/* Test bout-en-bout de la regle Excel (periode = f(heure d'entree))
 * pour la generation de l'emploi du temps Zomatel.
 * Cree un planning BROUILLON de test via un chef temporaire, y ecrit des
 * cellules (horaires + REPOS/CONGE/ABSENCE, periode volontairement fausse),
 * verifie ce que le serveur a reellement enregistre, puis nettoie :
 * suppression du planning de test + desactivation du compte de test.
 * Aucune donnee existante n'est modifiee.
 */
const http = require('http');

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request('http://localhost:4000/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: null }); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// Regle Excel : < 12:00 matin, 12:00-17:59 apres-midi, >= 18:00 soir
function periodeExcel(entree) {
  const [h, m] = String(entree).slice(0, 5).split(':').map(Number);
  const min = h * 60 + (m || 0);
  return min < 720 ? 'MATIN' : min < 1080 ? 'APRES_MIDI' : 'SOIR';
}

function lundiSemaineISO(annee, semaine) {
  const d = new Date(Date.UTC(annee, 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (semaine - 1) * 7);
  return d;
}
const iso = (d) => d.toISOString().slice(0, 10);

(async () => {
  // 1. Login RH + creation d'un chef de test (compte desactive a la fin)
  const rh = await req('POST', '/auth/login', null, { login: 'rh', mot_de_passe: 'rh123' });
  if (rh.status !== 200) return console.log('ECHEC login RH', rh.status);
  const T = rh.body.token;

  const services = await req('GET', '/services', T);
  const reception = services.body.find((s) => /r[ée]ception/i.test(s.nom || s.nom_service || ''));
  if (!reception) return console.log('ECHEC : service Reception introuvable');
  const idService = reception.id_service || reception.id;
  console.log('Service test :', reception.nom || reception.nom_service, '(id ' + idService + ')');

  const suffix = Date.now().toString().slice(-6);
  const loginChef = 'chef_edt_' + suffix;
  const cr = await req('POST', '/auth/users', T, {
    login: loginChef, mot_de_passe: 'Test1234!', role: 'CHEF_SERVICE', id_service: idService, nom: 'TEST', prenom: 'EDT',
  });
  if (cr.status !== 200 && cr.status !== 201) return console.log('ECHEC creation chef', cr.status, JSON.stringify(cr.body));
  const idChef = cr.body.id_utilisateur || cr.body.id || cr.body.user?.id_utilisateur;
  console.log('Chef temporaire cree :', loginChef, '(id ' + idChef + ')');

  const chef = await req('POST', '/auth/login', null, { login: loginChef, mot_de_passe: 'Test1234!' });
  if (chef.status !== 200) return console.log('ECHEC login chef', chef.status);
  const TC = chef.body.token;

  // 2. Employes du service du chef (filtrage serveur)
  const emps = await req('GET', '/employes', TC);
  const deux = (emps.body || []).slice(0, 2);
  if (deux.length < 2) return console.log('ECHEC : moins de 2 employes dans le service');
  console.log('Employes test :', deux.map((e) => e.nom + ' (#' + e.id_employe + ')').join(', '));

  // 3. Planning de test : 2030 S20 (aucun risque de doublon)
  const ANNEE = 2030, SEMAINE = 20;
  const lundi = lundiSemaineISO(ANNEE, SEMAINE);
  const jours = Array.from({ length: 7 }, (_, i) => iso(new Date(lundi.getTime() + i * 86400000)));
  const cp = await req('POST', '/plannings', TC, {
    id_service: idService, annee: ANNEE, numero_semaine: SEMAINE,
    date_debut: jours[0], date_fin: jours[6], statut: 'BROUILLON',
  });
  if (cp.status !== 200 && cp.status !== 201) return console.log('ECHEC creation planning', cp.status, JSON.stringify(cp.body));
  const idPlanning = cp.body.id_planning || cp.body.id;
  console.log('Planning de test #' + idPlanning, '(' + jours[0] + ' -> ' + jours[6] + ')');

  // 4. Ecriture de la grille : periode volontairement FAUSSE pour prouver
  //    que le serveur applique la regle Excel (et non la valeur client).
  const cellules = [
    { id_employe: deux[0].id_employe, jour: jours[0], statut_jour: 'TRAVAIL', creneau: { periode: 'SOIR', heure_entree: '07:00', heure_sortie: '15:00' } },
    { id_employe: deux[0].id_employe, jour: jours[1], statut_jour: 'TRAVAIL', creneau: { periode: 'MATIN', heure_entree: '14:00', heure_sortie: '22:00' } },
    { id_employe: deux[0].id_employe, jour: jours[2], statut_jour: 'REPOS', creneau: null },
    { id_employe: deux[0].id_employe, jour: jours[3], statut_jour: 'CONGE', creneau: null },
    { id_employe: deux[1].id_employe, jour: jours[0], statut_jour: 'TRAVAIL', creneau: { periode: 'MATIN', heure_entree: '19:00', heure_sortie: '23:00' } },
    { id_employe: deux[1].id_employe, jour: jours[1], statut_jour: 'ABSENCE', creneau: null },
  ];
  const sv = await req('PUT', '/plannings/' + idPlanning + '/grille', TC, { cellules });
  if (sv.status !== 200) return console.log('ECHEC save grille', sv.status, JSON.stringify(sv.body));
  const echecs = (sv.body.resultats || []).filter((r) => !r.ok);
  console.log('Grille enregistree :', (sv.body.resultats || []).length - echecs.length, 'ok /', echecs.length, 'echecs');
  if (echecs.length) echecs.forEach((e) => console.log('   echec :', e.erreur));

  // 5. Verification : ce que le serveur a enregistre vs regle Excel
  const det = await req('GET', '/plannings/' + idPlanning, TC);
  const attente = cellules.filter((c) => c.creneau);
  let ok = 0, ko = [];
  for (const c of cellules.filter((x) => x.creneau)) {
    const aff = (det.body.affectations || []).find((a) => a.id_employe === c.id_employe && a.jour === c.jour);
    const cr2 = (aff?.creneaux || []).find((x) => x.heure_entree);
    if (!cr2) { ko.push(c.heure_entree + ' -> aucun creneau en base'); continue; }
    const attendu = periodeExcel(c.creneau.heure_entree);
    if (cr2.periode === attendu) ok++;
    else ko.push(c.creneau.heure_entree + '-' + c.creneau.heure_sortie + ' : attendu ' + attendu + ', stocke ' + cr2.periode);
  }
  console.log('REGLE EXCEL (periode = f(heure entree)) :', ok + '/' + attente.length, 'conformes', ko.length ? '\n   ' + ko.join('\n   ') : '');

  // Statuts sans horaire : aucun creneau ne doit exister
  let statutsOk = true;
  for (const c of cellules.filter((x) => !x.creneau)) {
    const aff = (det.body.affectations || []).find((a) => a.id_employe === c.id_employe && a.jour === c.jour);
    if (aff && (aff.creneaux || []).length > 0) statutsOk = false;
  }
  console.log('REPOS/CONGE/ABSENCE sans horaire :', statutsOk ? 'OK' : 'PROBLEME');
  console.log('Statuts enregistrés :', (det.body.affectations || []).map((a) => a.statut_jour || a.statut).filter((s) => s && s !== 'TRAVAIL').join(', '));

  // 6. Nettoyage : suppression planning de test + desactivation chef
  const del = await req('DELETE', '/plannings/' + idPlanning, TC);
  console.log('Planning de test supprime :', del.status === 200 ? 'OK' : 'status ' + del.status);
  const des = await req('DELETE', '/auth/users/' + idChef, T);
  console.log('Chef de test desactive :', des.status === 200 ? 'OK' : 'status ' + des.status);

  console.log(ko.length === 0 && statutsOk ? 'RESULTAT : CONFORME A LA REGLE EXCEL' : 'RESULTAT : ECARTS DETECTES');
})().catch((e) => console.log('ERREUR :', e.message));
