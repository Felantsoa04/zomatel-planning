/* TEST — export GROUPÉ PAR SEMAINE (règle finale) : N plannings validés ->
 * fichiers regroupés par WEEK (READ-ONLY en base, sortie dans %TEMP%).
 *   Plannings A (#40 CUISINE CANTINE, WEEK 45) et B (#3 Réception, WEEK 39).
 * Vérifications :
 *   1. POST multi {ids:[40,3]} : 2 WEEK différentes -> UNE ARCHIVE ZIP avec
 *      exactement Emploi_du_temps_2030_S45.xlsx et Emploi_du_temps_2026_S39.xlsx
 *      (jamais un fichier par service) ;
 *   2. chaque classeur = les feuilles de SA semaine ; onglet = service seul ;
 *   3. zone 1 : titre « EMPLOI DU TEMPS <service> WEEK n » (format modèle) ;
 *      zone 2 : barre C5 SANS aucune info de semaine ;
 *   4. RECAP = données réelles de chaque planning (matricule, nom, total
 *      hebdo exact) ; aucun résidu d'exemple ;
 *   5. structure du modèle conservée (styles/theme octet-pour-octet, gabarit
 *      feuille 1 identique) ;
 *   6. régressions : export simple GET = feuille identique ; refus non
 *      VALIDÉ -> 403 ; liste vide -> 400.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const AdmZip = require('adm-zip');
const fs = require('fs');

const TEMP = process.env.TEMP || '/tmp';
const MODELE = path.resolve(__dirname, '..', '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');
const RESIDUS = ['ANYAH', 'AVOTRA', 'AUGUSTIN', 'EDHINO', 'HERMANN', 'JEAN CHRYS', 'RAVAKA', 'ROLAND', 'ZIANI', 'JIMMY', 'MANOELA', 'Stagiaire', 'CUISINE SNACK'];
const API = 'http://localhost:4000/api';

function onglets(z) {
  const wb = z.getEntry('xl/workbook.xml').getData().toString('utf8');
  const noms = (wb.match(/<sheet name="([^"]*)"/g) || []).map((s) => s.match(/name="([^"]*)"/)[1]);
  const rels = z.getEntry('xl/_rels/workbook.xml.rels').getData().toString('utf8');
  const cible = {};
  for (const m of rels.matchAll(/<Relationship [^>]*Type="[^"]*\/worksheet"[^>]*>/g)) {
    cible[(m[0].match(/Id="(rId\d+)"/) || [])[1]] = 'xl/' + (m[0].match(/Target="([^"]*)"/) || [])[1].replace(/^\//, '');
  }
  const fichiers = (wb.match(/<sheet [^>]*r:id="(rId\d+)"[^>]*\/>/g) || []).map((s) => cible[(s.match(/r:id="(rId\d+)"/) || [])[1]]);
  return { noms, fichiers };
}
function lireCellules(z, cible) {
  const xml = z.getEntry(cible).getData().toString('utf8');
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
  const zm = new AdmZip(MODELE);

  // Login RH
  const lr = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }),
  });
  const lj = await lr.json();
  if (!lr.ok) { console.log('login KO'); process.exit(2); }
  const H = { Authorization: 'Bearer ' + lj.token };

  const IDs = [40, 3];
  const donnees = {};
  for (const ID of IDs) {
    const [[planning]] = await pool.query(
      `SELECT p.numero_semaine, p.annee, s.nom_service
       FROM planning p JOIN service s ON s.id_service = p.service_id WHERE p.id_planning = ?`, [ID]);
    const [affs] = await pool.query(
      `SELECT a.id_affectation, a.employe_id, e.nom, e.matricule FROM affectation a
       JOIN employe e ON e.id_employe = a.employe_id WHERE a.planning_id = ? ORDER BY e.nom`, [ID]);
    const empsDedup = [];
    const vus = new Set();
    for (const a of affs) { if (!vus.has(a.employe_id)) { vus.add(a.employe_id); empsDedup.push(a); } }
    const [crens] = await pool.query(
      `SELECT ct.affectation_id, ct.heure_entree, ct.heure_sortie
       FROM creneau_travail ct JOIN affectation a ON a.id_affectation = ct.affectation_id
       WHERE a.planning_id = ?`, [ID]);
    const affParEmp = {};
    for (const a of affs) affParEmp[a.id_affectation] = a.employe_id;
    const totaux = {};
    for (const c of crens) {
      const emp = affParEmp[c.affectation_id];
      if (emp === undefined) continue;
      const m = String(c.heure_entree).slice(0, 5).match(/^(\d{1,2}):(\d{2})/);
      const s = String(c.heure_sortie).slice(0, 5).match(/^(\d{1,2}):(\d{2})/);
      if (!m || !s) continue;
      totaux[emp] = (totaux[emp] || 0) + Math.max(0, Number(s[1]) * 60 + Number(s[2]) - (Number(m[1]) * 60 + Number(m[2])));
    }
    donnees[ID] = { planning, emps: empsDedup, totaux };
  }

  // 1. Export groupé : 2 services, 2 WEEK différentes -> archive ZIP
  console.log('=== POST multi {ids:[40,3]} — 2 services, 2 WEEK différentes ===');
  const er = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids_plannings: IDs }),
  });
  if (er.status !== 200) { echec('HTTP ' + er.status + ' : ' + await er.text()); process.exit(1); }
  const fichierZip = path.join(TEMP, 'export-multi-semaines.zip');
  fs.writeFileSync(fichierZip, Buffer.from(await er.arrayBuffer()));
  const zArchive = new AdmZip(fichierZip);
  const entrees = zArchive.getEntries().map((e) => e.entryName).sort();
  console.log('HTTP 200 — archive :', entrees.join(' | '));
  if (entrees.length !== 2) echec('2 WEEK différentes -> 2 fichiers attendus dans l\'archive');
  if (!entrees.includes('Emploi_du_temps_2030_S45.xlsx')) echec('Emploi_du_temps_2030_S45.xlsx absent');
  if (!entrees.includes('Emploi_du_temps_2026_S39.xlsx')) echec('Emploi_du_temps_2026_S39.xlsx absent');

  // 2-5. Vérification de chaque classeur WEEK
  const verifierClasseur = (nomEntree, ID) => {
    const { planning, emps, totaux } = donnees[ID];
    const zExp = new AdmZip(zArchive.getEntry(nomEntree).getData());
    const { noms, fichiers } = onglets(zExp);
    console.log(`\n--- ${nomEntree} : planning #${ID} (${planning.nom_service} WEEK ${planning.numero_semaine}) ---`);
    if (noms.length !== 1) echec(`${nomEntree} doit contenir 1 feuille (son service), trouvé ${noms.length}`);
    if (noms[0] !== planning.nom_service) echec(`${nomEntree} onglet "${noms[0]}" attendu "${planning.nom_service}"`);
    const { cellules, xml } = lireCellules(zExp, fichiers[0]);
    // Zone 1 : titre principal au format du modèle (WEEK conservé)
    const titreAttendu = `EMPLOI DU TEMPS ${planning.nom_service} WEEK ${planning.numero_semaine}`;
    if (cellules['E2'] !== titreAttendu) echec(`${nomEntree} E2="${cellules['E2']}" attendu "${titreAttendu}"`);
    else console.log(`titre E2 = "${cellules['E2']}" OK`);
    // Zone 2 : barre multi-tâche SANS numéro/texte de semaine
    if (/WEEK|semaine/i.test(cellules['C5'] || '')) echec(`${nomEntree} barre C5 avec semaine : "${cellules['C5']}"`);
    if (cellules['C5'] !== planning.nom_service) echec(`${nomEntree} C5="${cellules['C5']}" attendu "${planning.nom_service}"`);
    else console.log(`barre C5 = "${cellules['C5']}" OK (sans semaine)`);
    // RECAP : données réelles du planning
    emps.forEach((emp, i) => {
      // Gabarit Sécurité : bloc = 3+N+2 lignes, RECAP sans ligne de titre
      const r = 5 + 7 * (3 + emps.length + 2) + i;
      if (cellules['A' + r] !== (emp.matricule || '')) echec(`${nomEntree} RECAP A${r}="${cellules['A' + r]}" attendu "${emp.matricule}"`);
      if (cellules['B' + r] !== emp.nom) echec(`${nomEntree} RECAP B${r}="${cellules['B' + r]}" attendu "${emp.nom}"`);
      const vu = Number(cellules['C' + r]);
      const att = Number(((totaux[emp.employe_id] || 0) / 1440).toPrecision(15));
      if (Math.abs(vu - att) > 1e-9) echec(`${nomEntree} RECAP ${emp.nom} C${r}=${cellules['C' + r]} attendu ${att}`);
    });
    console.log(`RECAP : ${emps.length} employés vérifiés (matricule, nom, total hebdo exact)`);
    const residus = RESIDUS.filter((t) => xml.includes(t));
    if (residus.length) echec(`${nomEntree} résidus : ${residus.join(', ')}`);
    else console.log('aucune donnée d\'exemple du modèle');
    // Structure du modèle conservée
    if (zm.getEntry('xl/styles.xml').getData().toString() !== zExp.getEntry('xl/styles.xml').getData().toString()) echec(`${nomEntree} styles.xml diffère du modèle`);
    if (zm.getEntry('xl/theme/theme1.xml').getData().toString() !== zExp.getEntry('xl/theme/theme1.xml').getData().toString()) echec(`${nomEntree} theme1.xml diffère du modèle`);
    // Gabarit = feuille SECURITE (sheet23) du modèle
    const headM = zm.getEntry('xl/worksheets/sheet23.xml').getData().toString('utf8');
    const headModele = headM.slice(0, headM.indexOf('<sheetData>')).replace(/<dimension ref="[^"]*"\/>/, '');
    const x0 = zExp.getEntry(fichiers[0]).getData().toString('utf8');
    const headExport = x0.slice(0, x0.indexOf('<sheetData>')).replace(/<dimension ref="[^"]*"\/>/, '');
    if (headModele !== headExport) echec(`${nomEntree} gabarit de feuille différent du modèle`);
    else console.log('structure du modèle conservée (styles, theme, gabarit)');
    return { zExp, fichiers };
  };

  const w45 = verifierClasseur('Emploi_du_temps_2030_S45.xlsx', 40);
  const w39 = verifierClasseur('Emploi_du_temps_2026_S39.xlsx', 3);

  // 6. Régressions
  const es = await fetch(API + '/plannings/40/emploi-du-temps.xlsx', { headers: H });
  if (es.status !== 200) echec('export simple HTTP ' + es.status);
  else {
    const fSimple = path.join(TEMP, 'export-simple-40.xlsx');
    fs.writeFileSync(fSimple, Buffer.from(await es.arrayBuffer()));
    const { cellules: cSimple } = lireCellules(new AdmZip(fSimple), 'xl/worksheets/sheet1.xml');
    const { cellules: cWeek } = lireCellules(w45.zExp, w45.fichiers[0]);
    const identique = Object.keys(cWeek).every((ref) => cSimple[ref] === cWeek[ref]) && Object.keys(cSimple).length === Object.keys(cWeek).length;
    if (!identique) echec('l\'export simple diffère de la feuille S45');
    else console.log('\nexport simple inchangé : feuille identique à Emploi_du_temps_2030_S45.xlsx');
  }
  const e22 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids_plannings: [40, 22] }) });
  console.log(`[40,22] (22 BROUILLON) : HTTP ${e22.status} (attendu 403)`);
  if (e22.status !== 403) echec('un non validé est passé');
  const e0 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids_plannings: [] }) });
  console.log(`liste vide : HTTP ${e0.status} (attendu 400)`);
  if (e0.status !== 400) echec('liste vide acceptée');

  console.log(ecarts === 0
    ? '\n=== EXPORT GROUPÉ PAR SEMAINE : PASSÉ — 1 WEEK = 1 fichier, tous les services regroupés, modèle = structure uniquement ==='
    : `\n=== ${ecarts} écart(s) ===`);
  process.exit(ecarts === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR :', e); process.exit(1); });
