/* Test rapide du flux Export Excel via api.getBrut()
 * login formulaire -> /planning/3 -> vue EDT -> clic Export Excel
 * sonde fetch : Authorization présent, blob xlsx (PK), taille
 */
const http = require('http');
const { execSync, spawn } = require('child_process');

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
function waitForMessage(ws) { return new Promise((r) => ws.once('message', (d) => r(JSON.parse(d.toString())))); }
async function evalJS(ws, id, e) {
  cdpSend(ws, id, 'Runtime.evaluate', { expression: e, returnByValue: true });
  while (true) { const m = await waitForMessage(ws); if (m.id === id) return m.result?.result?.value; }
}
const attente = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  execSync('taskkill //F //IM chrome.exe > /dev/null 2>&1 || true');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--remote-debugging-port=9222', '--no-first-run', '--user-data-dir=' + process.env.TEMP + '/z-chrome-export', 'about:blank'], { stdio: 'ignore' });
  await attente(4000);
  const t = await httpJson('http://127.0.0.1:9222/json');
  const page = t.body.find((x) => x.type === 'page');
  const WebSocket = require(require('path').resolve(__dirname, '..', 'frontend', 'node_modules', 'ws'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let idc = 0;

  cdpSend(ws, ++idc, 'Page.navigate', { url: 'http://localhost:3001/login' });
  await attente(8000);
  await evalJS(ws, ++idc, `(() => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const i = document.querySelector('form input:not([type=password])');
    const p = document.querySelector('form input[type=password]');
    s.call(i, 'rh'); i.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(p, 'rh123'); p.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form button[type=submit], form button').click();
    return 'ok';
  })()`);
  for (let i = 0; i < 8; i++) { await attente(2500); const u = await evalJS(ws, ++idc, 'location.pathname'); if (String(u).startsWith('/dashboard')) break; }
  console.log('login ->', await evalJS(ws, ++idc, 'location.pathname'));

  cdpSend(ws, ++idc, 'Page.navigate', { url: 'http://localhost:3001/planning/3' });
  for (let i = 0; i < 10; i++) { await attente(2500); const nb = await evalJS(ws, ++idc, `document.querySelectorAll('button').length`); if (nb > 2) break; }
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('emploi du temps')); if (b) b.click(); return 'ok'; })()`);
  await attente(3000);
  const bouton = await evalJS(ws, ++idc, `[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Export Excel')`);
  console.log(bouton ? 'PASS  bouton Export Excel visible' : 'FAIL  bouton absent');

  // Sonde fetch + clic
  await evalJS(ws, ++idc, `(() => {
    window.__x = null;
    const of = window.fetch;
    window.fetch = async function(u, o) {
      if (String(u).includes('emploi-du-temps.xlsx')) {
        const r = await of.apply(this, arguments);
        const c = await r.clone().blob();
        const buf = new Uint8Array(await c.arrayBuffer()).slice(0, 2);
        window.__x = { auth: !!(o?.headers?.Authorization), taille: c.size, sig: String.fromCharCode(buf[0]) + String.fromCharCode(buf[1]) };
        return r;
      }
      return of.apply(this, arguments);
    };
    [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Export Excel').click();
    return 'clic';
  })()`);
  for (let i = 0; i < 6; i++) { await attente(2000); const x = await evalJS(ws, ++idc, 'window.__x'); if (x) { console.log((x.auth && x.taille > 3000 && x.sig === 'PK') ? 'PASS' : 'FAIL', ' téléchargement :', JSON.stringify(x)); break; } }

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
