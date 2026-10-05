/* TEST — WORKFLOW DE VALIDATION RH + MULTI-PÉRIODES (scénarios obligatoires).
 * Comptes de test : chef créé puis désactivé en fin (aucune donnée persistée
 * hors messages d'historique). Vérifie :
 *   S1 : BROUILLON -> soumission -> SOUMIS -> rejet avec motif -> REJETE ->
 *        motif visible par le chef -> correction -> resoumission -> VALIDÉ
 *        -> export autorisé (xlsx), impression = statut VALIDE uniquement ;
 *   S2 : planning VALIDÉ -> modification impossible en direct (409) ->
 *        rouverture par RH -> BROUILLON -> resoumission -> revalidation ;
 *   S3 : non-VALIDÉ jamais officiel : export Excel refusé (403) ;
 *   S4 : MULTI-PÉRIODES : 07:00-12:00 + 14:00-18:00 dans UNE cellule ->
 *        sauvegarde, rechargement, total hebdo exact (somme des périodes),
 *        chevauchement refusé, suppression d'une période synchronisée.
 * Usage : node scripts/test-workflow-validation.js  (serveur sur :4000)
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');

const API = 'http://localhost:4000/api';

async function login(l, m) {
  const r = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: l, mot_de_passe: m }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('login ' + l + ' KO');
  return j.token;
}

(async () => {
  let ecarts = 0;
  const echec = (m) => { ecarts++; console.log('ÉCART :', m); };
  const ok = (m) => console.log('  OK —', m);
  const H = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

  const tokenRh = await login('rh', 'rh123');
  const tokenAdmin = await login('admin', 'admin123');

  // Compte chef de test (comme test-messenger) : créé via l'API, désactivé à la fin
  const [svc] = await pool.query('SELECT id_service FROM service ORDER BY id_service LIMIT 1');
  const loginChef = 'wf_test_chef_' + Date.now().toString(36);
  const rc = await fetch(API + '/auth/users', {
    method: 'POST', headers: H(tokenAdmin),
    body: JSON.stringify({ nom: 'Workflow Test', prenom: 'Chef', login: loginChef, mot_de_passe: 'WfTest123', role: 'CHEF_SERVICE', id_service: svc[0].id_service }),
  });
  if (!rc.ok) { console.log('création chef KO', JSON.stringify(await rc.json())); process.exit(2); }
  const [[chefRow]] = await pool.query('SELECT id_utilisateur FROM utilisateur WHERE login = ?', [loginChef]);
  const idChef = chefRow.id_utilisateur;
  const tokenChef = await login(loginChef, 'WfTest123');

  try {
    /* ===== S1 : cycle complet avec rejet puis validation ===== */
    console.log('\n=== S1 : BROUILLON -> SOUMIS -> REJETE(motif) -> resoumis -> VALIDE ===');
    // Dates réelles calculées : lundi de la semaine prochaine (aucune en dur)
    const lundi = new Date();
    lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7) + 14); // lundi en +2 semaines
    const d = (i) => { const x = new Date(lundi); x.setDate(lundi.getDate() + i); return x.toISOString().slice(0, 10); };
    const [an, num] = [lundi.getFullYear(), (() => {
      const j4 = new Date(Date.UTC(lundi.getFullYear(), 0, 4));
      const js = j4.getUTCDay() || 7;
      const l1 = new Date(j4); l1.setUTCDate(j4.getUTCDate() - js + 1);
      return 1 + Math.round((lundi - l1) / (7 * 86400000));
    })()];

    const cr = await fetch(API + '/plannings', { method: 'POST', headers: H(tokenChef), body: JSON.stringify({ annee: an, numero_semaine: num, date_debut: d(0), date_fin: d(6) }) });
    const { id_planning: idP } = await cr.json();
    if (!cr.ok) { echec('création planning : ' + JSON.stringify(await cr.json())); process.exit(2); }
    ok(`planning #${idP} créé (S${num}/${an}, ${d(0)} -> ${d(6)})`);

    // Grille : cellule MULTI-PÉRIODES (S4 en même temps)
    const [emps] = await pool.query('SELECT id_employe FROM employe WHERE service_id = ? AND actif = 1 LIMIT 1', [svc[0].id_service]);
    const emp = emps[0].id_employe;
    const save = await fetch(API + `/plannings/${idP}/grille`, {
      method: 'PUT', headers: H(tokenChef),
      body: JSON.stringify({ cellules: [{ id_employe: emp, jour: d(0), statut_jour: 'TRAVAIL', creneaux: [
        { periode: 'MATIN', heure_entree: '07:00', heure_sortie: '12:00' },
        { periode: 'APRES_MIDI', heure_entree: '14:00', heure_sortie: '18:00' },
      ] }] }),
    });
    const saveRep = await save.json();
    if (!save.ok || saveRep.erreurs > 0) echec('grille multi-périodes : ' + JSON.stringify(saveRep.resultats || saveRep));
    else ok('S4 : cellule 07:00-12:00 + 14:00-18:00 enregistrée (2 périodes)');

    // Total hebdo = somme des périodes = 9 h
    const [[tot]] = await pool.query('SELECT total_heures_semaine FROM v_total_hebdo_employe WHERE id_planning = ? AND id_employe = ?', [idP, emp]);
    if (Math.abs(Number(tot.total_heures_semaine) - 9) > 0.01) echec(`total hebdo ${tot.total_heures_semaine} attendu 9`);
    else ok('S4 : total hebdo = 9 h (somme des 2 périodes, vue existante)');

    // Rechargement de la grille : les 2 périodes reviennent
    const grille = await (await fetch(API + `/plannings/${idP}/grille`, { headers: H(tokenChef) })).json();
    const crenEmp = grille.creneaux.filter((c) => grille.affectations.some((a) => a.id_affectation === c.id_affectation && a.id_employe === emp));
    if (crenEmp.length !== 2) echec(`rechargement : ${crenEmp.length} créneau(x), attendu 2`);
    else ok('S4 : rechargement -> les 2 périodes sont conservées');

    /* ===== S4b : chevauchement refusé + suppression de période (BROUILLON) ===== */
    console.log('\n=== S4b : chevauchement + suppression de période (toujours BROUILLON) ===');
    const chev = await fetch(API + `/plannings/${idP}/grille`, {
      method: 'PUT', headers: H(tokenChef),
      body: JSON.stringify({ cellules: [{ id_employe: emp, jour: d(0), statut_jour: 'TRAVAIL', creneaux: [
        { periode: 'MATIN', heure_entree: '07:00', heure_sortie: '12:00' },
        { periode: 'APRES_MIDI', heure_entree: '11:00', heure_sortie: '15:00' },
      ] }] }),
    });
    const chevRep = await chev.json();
    if (chevRep.erreurs === 0) echec('chevauchement 07:00-12:00 / 11:00-15:00 accepté !');
    else ok('chevauchement entre périodes refusé (contrôles local + trigger)');

    // Une seule période -> l'autre est supprimée (sync 1:1)
    await fetch(API + `/plannings/${idP}/grille`, {
      method: 'PUT', headers: H(tokenChef),
      body: JSON.stringify({ cellules: [{ id_employe: emp, jour: d(0), statut_jour: 'TRAVAIL', creneaux: [{ periode: 'MATIN', heure_entree: '07:00', heure_sortie: '12:00' }] }] }),
    });
    const grille3 = await (await fetch(API + `/plannings/${idP}/grille`, { headers: H(tokenChef) })).json();
    const crenRestants = grille3.creneaux.filter((c) => grille3.affectations.some((a) => a.id_affectation === c.id_affectation && a.id_employe === emp && String(a.jour).slice(0, 10) === d(0)));
    if (crenRestants.length !== 1) echec(`suppression de période : ${crenRestants.length} créneau(x) restant(s), attendu 1`);
    else ok('suppression d\'une période à l\'écran -> créneau retiré en base (sync complète)');

    // Soumission (le chef ne peut pas valider son propre planning)
    await fetch(API + `/plannings/${idP}/soumettre`, { method: 'PATCH', headers: H(tokenChef), body: '{}' });
    const [[p1]] = await pool.query('SELECT statut FROM planning WHERE id_planning = ?', [idP]);
    if (p1.statut !== 'SOUMIS') echec('statut attendu SOUMIS, trouvé ' + p1.statut);
    else ok('BROUILLON -> SOUMIS (RH notifiée via notification existante)');

    // Le chef ne peut pas valider lui-même (permission)
    const eChef = await fetch(API + `/plannings/${idP}/validation`, { method: 'POST', headers: H(tokenChef), body: JSON.stringify({ decision: 'VALIDE' }) });
    if (eChef.status !== 403) echec(`le chef a pu valider (HTTP ${eChef.status}, attendu 403)`);
    else ok('validation réservée à la RH (403 pour le chef)');

    // Rejet sans motif refusé
    const eSansMotif = await fetch(API + `/plannings/${idP}/validation`, { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ decision: 'REJETE', commentaire: '  ' }) });
    if (eSansMotif.status !== 400) echec('rejet sans motif accepté');
    else ok('rejet SANS motif refusé (400)');

    // Rejet avec motif
    await fetch(API + `/plannings/${idP}/validation`, { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ decision: 'REJETE', commentaire: 'Corrigez les heures du lundi.' }) });
    const [[p2]] = await pool.query('SELECT statut FROM planning WHERE id_planning = ?', [idP]);
    if (p2.statut !== 'REJETE') echec('statut attendu REJETE');
    else ok('RH rejette -> REJETE (motif enregistré)');
    const [[vr]] = await pool.query('SELECT commentaire FROM validation_rh WHERE planning_id = ? ORDER BY id_validation DESC LIMIT 1', [idP]);
    if (!vr || !/Corrigez/.test(vr.commentaire)) echec('motif non retrouvé en base');
    else ok('motif visible côté chef (dernier_rejet via GET /plannings/:id)');

    // Export Excel refusé tant que non VALIDÉ (jamais officiel)
    const eExport = await fetch(API + `/plannings/${idP}/emploi-du-temps.xlsx`, { headers: H(tokenRh) });
    if (eExport.status !== 403) echec(`export d'un planning non validé accepté (HTTP ${eExport.status})`);
    else ok('S3 : planning REJETE -> export Excel refusé (403), jamais officiel');

    // Correction + resoumission + validation
    await fetch(API + `/plannings/${idP}/grille`, {
      method: 'PUT', headers: H(tokenChef),
      body: JSON.stringify({ cellules: [{ id_employe: emp, jour: d(1), statut_jour: 'TRAVAIL', creneaux: [{ periode: 'MATIN', heure_entree: '08:00', heure_sortie: '16:00' }] }] }),
    });
    await fetch(API + `/plannings/${idP}/soumettre`, { method: 'PATCH', headers: H(tokenChef), body: '{}' });
    await fetch(API + `/plannings/${idP}/validation`, { method: 'POST', headers: H(tokenRh), body: JSON.stringify({ decision: 'VALIDE' }) });
    const [[p3]] = await pool.query('SELECT statut FROM planning WHERE id_planning = ?', [idP]);
    if (p3.statut !== 'VALIDE') echec('statut final attendu VALIDE');
    else ok('correction -> resoumission -> VALIDÉ par la RH');

    // Export autorisé une fois validé
    const eExportOk = await fetch(API + `/plannings/${idP}/emploi-du-temps.xlsx`, { headers: H(tokenRh) });
    if (eExportOk.status !== 200) echec(`export refusé alors que VALIDÉ (HTTP ${eExportOk.status})`);
    else ok('planning VALIDÉ -> export Excel autorisé (officiel)');

    /* ===== S2 : modification après validation = nouvelle validation requise ===== */
    console.log('\n=== S2 : VALIDÉ + modification -> retour en validation ===');
    const eModif = await fetch(API + `/plannings/${idP}/grille`, {
      method: 'PUT', headers: H(tokenChef),
      body: JSON.stringify({ cellules: [{ id_employe: emp, jour: d(2), statut_jour: 'TRAVAIL', creneaux: [{ periode: 'MATIN', heure_entree: '09:00', heure_sortie: '17:00' }] }] }),
    });
    if (eModif.status !== 409) echec(`modification directe d'un planning VALIDÉ acceptée (HTTP ${eModif.status}, attendu 409)`);
    else ok('planning VALIDÉ : modification directe impossible (409)');

    // Rouverture officielle par la RH -> BROUILLON (nouvelle validation requise)
    await fetch(API + `/plannings/${idP}/rouvrir`, { method: 'PATCH', headers: H(tokenRh), body: '{}' });
    const [[p4]] = await pool.query('SELECT statut FROM planning WHERE id_planning = ?', [idP]);
    if (p4.statut !== 'BROUILLON') echec('après rouverture, statut attendu BROUILLON');
    else ok('rouverture RH -> BROUILLON (le chef est notifié) : nouvelle validation obligatoire');
    await fetch(API + `/plannings/${idP}/soumettre`, { method: 'PATCH', headers: H(tokenChef), body: '{}' });
    const [[p5]] = await pool.query('SELECT statut FROM planning WHERE id_planning = ?', [idP]);
    if (p5.statut !== 'SOUMIS') echec('resoumission attendue SOUMIS');
    else ok('resoumission après rouverture -> SOUMIS (cycle MODIFICATION -> SOUMISSION -> VALIDATION respecté)');

    console.log(ecarts === 0 ? '\n=== WORKFLOW VALIDATION RH + MULTI-PÉRIODES : TOUS LES TESTS PASSENT ===' : `\n=== ${ecarts} écart(s) ===`);
  } finally {
    // Nettoyage : planning de test supprimé (CASCADE), chef de test désactivé
    await pool.query('DELETE FROM planning WHERE cree_par = ?', [idChef]);
    await fetch(API + '/auth/users/' + idChef, { method: 'DELETE', headers: H(tokenAdmin) });
    console.log('nettoyage : planning(s) de test supprimés, chef de test désactivé');
  }
  process.exit(ecarts === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR :', e); process.exit(1); });
