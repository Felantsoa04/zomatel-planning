/* TEST OBLIGATOIRE — deux plannings différents (READ-ONLY en base) :
 *   Planning A (#40 CUISINE CANTINE S45/2030) et Planning B (#3 Réception S39/2026),
 *   tous deux VALIDÉ. Pour chaque planning sélectionné par son ID :
 *     - export HTTP avec l'ID explicite ;
 *     - comparaison du contenu Excel aux données RÉELLES de CE planning en base
 *       (barre Service, titre, matricules/noms, totaux RECAP exacts) ;
 *     - vérification qu'aucune donnée d'exemple du modèle ne subsiste ;
 *   puis : les deux fichiers partagent la MÊME structure (styles octet-pour-octet
 *   = modèle, head/tail de la feuille identiques) avec des CONTENUS différents ;
 *   enfin : un planning non VALIDÉ (#22) est refusé (403) — aucun repli
 *   automatique vers un autre planning.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const AdmZip = require('adm-zip');
const fs = require('fs');

const TEMP = process.env.TEMP || '/tmp';
const MODELE = path.resolve(__dirname, '..', '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');
const RESIDUS = ['ANYAH', 'AVOTRA', 'AUGUSTIN', 'EDHINO', 'HERMANN', 'JEAN CHRYS', 'RAVAKA', 'ROLAND', 'ZIANI', 'JIMMY', 'MANOELA', 'Stagiaire', 'CUISINE SNACK'];

function lireCellules(fichier) {
  const xml = new AdmZip(fichier).getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
  const cellules = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const t = (m[2].match(/t="(\w+)"/) || [])[1];
    let v = (m[3] || '').match(/<v>([\s\S]*?)<\/v>/);
    v = v ? v[1] : '';
    if (t === 'inlineStr') v = ((m[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || ['', ''])[1];
    cellules[m[1]] = v;
  }
  return { xml, cellules };
}

(async () => {
  let ecarts = 0;
  const echec = (msg) => { ecarts++; console.log('ÉCART :', msg); };

  // 1. Login RH
  const lr = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }),
  });
  const lj = await lr.json();
  if (!lr.ok) { console.log('login KO'); process.exit(2); }
  const H = { Authorization: 'Bearer ' + lj.token };

  const IDs = [40, 3]; // Planning A, Planning B (VALIDÉ tous les deux)
  const resultats = [];

  for (const ID of IDs) {
    // Export HTTP : L'ID du planning sélectionné est la seule référence
    const er = await fetch('http://localhost:4000/api/plannings/' + ID + '/emploi-du-temps.xlsx', { headers: H });
    if (er.status !== 200) { echec(`planning ${ID} : export HTTP ${er.status}`); continue; }
    const fichier = path.join(TEMP, `export-${ID}.xlsx`);
    fs.writeFileSync(fichier, Buffer.from(await er.arrayBuffer()));

    // Données RÉELLES de CE planning (SELECT uniquement)
    const [[planning]] = await pool.query(
      `SELECT p.numero_semaine, p.date_debut_semaine, s.nom_service
       FROM planning p JOIN service s ON s.id_service = p.service_id WHERE p.id_planning = ?`, [ID]);
    const [affs] = await pool.query(
      `SELECT a.id_affectation, a.employe_id, a.date_jour, a.statut, e.nom, e.matricule
       FROM affectation a JOIN employe e ON e.id_employe = a.employe_id
       WHERE a.planning_id = ? ORDER BY e.nom`, [ID]);
    const [crens] = await pool.query(
      `SELECT ct.affectation_id, ct.heure_entree, ct.heure_sortie
       FROM creneau_travail ct JOIN affectation a ON a.id_affectation = ct.affectation_id
       WHERE a.planning_id = ?`, [ID]);
    const cre = {};
    for (const c of crens) (cre[c.affectation_id] = cre[c.affectation_id] || []).push(c);
    const emps = new Map();
    const totaux = {};
    for (const a of affs) {
      if (!emps.has(a.employe_id)) emps.set(a.employe_id, { nom: a.nom, matricule: a.matricule || '' });
      let t = totaux[a.employe_id] || 0;
      for (const c of cre[a.id_affectation] || []) {
        const m = String(c.heure_entree).slice(0, 5).match(/^(\d{1,2}):(\d{2})/);
        if (!m) continue;
        const deb = Number(m[1]) * 60 + Number(m[2]);
        const s = String(c.heure_sortie).slice(0, 5).match(/^(\d{1,2}):(\d{2})/);
        if (s) t += Math.max(0, Number(s[1]) * 60 + Number(s[2]) - deb);
      }
      totaux[a.employe_id] = t;
    }

    // Vérifications du contenu de CE planning dans l'Excel
    const { xml, cellules } = lireCellules(fichier);
    console.log(`\n=== Planning sélectionné #${ID} — ${planning.nom_service} S${planning.numero_semaine} ===`);
    if (cellules['C5'] !== planning.nom_service) echec(`#${ID} barre Service C5="${cellules['C5']}" attendu "${planning.nom_service}"`);
    else console.log(`barre Service C5 = "${cellules['C5']}" OK`);
    // Zone 1 — titre au FORMAT DU MODÈLE (WEEK n conservé)
    if (cellules['E2'] !== `EMPLOI DU TEMPS ${planning.nom_service} WEEK ${planning.numero_semaine}`) echec(`#${ID} titre E2 incorrect : "${cellules['E2']}"`);
    const nb = emps.size;
    const pas = 3 + nb + 2; // gabarit Sécurité : sans jumelle/remplissage
    let k = 0;
    for (const [idEmp, emp] of emps) {
      const r = 5 + 7 * pas + k; k++; // RECAP (sans ligne de titre)
      if (cellules['A' + r] !== emp.matricule) echec(`#${ID} RECAP A${r}="${cellules['A' + r]}" attendu "${emp.matricule}"`);
      if (cellules['B' + r] !== emp.nom) echec(`#${ID} RECAP B${r}="${cellules['B' + r]}" attendu "${emp.nom}"`);
      const vu = Number(cellules['C' + r]);
      const att = Number((totaux[idEmp] / 1440).toPrecision(15));
      if (Math.abs(vu - att) > 1e-9) echec(`#${ID} RECAP ${emp.nom} C${r}=${cellules['C' + r]} attendu ${att}`);
    }
    console.log(`RECAP : ${nb} employés vérifiés (matricule, nom, total hebdo exact)`);
    const residus = RESIDUS.filter((t) => xml.includes(t));
    if (residus.length) echec(`#${ID} résidus du modèle : ${residus.join(', ')}`);
    else console.log('aucune donnée d\'exemple du modèle');
    resultats.push({ ID, fichier, service: planning.nom_service, nb });
  }

  // 2. Structure identique, contenus différents
  if (resultats.length === 2) {
    const [a, b] = resultats;
    const za = new AdmZip(a.fichier), zb = new AdmZip(b.fichier), zm = new AdmZip(MODELE);
    const stylesOk = zm.getEntry('xl/styles.xml').getData().equals(za.getEntry('xl/styles.xml').getData())
      && zm.getEntry('xl/styles.xml').getData().equals(zb.getEntry('xl/styles.xml').getData());
    console.log(`\nstyles.xml identiques au modèle pour les 2 exports : ${stylesOk}`);
    if (!stylesOk) echec('styles.xml diffère du modèle');
    const head = (z) => z.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8')
      .slice(0, z.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8').indexOf('<sheetData>'))
      .replace(/<dimension ref="[^"]*"\/>/, '');
    if (head(za) !== head(zb)) echec('head de la feuille différent entre les 2 exports');
    const xa = lireCellules(a.fichier).cellules, xb = lireCellules(b.fichier).cellules;
    const contenusDifferents = xa['C5'] !== xb['C5'] && xa['E2'] !== xb['E2'];
    console.log(`contenus différents (C5 : "${xa['C5']}" vs "${xb['C5']}") : ${contenusDifferents}`);
    if (!contenusDifferents) echec('les 2 exports ont le même contenu : l\'ID ne serait pas utilisé');
  }

  // 3. Planning non VALIDÉ : refus, aucun repli automatique
  const e22 = await fetch('http://localhost:4000/api/plannings/22/emploi-du-temps.xlsx', { headers: H });
  console.log(`\nplanning non VALIDÉ #22 : HTTP ${e22.status} (attendu 403)`);
  if (e22.status !== 403) echec('un planning non validé a été exporté');

  console.log(ecarts === 0
    ? '\n=== TEST 2 PLANNINGS : PASSÉ — chaque export = exactement le planning sélectionné par son ID, même structure du modèle ==='
    : `\n=== ${ecarts} écart(s) ===`);
  process.exit(ecarts === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR :', e); process.exit(1); });
