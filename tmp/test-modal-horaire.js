/* Test navigateur (CDP) du modal « Ajouter un horaire » (grille /planning/gestion).
 * - chef temporaire + planning BROUILLON de test (2031-S02), créés via API existante
 * - ouvre la grille, clic sur une cellule -> modal
 * - préremplissage employé/jour, dropdowns d'heures (00:00→24:00, pas 30 min, auto-scroll)
 * - enregistre 08:00-16:00 (logique existante), sauvegarde via PUT grille existant
 * - fermetures Échap/Annuler/[X], erreur (fin<=début), nettoyage complet
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
function check(nom, condition, detail = '') {
  console.log((condition ? 'PASS' : 'FAIL') + '  ' + nom + (detail ? ' — ' + detail : ''));
  if (!condition) echecs++;
}

(async () => {
  // --- Setup : chef temporaire + planning BROUILLON de test (API existantes)
  const rh = await httpJson(BACK + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }) });
  const T = rh.body.token;
  const services = await httpJson(BACK + '/services', { headers: { Authorization: 'Bearer ' + T } });
  const reception = services.body.find((s) => /r[ée]ception/i.test(s.nom || ''));
  const suffix = Date.now().toString().slice(-6);
  const loginChef = 'chef_hor_' + suffix;
  const cr = await httpJson(BACK + '/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: JSON.stringify({ nom: 'TEST', prenom: 'HOR', login: loginChef, mot_de_passe: 'Test1234!', role: 'CHEF_SERVICE', id_service: reception.id_service }) });
  const idChef = cr.body.id_utilisateur;
  const chef = await httpJson(BACK + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: loginChef, mot_de_passe: 'Test1234!' }) });
  const TC = chef.body.token;
  const emps = await httpJson(BACK + '/employes', { headers: { Authorization: 'Bearer ' + TC } });
  const emp = (emps.body || [])[0];
  const cp = await httpJson(BACK + '/plannings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TC }, body: JSON.stringify({ annee: 2031, numero_semaine: 2, date_debut: '2031-01-06', date_fin: '2031-01-12' }) });
  const idPlanning = cp.body.id_planning;
  console.log('Setup : chef + planning de test #' + idPlanning, '| employé :', emp.nom);

  // --- Chrome headless + CDP
  execSync('taskkill //F //IM chrome.exe > /dev/null 2>&1 || true');
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + process.env.TEMP + '/z-chrome-hor', 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));
  const targets = await httpJson('http://127.0.0.1:9222/json');
  const page = targets.body.find((t) => t.type === 'page');
  const pathWs = require('path').resolve(__dirname, '..', 'frontend', 'node_modules', 'ws');
  const WebSocket = require(pathWs);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let idc = 0;

  // --- Login chef via formulaire
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

  // --- Ouverture de la grille du planning de test
  cdpSend(ws, ++idc, 'Page.navigate', { url: FRONT + '/planning/gestion?service=' + reception.id_service + '&semaine=2031-W02' });
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pret = await evalJS(ws, ++idc, `(() => ({ url: location.pathname, cellules: document.querySelectorAll('table td').length }))()`);
    if (pret && pret.url === '/planning/gestion' && pret.cellules > 10) break;
  }
  await new Promise((r) => setTimeout(r, 4000));

  // --- 1/2/3/4. Clic sur la cellule de l'employé (colonne Lundi)
  const clic = await evalJS(ws, ++idc, `(() => {
    // Ligne de l'employé : la 1re ligne de données de la grille
    const lignes = [...document.querySelectorAll('table tbody tr')];
    const ligne = lignes.find((tr) => tr.textContent.includes(${JSON.stringify(emp.nom)}));
    if (!ligne) return 'ligne employé introuvable';
    const cellulesCliquables = [...ligne.querySelectorAll('td button, td [role=button], td .cellule')];
    const cible = cellulesCliquables[0] || ligne.querySelectorAll('td')[1];
    (cible || ligne).click();
    return 'clic cellule';
  })()`);
  console.log('clic cellule :', clic);
  await new Promise((r) => setTimeout(r, 800));
  check('Test 1-2 : clic cellule -> modal ouvert', (await evalJS(ws, ++idc, `!!document.querySelector('.modal-boite')`)) === true);
  check('Test 3 : employé prérempli en lecture seule (' + emp.nom + ')', (await evalJS(ws, ++idc, `document.querySelector('.modal-boite')?.textContent || ''`)).includes(emp.nom));
  check('Test 4 : jour prérempli (Lundi 2031-01-06)', (await evalJS(ws, ++idc, `document.querySelector('.modal-boite')?.textContent || ''`)).includes('LUNDI') || (await evalJS(ws, ++idc, `document.querySelector('.modal-boite')?.textContent || ''`)).includes('Lundi'));

  // --- 5/6/7. Dropdown Heure début : liste 00:00 -> 24:00, pas 30 min
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite .shf-champ')][0]; b.click(); return 'clic dropdown'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  const options = await evalJS(ws, ++idc, `(() => {
    const opts = [...document.querySelectorAll('.shf-liste .shf-option span')].map((s) => s.textContent);
    return { nb: opts.length, premiere: opts[0], derniere: opts[opts.length - 1], contient1830: opts.includes('18:30'), scrollable: (() => { const l = document.querySelector('.shf-liste'); return l ? l.scrollHeight > l.clientHeight : false; })() };
  })()`);
  check('Test 6 : liste 00:00 -> 24:00 (49 options)', options.nb === 49 && options.premiere === '00:00' && options.derniere === '24:00', JSON.stringify(options));
  check('Test 7 : intervalle 30 min (18:30 présent)', options.contient1830 === true);
  check('Test 8 : défilement interne limité (scrollHeight > clientHeight)', options.scrollable === true);

  // --- 10/11. Auto-scroll vers 18:00
  await evalJS(ws, ++idc, `(() => { const opts = [...document.querySelectorAll('.shf-liste .shf-option')]; const c = opts.find((o) => o.textContent.includes('18:00')); if (c) c.click(); return '18:00 sélectionnée'; })()`);
  await new Promise((r) => setTimeout(r, 300));
  // Réouvre : la liste doit être auto-scrollée vers 18:00
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite .shf-champ')][0]; b.click(); return 'réouverture'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  const scrollPos = await evalJS(ws, ++idc, `(() => { const l = document.querySelector('.shf-liste'); return l ? { top: l.scrollTop, actif: document.querySelector('.shf-option-active')?.textContent || null } : null; })()`);
  check('Test 10-11 : auto-scroll vers 18:00 à l\'ouverture', scrollPos && scrollPos.top > 0 && (scrollPos.actif || '').includes('18:00'), JSON.stringify(scrollPos));
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite .shf-champ')][0]; b.click(); return 'ferme'; })()`);
  // Remet 08:00 pour la fin du scénario
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite .shf-champ')][0]; b.click(); return 're'; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJS(ws, ++idc, `(() => { const o = [...document.querySelectorAll('.shf-liste .shf-option')].find((x) => x.textContent.includes('08:00')); o.click(); return 'ok'; })()`);
  // Heure fin : 16:00
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite .shf-champ')][1]; b.click(); return 're'; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJS(ws, ++idc, `(() => { const o = [...document.querySelectorAll('.shf-liste .shf-option')].find((x) => x.textContent.includes('16:00')); o.click(); return 'ok'; })()`);
  const valeurs = await evalJS(ws, ++idc, `(() => ({ c1: document.querySelectorAll('.modal-boite .shf-champ')[0]?.textContent, c2: document.querySelectorAll('.modal-boite .shf-champ')[1]?.textContent }))()`);
  check('Test 12 : sélection 08:00 -> 16:00 affichée', (valeurs.c1 || '').includes('08:00') && (valeurs.c2 || '').includes('16:00'), JSON.stringify(valeurs));

  // --- 13/14. Enregistre (logique existante) puis sauvegarde grille
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite button')].find((x) => x.textContent.trim() === 'Enregistrer'); b.click(); return 'clic enregistrer'; })()`);
  await new Promise((r) => setTimeout(r, 600));
  check('Test 13 : modal fermé après Enregistrer', (await evalJS(ws, ++idc, `!document.querySelector('.modal-boite')`)) === true);
  // Vérifie l'affichage dans la cellule
  const cellule = await evalJS(ws, ++idc, `(() => {
    const lignes = [...document.querySelectorAll('table tbody tr')];
    const ligne = lignes.find((tr) => tr.textContent.includes(${JSON.stringify(emp.nom)}));
    return ligne ? ligne.textContent : '';
  })()`);
  check('Test 14 : horaire affiché dans la cellule (08:00 / 16:00)', cellule.includes('08:00') && cellule.includes('16:00'), cellule.slice(0, 90));

  // Sauvegarde réelle de la grille (bouton existant) puis vérif API
  const avantSave = await httpJson(BACK + '/plannings/' + idPlanning, { headers: { Authorization: 'Bearer ' + TC } });
  const creneauAvant = ((avantSave.body.affectations || []).find((a) => a.id_employe === emp.id_employe && a.jour === '2031-01-06')?.creneaux || [])[0];
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('button')].find((x) => /Enregistrer (le )?brouillon|Enregistrer/.test(x.textContent) && !x.closest('.modal-boite')); if (b) { b.click(); return 'sauvegarde'; } return 'bouton introuvable'; })()`);
  await new Promise((r) => setTimeout(r, 3500));
  const apres = await httpJson(BACK + '/plannings/' + idPlanning, { headers: { Authorization: 'Bearer ' + TC } });
  const aff = (apres.body.affectations || []).find((a) => a.id_employe === emp.id_employe && a.jour === '2031-01-06');
  const crx = (aff?.creneaux || [])[0];
  const heureCourte = (t) => (t || '').slice(0, 5);
  check('Test 14b : horaire enregistré en base via API existante (08:00-16:00)', crx && heureCourte(crx.heure_entree) === '08:00' && heureCourte(crx.heure_sortie) === '16:00', crx ? crx.heure_entree + '-' + crx.heure_sortie + ' periode=' + crx.periode : 'absent');
  check('Compat EDT : période déduite selon règle Excel (08:00 -> MATIN)', crx && crx.periode === 'MATIN', crx ? crx.periode : '-');

  // --- 16/17/18. Fermetures sans sauvegarde
  await evalJS(ws, ++idc, `(() => { const l = [...document.querySelectorAll('table tbody tr')].find((tr) => tr.textContent.includes(${JSON.stringify(emp.nom)})); l.querySelectorAll('td')[2].click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await evalJS(ws, ++idc, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'esc'`);
  await new Promise((r) => setTimeout(r, 400));
  check('Test 18 : Échap ferme le modal', (await evalJS(ws, ++idc, `!document.querySelector('.modal-boite')`)) === true);
  await evalJS(ws, ++idc, `(() => { const l = [...document.querySelectorAll('table tbody tr')].find((tr) => tr.textContent.includes(${JSON.stringify(emp.nom)})); l.querySelectorAll('td')[3].click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await evalJS(ws, ++idc, `(() => { document.querySelector('.modal-fermer').click(); return 'x'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  check('Test 17 : [X] ferme le modal', (await evalJS(ws, ++idc, `!document.querySelector('.modal-boite')`)) === true);
  await evalJS(ws, ++idc, `(() => { const l = [...document.querySelectorAll('table tbody tr')].find((tr) => tr.textContent.includes(${JSON.stringify(emp.nom)})); l.querySelectorAll('td')[4].click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite button')].find((x) => x.textContent.trim() === 'Annuler'); b.click(); return 'annuler'; })()`);
  await new Promise((r) => setTimeout(r, 400));
  check('Test 16 : Annuler ferme le modal', (await evalJS(ws, ++idc, `!document.querySelector('.modal-boite')`)) === true);

  // --- 19. Erreur API : fin <= début -> erreur affichée, modal ouvert
  await evalJS(ws, ++idc, `(() => { const l = [...document.querySelectorAll('table tbody tr')].find((tr) => tr.textContent.includes(${JSON.stringify(emp.nom)})); l.querySelectorAll('td')[2].click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await evalJS(ws, ++idc, `(() => {
    const b1 = document.querySelectorAll('.modal-boite .shf-champ')[0];
    b1.click();
    return 'dd1';
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJS(ws, ++idc, `(() => { const o = [...document.querySelectorAll('.shf-liste .shf-option')].find((x) => x.textContent.includes('16:00')); o.click(); return 'ok'; })()`);
  await evalJS(ws, ++idc, `(() => { document.querySelectorAll('.modal-boite .shf-champ')[1].click(); return 'dd2'; })()`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJS(ws, ++idc, `(() => { const o = [...document.querySelectorAll('.shf-liste .shf-option')].find((x) => x.textContent.includes('08:00')); o.click(); return 'ok'; })()`);
  await evalJS(ws, ++idc, `(() => { const b = [...document.querySelectorAll('.modal-boite button')].find((x) => x.textContent.trim() === 'Enregistrer'); b.click(); return 'clic'; })()`);
  await new Promise((r) => setTimeout(r, 500));
  const err = await evalJS(ws, ++idc, `(() => ({ ouvert: !!document.querySelector('.modal-boite'), msg: document.querySelector('.modal-boite .error, .modal-boite .hint-erreur-float')?.textContent || null }))()`);
  check('Test 19 : erreur (fin<=début) affichée, modal reste ouvert', err.ouvert && !!err.msg, JSON.stringify(err).slice(0, 120));
  await evalJS(ws, ++idc, `(() => { document.querySelector('.modal-fermer').click(); return 'x'; })()`);

  // --- 20. Nettoyage complet
  ws.close();
  chrome.kill();
  const delP = await httpJson(BACK + '/plannings/' + idPlanning, { method: 'DELETE', headers: { Authorization: 'Bearer ' + TC } });
  check('Test 20 : planning de test supprimé (backend intact)', delP.status === 200, 'status=' + delP.status);
  const delC = await httpJson(BACK + '/auth/users/' + idChef, { method: 'DELETE', headers: { Authorization: 'Bearer ' + T } });
  check('Test 20 : chef temporaire désactivé', delC.status === 200);

  console.log(echecs === 0 ? '\nRESULTAT : TOUS LES TESTS PASSENT' : `\nRESULTAT : ${echecs} ECHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.log('ERREUR :', e.message); process.exit(1); });
