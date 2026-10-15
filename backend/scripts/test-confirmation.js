/* Test réel de POST /api/numerisation/:id/confirmer (route complète, JWT réel).
 * Scénarios :
 *   A. Scan #3 (données vides)            -> 400 explicite
 *   B. Données invalides (employé inconnu)-> 400 explicite
 *   C. Confirmation normale               -> 201 puis 409 idempotent (id_planning)
 *   D. Deux confirmations CONCURRENTES du même scan -> exactement 201 + 409
 *      (sérialisation par verrou FOR UPDATE, pas de Lock wait / dup-entry brut)
 *   E. Doublon service+semaine existant   -> 409 propre
 * Nettoyage ciblé : SEULES les lignes de test créées ici sont supprimées
 * (scan de test + planning + affectations + créneaux). Le scan #3 réel et
 * toutes les données existantes sont préservés.
 * Usage : node backend/scripts/test-confirmation.js
 */
process.env.PORT_TEST = '4100';
const pool = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');
const { lundiDeSemaineIso } = require('../src/services/ocrPlannings');

const BASE = 'http://127.0.0.1:4100/api';
const ANNEE_TEST = 2099; // slot choisi pour ne JAMAIS entrer en collision avec les vraies données

const resultat = [];
const attendu = (nom, ok, detail) => resultat.push({ nom, ok: !!ok, detail });

/* Planifications de test en base (scans) : retourne les ids créés. */
async function creerScanTest(rh, cfg) {
  const deb = lundiDeSemaineIso(cfg.annee, cfg.numero_semaine);
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(new Date(`${deb}T00:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10));
  const [r] = await pool.query(
    `INSERT INTO planning_scan
       (utilisateur_id, nom_fichier, chemin_fichier, type_mime, taille_octets, statut, progression,
        service_id, numero_semaine, annee, date_debut_semaine, donnees_ocr, donnees_corrigees)
     VALUES (?, 'test-confirmation.tmp', 'test-confirmation.tmp', 'image/png', 1, 'OCR_FAITE', 100,
             ?, ?, ?, ?, ?, ?)`,
    [
      rh.id_utilisateur,
      cfg.service_id, cfg.numero_semaine, cfg.annee, deb,
      JSON.stringify(cfg.donnees), JSON.stringify(cfg.donnees),
    ]
  );
  return r.insertId;
}

function donneesEmployes(idEmployees, deb) {
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(new Date(`${deb}T00:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10));
  return idEmployees.map((id, k) => ({
    employe_id: id,
    nom_ocr: `EMPLOYE ${id}`,
    jours: {
      [dates[0]]: { statut: 'TRAVAIL', creneaux: [{ heure_entree: '07:00', heure_sortie: '15:00' }] },
      [dates[1]]: { statut: 'TRAVAIL', creneaux: [{ heure_entree: '06:00', heure_sortie: '14:00' }] },
      [dates[2]]: { statut: 'REPOS', creneaux: [] },
      [dates[3]]: { statut: 'CONGE', creneaux: [] },
      [dates[4]]: { statut: 'TRAVAIL', creneaux: [{ heure_entree: '18:00', heure_sortie: '22:00' }] },
      [dates[5]]: { statut: 'TRAVAIL', creneaux: [{ heure_entree: '07:00', heure_sortie: '12:00' }] },
      [dates[6]]: { statut: 'TRAVAIL', creneaux: [{ heure_entree: '07:00', heure_sortie: '12:00' }] },
    },
  }));
}

async function envoyer(token, chemin, methode = 'POST') {
  const res = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${token}` },
  });
  let corps = null;
  try { corps = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, corps };
}

(async () => {
  /* --- préparation du contexte (lecture seule sur les vraies données) --- */
  const q = async (sql, p) => (await pool.query(sql, p))[0];
  const [rh] = await q(
    `SELECT u.id_utilisateur, u.role, u.service_id FROM utilisateur u
     JOIN utilisateur_permission up ON up.utilisateur_id = u.id_utilisateur
     JOIN permissions pe ON pe.id = up.permission_id AND pe.code = 'numerisation.use'
     WHERE u.role = 'RH' AND u.actif = 1 LIMIT 1`
  );
  if (!rh) throw new Error('Aucun RH avec la permission numerisation.use.');
  const [svc] = await q(
    `SELECT s.id_service FROM service s
     WHERE EXISTS (SELECT 1 FROM employe e WHERE e.service_id = s.id_service AND e.actif = 1)
       AND NOT EXISTS (SELECT 1 FROM planning p WHERE p.service_id = s.id_service AND p.annee = ? AND p.numero_semaine IN (51, 52))
     LIMIT 1`,
    [ANNEE_TEST]
  );
  if (!svc) throw new Error('Aucun service disponible pour un planning test S51-S52/2099.');
  const emps = await q('SELECT id_employe FROM employe WHERE service_id = ? AND actif = 1 LIMIT 2', [svc.id_service]);
  if (emps.length < 1) throw new Error('Aucun employé actif du service.');
  const deb52 = lundiDeSemaineIso(ANNEE_TEST, 52);
  const deb51 = lundiDeSemaineIso(ANNEE_TEST, 51);

  /* Doublon : un couple (service, semaine, annee) qui existe RÉELLEMENT */
  const [planningExistant] = await q(
    `SELECT id_planning, service_id, annee, numero_semaine FROM planning
     ORDER BY id_planning DESC LIMIT 1`
  );
  const [empDoublon] = await q(
    'SELECT id_employe FROM employe WHERE service_id = ? AND actif = 1 LIMIT 1',
    [planningExistant.service_id]
  );

  /* --- scans de test --- */
  const scanC = await creerScanTest(rh, { service_id: svc.id_service, annee: ANNEE_TEST, numero_semaine: 52, donnees: { employes: donneesEmployes(emps.map((e) => e.id_employe), deb52), alertes: [] } });
  const scanD = await creerScanTest(rh, { service_id: svc.id_service, annee: ANNEE_TEST, numero_semaine: 51, donnees: { employes: donneesEmployes(emps.map((e) => e.id_employe), deb51), alertes: [] } });
  const scanB = await creerScanTest(rh, { service_id: svc.id_service, annee: ANNEE_TEST, numero_semaine: 50, donnees: { employes: [{ employe_id: 999999, nom_ocr: 'INCONNU X', jours: {} }], alertes: [] } });
  let scanE = null;
  if (empDoublon) {
    const debE = lundiDeSemaineIso(planningExistant.annee, planningExistant.numero_semaine);
    scanE = await creerScanTest(rh, {
      service_id: planningExistant.service_id, annee: planningExistant.annee, numero_semaine: planningExistant.numero_semaine,
      donnees: { employes: donneesEmployes([empDoublon.id_employe], debE), alertes: [] },
    });
  }

  const token = signToken({ id_utilisateur: rh.id_utilisateur, role: rh.role, id_service: rh.service_id });
  let serveur;
  try {
    serveur = require('../src/app').listen(4100, () => {}); // listen() renvoie le serveur
    await new Promise((ok) => setTimeout(ok, 300));

    /* A. Scan #3 : données vides -> 400 explicite */
    let r = await envoyer(token, '/numerisation/3/confirmer');
    attendu('A. Scan 3 (vide) -> 400 avec message explicite',
      r.status === 400 && /employé/i.test(r.corps?.message || ''), JSON.stringify(r));

    /* B. Données invalides -> 400 explicite */
    r = await envoyer(token, `/numerisation/${scanB}/confirmer`);
    attendu('B. Employé inconnu -> 400 explicite',
      r.status === 400 && /actif/i.test(r.corps?.message || ''), JSON.stringify(r));

    /* C. Confirmation -> 201, puis 409 idempotent avec le même id_planning */
    r = await envoyer(token, `/numerisation/${scanC}/confirmer`);
    const idPlanningC = r.status === 201 ? r.corps.id_planning : null;
    attendu('C1. Confirmation normale -> 201', r.status === 201 && !!idPlanningC, JSON.stringify(r));
    r = await envoyer(token, `/numerisation/${scanC}/confirmer`);
    attendu('C2. Re-confirmation -> 409 idempotent (même planning)',
      r.status === 409 && r.corps?.id_planning === idPlanningC, JSON.stringify(r));

    /* D. Deux confirmations CONCURRENTES du même scan -> 201 + 409, un seul planning */
    const [d1, d2] = await Promise.all([
      envoyer(token, `/numerisation/${scanD}/confirmer`),
      envoyer(token, `/numerisation/${scanD}/confirmer`),
    ]);
    const codes = [d1.status, d2.status].sort();
    attendu('D. Concurrents (même scan) -> exactement 201 + 409', codes.join(',') === '201,409',
      JSON.stringify([d1.status, d2.status]));
    const [dupPlanning] = await q(
      `SELECT COUNT(*) AS n FROM planning WHERE service_id = ? AND annee = ? AND numero_semaine = 51`,
      [svc.id_service, ANNEE_TEST]
    );
    attendu('D2. Un SEUL planning créé malgré la course', dupPlanning.n === 1, `count=${dupPlanning.n}`);

    /* E. Doublon service+semaine déjà existant -> 409 propre */
    if (scanE) {
      r = await envoyer(token, `/numerisation/${scanE}/confirmer`);
      attendu('E. Doublon semaine -> 409 avec id du planning existant',
        r.status === 409 && r.corps?.id_planning === planningExistant.id_planning, JSON.stringify(r));
    }

    /* F. Aucune transaction orpheline / connexion figée après les tests */
    const trx = await q('SELECT COUNT(*) AS n FROM information_schema.innodb_trx').catch(() => [{ n: 0 }]);
    attendu('F. Aucune transaction résiduelle', trx[0].n === 0, JSON.stringify(trx));
  } finally {
    /* --- Nettoyage ciblé : SEULEMENT les lignes créées par CE test --- */
    const ids = await q(
      `SELECT id_planning FROM planning WHERE annee = ? AND numero_semaine IN (50, 51, 52)
       AND id_planning IN (SELECT id_planning FROM planning_scan WHERE nom_fichier = 'test-confirmation.tmp' AND id_planning IS NOT NULL)`,
      [ANNEE_TEST]
    );
    for (const { id_planning } of ids) {
      await pool.query('DELETE FROM creneau_travail WHERE affectation_id IN (SELECT id_affectation FROM affectation WHERE planning_id = ?)', [id_planning]);
      await pool.query('DELETE FROM affectation WHERE planning_id = ?', [id_planning]);
      await pool.query('DELETE FROM planning WHERE id_planning = ?', [id_planning]);
    }
    await pool.query("DELETE FROM planning_scan WHERE nom_fichier = 'test-confirmation.tmp'");
    console.log('Nettoyage des données de test effectué (scans/plannings temporaires seulement).');
    serveur?.close();
    await pool.end();
  }

  console.log('\n=== VÉRIFICATIONS /api/numerisation/:id/confirmer ===');
  let ok = 0;
  for (const v of resultat) {
    console.log(`${v.ok ? 'OK  ' : 'ECHEC'} ${v.nom}${v.ok ? '' : ` -> ${v.detail.slice(0, 220)}`}`);
    if (v.ok) ok += 1;
  }
  console.log(`\n${ok}/${resultat.length} vérifications réussies.`);
  process.exit(ok === resultat.length ? 0 : 1);
})().catch((e) => {
  console.error('ECHEC test confirmation :', e);
  process.exit(1);
});
