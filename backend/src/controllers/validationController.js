const pool = require('../config/db');
const { logAction } = require('../utils/historique');
const { notifierUtilisateur, notifierRole } = require('../utils/notifier');

// POST /api/plannings/:id/validation  (RH uniquement)
// body: { decision: 'VALIDE' | 'REJETE', commentaire }
async function valider(req, res, next) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { decision, commentaire } = req.body;

    if (!['VALIDE', 'REJETE'].includes(decision)) {
      return res.status(400).json({ message: "decision doit etre 'VALIDE' ou 'REJETE'." });
    }
    // REGLE METIER : un rejet sans motif est impossible.
    // Le motif est stocke dans validation_rh.commentaire (structure existante).
    if (decision === 'REJETE' && !(commentaire && String(commentaire).trim())) {
      return res.status(400).json({ message: 'Le motif du rejet est obligatoire.' });
    }

    await connection.beginTransaction();

    const [[planning]] = await connection.query(
      `SELECT p.id_planning, p.statut, p.cree_par, p.numero_semaine, p.annee,
              s.nom_service
       FROM planning p
       JOIN service s ON s.id_service = p.service_id
       WHERE p.id_planning = ? FOR UPDATE`,
      [id]
    );
    if (!planning) {
      await connection.rollback();
      return res.status(404).json({ message: 'Planning introuvable.' });
    }
    if (planning.statut !== 'SOUMIS') {
      await connection.rollback();
      return res.status(409).json({ message: 'Le planning doit etre au statut SOUMIS pour etre valide/rejete.' });
    }

    await connection.query(
      `INSERT INTO validation_rh (planning_id, rh_id, decision, commentaire)
       VALUES (?, ?, ?, ?)`,
      [id, req.user.id_utilisateur, decision, commentaire || null]
    );

    await connection.query('UPDATE planning SET statut = ? WHERE id_planning = ?', [decision, id]);

    await connection.commit();

    await logAction(id, req.user.id_utilisateur, `Planning ${decision.toLowerCase()} par la RH`, commentaire);

    // Notification au chef de service (createur du planning)
    await notifierUtilisateur(
      planning.cree_par,
      id,
      `Planning ${decision === 'VALIDE' ? 'valide' : 'rejete'} par la RH`,
      `Votre planning ${planning.nom_service} S${planning.numero_semaine}/${planning.annee} a ete ${decision === 'VALIDE' ? 'valide' : 'rejete'} par la RH.${commentaire ? ` Motif : ${commentaire}` : ''}`
    );
    // Copie d'information aux autres RH et a l'ADMIN
    await notifierRole('RH', id, `Planning ${decision.toLowerCase()} (S${planning.numero_semaine} ${planning.nom_service})`, `Le planning ${planning.nom_service} S${planning.numero_semaine}/${planning.annee} a ete ${decision === 'VALIDE' ? 'valide' : 'rejete'}.`, { exceptUtilisateurId: req.user.id_utilisateur });
    await notifierRole('ADMIN', id, `Planning ${decision.toLowerCase()} (S${planning.numero_semaine} ${planning.nom_service})`, `Le planning ${planning.nom_service} S${planning.numero_semaine}/${planning.annee} a ete ${decision === 'VALIDE' ? 'valide' : 'rejete'}.`);

    res.json({ message: `Planning ${decision === 'VALIDE' ? 'valide' : 'rejete'}.` });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
}

// GET /api/plannings/:id/validations (historique des decisions RH sur ce planning)
// Les motifs ne sont pas publics : EMPLOYE refuse, un chef ne lit que les
// validations des plannings de SON service (RH/ADMIN : tous).
async function historiqueValidations(req, res, next) {
  try {
    const { id } = req.params;
    if (req.user.role === 'EMPLOYE') {
      return res.status(403).json({ message: 'Acces refuse.' });
    }
    if (req.user.role === 'CHEF_SERVICE') {
      const [[p]] = await pool.query('SELECT service_id FROM planning WHERE id_planning = ?', [id]);
      if (!p) return res.status(404).json({ message: 'Planning introuvable.' });
      if (Number(p.service_id) !== Number(req.user.id_service)) {
        return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
      }
    }
    const [rows] = await pool.query(
      `SELECT v.id_validation, v.planning_id AS id_planning,
              v.rh_id AS id_utilisateur, v.decision, v.commentaire,
              v.date_validation AS date_decision,
              u.nom_utilisateur AS nom, u.prenom
       FROM validation_rh v JOIN utilisateur u ON u.id_utilisateur = v.rh_id
       WHERE v.planning_id = ? ORDER BY v.date_validation DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

module.exports = { valider, historiqueValidations };