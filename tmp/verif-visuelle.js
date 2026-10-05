/* Vérification visuelle du dashboard Zomatel — Chrome headless + CDP.
 * Se connecte en RH, ouvre /dashboard/rh et mesure les styles calculés
 * pour prouver que l'identité visuelle (sidebar sombre, pastilles,
 * layout colonnes, topbar flottante) est réellement rendue.
 */
const http = require('http');

const FRONT = 'http://localhost:3001';
const BACK = 'http://localhost:4000/api';

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET', headers: options.headers || {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (_) {
          resolve({ status: res.statusCode, body: null });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function cdpSend(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
}

function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString())));
  });
}

async function evalJS(ws, id, expression) {
  cdpSend(ws, id, 'Runtime.evaluate', { expression, returnByValue: true });
  while (true) {
    const msg = await waitForMessage(ws);
    if (msg.id === id) return msg.result?.result?.value;
  }
}

(async () => {
  // 1. Login RH via l'API (le stockage localStorage sera injecté dans le navigateur)
  const login = await httpJson(BACK + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }),
  });
  if (login.status !== 200) return console.log('LOGIN ECHEC', login.status);
  const token = login.body.token;
  const user = JSON.stringify(login.body.user);
  console.log('1. Login RH : OK');

  // 2. Chrome headless avec port debug
  const { execSync, spawn } = require('child_process');
  execSync('taskkill //F //IM chrome.exe > /dev/null 2>&1 || true');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + process.env.TEMP + '/z-chrome-visu', 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));

  // 3. Récupérer le WebSocket debugger URL
  const targets = await httpJson('http://127.0.0.1:9222/json');
  const page = targets.body.find((t) => t.type === 'page');
  if (!page) return console.log('PAS DE PAGE CDP');

  const pathWs = require('path').resolve(__dirname, '..', 'frontend', 'node_modules', 'ws');
  const WebSocket = require(pathWs);
  let ws;
  try {
    ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch (e) {
    return console.log('WS indisponible (module ws absent) :', e.message);
  }
  await new Promise((r) => ws.on('open', r));
  let idc = 0;

  // 4. Se connecter VIA LE FORMULAIRE (comme un vrai utilisateur)
  cdpSend(ws, ++idc, 'Page.navigate', { url: FRONT + '/login' });
  await new Promise((r) => setTimeout(r, 8000));
  const champs = await evalJS(ws, ++idc, `(() => {
    const inp = document.querySelector('form input:not([type=password])');
    const pwd = document.querySelector('form input[type=password]');
    if (!inp || !pwd) return 'champs introuvables';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, 'rh');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(pwd, 'rh123');
    pwd.dispatchEvent(new Event('input', { bubbles: true }));
    return 'champs remplis';
  })()`);
  console.log('   Formulaire :', champs);
  await evalJS(ws, ++idc, `(() => { const b = document.querySelector('form button[type=submit], form button'); if (b) b.click(); return 'clic'; })()`);
  // Attendre la redirection + fetchs du dashboard (jusqu'à 45 s)
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const url = await evalJS(ws, ++idc, 'location.pathname');
    if (url && url.startsWith('/dashboard')) break;
  }
  await new Promise((r) => setTimeout(r, 8000));
  console.log('   URL finale :', await evalJS(ws, ++idc, 'location.pathname'));

  // Capturer les erreurs console React pendant la session
  const erreurs = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      const txt = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
      if (/hook|Hook|render|Render|update a component/.test(txt)) erreurs.push(txt.slice(0, 200));
    }
  });
  // Forcer un second rendu (changement de filtre) pour détecter un éventuel désordre de hooks
  await evalJS(ws, ++idc, `(() => {
    window.dispatchEvent(new CustomEvent('zomatel:filtres', { detail: { statut: 'VALIDE' } }));
    return 'filtre applique';
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
  await evalJS(ws, ++idc, `(() => {
    window.dispatchEvent(new CustomEvent('zomatel:filtres', { detail: { statut: '' } }));
    return 'filtre retire';
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('   Erreurs hooks/render detectées :', erreurs.length ? erreurs : 'AUCUNE ✔');

  // 5. Mesures de l'identité visuelle
  const mesures = await evalJS(ws, ++idc, `(() => {
    const g = (sel, prop) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return getComputedStyle(el)[prop];
    };
    return {
      url: location.pathname,
      titre: document.querySelector('.dash-titre')?.textContent?.trim() || null,
      sidebar: { bg: g('.dash-sidebar', 'backgroundImage') !== 'none' ? 'degrade' : g('.dash-sidebar', 'backgroundColor'), largeur: g('.dash-sidebar', 'width') },
      topbar: { radius: g('.dash-topbar', 'borderRadius'), ombre: g('.dash-topbar', 'boxShadow') !== 'none' },
      stats: {
        nb: document.querySelectorAll('.dash-stat').length,
        radius: g('.dash-stat', 'borderRadius'),
        pastille: !!document.querySelector('.dash-stat .stat-icone'),
        iconePremiere: document.querySelector('.dash-stat .stat-icone')?.textContent || null,
        valeurTeintee: g('.dash-stat-vert .valeur', 'color'),
      },
      layout: { colonnes: g('.dash-ligne', 'gridTemplateColumns'), lateral: !!document.querySelector('.dash-ligne-lateral') },
      carteService: { radius: g('.eps-carte', 'borderRadius'), ombre: g('.eps-carte', 'boxShadow') !== 'none' },
      accesVerticaux: document.querySelectorAll('.dash-acces-vertical .dash-acces-lien').length,
      carteNotifs: !!document.querySelector('.dash-carte-notifs'),
      employesTotal: document.querySelectorAll('.eps-employe').length,
      servicesAffiches: document.querySelectorAll('.eps-carte').length,
      erreursConsole: window.__err || 0,
    };
  })()`);
  console.log('2. MESURES IDENTITÉ VISUELLE :');
  console.log(JSON.stringify(mesures, null, 2));

  // 6. Capture d'écran
  cdpSend(ws, ++idc, 'Page.captureScreenshot', { format: 'png' });
  let shotId = idc;
  while (true) {
    const msg = await waitForMessage(ws);
    if (msg.id === shotId) {
      if (msg.result?.data) {
        require('fs').writeFileSync('tmp/dashboard-rh.png', Buffer.from(msg.result.data, 'base64'));
        console.log('3. Capture enregistrée : tmp/dashboard-rh.png');
      }
      break;
    }
  }

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => {
  console.error('ERREUR :', e.message);
  process.exit(1);
});
