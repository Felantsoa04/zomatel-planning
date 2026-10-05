/* TEST — RÈGLE FINALE « regroupement par WEEK » (READ-ONLY base, %TEMP%) :
 *   Plannings A (#40 CUISINE CANTINE, WEEK 45) et B (#3 Réception, WEEK 39)
 *   — deux SERVICES, deux SEMAINES différentes.
 * Vérifications :
 *   1. export groupé [40,3] -> une ARCHIVE ZIP (2 WEEK différentes) contenant
 *      exactement 2 fichiers : Emploi_du_temps_2030_S45.xlsx et
 *      Emploi_du_temps_2026_S39.xlsx (1 WEEK = 1 fichier,
 *      jamais un fichier par service) ;
 *   2. WEEK_45.xlsx contient UNIQUEMENT la feuille CUISINE CANTINE ; WEEK_39.xlsx
 *      UNIQUEMENT Réception (titre « EMPLOI DU TEMPS <service> WEEK n », barre
 *      C5 SANS info de semaine, données réelles de chaque planning) ;
 *   3. structure du modèle conservée (styles.xml / theme identiques, gabarit
 *      de feuille 1 identique) ; AUCUNE feuille d'exemple dans les classeurs ;
 *   4. régressions : export simple GET -> 1 fichier ; refus non VALIDÉ -> 403 ;
 *      liste vide -> 400.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const AdmZip = require('adm-zip');
const fs = require('fs');

const TEMP = process.env.TEMP || '/tmp';
const MODELE = path.resolve(__dirname, '..', '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');
const API = 'http://localhost:4000/api';
const RESIDUS = ['ANYAH', 'AVOTRA', 'AUGUSTIN', 'EDHINO', 'HERMANN', 'JEAN CHRYS', 'RAVAKA', 'ROLAND', 'ZIANI', 'JIMMY', 'MANOELA', 'Stagiaire', 'CUISINE SNACK'];

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
function cellules(z, fichier) {
  const xml = z.getEntry(fichier).getData().toString('utf8');
  const out = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const t = (m[2].match(/t="(\w+)"/) || [])[1];
    let v = (m[3] || '').match(/<v>([\s\S]*?)<\/v>/);
    v = v ? v[1] : '';
    if (t === 'inlineStr') v = ((m[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || ['', ''])[1];
    out[m[1]] = v;
  }
  return { xml, out };
}

/* Vérifie UN classeur WEEK : onglets attendus, titre format modèle, barre C5
 * sans semaine, données du planning, aucun résidu, structure du modèle. */
function verifierClasseurWeek(zExp, planningAttendus, zm, echec) {
  const { noms, fichiers } = onglets(zExp);
  if (noms.length !== planningAttendus.length) echec(`attendu ${planningAttendus.length} feuille(s), trouvé ${noms.length}`);
  planningAttendus.forEach((att, k) => {
    const { planning, emps } = att;
    const c = cellules(zExp, fichiers[k]).out;
    const xml = zExp.getEntry(fichiers[k]).getData().toString('utf8');
    // Zone 1 : titre principal au format du modèle (WEEK conservé)
    const titreAttendu = `EMPLOI DU TEMPS ${planning.nom_service} WEEK ${planning.numero_semaine}`;
    if (c['E2'] !== titreAttendu) echec(`WEEK_${planning.numero_semaine} : E2="${c['E2']}" attendu "${titreAttendu}"`);
    // Zone 2 : barre multi-tâche SANS numéro/texte de semaine
    if (/WEEK|semaine/i.test(c['C5'] || '')) echec(`WEEK_${planning.numero_semaine} : barre C5 contient une semaine : "${c['C5']}"`);
    if (c['C5'] !== planning.nom_service) echec(`WEEK_${planning.numero_semaine} : C5="${c['C5']}" attendu "${planning.nom_service}"`);
    // Données réelles (RECAP : matricule + nom de chaque employé)
    emps.forEach((emp, i) => {
      // Gabarit Sécurité : bloc = 3+N+2 lignes, RECAP sans ligne de titre
      const r = 5 + 7 * (3 + emps.length + 2) + i;
      if (c['A' + r] !== (emp.matricule || '')) echec(`WEEK_${planning.numero_semaine} : RECAP A${r} incorrect`);
      if (c['B' + r] !== emp.nom) echec(`WEEK_${planning.numero_semaine} : RECAP B${r} incorrect`);
    });
    // Aucune donnée d'exemple
    const residus = RESIDUS.filter((t) => xml.includes(t));
    if (residus.length) echec(`WEEK_${planning.numero_semaine} : résidus ${residus.join(', ')}`);
  });
  // Structure du modèle : styles + theme identiques, gabarit feuille 1 identique
  if (zm.getEntry('xl/styles.xml').getData().toString() !== zExp.getEntry('xl/styles.xml').getData().toString()) echec('styles.xml diffère du modèle');
  if (zm.getEntry('xl/theme/theme1.xml').getData().toString() !== zExp.getEntry('xl/theme/theme1.xml').getData().toString()) echec('theme1.xml diffère du modèle');
  // Gabarit = feuille SECURITE (sheet23) du modèle
  const headM = zm.getEntry('xl/worksheets/sheet23.xml').getData().toString('utf8');
  const headModele = headM.slice(0, headM.indexOf('<sheetData>')).replace(/<dimension ref="[^"]*"\/>/, '');
  const x0 = zExp.getEntry(fichiers[0]).getData().toString('utf8');
  const headExport = x0.slice(0, x0.indexOf('<sheetData>')).replace(/<dimension ref="[^"]*"\/>/, '');
  if (headModele !== headExport) echec('gabarit de la feuille 1 différent du modèle');
  return noms;
}

(async () => {
  let ecarts = 0;
  const echec = (msg) => { ecarts++; console.log('ÉCART :', msg); };

  const zm = new AdmZip(MODELE);

  const lr = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }),
  });
  const lj = await lr.json();
  if (!lr.ok) { console.log('login KO'); process.exit(2); }
  const H = { Authorization: 'Bearer ' + lj.token, 'Content-Type': 'application/json' };

  const IDs = [40, 3];
  const donnees = {};
  for (const ID of IDs) {
    const [[planning]] = await pool.query(
      `SELECT p.numero_semaine, p.annee, s.nom_service
       FROM planning p JOIN service s ON s.id_service = p.service_id WHERE p.id_planning = ?`, [ID]);
    const [affs] = await pool.query(
      `SELECT a.employe_id, e.nom, e.matricule FROM affectation a
       JOIN employe e ON e.id_employe = a.employe_id WHERE a.planning_id = ? GROUP BY a.employe_id, e.nom, e.matricule ORDER BY e.nom`, [ID]);
    donnees[ID] = { planning, emps: affs };
  }

  // 1. Export groupé de 2 services / 2 WEEK différentes
  console.log('=== POST multi {ids:[40,3]} — 2 services, 2 WEEK différentes ===');
  const er = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: IDs }) });
  if (er.status !== 200) { echec('HTTP ' + er.status + ' : ' + await er.text()); process.exit(1); }
  const typeMime = er.headers.get('content-type') || '';
  const archiveZip = path.join(TEMP, 'export-semaines.zip');
  fs.writeFileSync(archiveZip, Buffer.from(await er.arrayBuffer()));
  console.log(`HTTP 200, type : ${typeMime}`);
  const estZip = /zip/.test(typeMime) || archiveZip.slice(-4).toLowerCase() === '.zip' && new AdmZip(archiveZip).getEntries().length > 0;

  let classeurs;
  if (estZip) {
    // RÈGLE : WEEK différentes -> fichiers DIFFÉRENTS dans une archive
    const z = new AdmZip(archiveZip);
    const entrees = z.getEntries().map((e) => e.entryName);
    console.log('archive ZIP :', entrees.join(' | '));
    if (entrees.length !== 2) echec('attendu 2 fichiers WEEK dans l\'archive');
    if (!entrees.includes('Emploi_du_temps_2030_S45.xlsx')) echec('Emploi_du_temps_2030_S45.xlsx absent de l\'archive');
    if (!entrees.includes('Emploi_du_temps_2026_S39.xlsx')) echec('Emploi_du_temps_2026_S39.xlsx absent de l\'archive');
    classeurs = {
      45: new AdmZip(z.getEntry('Emploi_du_temps_2030_S45.xlsx').getData()),
      39: new AdmZip(z.getEntry('Emploi_du_temps_2026_S39.xlsx').getData()),
    };
  } else {
    echec('2 WEEK différentes devraient produire une archive ZIP, pas un seul classeur');
    process.exit(1);
  }

  // 2/3. Contenu de chaque fichier WEEK (2 services distincts au total)
  const servicesAttendus = new Set(IDs.map((ID) => donnees[ID].planning.nom_service));
  console.log(`services distincts attendus : ${[...servicesAttendus].join(', ')}`);
  verifierClasseurWeek(classeurs[45], [{ planning: donnees[40].planning, emps: donnees[40].emps }], zm, echec);
  console.log('Emploi_du_temps_2030_S45.xlsx : feuille unique CUISINE CANTINE, titre WEEK 45, barre sans semaine, données réelles — OK');
  verifierClasseurWeek(classeurs[39], [{ planning: donnees[3].planning, emps: donnees[3].emps }], zm, echec);
  console.log('Emploi_du_temps_2026_S39.xlsx : feuille unique Réception, titre WEEK 39, barre sans semaine, données réelles — OK');

  // 4. Régressions
  const es = await fetch(API + '/plannings/40/emploi-du-temps.xlsx', { headers: H });
  console.log(`export simple : HTTP ${es.status} (attendu 200)`);
  if (es.status !== 200) echec('export simple cassé');
  const e22 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [40, 22] }) });
  console.log(`[40,22] (22 BROUILLON) : HTTP ${e22.status} (attendu 403)`);
  if (e22.status !== 403) echec('un non validé est passé');
  const e0 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [] }) });
  console.log(`liste vide : HTTP ${e0.status} (attendu 400)`);
  if (e0.status !== 400) echec('liste vide acceptée');

  console.log(ecarts === 0
    ? '\n=== RÈGLE PAR WEEK : PASSÉE — 1 WEEK = 1 fichier, tous les services de la semaine regroupés, modèle = structure uniquement ==='
    : `\n=== ${ecarts} écart(s) ===`);
  process.exit(ecarts === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR :', e); process.exit(1); });
