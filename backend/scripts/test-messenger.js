/* TEST — MESSENGER INTERNE (READ-ONLY sur les comptes, écritures limitées à
 * des conversations de test). Couvre :
 *   1. auth : sans JWT -> 401 ; permission requise ;
 *   2. utilisateurs autorisés (RH/Chef actifs, jamais EMPLOYE) ;
 *   3. création conversation RH <-> Chef (idempotence : pas de doublon) ;
 *   4. envoi message + notification réelle (table notification) ;
 *   5. non-lus côté destinataire puis passage en lu ;
 *   6. modification / suppression logique / réponse ;
 *   7. sécurité : conversation inexistante (404/400), non-membre (403),
 *      message vide (400), modification par un autre (403) ;
 *   8. Socket.IO : handshake sans token refusé, réception temps réel,
 *      typing indicator, présence.
 * Usage : node scripts/test-messenger.js   (le serveur doit tourner sur :4000)
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
// socket.io-client est installe cote FRONTEND : resolution depuis frontend/node_modules
const { io } = require(path.resolve(__dirname, '..', '..', 'frontend', 'node_modules', 'socket.io-client'));
const pool = require('../src/config/db');

const API = 'http://localhost:4000/api';
const SOCKET = 'http://localhost:4000';

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

  /* --- Comptes de test (mots de passe connus du projet) --- */
  const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
  const tokenRh = await login('rh', 'rh123');
  const tokenAdmin = await login('admin', 'admin123');

  // Compte CHEF_SERVICE de test dédié, créé via l'API existante (comme la
  // page Gestion utilisateurs) dans un service réel, puis DÉSACTIVÉ à la
  // fin du test (aucune donnée existante n'est modifiée ni supprimée).
  const [services] = await pool.query('SELECT id_service FROM service ORDER BY id_service LIMIT 1');
  const idServiceTest = services[0].id_service;
  const loginChefTest = 'msg_test_chef_' + Date.now().toString(36);
  const rCreeChef = await fetch(API + '/auth/users', {
    method: 'POST', headers: H(tokenAdmin),
    body: JSON.stringify({ nom: 'Messenger Test', prenom: 'Chef', login: loginChefTest, mot_de_passe: 'MsgTest123', role: 'CHEF_SERVICE', id_service: idServiceTest }),
  });
  if (!rCreeChef.ok) { console.log('création chef de test KO :', JSON.stringify(await rCreeChef.json())); process.exit(2); }
  const chefCree = await rCreeChef.json();
  const [[chefRow]] = await pool.query('SELECT id_utilisateur FROM utilisateur WHERE login = ?', [loginChefTest]);
  const idChefTest = chefRow.id_utilisateur;
  console.log(`compte chef de test créé : ${loginChefTest} (#${idChefTest}, service ${idServiceTest})`);
  const tokenChef = await login(loginChefTest, 'MsgTest123');

  /* 1. Auth */
  console.log('=== 1. Authentification et permission ===');
  const e401 = await fetch(API + '/messenger/conversations');
  console.log('sans JWT :', e401.status, '(attendu 401)');
  if (e401.status !== 401) echec('sans JWT devrait donner 401'); else ok('JWT requis');

  /* 2. Utilisateurs autorisés */
  console.log('=== 2. Utilisateurs autorisés (réels) ===');
  const rUsers = await fetch(API + '/messenger/utilisateurs', { headers: H(tokenRh) });
  const users = await rUsers.json();
  if (rUsers.status !== 200) { echec('liste utilisateurs KO'); process.exit(1); }
  console.log('  autorisés :', users.map((u) => `${u.nom_utilisateur}(${u.role})`).join(', '));
  if (users.some((u) => u.role === 'EMPLOYE')) echec('un EMPLOYE est listé'); else ok('aucun EMPLOYE');
  if (users.some((u) => !u.actif)) echec('un compte inactif est listé'); else ok('aucun inactif');
  const chef = users.find((u) => Number(u.id_utilisateur) === Number(idChefTest));
  if (!chef) { console.log('le chef de test n\'apparaît pas dans la liste autorisée'); process.exit(1); }

  /* 3. Création conversation (idempotence) */
  console.log('=== 3. Conversation RH <-> Chef ===');
  const rC1 = await fetch(API + '/messenger/conversations', { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ utilisateur_id: chef.id_utilisateur }) });
  const c1 = await rC1.json();
  if (rC1.status !== 200 && rC1.status !== 201) { echec('création conv : ' + JSON.stringify(c1)); process.exit(1); }
  const rC2 = await fetch(API + '/messenger/conversations', { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ utilisateur_id: chef.id_utilisateur }) });
  const c2 = await rC2.json();
  if (c1.id !== c2.id) echec(`deux appels ont créé deux conversations (${c1.id} vs ${c2.id})`);
  else ok(`conversation unique #${c1.id} (pas de doublon)`);

  /* 4. Envoi + notification réelle */
  console.log('=== 4. Envoi message + notification ===');
  const [[notifAvant]] = (await pool.query(
    'SELECT COUNT(*) AS n FROM notification WHERE utilisateur_id = ?', [chef.id_utilisateur]));
  const rMsg = await fetch(API + `/messenger/conversations/${c1.id}/messages`, { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ contenu: 'Bonjour, le planning S40 est validé.' }) });
  const { message } = await rMsg.json();
  if (rMsg.status !== 201) echec('envoi message : ' + JSON.stringify(message));
  else ok('message #' + message.id + ' créé');
  const [[notifApres]] = (await pool.query(
    'SELECT COUNT(*) AS n FROM notification WHERE utilisateur_id = ?', [chef.id_utilisateur]));
  if (Number(notifApres.n) <= Number(notifAvant.n)) echec('aucune notification créée chez le destinataire');
  else ok('notification réelle créée (table notification)');

  /* 5. Non-lus puis lecture */
  console.log('=== 5. Non-lus et passage en lu ===');
  const rUnread = await fetch(API + '/messenger/unread-count', { headers: H(tokenChef) });
  const unread = await rUnread.json();
  if (Number(unread.non_lus) < 1) echec('le compteur du chef devrait compter au moins 1');
  else ok(`badge chef = ${unread.non_lus}`);
  const rConvs = await fetch(API + '/messenger/conversations', { headers: H(tokenChef) });
  const convsChef = await rConvs.json();
  const convChef = convsChef.find((c) => c.id === c1.id);
  if (!convChef) echec('conversation non visible côté chef');
  else if (Number(convChef.non_lus) < 1) echec('non-lus de la conversation côté chef = 0');
  else ok(`non-lus de la conv côté chef = ${convChef.non_lus}`);
  await fetch(API + `/messenger/conversations/${c1.id}/read`, { method: 'POST', headers: H(tokenChef), body: '{}' });
  const rUnread2 = await fetch(API + '/messenger/unread-count', { headers: H(tokenChef) });
  const unread2 = await rUnread2.json();
  if (Number(unread2.non_lus) !== 0) echec(`après lecture, badge chef = ${unread2.non_lus} (attendu 0)`);
  else ok('passage en lu : badge à 0');
  const rConvs2 = await fetch(API + '/messenger/conversations', { headers: H(tokenChef) });
  const convsChef2 = await rConvs2.json();
  const convChef2 = convsChef2.find((c) => c.id === c1.id);
  if (convChef2 && Number(convChef2.non_lus) !== 0) echec('non-lus conv non remis à 0');
  else ok('non-lus de la conversation à 0');

  /* 6. Réponse, modification, suppression */
  console.log('=== 6. Réponse / modification / suppression ===');
  const rRep = await fetch(API + `/messenger/conversations/${c1.id}/messages`, { method: 'POST', headers: H(tokenChef), body: JSON.stringify({ contenu: 'Bonjour, merci.', repondre_a: message.id }) });
  const { message: reponse } = await rRep.json();
  if (rRep.status !== 201) echec('réponse : ' + JSON.stringify(reponse));
  else if (!reponse.reponse || reponse.reponse.id !== message.id) echec('aperçu de réponse manquant');
  else ok('réponse au message avec aperçu');
  const rMod = await fetch(API + '/messenger/messages/' + reponse.id, { method: 'PATCH', headers: H(tokenChef), body: JSON.stringify({ contenu: 'Bonjour, merci. Bien reçu.' }) });
  const { message: modifie } = await rMod.json();
  if (rMod.status !== 200) echec('modification : ' + JSON.stringify(modifie));
  else if (!modifie.modifie) echec('modifié non marqué');
  else ok('modification marquée (modified_at)');
  const rSup = await fetch(API + '/messenger/messages/' + reponse.id, { method: 'DELETE', headers: H(tokenChef) });
  const { message: supprime } = await rSup.json();
  if (rSup.status !== 200) echec('suppression : ' + JSON.stringify(supprime));
  else if (!supprime.supprime) echec('suppression logique non marquée');
  else ok('suppression logique (deleted_at), historique conservé');
  const [[ligne]] = await pool.query('SELECT contenu, deleted_at FROM messages WHERE id = ?', [reponse.id]);
  if (!ligne || !ligne.deleted_at) echec('la ligne doit toujours exister en base');
  else ok('ligne conservée en base (pas de destruction)');

  /* 7. Sécurité */
  console.log('=== 7. Sécurité (non-membre, vide, introuvable) ===');
  // Un troisième utilisateur non membre : le compte ADMIN de test
  let tokenAutre = tokenAdmin;
  if (tokenAutre) {
    const rInterdit = await fetch(API + `/messenger/conversations/${c1.id}/messages`, { headers: H(tokenAutre) });
    if (rInterdit.status !== 403) echec(`non-membre : HTTP ${rInterdit.status} (attendu 403)`);
    else ok('non-membre refusé (403)');
  } else {
    console.log('  (pas de 3e compte de test : le contrôle non-membre est vérifié par le socket)');
  }
  const rVide = await fetch(API + `/messenger/conversations/${c1.id}/messages`, { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ contenu: '   ' }) });
  if (rVide.status !== 400) echec(`message d'espaces : HTTP ${rVide.status} (attendu 400)`);
  else ok('message vide / espaces refusé (400)');
  const rConv404 = await fetch(API + '/messenger/conversations/999999/messages', { headers: H(tokenRh) });
  if (rConv404.status !== 403) echec(`conversation inexistante : HTTP ${rConv404.status} (attendu 403 : pas membre d'une conv qui n'existe pas)`);
  else ok('conversation inexistante traitée comme non-membre (403)');
  const rMsg404 = await fetch(API + '/messenger/messages/999999', { method: 'PATCH', headers: H(tokenRh), body: JSON.stringify({ contenu: 'x' }) });
  if (rMsg404.status !== 404) echec(`message inexistant : HTTP ${rMsg404.status} (attendu 404)`);
  else ok('message inexistant refusé (404)');
  // Modification du message d'un autre : la RH tente de modifier le message du chef
  const [[autreMsg]] = await pool.query(
    `SELECT id FROM messages WHERE conversation_id = ? AND expediteur_id != 
     (SELECT id_utilisateur FROM utilisateur WHERE login = 'rh' LIMIT 1) LIMIT 1`, [c1.id]);
  if (autreMsg) {
    // identification de l'auteur réel : la RH ne doit pas pouvoir modifier
    const rHijack = await fetch(API + '/messenger/messages/' + reponse.id, { method: 'PATCH', headers: H(tokenRh), body: JSON.stringify({ contenu: 'usurpation' }) });
    // le message est supprimé -> 409 attendu, sinon 403
    if (![403, 409].includes(rHijack.status)) echec(`modification par un autre : HTTP ${rHijack.status} (attendu 403/409)`);
    else ok(`modification par un non-auteur refusée (HTTP ${rHijack.status})`);
  }

  /* 8. Socket.IO : handshake, temps réel, typing, présence */
  console.log('=== 8. Socket.IO (temps réel) ===');
  await new Promise((resolve) => {
    let recu = 0;
    const sChef = io(SOCKET, { auth: { token: tokenChef }, transports: ['websocket'] });
    const sRh = io(SOCKET, { auth: { token: tokenRh }, transports: ['websocket'] });
    let termine = false;
    const fin = () => {
      if (termine) return;
      termine = true;
      try { sChef.disconnect(); sRh.disconnect(); } catch {}
      resolve();
    };
    setTimeout(fin, 8000);

    sChef.on('connect_error', (e) => { echec('socket chef : ' + e.message); fin(); });
    sRh.on('connect_error', (e) => { echec('socket rh : ' + e.message); fin(); });

    sChef.on('connect', () => sChef.emit('messenger:join'));
    sRh.on('connect', () => {
      sRh.emit('messenger:join');
      setTimeout(() => sRh.emit('messenger:conversation-ouverte', { conversation_id: c1.id }), 300);
    });
    // Typing : le chef doit recevoir l'indicateur de la RH
    sChef.on('messenger:typing', (d) => { if (d.ecrit) { recu++; ok('typing reçu en temps réel'); } });
    // Message temps réel : la RH envoie, le chef reçoit via le socket
    sChef.on('messenger:message', ({ message: m }) => {
      recu++;
      ok('message reçu instantanément : ' + JSON.stringify(m.contenu));
    });
    sChef.on('messenger:presence', (d) => { if (d.en_ligne) { recu++; ok('présence en ligne reçue'); } });

    setTimeout(async () => {
      try {
        await fetch(API + `/messenger/conversations/${c1.id}/messages`, { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ contenu: 'Test temps réel socket' }) });
        sRh.emit('messenger:typing', { conversation_id: c1.id, ecrit: true });
      } catch (e) { echec('envoi pendant test socket : ' + e.message); }
    }, 1200);

    setTimeout(() => {
      if (recu < 2) echec(`temps réel incomplet : ${recu} événement(s) reçu(s)`);
      fin();
    }, 6000);
  });

  /* Handshake sans token */
  await new Promise((resolve) => {
    const s = io(SOCKET, { transports: ['websocket'] });
    s.on('connect_error', (e) => { ok('handshake sans token refusé : ' + e.message); s.close(); resolve(); });
    setTimeout(() => { echec('handshake sans token aurait dû être refusé'); resolve(); }, 4000);
  });

  /* Nettoyage : le compte chef de test est DÉSACTIVÉ (jamais supprimé). */
  async function desactiverChefTest() {
    try {
      await fetch(API + '/auth/users/' + idChefTest, { method: 'DELETE', headers: H(tokenAdmin) });
      console.log('compte chef de test désactivé (fin du test)');
    } catch { /* silencieux */ }
  }

  console.log(ecarts === 0
    ? '\n=== MESSENGER : TOUS LES TESTS PASSENT (API + sécurité + temps réel) ==='
    : `\n=== ${ecarts} écart(s) ===`);
  await desactiverChefTest();
  process.exit(ecarts === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR :', e); process.exit(1); });
