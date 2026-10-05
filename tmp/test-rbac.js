/* Tests RBAC backend (Tests 1, 2, 6, 7 du cahier).
 * 1. RH ouvre la gestion des utilisateurs
 * 2. RH cree un utilisateur avec Nom+Identifiant+Role+Service+Permissions explicites
 * 6. Modifier les permissions change reellement l'acces backend (revocation -> 403)
 * 7. Sans token -> 401
 * Nettoyage : suppression (desactivation) du compte cree.
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
  // === Test 1 : RH ouvre la gestion des utilisateurs ===
  const rh = await req('POST', '/auth/login', null, { login: 'rh', mot_de_passe: 'rh123' });
  check('login RH', rh.status === 200);
  const T = rh.body.token;

  const liste = await req('GET', '/auth/users', T);
  check('Test 1 : RH liste les utilisateurs (user.view)', liste.status === 200 && Array.isArray(liste.body));
  const permsRH = await req('GET', '/auth/permissions', T);
  check('Test 1 : RH lit le catalogue de permissions', permsRH.status === 200 && Array.isArray(permsRH.body.catalogue) && permsRH.body.catalogue.length >= 14);

  const services = await req('GET', '/services', T);
  const cuisine = services.body.find((s) => /cuisine/i.test(s.nom || ''));
  check('service Cuisine existant pour le test', !!cuisine);

  // === Test 2 : creation avec Role + Permissions explicites ===
  const suffix = Date.now().toString().slice(-6);
  const loginTest = 'rbac_' + suffix;
  const cree = await req('POST', '/auth/users', T, {
    nom: 'TEST', prenom: 'RBAC', login: loginTest, mot_de_passe: 'Test1234!',
    role: 'CHEF_SERVICE', id_service: cuisine.id_service,
    // Permissions volontairement REDUITES : employe.view seulement
    permissions: ['employe.view', 'planning.view'],
  });
  check('Test 2 : RH cree un compte avec role+permissions explicites', cree.status === 201, JSON.stringify(cree.body).slice(0, 120));
  const idTest = cree.body.id_utilisateur;

  const verifListe = await req('GET', '/auth/users', T);
  const verif = verifListe.body.find((u) => u.id_utilisateur === idTest);
  check('Test 2 : permissions exactes enregistrees', !!verif && verif.permissions.length === 2 && verif.permissions.includes('employe.view') && verif.permissions.includes('planning.view'), verif ? verif.permissions.join(',') : 'introuvable');

  const chef = await req('POST', '/auth/login', null, { login: loginTest, mot_de_passe: 'Test1234!' });
  check('Test 2 : le nouveau compte peut se connecter', chef.status === 200);
  const TC = chef.body.token;

  // Le compte n'a PAS employe.manage -> creation d'employe refusee (403)
  const creationInterdite = await req('POST', '/employes', TC, { nom: 'X', service_id: cuisine.id_service });
  check('Test 6a : sans employe.manage -> 403 sur POST /employes', creationInterdite.status === 403, 'status=' + creationInterdite.status);
  // Il a employe.view -> lecture OK (restreinte a son service par le controleur)
  const lectureOk = await req('GET', '/employes', TC);
  check('Test 6b : avec employe.view -> 200 sur GET /employes', lectureOk.status === 200, 'status=' + lectureOk.status);

  // Le compte n'a PAS user.view -> liste utilisateurs refusee
  const usersInterdit = await req('GET', '/auth/users', TC);
  check('Test 6c : sans user.view -> 403 sur GET /auth/users', usersInterdit.status === 403, 'status=' + usersInterdit.status);

  // === Test 6d : le RH ACCORDE la permission -> acces immediat ===
  const maj = await req('PUT', '/auth/users/' + idTest, T, {
    permissions: ['employe.view', 'planning.view', 'employe.manage'],
  });
  check('Test 6d : RH ajoute employe.manage', maj.status === 200, JSON.stringify(maj.body).slice(0, 100));
  const creationAutorisee = await req('POST', '/employes', TC, { nom: 'TEST_RBAC_TMP', service_id: cuisine.id_service });
  check('Test 6e : avec employe.manage -> 201/200 sur POST /employes', [200, 201].includes(creationAutorisee.status), 'status=' + creationAutorisee.status);
  const idEmpCree = creationAutorisee.body?.id_employe;

  // === Test 6f : revocation -> acces coupe immediatement (meme token) ===
  await req('PUT', '/auth/users/' + idTest, T, { permissions: ['employe.view'] });
  const revocation = await req('POST', '/employes', TC, { nom: 'Y', service_id: cuisine.id_service });
  check('Test 6f : revocation immediate -> 403 avec le MEME token', revocation.status === 403, 'status=' + revocation.status);

  // === Test 7 : sans token -> 401 ===
  const sansToken = await req('GET', '/auth/users', null);
  check('Test 7 : sans token -> 401', sansToken.status === 401, 'status=' + sansToken.status);

  // === Nettoyage ===
  if (idEmpCree) {
    await req('DELETE', '/employes/' + idEmpCree, T);
  }
  const nettoyage = await req('DELETE', '/auth/users/' + idTest, T);
  check('Nettoyage : compte de test desactive', nettoyage.status === 200);
  const relogin = await req('POST', '/auth/login', null, { login: loginTest, mot_de_passe: 'Test1234!' });
  check('Nettoyage : le compte desactive ne peut plus se connecter', relogin.status === 401, 'status=' + relogin.status);

  console.log(echecs === 0 ? '\nRESULTAT : TOUS LES TESTS PASSENT' : `\nRESULTAT : ${echecs} ECHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
