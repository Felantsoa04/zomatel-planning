/* Test du bouton « Export Excel » (EmploiDuTemps.js) qui appelle api.getBrut()
 * -> GET /plannings/3/emploi-du-temps.xlsx (endpoint existant, JWT requis).
 * Vérifie : login RH, vue EDT, clic bouton, blob téléchargé = xlsx valide
 * (signature ZIP PK) et ouvrable par SheetJS avec le titre attendu.
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
function cdpSend(ws, id, method, params = {}) { ws.send(JSON.stringify({ id, method, params })); }
function waitForMessage(ws) { return new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString())))); }
async function evalJS(ws, id, expression) {
  cdpSend(ws, id, 'Runtime.evaluate', { expression, returnByValue: true });
  while (true) {
    const msg = await waitForMessage(ws);
    if (msg.id === id) return msg.result?.result?.value;
  }
}
let echecs = 0;
function check(nom, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + nom + (detail ? ' — ' + detail : ''));
  if (!cond) echecs++;
}

(async () => {
  const l = await httpJson(BACK + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }) });
  if (l.status !== 200) return console.log('ECHEC login', l.status);
  console.log('Setup : RH connecté');

  execSync('taskkill //F //IM chrome.exe > /dev/null 2>&1 || true');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9222', '--no-first-run',
    '--user-data-dir=' + process.env.TEMP + '/z-chrome-xlsx', 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));
  const targets = await httpJson('http://127.0.0.1:9222/json');
  const page = targets.body.find((t) => t.type === 'page');
  const pathWs = require('path').resolve(__dirname, '..', 'frontend', 'node_modules', 'ws');
  const WebSocket = require(pathWs);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let idc = 0;

  // Login via formulaire
  cdpSend(ws, ++idc, 'Page.navigate', { url: FRONT + '/login' });
  await new Promise((r) => setTimeout(r, 9000));
  await evalJS(ws, ++idc, `(() => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const i = document.querySelector('form input:not([type=password])');
    const p = document.querySelector('form input[type=password]');
    s.call(i, 'rh'); i.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(p, 'rh123'); p.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await evalJS(ws, ++idc, `(() => { document.querySelector('form button[type=submit], form button').click(); return 'clic'; })()`);
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const u = await evalJS(ws, ++idc, 'location.pathname');
    if (u && u.startsWith('/dashboard')) break;
  }
  check('Login RH -> dashboard', (await evalJS(ws, ++idc, 'location.pathname')).startsWith('/dashboard'));

  // Vue emploi du temps du planning 3 (bouton Export Excel présent en VALIDE)
  cdpSend(ws, ++idc, 'Page.navigate', { url: FRONT + '/planning/3' });
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const nb = await evalJS(ws, ++idc, `document.querySelectorAll('button').length`);
    if (nb > 2) break;
  }
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('emploi du temps')); if (b) b.click(); return 'vue EDT'; })()`);
  await new Promise((r) => setTimeout(r, 4000));
  check('Bouton « Export Excel » présent (planning VALIDE)', (await evalJS(ws, ++idc, `[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Export Excel')`)) === true);

  // Clic sur Export Excel : intercepte le fetch pour vérifier l'authentification + le contenu
  await evalJS(ws, ++idc, `(() => {
    window.__xlsx = null; window.__authHeader = null;
    const of = window.fetch;
    window.fetch = async function(u, o) {
      if (String(u).includes('emploi-du-temps.xlsx')) {
        window.__authHeader = o?.headers?.Authorization || null;
        const r = await of.apply(this, arguments);
        const c = await r.clone().blob();
        window.__xlsx = { taille: c.size, type: c.type, signature: null };
        const buf = new Uint8Array(await c.arrayBuffer()).slice(0, 2);
        window.__xlsx.signature = String.fromCharCode(buf[0]) + String.fromCharCode(buf[1]);
      }
      return r;
    };
    return 'sonde posée';
  })()`);
  await evalJS(ws, ++idc, `(() => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Export Excel').click(); return 'clic export'; })()`);
  await new Promise((r) => setTimeout(r, 5000));
  const r = await evalJS(ws, ++idc, `({ auth: window.__authHeader ? window.__authHeader.slice(0, 14) + '...' : null, x: window.__xlsx })`);
  check('Appel authentifié (JWT dans Authorization)', !!r.auth, r.auth);
  check('Blob téléchargé (xlsx > 3 Ko)', r.x && r.x.taille > 3000, r.x ? r.x.taille + ' octets' : 'aucun');
  check('Signature ZIP valide (PK = fichier xlsx réel)', r.x && r.x.signature === 'PK', r.x ? r.x.signature : '-');

  // Vérifie le contenu réel : ouvre le xlsx téléchargé côté Node
  const tele = await httpJson(BACK + '/plannings/3/emploi-du-temps.xlsx', { headers: { Authorization: 'Bearer ' + l.body.token } });
  // (recharge via API directe pour inspection SheetJS)
  const fichier = require('path').resolve(__dirname, 'edt-telecharge.xlsx');
  // Le test navigateur a déjà prouvé le flux ; on contrôle le contenu du même endpoint
  const rr = await fetch(BACK + '/plannings/3/emploi-du-temps.xlsx', { headers: { Authorization: 'Bearer ' + l.body.token } });
  const ab = Buffer.from(await rr.arrayBuffer());
  require('fs').writeFileSync(fichier, ab);
  process.chdir(require('path').resolve(__dirname, '..', 'backend'));
  const XLSX = require(require('path').resolve(__dirname, '..', 'backend', 'node_modules', 'xlsx'));
  const wb = XLSX.readFile(fichier, { cellStyles: true });
  check('Contenu : titre EDT fidèle au modèle', (wb.Sheets[wb.SheetNames[0]]['E2']?.v || '').startsWith('EMPLOI DU TEMPS Réception'), wb.Sheets[wb.SheetNames[0]]['E2']?.v);
  require('fs').unlinkSync(fichier);

  ws.close();
  chrome.kill();
  console.log(echecs === 0 ? '\nRESULTAT : TELECHARGEMENT EXCEL AUTHENTIFIE FONCTIONNEL' : `\nRESULTAT : ${echecs} ECHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
