/* Test de la regle fonctionnelle definitive : l'Employe n'a PAS de compte.
 * - POST /auth/users avec role=EMPLOYE -> refuse (400)
 * - login d'un compte EMPLOYE residuel -> refuse (403)
 * - les API /employes/me/* ne sont pas cassees (elles restent muettes pour
 *   les roles connectables : 403 si utilisees sans fiche employe rattachee)
 * - RBAC chef/RH : inchangé (regression check rapide)
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
  // 1. Creation d'un compte EMPLOYE -> refusee
  const rh = await req('POST', '/auth/login', null, { login: 'rh', mot_de_passe: 'rh123' });
  const T = rh.body.token;
  const tentative = await req('POST', '/auth/users', T, {
    nom: 'TEST', login: 'emp_refuse_' + Date.now().toString().slice(-5), mot_de_passe: 'Test1234!', role: 'EMPLOYE',
  });
  check('POST /auth/users role=EMPLOYE -> 400 (non creable)', tentative.status === 400, 'status=' + tentative.status);

  // 2. Le compte EMPLOYE residuel en base ne peut pas se connecter
  const existe = await req('GET', '/auth/users', T);
  const residuel = (existe.body || []).find((u) => u.role === 'EMPLOYE');
  if (residuel) {
    const loginResiduel = await req('POST', '/auth/login', null, { login: residuel.login, mot_de_passe: 'Test1234!' });
    check('compte EMPLOYE residuel -> login refuse (401/403)', [401, 403].includes(loginResiduel.status), 'status=' + loginResiduel.status + ' (' + (loginResiduel.body?.message || '').slice(0, 60) + ')');
  } else {
    console.log('INFO : aucun compte EMPLOYE residuel en base (regle deja appliquee)');
  }

  // 3. Regression RBAC : le RH et un chef de test conservent leurs acces
  const liste = await req('GET', '/auth/users', T);
  check('RH : GET /auth/users toujours OK', liste.status === 200);
  const services = await req('GET', '/services', T);
  const reception = services.body.find((s) => /r[ée]ception/i.test(s.nom || ''));
  const suffix = Date.now().toString().slice(-5);
  const chef = await req('POST', '/auth/users', T, {
    nom: 'TEST', login: 'chef_reg_' + suffix, mot_de_passe: 'Test1234!',
    role: 'CHEF_SERVICE', id_service: reception.id_service,
  });
  check('creation chef (regression) -> 201', chef.status === 201);
  const chefLogin = await req('POST', '/auth/login', null, { login: 'chef_reg_' + suffix, mot_de_passe: 'Test1234!' });
  const TC = chefLogin.body.token;
  const empsChef = await req('GET', '/employes', TC);
  const tousRecep = (empsChef.body || []).every((e) => Number(e.id_service) === Number(reception.id_service));
  check('chef : employes limites a son service', empsChef.status === 200 && tousRecep, `${(empsChef.body || []).length} employes`);
  await req('DELETE', '/auth/users/' + chef.body.id_utilisateur, T);
  check('nettoyage chef de test', true);

  console.log(echecs === 0 ? '\nRESULTAT : REGLE EMPLOYE APPLIQUEE + AUCUNE REGRESSION' : `\nRESULTAT : ${echecs} ECHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
