/* TEST — « TOUT EXPORTER » avec la RÈGLE PAR WEEK (READ-ONLY base, %TEMP%) :
 *   POST multi sans liste = TOUS les plannings validés accessibles.
 * En base : #40 CUISINE CANTINE (WEEK 45/2030) et #3 Réception (WEEK 39/2026)
 *   -> 2 WEEK différentes -> UNE ARCHIVE ZIP contenant Emploi_du_temps_2026_S39.xlsx
 *      et Emploi_du_temps_2030_S45.xlsx (1 WEEK = 1 fichier, tous les services).
 * Vérifications :
 *   1. POST {} -> ZIP avec exactement un fichier xlsx par semaine présente ;
 *   2. chaque classeur : onglet = service seul, titre « EMPLOI DU TEMPS
 *      <service> WEEK n », barre C5 SANS semaine, données réelles, 0 résidu ;
 *   3. structure du modèle conservée (styles/theme/gabarit) ;
 *   4. liste mono-semaine [40] -> xlsx DIRECT nommé Emploi_du_temps_2030_S45.xlsx ;
 *   5. régressions : [40,22] -> 403, [] -> 400.
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

  // Attendu : tous les plannings VALIDE
  const [valides] = await pool.query(
    `SELECT p.id_planning, p.numero_semaine, p.annee, s.nom_service
     FROM planning p JOIN service s ON s.id_service = p.service_id
     WHERE p.statut = 'VALIDE' ORDER BY p.annee, p.numero_semaine, s.nom_service`
  );
  const semaines = [...new Set(valides.map((v) => v.numero_semaine))];
  // Année réelle de chaque semaine (pour les noms de fichiers attendus)
  const anneesParSemaine = {};
  for (const v of valides) anneesParSemaine[v.numero_semaine] = v.annee;
  console.log(`plannings VALIDE : ${valides.length} (#${valides.map((v) => v.id_planning).join(', #')}) — semaines : ${semaines.join(', ')}`);
  if (valides.length === 0) { console.log('rien à tester'); process.exit(1); }

  // 1. POST {} = tous -> 2 semaines en base -> archive ZIP attendue
  console.log('\n=== POST {} (tous les validés) ===');
  const er = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: '{}' });
  if (er.status !== 200) { echec('HTTP ' + er.status + ' : ' + await er.text()); process.exit(1); }
  const type = er.headers.get('content-type') || '';
  const tampon = Buffer.from(await er.arrayBuffer());
  console.log('HTTP 200, type :', type);

  const classeurs = {}; // numero_semaine -> AdmZip
  if (semaines.length > 1) {
    if (!/zip/.test(type)) echec('plusieurs WEEK -> archive ZIP attendue, reçu ' + type);
    const z = new AdmZip(tampon);
    const entrees = z.getEntries().map((e) => e.entryName).sort();
    console.log('archive ZIP :', entrees.join(' | '));
    for (const sem of semaines) {
      const nom = `Emploi_du_temps_${anneesParSemaine[sem]}_S${sem}.xlsx`;
      if (!entrees.includes(nom)) { echec(`${nom} absent de l'archive`); continue; }
      classeurs[sem] = new AdmZip(z.getEntry(nom).getData());
    }
    if (entrees.length !== semaines.length) echec('l\'archive doit contenir exactement un fichier par semaine');
  } else {
    if (!/sheet/.test(type)) echec('une seule WEEK -> xlsx direct attendu');
    classeurs[semaines[0]] = new AdmZip(tampon);
  }

  // 2-3. Vérification de chaque classeur WEEK (feuille par feuille)
  const parSemaine = {};
  for (const v of valides) (parSemaine[v.numero_semaine] = parSemaine[v.numero_semaine] || []).push(v);
  for (const [semStr, liste] of Object.entries(parSemaine)) {
    const sem = Number(semStr);
    const zExp = classeurs[sem];
    if (!zExp) continue;
    const { noms, fichiers } = onglets(zExp);
    console.log(`\n--- Emploi_du_temps_${anneesParSemaine[sem]}_S${sem}.xlsx : ${liste.length} service(s) — ${liste.map((v) => v.nom_service).join(', ')} ---`);
    if (noms.length !== liste.length) echec(`WEEK_${sem} : ${liste.length} feuilles attendues, trouvé ${noms.length}`);
    liste.forEach((v, k) => {
      const c = cellules(zExp, fichiers[k]).out;
      const { xml } = cellules(zExp, fichiers[k]);
      if (noms[k] !== v.nom_service) echec(`WEEK_${sem} onglet "${noms[k]}" attendu "${v.nom_service}"`);
      const titreAttendu = `EMPLOI DU TEMPS ${v.nom_service} WEEK ${v.numero_semaine}`;
      if (c['E2'] !== titreAttendu) echec(`#${v.id_planning} E2="${c['E2']}" attendu "${titreAttendu}"`);
      if (/WEEK|semaine/i.test(c['C5'] || '')) echec(`#${v.id_planning} barre C5 avec semaine : "${c['C5']}"`);
      if (c['C5'] !== v.nom_service) echec(`#${v.id_planning} C5="${c['C5']}" attendu "${v.nom_service}"`);
      const residus = RESIDUS.filter((t) => xml.includes(t));
      if (residus.length) echec(`#${v.id_planning} résidus : ${residus.join(', ')}`);
    });
    // Structure du modèle conservée
    if (zm.getEntry('xl/styles.xml').getData().toString() !== zExp.getEntry('xl/styles.xml').getData().toString()) echec(`S${sem} styles.xml diffère`);
    if (zm.getEntry('xl/theme/theme1.xml').getData().toString() !== zExp.getEntry('xl/theme/theme1.xml').getData().toString()) echec(`S${sem} theme1.xml diffère`);
    console.log(`titre format modèle + barre sans semaine + 0 résidu + structure modèle : OK pour ${liste.length} feuille(s)`);
  }

  // 4. Liste mono-semaine [40] -> xlsx DIRECT nommé WEEK_<45>.xlsx
  const [[p40]] = await pool.query(`SELECT numero_semaine, annee FROM planning WHERE id_planning = 40`);
  const e1 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [40] }) });
  console.log(`\nliste mono-semaine [40] : HTTP ${e1.status}, type ${e1.headers.get('content-type')}`);
  if (e1.status !== 200) echec('[40] refusé');
  else {
    if (!/sheet/.test(e1.headers.get('content-type') || '')) echec('une seule WEEK doit renvoyer un xlsx direct');
    const dispo = (e1.headers.get('content-disposition') || '');
    const nomAttendu = encodeURIComponent(`Emploi_du_temps_${p40.annee}_S${p40.numero_semaine}.xlsx`);
    if (!dispo.includes(nomAttendu)) echec(`nom de fichier attendu Emploi_du_temps_${p40.annee}_S${p40.numero_semaine}.xlsx, reçu : ${decodeURIComponent(dispo)}`);
    else console.log(`fichier unique direct : Emploi_du_temps_${p40.annee}_S${p40.numero_semaine}.xlsx OK (1 semaine = 1 fichier)`);
  }

  // 5. Régressions
  const e22 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [40, 22] }) });
  console.log(`[40,22] (22 BROUILLON) : HTTP ${e22.status} (attendu 403)`);
  if (e22.status !== 403) echec('un non validé est passé');
  const e0 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [] }) });
  console.log(`liste vide : HTTP ${e0.status} (attendu 400)`);
  if (e0.status !== 400) echec('liste vide acceptée');

  console.log(ecarts === 0
    ? '\n=== « TOUT EXPORTER » PAR WEEK : PASSÉ — un fichier par semaine, tous les services regroupés, modèle = structure uniquement ==='
    : `\n=== ${ecarts} écart(s) ===`);
  process.exit(ecarts === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR :', e); process.exit(1); });
