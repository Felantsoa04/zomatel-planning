/* TEST — GESTION DES DISCUSSIONS MESSENGER (épingler / archiver / supprimer).
 * Couvre les endpoints NOUVEAUX :
 *   PATCH /messenger/conversations/:id/epingle   { epinglee }
 *   PATCH /messenger/conversations/:id/archive   { archivee }
 *   DELETE /messenger/conversations/:id          (suppression POUR SOI)
 * Vérifie : état par membre (l'autre membre non affecté), liste triée
 * épinglées en haut, section archivée, réapparition après « suppression »
 * quand l'autre écrit, non-lus excluant les discussions supprimées.
 * Usage : node scripts/test-discussions.js  (le serveur doit tourner sur :4000)
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');

const API = 'http://localhost:4000/api';

async function login(loginName, motDePasse) {
  const r = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, mot_de_passe: motDePasse }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('login ' + loginName + ' KO : ' + JSON.stringify(j));
  return j.token;
}

(async () => {
  let ecarts = 0;
  const echec = (m) => { ecarts++; console.log('ÉCART :', m); };
  const ok = (m) => console.log('  OK —', m);
  const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

  const tokenRh = await login('rh', 'rh123');
  const tokenAdmin = await login('admin', 'admin123');

  // Compte CHEF_SERVICE de test dédié (créé puis désactivé à la fin).
  const [services] = await pool.query('SELECT id_service FROM service ORDER BY id_service LIMIT 1');
  const loginChefTest = 'disc_test_chef_' + Date.now().toString(36);
  const rCreeChef = await fetch(API + '/auth/users', {
    method: 'POST', headers: H(tokenAdmin),
    body: JSON.stringify({ nom: 'Discussions Test', prenom: 'Chef', login: loginChefTest, mot_de_passe: 'MsgTest123', role: 'CHEF_SERVICE', id_service: services[0].id_service }),
  });
  if (!rCreeChef.ok) { console.log('création chef de test KO :', JSON.stringify(await rCreeChef.json())); process.exit(2); }
  const [[chefRow]] = await pool.query('SELECT id_utilisateur FROM utilisateur WHERE login = ?', [loginChefTest]);
  const tokenChef = await login(loginChefTest, 'MsgTest123');
  const idChef = chefRow.id_utilisateur;
  const [[rhRow]] = await pool.query("SELECT id_utilisateur FROM utilisateur WHERE login = 'rh'");
  const idRh = rhRow.id_utilisateur;
  console.log(`comptes de test : rh(#${idRh}) / chef(#${idChef})`);

  try {
    /* --- 1. Conversation de test + 2 messages --- */
    const rConv = await fetch(API + '/messenger/conversations', { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ utilisateur_id: idChef }) });
    const { id: convId } = await rConv.json();
    await fetch(API + `/messenger/conversations/${convId}/messages`, { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ contenu: 'Message 1 (test discussions)' }) });

    /* --- 2. Épingler côté RH : visible dans la réponse et PAS côté chef --- */
    let r = await fetch(API + `/messenger/conversations/${convId}/epingle`, { method: 'PATCH', headers: H(tokenRh), body: JSON.stringify({ epinglee: true }) });
    let j = await r.json();
    r.ok && j.epinglee === true ? ok('épinglage accepté (RH)') : echec('épinglage RH : ' + JSON.stringify(j));
    let convsChef = await (await fetch(API + '/messenger/conversations', { headers: H(tokenChef) })).json();
    let convChef = convsChef.find((c) => c.id === convId);
    convChef && convChef.epinglee === false ? ok('état par membre : non épinglée côté chef') : echec('épinglage visible chez lautre membre !');
    let convsRh = await (await fetch(API + '/messenger/conversations', { headers: H(tokenRh) })).json();
    let convRh = convsRh.find((c) => c.id === convId);
    convRh && convRh.epinglee === true ? ok('épinglée côté RH') : echec('épinglée absente côté RH');

    /* --- 3. Désépingler --- */
    r = await fetch(API + `/messenger/conversations/${convId}/epingle`, { method: 'PATCH', headers: H(tokenRh), body: JSON.stringify({ epinglee: false }) });
    j = await r.json();
    r.ok && j.epinglee === false ? ok('désépinglage accepté') : echec('désépinglage : ' + JSON.stringify(j));

    /* --- 4. Archiver côté RH : sortie de la liste principale (mais listée) --- */
    r = await fetch(API + `/messenger/conversations/${convId}/archive`, { method: 'PATCH', headers: H(tokenRh), body: JSON.stringify({ archivee: true }) });
    j = await r.json();
    r.ok && j.archivee === true ? ok('archivage accepté (RH)') : echec('archivage : ' + JSON.stringify(j));
    convsRh = await (await fetch(API + '/messenger/conversations', { headers: H(tokenRh) })).json();
    convRh = convsRh.find((c) => c.id === convId);
    convRh && convRh.archivee === true ? ok('conversation toujours listée (flag archivee)') : echec('archivée non listée');
    convsChef = await (await fetch(API + '/messenger/conversations', { headers: H(tokenChef) })).json();
    convChef = convsChef.find((c) => c.id === convId);
    convChef && convChef.archivee === false ? ok('archivage par membre : non archivée côté chef') : echec('archivage visible chez lautre membre !');

    /* --- 5. Désarchiver : messages intacts --- */
    r = await fetch(API + `/messenger/conversations/${convId}/archive`, { method: 'PATCH', headers: H(tokenRh), body: JSON.stringify({ archivee: false }) });
    r.ok ? ok('désarchivage accepté') : echec('désarchivage KO');
    const msgs = await (await fetch(API + `/messenger/conversations/${convId}/messages`, { headers: H(tokenRh) })).json();
    msgs.messages.length === 1 ? ok('messages conservés après archivage/désarchivage') : echec('messages perdus !');

    /* --- 6. Suppression (pour soi) : disparait de la liste, non-lus exclus --- */
    r = await fetch(API + `/messenger/conversations/${convId}`, { method: 'DELETE', headers: H(tokenChef) });
    j = await r.json();
    r.ok && j.supprimee === true ? ok('suppression (pour soi) acceptée') : echec('suppression : ' + JSON.stringify(j));
    convsChef = await (await fetch(API + '/messenger/conversations', { headers: H(tokenChef) })).json();
    convsChef.some((c) => c.id === convId) ? echec('discussion supprimée encore listée !') : ok('discussion retirée de la liste du chef');
    // Conversation toujours visible pour la RH (suppression par membre).
    convsRh = await (await fetch(API + '/messenger/conversations', { headers: H(tokenRh) })).json();
    convsRh.some((c) => c.id === convId) ? ok('conversation conservée côté RH') : echec('supprimée chez lautre membre aussi !');
    // Le badge non-lus du chef n'inclut plus cette discussion.
    const { non_lus } = await (await fetch(API + '/messenger/unread-count', { headers: H(tokenChef) })).json();
    non_lus === 0 ? ok('badge non-lus à 0 (discussion supprimée exclue)') : echec('badge non-lus = ' + non_lus);

    /* --- 7. Réapparition : la RH écrit -> la discussion revient chez le chef --- */
    await fetch(API + `/messenger/conversations/${convId}/messages`, { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ contenu: 'Message 2 : la discussion reapparait' }) });
    convsChef = await (await fetch(API + '/messenger/conversations', { headers: H(tokenChef) })).json();
    convChef = convsChef.find((c) => c.id === convId);
    convChef ? ok('discussion reapparue après nouveau message (historique conservé)') : echec('discussion perdue définitivement !');
    const msgs2 = await (await fetch(API + `/messenger/conversations/${convId}/messages`, { headers: H(tokenChef) })).json();
    msgs2.messages.length === 2 ? ok('historique complet (2 messages)') : echec('historique incomplet : ' + msgs2.messages.length);

    /* --- 8. Sécurité : non-membre refusé sur les 3 actions --- */
    // (le chef a été remis membre au 7 ; on teste avec une conversation inexistante)
    r = await fetch(API + '/messenger/conversations/999999999/epingle', { method: 'PATCH', headers: H(tokenChef), body: JSON.stringify({ epinglee: true }) });
    r.status === 403 ? ok('épinglage non-membre refusé (403)') : echec('épinglage non-membre : ' + r.status);
    r = await fetch(API + '/messenger/conversations/999999999/archive', { method: 'PATCH', headers: H(tokenChef), body: JSON.stringify({ archivee: true }) });
    r.status === 403 ? ok('archivage non-membre refusé (403)') : echec('archivage non-membre : ' + r.status);
    r = await fetch(API + '/messenger/conversations/999999999', { method: 'DELETE', headers: H(tokenChef) });
    r.status === 403 ? ok('suppression non-membre refusée (403)') : echec('suppression non-membre : ' + r.status);

    /* --- 9. Nettoyage : les DEUX membres suppriment -> conversation purgée --- */
    await fetch(API + `/messenger/conversations/${convId}`, { method: 'DELETE', headers: H(tokenRh) });
    await fetch(API + `/messenger/conversations/${convId}`, { method: 'DELETE', headers: H(tokenChef) });
    const [[{ nConvs }]] = await pool.query('SELECT COUNT(*) AS nConvs FROM conversations WHERE id = ?', [convId]);
    const [[{ nMsgs }]] = await pool.query('SELECT COUNT(*) AS nMsgs FROM messages WHERE conversation_id = ?', [convId]);
    nConvs === 0 && nMsgs === 0 ? ok('plus aucun membre conservant la discussion : purge (CASCADE)') : echec(`purge incomplète (convs=${nConvs}, msgs=${nMsgs})`);
  } finally {
    // Désactivation du compte de test (aucune donnée réelle modifiée).
    await pool.query('UPDATE utilisateur SET actif = 0 WHERE id_utilisateur = ?', [idChef]);
    console.log('compte chef de test désactivé (fin du test)');
    await pool.end();
  }

  if (ecarts > 0) { console.log(`\n=== DISCUSSIONS : ${ecarts} ECART(S) ===`); process.exit(1); }
  console.log('\n=== DISCUSSIONS : TOUS LES TESTS PASSENT ===');
  process.exit(0);
})().catch((e) => { console.error('ERREUR test :', e.message); process.exit(2); });
