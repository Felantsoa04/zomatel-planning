/* Test E2E — données réelles pour la section Employés par service */
const B = 'http://localhost:4000/api';
const login = async (l, p) => {
  const r = await fetch(B + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: l, mot_de_passe: p }),
  });
  if (!r.ok) return { err: r.status };
  return r.json();
};
const get = async (ep, t) => {
  const r = await fetch(B + ep, { headers: { Authorization: 'Bearer ' + t } });
  return r.ok ? r.json() : { err: r.status };
};

(async () => {
  const rh = await login('rh', 'rh123');
  if (rh.err) return console.log('login RH echec', rh.err);
  const t = rh.token; // token a la racine de la reponse login

  // 1. /services : champ `nom` présent (bug nom_service corrigé) ?
  const srv = await get('/services', t);
  console.log('SERVICES :', srv.length, '→ champ nom ?', 'nom' in srv[0], '· exemple :', srv[0].nom);

  // 2. RH : employés tous services, groupés
  const empRh = await get('/employes', t);
  const parService = {};
  for (const e of empRh) parService[e.service_nom] = (parService[e.service_nom] || 0) + 1;
  console.log('RH :', empRh.length, 'employés ·', Object.keys(parService).length, 'services');
  Object.entries(parService).forEach(([s, n]) => console.log('   -', s.padEnd(22), n, 'employé(s)'));
  console.log('   TITULAIRE :', empRh.filter((e) => e.statut === 'TITULAIRE').length,
    '· STAGIAIRE :', empRh.filter((e) => e.statut === 'STAGIAIRE').length);

  // 3. Créer un chef de test (via RH, fonctionnalité existante), tester l'isolation, désactiver
  const loginTest = 'zz_test_chef_ui';
  await fetch(B + '/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ nom: 'TestUI', prenom: 'Chef', login: loginTest, mot_de_passe: 'test1234', id_service: 1 }) });
  const users = await get('/auth/users', t);
  const me = (users.find((u) => u.login === loginTest) || {});
  const chef = await login(loginTest, 'test1234');
  if (chef.err) return console.log('login chef test echec', chef.err);
  const tc = chef.token;
  const empChef = await get('/employes', tc);
  console.log('CHEF TEST :', empChef.length, 'employés · services distincts =',
    JSON.stringify([...new Set(empChef.map((e) => e.service_nom))]), '· id_service =', chef.user.id_service);

  // 4. Chef tente la page utilisateurs → doit être 403 (permissions intactes)
  const usr = await get('/auth/users', tc);
  console.log('CHEF → /auth/users :', usr.err || 200, '(403 attendu)');

  // 5. Nettoyage : désactiver le compte de test
  const del = await fetch(B + '/auth/users/' + me.id_utilisateur, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
  console.log('Nettoyage compte test :', del.ok || del.status);

  // 6. Erreur API simulée : token invalide → l'UI doit afficher le message + Réessayer
  const bad = await fetch(B + '/employes', { headers: { Authorization: 'Bearer invalide' } });
  console.log('Token invalide →', bad.status, '(401 attendu : la section affichera le message + Réessayer)');
})();
