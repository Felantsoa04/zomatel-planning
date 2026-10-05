/* TEST — PIECES JOINTES MESSENGER (image / video / audio / fichier).
 * Couvre : POST /messenger/conversations/:id/fichiers (multipart) +
 * champs retournés (type_message, fichier_chemin, nom_fichier, mime_type) +
 * service statique du fichier + apercu de liste (dernier_message.type_message).
 * Usage : node scripts/test-pieces-jointes.js (serveur sur :4000, base migrée).
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

// Petit PNG 1x1 valide (octets magiques verifiés par le navigateur/serveur).
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
  '0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex'
);

async function envoyerPJ(token, convId, buffer, nom, mime, legende) {
  const form = new FormData();
  form.append('fichier', new Blob([buffer], { type: mime }), nom);
  if (legende) form.append('contenu', legende);
  const r = await fetch(`${API}/messenger/conversations/${convId}/fichiers`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

(async () => {
  let ecarts = 0;
  const echec = (m) => { ecarts++; console.log('ECART :', m); };
  const ok = (m) => console.log('  OK —', m);
  const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

  const tokenRh = await login('rh', 'rh123');
  const tokenAdmin = await login('admin', 'admin123');
  const [[rhRow]] = await pool.query("SELECT id_utilisateur FROM utilisateur WHERE login = 'rh'");
  const idRh = rhRow.id_utilisateur;

  // Conversation RH <-> ADMIN (existante ou créée).
  const rConv = await fetch(API + '/messenger/conversations', { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ utilisateur_id: 1 }) });
  const cj = await rConv.json();
  if (!rConv.ok) { console.log('conversation KO :', JSON.stringify(cj)); process.exit(2); }
  const convId = cj.id;
  console.log('conversation de test #' + convId);

  /* --- 1. Image PNG (avec légende) --- */
  let r = await envoyerPJ(tokenRh, convId, PNG_1PX, 'capture-test.png', 'image/png', 'Voici la capture');
  let j = r.json;
  if (r.status === 201 && j.message && j.message.type_message === 'image') {
    ok('image acceptée : type_message=image, legende="' + (j.message.contenu || '') + '"');
  } else echec('image : ' + r.status + ' ' + JSON.stringify(j));

  /* --- 2. Fichier servi statiquement --- */
  if (j.message && j.message.fichier_chemin) {
    const rs = await fetch('http://localhost:4000' + j.message.fichier_chemin);
    const buf = Buffer.from(await rs.arrayBuffer());
    rs.ok && buf.equals(PNG_1PX) ? ok('fichier servi statiquement, octets identiques (' + j.message.fichier_chemin + ')')
      : echec('service statique : ' + rs.status + ', ' + buf.length + ' octets');
  } else echec('fichier_chemin absent : ' + JSON.stringify(j));

  /* --- 3. Rejet d'un type non autorisé --- */
  r = await envoyerPJ(tokenRh, convId, Buffer.from('<html></html>'), 'page.html', 'text/html');
  r.status === 415 ? ok('type HTML rejeté (415)') : echec('type interdit accepté ? ' + r.status + ' ' + JSON.stringify(r.json));

  /* --- 4. Aperçu de la liste : dernier_message.type_message --- */
  const rl = await fetch(API + '/messenger/conversations', { headers: H(tokenRh) });
  const liste = await rl.json();
  const conv = (Array.isArray(liste) ? liste : []).find((c) => c.id === convId);
  conv && conv.dernier_message && conv.dernier_message.type_message === 'image'
    ? ok('liste : dernier_message.type_message = image')
    : echec('liste sans type_message : ' + JSON.stringify(conv && conv.dernier_message));

  /* --- 5. Message vocal simulé (audio/webm) --- */
  r = await envoyerPJ(tokenRh, convId, Buffer.from('RIFF0000WEBPVP8 fake-audio'), 'vocal-' + Date.now() + '.webm', 'audio/webm');
  r.status === 201 && r.json.message && r.json.message.type_message === 'audio'
    ? ok('vocal accepté : type_message=audio')
    : echec('vocal : ' + r.status + ' ' + JSON.stringify(r.json));

  console.log(ecarts === 0 ? 'TESTS PIECES JOINTES : TOUS OK' : `TESTS PIECES JOINTES : ${ecarts} ECART(S)`);
  process.exit(ecarts === 0 ? 0 : 1);
})().catch((e) => { console.error('ECHEC test :', e.message); process.exit(2); });
