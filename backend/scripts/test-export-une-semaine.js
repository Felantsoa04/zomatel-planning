/* TEST — RÈGLE MÉTIER « UN EXPORT = UNE SEULE SEMAINE » (READ-ONLY base,
 * sortie %TEMP%). Données réelles de la base de test :
 *   S45/2030 : CUISINE CANTINE (#40) — 04/11 → 10/11
 *   S39/2026 : Réception (#3) — 21/09 → 28/09
 *              Sécurité  (#49) — 21/09 → 27/09 (dates DIFFÉRENTES, même S39)
 * Vérifications :
 *   1. sélection multi-SERVICES de la MÊME semaine [3,49] -> UN SEUL classeur
 *      « Emploi_du_temps_2026_S39.xlsx » (PAS de ZIP, PAS un fichier par
 *      service), UNE FEUILLE par service, données réelles ;
 *   2. dates début/fin DIFFÉRENTES au sein de la même semaine (#3 et #49) :
 *      la sélection n'est PAS bloquée (dates = info affichée, jamais un
 *      critère) — les 2 plannings partent dans LE MÊME fichier ;
 *   3. semaine unique [40] -> un seul fichier direct (pas de ZIP) ;
 *   4. semaines MÉLANGÉES [3,40] -> l'interface RH l'interdit ; le serveur,
 *      lui, regroupe proprement par semaine (ZIP, un fichier par semaine) ;
 *   5. structure du modèle conservée (styles/theme/gabarit Sécurité) ;
 *   6. régressions : non VALIDÉ -> 403, liste vide -> 400.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const AdmZip = require('adm-zip');
const fs = require('fs');

const TEMP = process.env.TEMP || '/tmp';
const MODELE = path.resolve(__dirname, '..', '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');
const API = 'http://localhost:4000/api';
const RESIDUS = ['ANYAH', 'AVOTRA', 'AUGUSTIN', 'EDHINO', 'HERMANN', 'JEAN CHRYS', 'RAVAKA', 'ROLAND', 'ZIANI', 'JIMMY', 'MANOELA', 'CUISINE SNACK'];

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

  // Données réelles des plannings de test
  const IDs = [3, 40, 49];
  const donnees = {};
  for (const ID of IDs) {
    const [[p]] = await pool.query(
      `SELECT p.id_planning, p.numero_semaine, p.annee, p.date_debut_semaine, p.date_fin_semaine, s.nom_service
       FROM planning p JOIN service s ON s.id_service = p.service_id WHERE p.id_planning = ?`, [ID]);
    if (!p) { console.log(`planning #${ID} absent de la base de test`); process.exit(2); }
    donnees[ID] = p;
  }
  for (const ID of IDs) {
    const p = donnees[ID];
    console.log(`#${ID} : ${p.nom_service} — S${p.numero_semaine}/${p.annee} — ${String(p.date_debut_semaine).slice(0, 10)} -> ${String(p.date_fin_semaine).slice(0, 10)} (${String(p.date_fin_semaine).slice(0, 10) === String(p.date_debut_semaine).slice(0, 10) ? '1 jour' : 'plusieurs jours'})`);
  }

  /* ---- TEST 1 : plusieurs services de la MÊME semaine -> UN SEUL fichier -- */
  console.log('\n=== TEST 1 : [3, 49] même semaine S39 -> UN SEUL classeur ===');
  const e1 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [3, 49] }) });
  if (e1.status !== 200) { echec('HTTP ' + e1.status + ' : ' + await e1.text()); process.exit(1); }
  const type1 = e1.headers.get('content-type') || '';
  const tampon1 = Buffer.from(await e1.arrayBuffer());
  console.log('HTTP 200, type :', type1);
  if (/zip/.test(type1)) echec('une seule semaine doit donner un xlsx DIRECT, pas un ZIP');
  if (!/sheet/.test(type1)) echec('type MIME inattendu : ' + type1);
  const dispo1 = decodeURIComponent(e1.headers.get('content-disposition') || '');
  const nomAttendu1 = 'Emploi_du_temps_2026_S39.xlsx';
  if (!dispo1.includes(nomAttendu1)) echec(`nom attendu ${nomAttendu1}, reçu : ${dispo1}`);
  else console.log(`UN SEUL fichier direct : ${nomAttendu1} OK (pas de ZIP, pas un fichier par service)`);

  const z1 = new AdmZip(tampon1);
  const { noms: noms1, fichiers: fichiers1 } = onglets(z1);
  console.log('feuilles :', noms1.join(' | '));
  if (noms1.length !== 2) echec(`attendu 2 feuilles (une par service sélectionné), trouvé ${noms1.length}`);
  for (const [k, ID] of [3, 49].entries()) {
    const p = donnees[ID];
    if (noms1[k] !== p.nom_service) echec(`feuille ${k} : "${noms1[k]}" attendu "${p.nom_service}"`);
    const c = cellules(z1, fichiers1[k]).out;
    const titreAttendu = `EMPLOI DU TEMPS ${p.nom_service} WEEK ${p.numero_semaine}`;
    if (c['E2'] !== titreAttendu) echec(`#${ID} E2="${c['E2']}" attendu "${titreAttendu}"`);
    const residus = RESIDUS.filter((t) => cellules(z1, fichiers1[k]).xml.includes(t));
    if (residus.length) echec(`#${ID} résidus d'exemple : ${residus.join(', ')}`);
  }
  console.log('une feuille par service, titre format modèle, 0 donnée d\'exemple : OK');

  /* ---- TEST 2 : dates début/fin différentes, MÊME semaine -> sélectionnable */
  console.log('\n=== TEST 2 : dates différentes au sein de S39 (dates = info affichée) ===');
  const dates = [donnees[3], donnees[49]].map((p) =>
    `${p.nom_service}: ${String(p.date_debut_semaine).slice(0, 10)} -> ${String(p.date_fin_semaine).slice(0, 10)}`);
  console.log(dates.join('\n'));
  const memesSemaines = new Set([donnees[3], donnees[49]].map((p) => `${p.annee}-${p.numero_semaine}`));
  if (memesSemaines.size !== 1) echec('le jeu de test doit contenir 2 plannings de la MÊME semaine (3 et 49 en S39/2026)');
  else console.log('2 plannings de la semaine S39/2026 avec des périodes différentes : même critère SEMAINE (l\'API accepte leur export groupé — voir TEST 1)');

  // (la preuve serveur est déjà faite par le TEST 1 : un seul fichier, 2 feuilles)

  /* ---- TEST 3 : semaine unique S45 -> un seul fichier direct -------------- */
  console.log('\n=== TEST 3 : [40] semaine unique S45/2030 -> fichier direct ===');
  const e3 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [40] }) });
  if (e3.status !== 200) echec('HTTP ' + e3.status + ' ([40])');
  else {
    const dispo3 = decodeURIComponent(e3.headers.get('content-disposition') || '');
    if (!dispo3.includes('Emploi_du_temps_2030_S45.xlsx')) echec(`nom attendu Emploi_du_temps_2030_S45.xlsx, reçu : ${dispo3}`);
    else    console.log('semaine seule -> un fichier Emploi_du_temps_2030_S45.xlsx : OK');
  }

  /* ---- TEST 4 : deux semaines mélangées -> JAMAIS un seul classeur -------- */
  console.log('\n=== TEST 4 : [3 (S39) + 40 (S45)] mélangées -> ZIP, jamais un seul classeur ===');
  const e4 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [3, 40] }) });
  if (e4.status !== 200) { echec('HTTP ' + e4.status); }
  else {
    const type4 = e4.headers.get('content-type') || '';
    if (!/zip/.test(type4)) echec('deux semaines doivent produire une archive ZIP, reçu : ' + type4);
    const z4 = new AdmZip(Buffer.from(await e4.arrayBuffer()));
    const entrees = z4.getEntries().map((x) => x.entryName).sort();
    console.log('archive :', entrees.join(' | '));
    if (!entrees.includes('Emploi_du_temps_2026_S39.xlsx') || !entrees.includes('Emploi_du_temps_2030_S45.xlsx')) {
      echec('l\'archive doit contenir un fichier par semaine (S39 et S45)');
    } else {
      console.log('deux semaines ne sont JAMAIS fusionnées : un fichier par semaine dans l\'archive : OK');
      console.log('(côté interface RH, ce cas est IMPOSSIBLE : la sélection est limitée à une seule semaine)');
    }
  }

  /* ---- TEST 5 : structure du modèle conservée ----------------------------- */
  console.log('\n=== TEST 5 : structure du modèle Excel de référence ===');
  if (zm.getEntry('xl/styles.xml').getData().toString() !== z1.getEntry('xl/styles.xml').getData().toString()) echec('styles.xml diffère du modèle');
  if (zm.getEntry('xl/theme/theme1.xml').getData().toString() !== z1.getEntry('xl/theme/theme1.xml').getData().toString()) echec('theme1.xml diffère du modèle');
  const headM = zm.getEntry('xl/worksheets/sheet23.xml').getData().toString('utf8');
  const headModele = headM.slice(0, headM.indexOf('<sheetData>')).replace(/<dimension ref="[^"]*"\/>/, '');
  const x0 = z1.getEntry(fichiers1[0]).getData().toString('utf8');
  const headExport = x0.slice(0, x0.indexOf('<sheetData>')).replace(/<dimension ref="[^"]*"\/>/, '');
  if (headModele !== headExport) echec('gabarit de feuille différent du modèle (SECURITE sheet23)');
  else console.log('styles, thème et gabarit (feuille SECURITE) conservés à l\'identique du modèle : OK');

  /* ---- TEST 6 : régressions ---------------------------------------------- */
  console.log('\n=== TEST 6 : régressions (statut, liste vide) ===');
  const e403 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [40, 22] }) });
  console.log(`[40,22] (22 BROUILLON) : HTTP ${e403.status} (attendu 403)`);
  if (e403.status !== 403) echec('un planning non validé est passé');
  const e400 = await fetch(API + '/plannings/emploi-du-temps-multi.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ ids_plannings: [] }) });
  console.log(`liste vide : HTTP ${e400.status} (attendu 400)`);
  if (e400.status !== 400) echec('liste vide acceptée');

  console.log(ecarts === 0
    ? '\n=== RÈGLE « UN EXPORT = UNE SEMAINE » : PASSÉE — plusieurs services, dates libres, UN SEUL fichier ==='
    : `\n=== ${ecarts} écart(s) ===`);
  process.exit(ecarts === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR :', e); process.exit(1); });
