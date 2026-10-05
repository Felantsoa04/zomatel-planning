/* Test navigateur (CDP) du modal « Ajouter un planning ».
 * - chef temporaire cree via API RH (fonctionnalite existante), supprime a la fin
 * - ouvre /dashboard/chef, clique « + Ajouter un planning » -> modal
 * - verifie les champs, cree reellement via POST /plannings (endpoint existant)
 * - verifie fermeture auto + presence dans la liste via API
 * - verifie Echap / Annuler / X sans creation
 */
const http = require('http');
const { execSync, spawn } = require('child_process');

const FRONT = 'http://localhost:3001';
const BACK = 'http://localhost:4000/api';

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method: options.method || 'GET', headers: options.headers || {} }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); } catch { resolve({ status: res.statusCode, body: null }); } });
    });
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

function cdpSend(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
}
function waitForMessage(ws) {
  return new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
}
async function evalJS(ws, id, expression) {
  cdpSend(ws, id, 'Runtime.evaluate', { expression, returnByValue: true });
  while (true) {
    const msg = await waitForMessage(ws);
    if (msg.id === id) return msg.result?.result?.value;
  }
}

let echecs = 0;
function check(nom, condition, detail = '') {
  console.log((condition ? 'PASS' : 'FAIL') + '  ' + nom + (detail ? ' — ' + detail : ''));
  if (!condition) echecs++;
}

(async () => {
  // --- Setup : chef temporaire via API RH (comptes/fonctions existants)
  const rh = await httpJson(BACK + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }),
  });
  const T = rh.body.token;
  const services = await httpJson(BACK + '/services', { headers: { Authorization: 'Bearer ' + T } });
  const reception = services.body.find((s) => /r[ée]ception/i.test(s.nom || ''));
  const suffix = Date.now().toString().slice(-6);
  const loginChef = 'chef_modal_' + suffix;
  const cr = await httpJson(BACK + '/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
    body: JSON.stringify({ nom: 'TEST', prenom: 'MODAL', login: loginChef, mot_de_passe: 'Test1234!', role: 'CHEF_SERVICE', id_service: reception.id_service }),
  });
  const idChef = cr.body.id_utilisateur;
  const chef = await httpJson(BACK + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginChef, mot_de_passe: 'Test1234!' }),
  });
  if (chef.status !== 200) return console.log('ECHEC setup chef', chef.status);
  console.log('Setup : chef temporaire OK (' + loginChef + ')');

  // --- Chrome headless + CDP
  execSync('taskkill //F //IM chrome.exe > /dev/null 2>&1 || true');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + process.env.TEMP + '/z-chrome-modal', 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));
  const targets = await httpJson('http://127.0.0.1:9222/json');
  const page = targets.body.find((t) => t.type === 'page');
  const pathWs = require('path').resolve(__dirname, '..', 'frontend', 'node_modules', 'ws');
  const WebSocket = require(pathWs);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let idc = 0;

  // --- Connexion via le formulaire de login (vrai parcours utilisateur)
  cdpSend(ws, ++idc, 'Page.navigate', { url: FRONT + '/login' });
  await new Promise((r) => setTimeout(r, 8000));
  await evalJS(ws, ++idc, `(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const inp = document.querySelector('form input:not([type=password])');
    const pwd = document.querySelector('form input[type=password]');
    setter.call(inp, ${JSON.stringify(loginChef)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(pwd, 'Test1234!');
    pwd.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await evalJS(ws, ++idc, `(() => { document.querySelector('form button[type=submit], form button').click(); return 'clic'; })()`);
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const url = await evalJS(ws, ++idc, 'location.pathname');
    if (url && url.startsWith('/dashboard')) break;
  }
  await new Promise((r) => setTimeout(r, 6000));
  check('connexion chef -> /dashboard/chef', (await evalJS(ws, ++idc, 'location.pathname')) === '/dashboard/chef');

  // --- 1. Le bouton ouvre le modal
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Ajouter un planning')); if (b) { b.click(); return 'clic'; } return 'bouton introuvable'; })()`);
  await new Promise((r) => setTimeout(r, 800));
  check('Test 2-3 : clic -> modal ouvert', (await evalJS(ws, ++idc, `!!document.querySelector('.modal-boite')`)) === true);
  check('Test 3 : titre « Ajouter un planning »', (await evalJS(ws, ++idc, `document.querySelector('.modal-entete h3')?.textContent || ''`)) === 'Ajouter un planning');

  // --- 4. Champs présents
  const champs = await evalJS(ws, ++idc, `(() => ({
    debut: !!document.querySelector('.modal-boite input[type=date]'),
    nbDates: document.querySelectorAll('.modal-boite input[type=date]').length,
    annuler: [...document.querySelectorAll('.modal-boite button')].some((b) => b.textContent.trim() === 'Annuler'),
    creer: [...document.querySelectorAll('.modal-boite button')].some((b) => b.textContent.trim() === 'Créer'),
    croix: !!document.querySelector('.modal-fermer'),
  }))()`);
  check('Test 4 : 2 champs date (debut/fin) — SEULS champs du formulaire existant', champs.nbDates === 2, JSON.stringify(champs));
  check('Test 4 : boutons Annuler + Créer + croix [X] présents', champs.annuler && champs.creer && champs.croix);

  // --- 5/6/7. Creation reelle (endpoint existant POST /plannings)
  // Semaine future sans conflit : lundi d'une semaine de 2031
  await evalJS(ws, ++idc, `(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const dates = document.querySelectorAll('.modal-boite input[type=date]');
    setter.call(dates[0], '2031-01-06');
    dates[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(dates[1], '2031-01-12');
    dates[1].dispatchEvent(new Event('input', { bubbles: true }));
    return 'dates saisies';
  })()`);
  // Interception du nombre d'appels POST /plannings pour prouver l'endpoint
  await evalJS(ws, ++idc, `(() => { window.__postsPlannings = 0; const of = window.fetch; window.fetch = function(u, o) { if (String(u).includes('/plannings') && (o?.method || 'GET') === 'POST') window.__postsPlannings++; return of.apply(this, arguments); }; return 'sonde posee'; })()`);
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite button')].find((x) => x.textContent.trim() === 'Créer'); b.click(); return 'clic creer'; })()`);
  await new Promise((r) => setTimeout(r, 3000));
  const posts = await evalJS(ws, ++idc, 'window.__postsPlannings');
  check('Test 6 : endpoint existant POST /plannings appelé exactement 1 fois', posts === 1, 'appels=' + posts);
  check('Test 8 : modal fermé après succès', (await evalJS(ws, ++idc, `!document.querySelector('.modal-boite')`)) === true);

  // --- 9. Le planning apparait dans la liste (API avec le meme compte)
  const liste = await httpJson(BACK + '/plannings', { headers: { Authorization: 'Bearer ' + chef.body.token } });
  const trouve = (liste.body || []).find((p) => p.annee === 2031 && p.numero_semaine === 2);
  check('Test 7/9 : planning enregistré et visible dans la liste (S2/2031)', !!trouve, trouve ? '#' + trouve.id_planning : 'absent');

  // --- 10. Erreur API : modal reste ouvert + message
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Ajouter un planning')); b.click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 500));
  // Doublon volontaire : la meme semaine existe deja -> l'API refuse (anti-doublon)
  await evalJS(ws, ++idc, `(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const dates = document.querySelectorAll('.modal-boite input[type=date]');
    setter.call(dates[0], '2031-01-06');
    dates[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(dates[1], '2031-01-12');
    dates[1].dispatchEvent(new Event('input', { bubbles: true }));
    return 'doublon saisi';
  })()`);
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite button')].find((x) => x.textContent.trim() === 'Créer'); b.click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 2500));
  const erreurVisible = await evalJS(ws, ++idc, `(() => ({ modalOuvert: !!document.querySelector('.modal-boite'), erreur: document.querySelector('.modal-boite .error')?.textContent || null }))()`);
  check('Test 10 : erreur API -> modal RESTE ouvert + message affiché', erreurVisible.modalOuvert && !!erreurVisible.erreur, JSON.stringify(erreurVisible).slice(0, 120));

  // --- 11a. Échap ferme sans créer
  await evalJS(ws, ++idc, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'esc'`);
  await new Promise((r) => setTimeout(r, 400));
  check('Test 11a : Échap ferme le modal', (await evalJS(ws, ++idc, `!document.querySelector('.modal-boite')`)) === true);

  // --- 11b. Annuler ferme sans créer
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Ajouter un planning')); b.click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  const avantAnnuler = await evalJS(ws, ++idc, 'window.__postsPlannings');
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite button')].find((x) => x.textContent.trim() === 'Annuler'); b.click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  check('Test 11b : Annuler ferme sans requête POST', (await evalJS(ws, ++idc, `!document.querySelector('.modal-boite')`)) === true && (await evalJS(ws, ++idc, 'window.__postsPlannings')) === avantAnnuler);

  // --- 11c. Croix [X] ferme sans créer
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Ajouter un planning')); b.click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  await evalJS(ws, ++idc, `(() => { document.querySelector('.modal-fermer').click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  check('Test 11c : croix [X] ferme le modal', (await evalJS(ws, ++idc, `!document.querySelector('.modal-boite')`)) === true);

  // --- Nettoyage
  ws.close();
  chrome.kill();
  if (trouve) {
    const del = await httpJson(BACK + '/plannings/' + trouve.id_planning, { method: 'DELETE', headers: { Authorization: 'Bearer ' + chef.body.token } });
    check('Nettoyage : planning de test supprimé', del.status === 200, 'status=' + del.status);
  }
  const delChef = await httpJson(BACK + '/auth/users/' + idChef, { method: 'DELETE', headers: { Authorization: 'Bearer ' + T } });
  check('Nettoyage : chef temporaire désactivé', delChef.status === 200);

  console.log(echecs === 0 ? '\nRESULTAT : TOUS LES TESTS PASSENT' : `\nRESULTAT : ${echecs} ECHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
