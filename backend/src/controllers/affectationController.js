const pool = require('../config/db');
const { aAccesServicePlanning } = require('../utils/planningAccess');
const { logAction } = require('../utils/historique');

// POST /api/plannings/:idPlanning/affectations
// Cree ou met a jour l'affectation d'un employe pour un jour donne (upsert)
async function upsert(req, res, next) {
  try {
    const { idPlanning } = req.params;
    const { id_employe, jour, statut_jour, observation } = req.body;

    if (!id_employe || !jour) {
      return res.status(400).json({ message: 'id_employe et jour requis.' });
    }

    // Le planning doit encore etre modifiable
    const [[planning]] = await pool.query(
      'SELECT statut, service_id FROM planning WHERE id_planning = ?',
      [idPlanning]
    );
    if (!planning) return res.status(404).json({ message: 'Planning introuvable.' });
    // Isolation reelle : un chef n'affecte que dans les plannings de SON service
    if (!aAccesServicePlanning(req, planning.service_id)) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }
    if (planning.statut === 'VALIDE') {
      return res.status(409).json({ message: 'Planning deja valide : modification impossible.' });
    }

    await pool.query(
      `INSERT INTO affectation (planning_id, employe_id, date_jour, statut, commentaire)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         statut = VALUES(statut),
         commentaire = VALUES(commentaire)`,
      [idPlanning, id_employe, jour, statut_jour || 'TRAVAIL', observation || null]
    );

    await logAction(
      idPlanning,
      req.user.id_utilisateur,
      'Affectation mise a jour',
      `employe=${id_employe} jour=${jour} statut=${statut_jour || 'TRAVAIL'}`
    );

    // insertId vaut 0 en cas d'UPDATE (ON DUPLICATE KEY) : on relit l'id reel
    const [[row]] = await pool.query(
      'SELECT id_affectation FROM affectation WHERE planning_id = ? AND employe_id = ? AND date_jour = ?',
      [idPlanning, id_employe, jour]
    );

    res.status(200).json({ id_affectation: row.id_affectation });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/affectations/:id
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [[aff]] = await pool.query(
      `SELECT a.id_affectation, p.service_id
       FROM affectation a JOIN planning p ON p.id_planning = a.planning_id
       WHERE a.id_affectation = ?`,
      [id]
    );
    if (!aff) return res.status(404).json({ message: 'Affectation introuvable.' });
    if (!aAccesServicePlanning(req, aff.service_id)) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }
    await pool.query('DELETE FROM affectation WHERE id_affectation = ?', [id]);
    res.json({ message: 'Affectation supprimee.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { upsert, remove };