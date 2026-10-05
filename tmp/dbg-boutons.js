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

(async () => {
  const l = await httpJson('http://localhost:4000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }) });
  execSync('taskkill //F //IM chrome.exe > /dev/null 2>&1 || true');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--remote-debugging-port=9222', '--no-first-run', '--user-data-dir=' + process.env.TEMP + '/z-dbg-btn', 'about:blank'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));
  const t = await httpJson('http://127.0.0.1:9222/json');
  const page = t.body.find((x) => x.type === 'page');
  const WebSocket = require(require('path').resolve(__dirname, '..', 'frontend', 'node_modules', 'ws'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let idc = 0;
  cdpSend(ws, ++idc, 'Page.navigate', { url: 'http://localhost:3001/login' });
  await new Promise((r) => setTimeout(r, 9000));
  // Login via formulaire (plus fiable que l'injection localStorage)
  await evalJS(ws, ++idc, `(() => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const i = document.querySelector('form input:not([type=password])');
    const p = document.querySelector('form input[type=password]');
    s.call(i, 'rh'); i.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(p, 'rh123'); p.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form button[type=submit], form button').click();
    return 'ok';
  })()`);
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const u = await evalJS(ws, ++idc, 'location.pathname');
    if (u && u.startsWith('/dashboard')) break;
  }
  cdpSend(ws, ++idc, 'Page.navigate', { url: 'http://localhost:3001/planning/3' });
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const nb = await evalJS(ws, ++idc, `document.querySelectorAll('button').length`);
    if (nb > 0) break;
  }
  // Bascule la vue EDT puis liste les boutons
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('emploi du temps')); if (b) b.click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 4000));
  const etat = await evalJS(ws, ++idc, `(() => ({ url: location.pathname, erreurs: document.querySelector('.error')?.textContent || null, boutons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 15) }))()`);
  console.log(JSON.stringify(etat, null, 1));
  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
