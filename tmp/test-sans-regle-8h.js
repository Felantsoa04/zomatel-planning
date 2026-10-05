/* Vérification suppression de la règle 8h/jour :
 *  - plage de 6h  : acceptée (pas de minimum journalier)
 *  - plage de 10h : acceptée (pas de maximum 8h, côté API ET trigger MariaDB)
 *  - REPOS conservé
 *  - calcul des heures réel préservé (6h + 10h + 8h30 = 24h30)
 *  - workflow Chef -> soumission -> validation RH intact
 * Nettoyage complet en fin de test.
 */
const http = require('http');

const BACK = 'http://localhost:4000/api';

function req(method, p, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(BACK + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (res) => {
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
  // 1. Chef temporaire (Cuisine) + RH
  const rh = await req('POST', '/auth/login', null, { login: 'rh', mot_de_passe: 'rh123' });
  const T = rh.body.token;
  const services = await req('GET', '/services', T);
  const cuisine = services.body.find((s) => /cuisine/i.test(s.nom || ''));
  const suffix = Date.now().toString().slice(-5);
  const loginChef = 'chef_8h_x_' + suffix;
  const cr = await req('POST', '/auth/users', T, { nom: 'TEST8H', login: loginChef, mot_de_passe: 'Test1234!', role: 'CHEF_SERVICE', id_service: cuisine.id_service });
  const idChef = cr.body.id_utilisateur;
  const chef = await req('POST', '/auth/login', null, { login: loginChef, mot_de_passe: 'Test1234!' });
  const TC = chef.body.token;
  const emps = await req('GET', '/employes', TC);
  const deux = (emps.body || []).slice(0, 2);
  check('Setup : chef + employés Cuisine', deux.length >= 2);

  // 2. Planning unique (anti-doublon)
  const annee = 2031;
  const semaine = 40 + (Number(suffix) % 9);
  const lundi = new Date(Date.UTC(2031, 0, 4));
  lundi.setUTCDate(lundi.getUTCDate() + (semaine - 1) * 7 - ((lundi.getUTCDay() + 6) % 7));
  const iso = (d) => d.toISOString().slice(0, 10);
  const jours = Array.from({ length: 7 }, (_, i) => iso(new Date(lundi.getTime() + i * 86400000)));
  const cp = await req('POST', '/plannings', TC, { annee, numero_semaine: semaine, date_debut: jours[0], date_fin: jours[6] });
  const idP = cp.body.id_planning;
  if (!idP) return console.log('ECHEC creation planning :', cp.status, JSON.stringify(cp.body).slice(0, 120));

  // 3. Saisie : 6h (Lundi), 10h (Mardi), 8h30 (Mercredi) pour emp1 ; REPOS emp2
  const cellules = [
    { id_employe: deux[0].id_employe, jour: jours[0], statut_jour: 'TRAVAIL', creneau: { periode: 'MATIN', heure_entree: '08:00', heure_sortie: '14:00' } },
    { id_employe: deux[0].id_employe, jour: jours[1], statut_jour: 'TRAVAIL', creneau: { periode: 'MATIN', heure_entree: '08:00', heure_sortie: '18:00' } },
    { id_employe: deux[0].id_employe, jour: jours[2], statut_jour: 'TRAVAIL', creneau: { periode: 'MATIN', heure_entree: '08:00', heure_sortie: '16:30' } },
    { id_employe: deux[1].id_employe, jour: jours[0], statut_jour: 'REPOS', creneau: null },
  ];
  const sv = await req('PUT', '/plannings/' + idP + '/grille', TC, { cellules });
  const rs = sv.body.resultats || [];
  check('Plage 6h acceptée (pas de minimum 8h)', rs[0] && rs[0].ok === true, JSON.stringify(rs[0] || sv.body).slice(0, 100));
  check('Plage 10h acceptée API (pas de max 8h) — traverse aussi le trigger MariaDB', rs[1] && rs[1].ok === true, JSON.stringify(rs[1] || sv.body).slice(0, 100));
  check('Plage 8h30 acceptée', rs[2] && rs[2].ok === true, JSON.stringify(rs[2] || sv.body).slice(0, 100));
  check('REPOS toujours accepté', rs[3] && rs[3].ok === true, JSON.stringify(rs[3] || sv.body).slice(0, 100));
  const d1 = rs[0] && rs[0].duree_minutes, d2 = rs[1] && rs[1].duree_minutes, d3 = rs[2] && rs[2].duree_minutes;
  check('Calcul réel des heures conservé (360 + 600 + 510 = 1470 min = 24h30)', d1 === 360 && d2 === 600 && d3 === 510, `360/600/510 -> ${d1}/${d2}/${d3}`);

  // 4. Relecture grille : valeurs exactes renvoyées (pas de remplacement par 8h)
  const gr = await req('GET', '/plannings/' + idP + '/grille', TC);
  const affDe = {};
  for (const a of gr.body.affectations || []) affDe[a.id_affectation] = a;
  const creneaux = gr.body.creneaux || [];
  const lu6 = creneaux.find((c) => { const a = affDe[c.id_affectation]; return a && a.id_employe === deux[0].id_employe && a.jour === jours[0]; });
  const ma10 = creneaux.find((c) => { const a = affDe[c.id_affectation]; return a && a.id_employe === deux[0].id_employe && a.jour === jours[1]; });
  const hCourt = (t) => String(t || '').slice(0, 5);
  check('Relecture : 6h stockée telle quelle (08:00-14:00)', lu6 && hCourt(lu6.heure_entree) === '08:00' && hCourt(lu6.heure_sortie) === '14:00', lu6 ? hCourt(lu6.heure_entree) + '-' + hCourt(lu6.heure_sortie) : 'absent');
  check('Relecture : 10h stockée telle quelle (08:00-18:00)', ma10 && hCourt(ma10.heure_entree) === '08:00' && hCourt(ma10.heure_sortie) === '18:00', ma10 ? hCourt(ma10.heure_entree) + '-' + hCourt(ma10.heure_sortie) : 'absent');

  // 5. Workflow intact : soumission chef -> validation RH
  const soum = await req('PATCH', '/plannings/' + idP + '/soumettre', TC, {});
  check('Soumission chef OK (workflow intact)', soum.status === 200, 'status=' + soum.status);
  const val = await req('POST', '/plannings/' + idP + '/validation', T, { decision: 'VALIDE', commentaire: 'Test sans regle 8h' });
  check('Validation RH OK (workflow intact)', val.status === 200, 'status=' + val.status);

  // 6. Nettoyage
  const del = await req('DELETE', '/plannings/' + idP, T);
  check('Nettoyage planning de test', [200, 204].includes(del.status), 'status=' + del.status);
  await req('DELETE', '/auth/users/' + idChef, T);
  console.log(echecs === 0 ? '\nRESULTAT : REGLE 8h/jour BIEN SUPPRIMEE, le reste intact' : `\nRESULTAT : ${echecs} ECHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
