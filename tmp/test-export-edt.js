/* Test de bout en bout de la chaîne demandée :
 *   PLANNING -> VALIDATION -> GÉNÉRATION -> EXPORT EXCEL fidèle au modèle.
 * Chef temporaire : crée un planning, saisit plusieurs employés/jours/horaires
 * (dont Repos et Congé), soumet ; RH valide ; l'export xlsx est téléchargé
 * puis comparé au modèle. Nettoyage complet à la fin.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BACK = 'http://localhost:4000/api';
const MODELE = path.resolve(__dirname, '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');

function req(method, path, token, body, brut) {
  return new Promise((resolve, reject) => {
    const r = http.request(BACK + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (res) => {
      if (brut) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
        return;
      }
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: null }); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
let echecs = 0;
function check(nom, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + nom + (detail ? ' — ' + detail : ''));
  if (!cond) echecs++;
}

(async () => {
  // 1. Chef temporaire (Cuisine)
  const rh = await req('POST', '/auth/login', null, { login: 'rh', mot_de_passe: 'rh123' });
  const T = rh.body.token;
  const services = await req('GET', '/services', T);
  const cuisine = services.body.find((s) => /cuisine/i.test(s.nom || ''));
  const suffix = Date.now().toString().slice(-5);
  const loginChef = 'chef_edt_x_' + suffix;
  const cr = await req('POST', '/auth/users', T, { nom: 'TEST', login: loginChef, mot_de_passe: 'Test1234!', role: 'CHEF_SERVICE', id_service: cuisine.id_service });
  const idChef = cr.body.id_utilisateur;
  const chef = await req('POST', '/auth/login', null, { login: loginChef, mot_de_passe: 'Test1234!' });
  const TC = chef.body.token;
  const emps = await req('GET', '/employes', TC);
  const trois = (emps.body || []).slice(0, 3);
  check('Setup : chef + employés Cuisine', trois.length >= 2, trois.map((e) => e.nom).join(', '));

  // 2. Création planning (semaine unique par exécution : anti-doublon) + saisie
  const annee = 2030;
  const semaine = 40 + (Number(suffix) % 9); // 40..48, unique par test
  const lundi = new Date(Date.UTC(2030, 0, 4));
  lundi.setUTCDate(lundi.getUTCDate() + (semaine - 1) * 7 - ((lundi.getUTCDay() + 6) % 7));
  const iso = (d) => d.toISOString().slice(0, 10);
  const jours = Array.from({ length: 7 }, (_, i) => iso(new Date(lundi.getTime() + i * 86400000)));
  const cp = await req('POST', '/plannings', TC, { annee, numero_semaine: semaine, date_debut: jours[0], date_fin: jours[6] });
  const idP = cp.body.id_planning;
  if (!idP) return console.log('ECHEC creation planning :', cp.status, JSON.stringify(cp.body).slice(0, 120));
  const cellules = [
    { id_employe: trois[0].id_employe, jour: jours[0], statut_jour: 'TRAVAIL', creneau: { periode: 'MATIN', heure_entree: '08:00', heure_sortie: '16:00' } },
    { id_employe: trois[0].id_employe, jour: jours[1], statut_jour: 'TRAVAIL', creneau: { periode: 'APRES_MIDI', heure_entree: '10:00', heure_sortie: '18:00' } },
    { id_employe: trois[0].id_employe, jour: jours[2], statut_jour: 'REPOS', creneau: null },
    { id_employe: trois[0].id_employe, jour: jours[3], statut_jour: 'TRAVAIL', creneau: { periode: 'SOIR', heure_entree: '19:00', heure_sortie: '23:00' } },
    { id_employe: trois[1].id_employe, jour: jours[0], statut_jour: 'TRAVAIL', creneau: { periode: 'MATIN', heure_entree: '06:00', heure_sortie: '12:00' } },
    { id_employe: trois[1].id_employe, jour: jours[1], statut_jour: 'TRAVAIL', creneau: { periode: 'MATIN', heure_entree: '06:00', heure_sortie: '12:00' } },
    { id_employe: trois[1].id_employe, jour: jours[2], statut_jour: 'CONGE', creneau: null },
    { id_employe: trois[1].id_employe, jour: jours[3], statut_jour: 'TRAVAIL', creneau: { periode: 'APRES_MIDI', heure_entree: '12:00', heure_sortie: '18:00' } },
    { id_employe: trois[2] ? trois[2].id_employe : trois[0].id_employe, jour: jours[0], statut_jour: 'ABSENCE', creneau: null },
  ];
  const sv = await req('PUT', '/plannings/' + idP + '/grille', TC, { cellules });
  check('Saisie grille (3 employés, 4 jours, horaires variés)', sv.status === 200 && (sv.body.resultats || []).every((r) => r.ok), sv.status + ' ' + JSON.stringify((sv.body.resultats || []).filter((r) => !r.ok)).slice(0, 80));

  // 3. Soumission + validation RH (workflow existant)
  const soum = await req('PATCH', '/plannings/' + idP + '/soumettre', TC, {});
  check('Soumission du planning', soum.status === 200, 'status=' + soum.status);
  const val = await req('POST', '/plannings/' + idP + '/validation', T, { decision: 'VALIDE', commentaire: 'Test export' });
  check('Validation RH', val.status === 200, 'status=' + val.status);

  // 4. Export Excel (endpoint nouveau, données/permissions existantes)
  const xlsx = await req('GET', '/plannings/' + idP + '/emploi-du-temps.xlsx', T, null, true);
  check('Export Excel téléchargé', xlsx.status === 200 && (xlsx.headers['content-type'] || '').includes('spreadsheetml'), 'status=' + xlsx.status);
  const fichier = path.resolve(__dirname, 'edt-test.xlsx');
  fs.writeFileSync(fichier, xlsx.buffer);

  // 5. Comparaison avec le modèle
  process.chdir(path.resolve(__dirname, '..', 'backend'));
  const AdmZip = require(path.resolve(__dirname, '..', 'backend', 'node_modules', 'adm-zip'));
  const XLSX = require(path.resolve(__dirname, '..', 'backend', 'node_modules', 'xlsx'));
  const styleDe = (xml, addr) => { const m = xml.match(new RegExp('<c r="' + addr + '"([^>]*?)(?:/>|>)')); const s = m && m[1].match(/s="(\d+)"/); return s ? s[1] : null; };
  const xmlM = new AdmZip(MODELE).getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
  const xmlG = new AdmZip(fichier).getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
  // Adresses de référence communes (structure) + comparaison des styles des
  // zones totaux/RECAP à POSITION HOMOLOGUE (les lignes dépendent du nb d'employés)
  const memeStyle = ['E2', 'C5', 'C6', 'B7', 'C8', 'E8', 'L8'].every((a) => styleDe(xmlM, a) === styleDe(xmlG, a));
  check('Styles identiques au modèle (titre/jours/périodes/en-têtes/heures/durées/totaux)', memeStyle);
  // Zone totaux du généré : dernière ligne avant le RECAP
  const posRecap = xmlG.search(/preserve">RECAP/);
  const ligneRecap = Number(xmlG.slice(0, posRecap).match(/<row r="(\d+)">/g).pop().match(/(\d+)/)[1]);
  const ligneTotauxGen = ligneRecap - 2;
  const styleDeGen = (addr) => styleDe(xmlG, addr);
  const totauxOk =
    styleDeGen('E' + ligneTotauxGen) === styleDe(xmlM, 'E113') &&
    styleDeGen('L' + ligneTotauxGen) === styleDe(xmlM, 'L113') &&
    styleDeGen('B' + ligneRecap) === styleDe(xmlM, 'B129');
  check('Styles totaux/RECAP identiques (positions homologues)', totauxOk, 'totaux L' + ligneTotauxGen + ' recap B' + ligneRecap);
  const sm = new AdmZip(MODELE).getEntry('xl/styles.xml').getData().toString('utf8');
  const sg = new AdmZip(fichier).getEntry('xl/styles.xml').getData().toString('utf8');
  check('styles.xml copié tel quel du modèle', sm === sg);
  const wbG = XLSX.readFile(fichier, { cellStyles: true });
  const wsG = wbG.Sheets[wbG.SheetNames[0]];
  check('Titre fidèle au format modèle', (wsG['E2']?.v || '').startsWith('EMPLOI DU TEMPS '));
  // Cherche l'observation Repos/Congé/Absence
  let obs = null;
  for (let r = 8; r < 45; r++) { const v = wsG['M' + r]?.v; if (v) { obs = v; break; } }
  check('Observations Repos/Congé/Absence présentes', ['Repos', 'Congé', 'Absence'].includes(obs), obs);
  check('Feuille renommée (service + semaine)', wbG.SheetNames[0].includes('S' + semaine), wbG.SheetNames[0]);

  // 6. Nettoyage
  const del = await req('DELETE', '/plannings/' + idP, T); // RH peut supprimer (planning.delete)
  check('Nettoyage planning de test', [200, 204].includes(del.status), 'status=' + del.status);
  await req('DELETE', '/auth/users/' + idChef, T);
  fs.unlinkSync(fichier);
  console.log(echecs === 0 ? '\nRESULTAT : CHAÎNE COMPLETE OK, FICHIER FIDÈLE AU MODÈLE' : `\nRESULTAT : ${echecs} ECHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
