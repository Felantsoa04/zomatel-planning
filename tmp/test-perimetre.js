/* Tests 3, 4, 5 du cahier RBAC.
 * 3. Chef de service (Cuisine) : ne voit que les donnees de Cuisine
 * 4. Acces direct par API a une ressource d'un autre service -> refuse
 * 5. Employe : consulte uniquement ses propres donnees/plannings
 */
const http = require('http');

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request('http://localhost:4000/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    }, (res) => {
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
function check(nom, condition, detail = '') {
  console.log((condition ? 'PASS' : 'FAIL') + '  ' + nom + (detail ? ' — ' + detail : ''));
  if (!condition) echecs++;
}

(async () => {
  const rh = await req('POST', '/auth/login', null, { login: 'rh', mot_de_passe: 'rh123' });
  const T = rh.body.token;
  const services = await req('GET', '/services', T);
  const cuisine = services.body.find((s) => /cuisine/i.test(s.nom || ''));
  const autreService = services.body.find((s) => !/cuisine/i.test(s.nom || ''));

  // === Test 3 : chef de Cuisine ===
  const suffix = Date.now().toString().slice(-5);
  const loginChef = 'chef_cui_' + suffix;
  const cree = await req('POST', '/auth/users', T, {
    nom: 'TEST', prenom: 'CUISINE', login: loginChef, mot_de_passe: 'Test1234!',
    role: 'CHEF_SERVICE', id_service: cuisine.id_service, // permissions par defaut du role
  });
  check('Test 3 : creation chef Cuisine (defauts du role)', cree.status === 201, JSON.stringify(cree.body).slice(0, 90));
  const idChef = cree.body.id_utilisateur;
  const chef = await req('POST', '/auth/login', null, { login: loginChef, mot_de_passe: 'Test1234!' });
  const TC = chef.body.token;

  const empsChef = await req('GET', '/employes', TC);
  const tousDuService = (empsChef.body || []).every((e) => Number(e.id_service) === Number(cuisine.id_service));
  check('Test 3 : chef ne voit que les employes de Cuisine', empsChef.status === 200 && tousDuService,
    `${(empsChef.body || []).length} employes, tous Cuisine: ${tousDuService}`);

  const planningsChef = await req('GET', '/plannings', TC);
  const planningsOk = (planningsChef.body || []).every((p) => Number(p.id_service) === Number(cuisine.id_service));
  check('Test 3 : chef ne voit que les plannings de Cuisine', planningsChef.status === 200 && planningsOk,
    `${(planningsChef.body || []).length} plannings, tous Cuisine: ${planningsOk}`);

  // === Test 4 : acces direct a une ressource d'un autre service ===
  // Planning d'un autre service (vu par la RH)
  const planningsRH = await req('GET', '/plannings', T);
  const planningAutre = (planningsRH.body || []).find((p) => Number(p.id_service) !== Number(cuisine.id_service));
  if (planningAutre) {
    const grilleAutre = await req('GET', `/plannings/${planningAutre.id_planning}/grille`, TC);
    check('Test 4a : grille d\'un planning d\'un autre service -> 403', grilleAutre.status === 403, 'status=' + grilleAutre.status);
    const majAutre = await req('PUT', `/plannings/${planningAutre.id_planning}/grille`, TC, { cellules: [] });
    check('Test 4b : modification grille d\'un autre service -> 403', majAutre.status === 403, 'status=' + majAutre.status);
    const employeAutre = (await req('GET', '/employes', T)).body.find((e) => Number(e.service_id || e.id_service) !== Number(cuisine.id_service));
    if (employeAutre) {
      const empAutre = await req('PUT', `/employes/${employeAutre.id_employe}`, TC, { nom: 'PIRATAGE' });
      check('Test 4c : modification d\'un employe d\'un autre service -> 403', empAutre.status === 403, 'status=' + empAutre.status);
    }
  } else {
    console.log('INFO : aucun planning d\'autre service disponible pour le Test 4');
  }

  // === Test 5 : employe ===
  const empsCuisine = (await req('GET', '/employes?service_id=' + cuisine.id_service, T)).body;
  const cible = empsCuisine && empsCuisine[0];
  check('Test 5 : un employe de Cuisine existe pour le test', !!cible, cible ? cible.nom : 'aucun');
  if (cible) {
    // Le compte EMPLOYE doit etre lie a la fiche (id_employe) pour /employes/me/*
    const creeEmp = await req('POST', '/auth/users', T, {
      nom: cible.nom, prenom: 'EMP', login: 'emp_' + suffix, mot_de_passe: 'Test1234!',
      role: 'EMPLOYE', id_employe: cible.id_employe, permissions: [],
    });
    check('Test 5 : RH cree un compte Employe lie a sa fiche', [200, 201].includes(creeEmp.status), JSON.stringify(creeEmp.body).slice(0, 90));
    const empLogin = await req('POST', '/auth/login', null, { login: 'emp_' + suffix, mot_de_passe: 'Test1234!' });
    check('Test 5 : le compte Employe peut se connecter', empLogin.status === 200, 'status=' + empLogin.status);
    if (empLogin.status === 200) {
      const TE = empLogin.body.token;
      const mesPlannings = await req('GET', '/employes/me/plannings', TE);
      check('Test 5 : GET /employes/me/plannings -> 200', mesPlannings.status === 200, 'status=' + mesPlannings.status);
      const profil = await req('GET', '/employes/me/profil', TE);
      check('Test 5 : GET /employes/me/profil -> 200', profil.status === 200, 'status=' + profil.status);
      const listeGlobale = await req('GET', '/employes', TE);
      check('Test 5 : GET /employes (liste globale) -> 403 pour un employe', listeGlobale.status === 403, 'status=' + listeGlobale.status);
      const gestion = await req('POST', '/employes', TE, { nom: 'X' });
      check('Test 5 : POST /employes -> 403 (aucune permission de gestion)', gestion.status === 403, 'status=' + gestion.status);
      const usersRH = await req('GET', '/auth/users', TE);
      check('Test 5 : GET /auth/users -> 403 pour un employe', usersRH.status === 403, 'status=' + usersRH.status);
      await req('DELETE', '/auth/users/' + creeEmp.body.id_utilisateur, T); // desactivation
    }
  }

  // === Nettoyage ===
  await req('DELETE', '/auth/users/' + idChef, T);
  check('Nettoyage : chef de test desactive', true);

  console.log(echecs === 0 ? '\nRESULTAT : TOUS LES TESTS PASSENT' : `\nRESULTAT : ${echecs} ECHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
