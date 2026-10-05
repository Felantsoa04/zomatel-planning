/* Diagnostic : ouvre /planning/gestion en chef et inspecte le DOM reel. */
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
function cdpSend(ws, id, method, params = {}) { ws.send(JSON.stringify({ id, method, params })); }
function waitForMessage(ws) { return new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString())))); }
async function evalJS(ws, id, expression) {
  cdpSend(ws, id, 'Runtime.evaluate', { expression, returnByValue: true });
  while (true) {
    const msg = await waitForMessage(ws);
    if (msg.id === id) return msg.result?.result?.value;
  }
}

(async () => {
  const rh = await httpJson(BACK + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }) });
  const T = rh.body.token;
  const services = await httpJson(BACK + '/services', { headers: { Authorization: 'Bearer ' + T } });
  const reception = services.body.find((s) => /r[ée]ception/i.test(s.nom || ''));
  const suffix = Date.now().toString().slice(-6);
  const loginChef = 'chef_dbg_' + suffix;
  const cr = await httpJson(BACK + '/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ nom: 'TEST', login: loginChef, mot_de_passe: 'Test1234!', role: 'CHEF_SERVICE', id_service: reception.id_service }) });
  const idChef = cr.body.id_utilisateur;
  const chef = await httpJson(BACK + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: loginChef, mot_de_passe: 'Test1234!' }) });
  const TC = chef.body.token;
  const cp = await httpJson(BACK + '/plannings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TC }, body: JSON.stringify({ annee: 2031, numero_semaine: 2, date_debut: '2031-01-06', date_fin: '2031-01-12' }) });
  const idPlanning = cp.body.id_planning;
  console.log('planning de test :', idPlanning);

  execSync('taskkill //F //IM chrome.exe > /dev/null 2>&1 || true');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9222', '--no-first-run',
    '--user-data-dir=' + process.env.TEMP + '/z-chrome-dbg', 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));
  const targets = await httpJson('http://127.0.0.1:9222/json');
  const page = targets.body.find((t) => t.type === 'page');
  const pathWs = require('path').resolve(__dirname, '..', 'frontend', 'node_modules', 'ws');
  const WebSocket = require(pathWs);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let idc = 0;

  cdpSend(ws, ++idc, 'Page.navigate', { url: FRONT + '/login' });
  await new Promise((r) => setTimeout(r, 9000));
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
  console.log('apres login :', await evalJS(ws, ++idc, 'location.pathname'));

  cdpSend(ws, ++idc, 'Page.navigate', { url: FRONT + '/planning/gestion?service=' + reception.id_service + '&semaine=2031-W02' });
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const etat = await evalJS(ws, ++idc, `(() => ({
      url: location.pathname + location.search,
      titre: document.querySelector('h1')?.textContent || null,
      selects: [...document.querySelectorAll('select')].map((s) => s.value),
      nbTables: document.querySelectorAll('table').length,
      nbLignes: document.querySelectorAll('table tbody tr').length,
      message: document.querySelector('.error, .muted')?.textContent?.slice(0, 80) || null,
    }))()`);
    console.log('attente ' + i + ' :', JSON.stringify(etat));
    if (etat.nbLignes > 3) break;
  }

  const cible = await evalJS(ws, ++idc, `(() => {
    const lignes = [...document.querySelectorAll('table tbody tr')];
    const ligne = lignes.find((tr) => tr.textContent.includes('ANGELA'));
    return { trouvee: !!ligne, nbTd: ligne ? ligne.querySelectorAll('td').length : 0, extrait: ligne ? ligne.textContent.slice(0, 80) : lignes.slice(0, 2).map((l) => l.textContent.slice(0, 50)) };
  })()`);
  console.log('ligne ANGELA :', JSON.stringify(cible));

  ws.close();
  chrome.kill();
  await httpJson(BACK + '/plannings/' + idPlanning, { method: 'DELETE', headers: { Authorization: 'Bearer ' + TC } });
  await httpJson(BACK + '/auth/users/' + idChef, { method: 'DELETE', headers: { Authorization: 'Bearer ' + T } });
  console.log('nettoyage OK');
  process.exit(0);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
