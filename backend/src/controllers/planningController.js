const pool = require('../config/db');
const { logAction } = require('../utils/historique');
const { notifierUtilisateur } = require('../utils/notifier');

// POST /api/plannings  (CHEF_SERVICE uniquement, pour son propre service)
async function create(req, res, next) {
  try {
    const { annee, numero_semaine, date_debut, date_fin } = req.body;
    const service_id = req.user.role === 'CHEF_SERVICE'
      ? req.user.id_service
      : (req.body.service_id || req.user.id_service);

    if (!service_id) {
      return res.status(400).json({ message: 'Un service doit être associé au planning.' });
    }
    const [[service]] = await pool.query(
      'SELECT id_service FROM service WHERE id_service = ?',
      [service_id]
    );
    if (!service) return res.status(404).json({ message: 'Service introuvable.' });
    if (req.user.role === 'CHEF_SERVICE' && Number(service_id) !== Number(req.user.id_service)) {
      return res.status(403).json({ message: 'Un chef de service ne peut créer un planning que pour son service.' });
    }
    if (req.user.id_service && !req.permissions.includes('planning.view_all')
        && Number(service_id) !== Number(req.user.id_service)) {
      return res.status(403).json({ message: 'Ce service ne fait pas partie de votre périmètre.' });
    }
    if (!req.user.id_service && !req.permissions.includes('planning.view_all')) {
      return res.status(403).json({ message: 'Aucun service n’est associé à votre compte.' });
    }
    if (!annee || !numero_semaine || !date_debut || !date_fin) {
      return res.status(400).json({ message: 'annee, numero_semaine, date_debut et date_fin requis.' });
    }

    const [result] = await pool.query(
      `INSERT INTO planning (service_id, annee, numero_semaine, date_debut_semaine, date_fin_semaine, statut, cree_par)
       VALUES (?, ?, ?, ?, ?, 'BROUILLON', ?)`,
      [service_id, annee, numero_semaine, date_debut, date_fin, req.user.id_utilisateur]
    );

    await logAction(result.insertId, req.user.id_utilisateur, 'Creation du planning');

    res.status(201).json({ id_planning: result.insertId });
  } catch (err) {
    // Index uniques uq_planning_semaine (service, annee, semaine) et
    // uq_planning_dates (service, date_debut) : un seul planning par service
    // et par periode, quelle que soit l'annee (anti-doublon en base).
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'Un planning existe deja pour ce service sur cette semaine/annee (ou ces dates).',
      });
    }
    next(err);
  }
}

// GET /api/plannings?id_service=1&annee=2026&statut=VALIDE
async function list(req, res, next) {
  try {
    if (req.user.role === 'EMPLOYE') {
      return res.status(403).json({ message: 'Acces refuse : consultez votre espace personnel.' });
    }
    const { id_service, annee, statut } = req.query;
    let sql = `SELECT p.id_planning, p.annee, p.numero_semaine,
                      p.date_debut_semaine AS date_debut,
                      p.date_fin_semaine   AS date_fin,
                      p.statut, p.cree_par,
                      p.service_id AS id_service,
                      s.nom_service AS service_nom,
                      u.nom_utilisateur AS cree_par_nom,
                      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.prenom, u.nom_utilisateur)), ''), u.login) AS chef_service,
                      (SELECT MAX(h.date_action)
                       FROM historique_modification h
                       WHERE h.planning_id = p.id_planning
                         AND h.action LIKE '%soumission%') AS date_soumission,
                      (SELECT MAX(v.date_validation)
                       FROM validation_rh v
                       WHERE v.planning_id = p.id_planning) AS date_validation,
                      (SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', vu.prenom, vu.nom_utilisateur)), ''), vu.login)
                       FROM validation_rh v
                       JOIN utilisateur vu ON vu.id_utilisateur = v.rh_id
                       WHERE v.planning_id = p.id_planning AND v.decision = 'VALIDE'
                       ORDER BY v.date_validation DESC
                       LIMIT 1) AS valide_par,
                      tot.total_heures, tot.nb_employes, tot.nb_manques, tot.nb_exces
               FROM planning p
               JOIN service s ON s.id_service = p.service_id
               JOIN utilisateur u ON u.id_utilisateur = p.cree_par
               LEFT JOIN (
                 SELECT v.id_planning,
                        ROUND(COALESCE(SUM(v.total_heures_semaine), 0), 1) AS total_heures,
                        COUNT(*) AS nb_employes,
                        SUM(CASE WHEN v.total_heures_semaine <
                              CASE WHEN LOWER(s2.nom_service) LIKE '%admin%' THEN 44 ELSE 48 END
                            THEN 1 ELSE 0 END) AS nb_manques,
                        SUM(CASE WHEN v.total_heures_semaine >
                              (CASE WHEN LOWER(s2.nom_service) LIKE '%admin%' THEN 44 ELSE 48 END + 8)
                            THEN 1 ELSE 0 END) AS nb_exces
                 FROM v_total_hebdo_employe v
                 JOIN planning p2 ON p2.id_planning = v.id_planning
                 JOIN service s2 ON s2.id_service = p2.service_id
                 GROUP BY v.id_planning
               ) tot ON tot.id_planning = p.id_planning
               WHERE 1=1`;
    const params = [];

    if (req.user.role === 'CHEF_SERVICE' || !req.permissions.includes('planning.view_all')) {
      if (!req.user.id_service) {
        return res.status(403).json({ message: 'Aucun service n’est associé à votre compte.' });
      }
      if (id_service && Number(id_service) !== Number(req.user.id_service)) {
        return res.status(403).json({ message: 'Ce service ne fait pas partie de votre périmètre.' });
      }
      sql += ' AND p.service_id = ?';
      params.push(req.user.id_service);
    } else if (id_service) {
      sql += ' AND p.service_id = ?';
      params.push(id_service);
    }
    if (annee) {
      sql += ' AND p.annee = ?';
      params.push(annee);
    }
    if (statut) {
      sql += ' AND p.statut = ?';
      params.push(statut);
    }
    sql += ' ORDER BY p.annee DESC, p.numero_semaine DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/plannings/:id  -> planning + affectations + creneaux + totaux hebdo
async function getById(req, res, next) {
  try {
    if (req.user.role === 'EMPLOYE') {
      return res.status(403).json({ message: 'Acces refuse : consultez votre espace personnel.' });
    }
    const { id } = req.params;

    const [[planning]] = await pool.query(
      `SELECT p.id_planning, p.annee, p.numero_semaine,
              p.date_debut_semaine AS date_debut,
              p.date_fin_semaine   AS date_fin,
              p.statut, p.service_id,
              s.nom_service AS service_nom, s.type_affichage
       FROM planning p JOIN service s ON s.id_service = p.service_id
       WHERE p.id_planning = ?`,
      [id]
    );
    if (!planning) return res.status(404).json({ message: 'Planning introuvable.' });
    // Isolation reelle : un chef ne voit que les plannings de SON service,
    // un employe passe par son espace personnel (/api/employes/me/plannings).
    if ((req.user.role === 'CHEF_SERVICE' || !req.permissions.includes('planning.view_all'))
        && Number(planning.service_id) !== Number(req.user.id_service)) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }

    const [affectations] = await pool.query(
      `SELECT a.id_affectation, a.planning_id AS id_planning,
              a.employe_id AS id_employe,
              a.date_jour  AS jour,
              a.statut     AS statut_jour,
              a.commentaire AS observation,
              e.nom AS employe_nom, e.matricule, e.statut AS employe_statut,
              e.fonction AS employe_fonction
       FROM affectation a JOIN employe e ON e.id_employe = a.employe_id
       WHERE a.planning_id = ?
       ORDER BY e.nom, a.date_jour`,
      [id]
    );

    const [creneaux] = await pool.query(
      `SELECT ct.id_creneau, ct.affectation_id AS id_affectation,
              ct.type_creneau AS periode,
              ct.heure_entree, ct.heure_sortie
       FROM creneau_travail ct
       JOIN affectation a ON a.id_affectation = ct.affectation_id
       WHERE a.planning_id = ?`,
      [id]
    );

    // On regroupe les creneaux par affectation pour faciliter l'affichage cote frontend
    const creneauxParAffectation = {};
    for (const c of creneaux) {
      if (!creneauxParAffectation[c.id_affectation]) creneauxParAffectation[c.id_affectation] = [];
      creneauxParAffectation[c.id_affectation].push(c);
    }
    const affectationsCompletes = affectations.map((a) => ({
      ...a,
      creneaux: creneauxParAffectation[a.id_affectation] || [],
    }));

    const [totaux] = await pool.query(
      'SELECT * FROM v_total_hebdo_employe WHERE id_planning = ?',
      [id]
    );

    const [couverture] = await pool.query(
      `SELECT id_controle, planning_id AS id_planning,
              date_jour AS jour, type_creneau AS periode,
              effectif_requis, effectif_reel,
              CASE resultat
                WHEN 'SOUS_COUVERTURE' THEN 'INSUFFISANT'
                WHEN 'COUVERT'         THEN 'OK'
                ELSE 'SUREFFECTIF'
              END AS statut
       FROM controle_couverture
       WHERE planning_id = ? ORDER BY date_jour, type_creneau`,
      [id]
    );

    const debut = planning.date_debut;
    const fin = planning.date_fin;
    const [conges] = await pool.query(
      `SELECT c.employe_id AS id_employe, e.nom AS employe_nom,
              c.date_debut, c.date_fin, c.type_conge
       FROM conge c JOIN employe e ON e.id_employe = c.employe_id
       WHERE c.statut = 'VALIDE'
         AND c.date_debut <= ? AND c.date_fin >= ?
         AND e.service_id = ?`,
      [fin, debut, planning.service_id]
    );
    const [indisponibilites] = await pool.query(
      `SELECT i.employe_id AS id_employe, e.nom AS employe_nom,
              i.date_debut, i.date_fin, i.type_indispo, i.motif
       FROM indisponibilite i JOIN employe e ON e.id_employe = i.employe_id
       WHERE i.date_debut <= ? AND i.date_fin >= ?
         AND e.service_id = ?`,
      [fin, debut, planning.service_id]
    );

    // Dernier rejet RH : expose uniquement tant que le planning est REJETE.
    // Apres correction/resoumission, le motif disparait de l'API (il reste
    // conserve dans validation_rh pour la tracabilite).
    let dernierRejet = null;
    if (planning.statut === 'REJETE') {
      [[dernierRejet]] = await pool.query(
        `SELECT commentaire, date_validation, rh_id
         FROM validation_rh
         WHERE planning_id = ? AND decision = 'REJETE'
         ORDER BY date_validation DESC, id_validation DESC
         LIMIT 1`,
        [id]
      );
    }

    res.json({
      planning,
      affectations: affectationsCompletes,
      totaux,
      couverture,
      contraintes: { conges, indisponibilites },
      dernier_rejet: dernierRejet || null,
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/plannings/:id/soumettre  (CHEF_SERVICE : BROUILLON -> SOUMIS, pret pour validation RH)
async function soumettre(req, res, next) {
  try {
    const { id } = req.params;
    const [result] = await pool.query(
      `UPDATE planning SET statut = 'SOUMIS' WHERE id_planning = ? AND statut = 'BROUILLON'`,
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(409).json({ message: 'Planning introuvable ou deja soumis/valide.' });
    }
    await logAction(id, req.user.id_utilisateur, 'Soumission pour validation RH');
    res.json({ message: 'Planning soumis a la RH.' });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/plannings/:id
// CHEF_SERVICE : uniquement son service, uniquement BROUILLON ou REJETE.
// Un planning VALIDE est conserve pour proteger l'historique des decisions RH.
async function supprimer(req, res, next) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();
    const [[planning]] = await connection.query(
      'SELECT id_planning, service_id, statut FROM planning WHERE id_planning = ? FOR UPDATE',
      [id]
    );
    if (!planning) {
      await connection.rollback();
      return res.status(404).json({ message: 'Planning introuvable.' });
    }

    if (req.user.role === 'CHEF_SERVICE' || !req.permissions.includes('planning.view_all')) {
      if (Number(planning.service_id) !== Number(req.user.id_service)) {
        await connection.rollback();
        return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
      }
    }
    if (planning.statut === 'VALIDE') {
      await connection.rollback();
      return res.status(409).json({
        message: 'Un planning VALIDE est conserve dans l’historique et ne peut pas etre supprime.',
      });
    }
    if (req.user.role === 'CHEF_SERVICE') {
      if (!['BROUILLON', 'REJETE'].includes(planning.statut)) {
        await connection.rollback();
        return res.status(409).json({
          message: "Seuls les plannings BROUILLON ou REJETE peuvent etre supprimes. Un planning SOUMIS est en cours de validation RH (demandez un refus a la RH).",
        });
      }
    }

    await connection.query('DELETE FROM planning WHERE id_planning = ?', [id]);
    await connection.commit();
    res.json({ message: 'Planning supprime.' });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
}

// PATCH /api/plannings/:id/rouvrir  (RH ou ADMIN)
// Regle metier : un planning VALIDE ne doit JAMAIS etre modifie silencieusement.
// Si une correction est necessaire, la RH "rouvre" le planning :
// il repasse en BROUILLON, le chef le corrige, puis tout le circuit
// soumission -> notification -> validation RH repart de zero.
// Tracabilite : une entree est ajoutee a historique_modification + le chef est notifie.
async function rouvrir(req, res, next) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();

    const [[planning]] = await connection.query(
      `SELECT id_planning, statut, service_id, cree_par, numero_semaine, annee
       FROM planning WHERE id_planning = ? FOR UPDATE`,
      [id]
    );
    if (!planning) {
      await connection.rollback();
      return res.status(404).json({ message: 'Planning introuvable.' });
    }
    if ((req.user.role === 'CHEF_SERVICE' || !req.permissions.includes('planning.view_all'))
        && Number(planning.service_id) !== Number(req.user.id_service)) {
      await connection.rollback();
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre périmètre.' });
    }
    if (planning.statut !== 'VALIDE') {
      await connection.rollback();
      return res.status(409).json({ message: 'Seul un planning VALIDE peut etre rouvert.' });
    }

    await connection.query(
      "UPDATE planning SET statut = 'BROUILLON' WHERE id_planning = ?",
      [id]
    );
    await connection.commit();

    const [[svc]] = await pool.query('SELECT nom_service FROM service WHERE id_service = ?', [
      planning.service_id,
    ]);
    await logAction(
      id,
      req.user.id_utilisateur,
      'Reouverture du planning valide par la RH (retour en BROUILLON pour correction)'
    );

    // Le chef est notifie : son planning rouvert attend une correction puis une nouvelle soumission
    await notifierUtilisateur(
      planning.cree_par,
      id,
      'Planning rouvert par la RH',
      `Votre planning ${svc ? svc.nom_service : ''} S${planning.numero_semaine}/${planning.annee} a ete rouvert par la RH : il est de retour en BROUILLON, corrigez-le puis soumettez-le a nouveau.`
    );

    res.json({ message: 'Planning rouvert : il est de retour en BROUILLON et devra etre soumis a nouveau a la RH.' });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
}

module.exports = { create, list, getById, soumettre, supprimer, rouvrir };