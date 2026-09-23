const pool = require('../config/db');
const { logAction } = require('../utils/historique');

// POST /api/affectations/:idAffectation/creneaux
// Cree ou met a jour un creneau (matin / apres-midi / soir) pour une affectation
async function upsert(req, res, next) {
  try {
    const { idAffectation } = req.params;
    const { periode, heure_entree, heure_sortie, id_type_horaire } = req.body;

    if (!periode || !heure_entree || !heure_sortie) {
      return res.status(400).json({ message: 'periode, heure_entree et heure_sortie requis.' });
    }
    if (heure_sortie <= heure_entree) {
      return res.status(400).json({ message: 'heure_sortie doit etre apres heure_entree.' });
    }

    // Isolation reelle : le creneau appartient a un planning du service du chef
    const [[ctx]] = await pool.query(
      `SELECT p.service_id
       FROM affectation a JOIN planning p ON p.id_planning = a.planning_id
       WHERE a.id_affectation = ?`,
      [idAffectation]
    );
    if (!ctx) return res.status(404).json({ message: 'Affectation introuvable.' });
    if (req.user.role === 'CHEF_SERVICE' && Number(ctx.service_id) !== Number(req.user.id_service)) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }

    await pool.query(
      `INSERT INTO creneau_travail (affectation_id, type_creneau, heure_entree, heure_sortie)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         heure_entree = VALUES(heure_entree),
         heure_sortie = VALUES(heure_sortie)`,
      [idAffectation, periode, heure_entree, heure_sortie]
    );

    const [[affectation]] = await pool.query(
      'SELECT planning_id FROM affectation WHERE id_affectation = ?',
      [idAffectation]
    );
    if (affectation) {
      await logAction(
        affectation.planning_id,
        req.user.id_utilisateur,
        'Creneau mis a jour',
        `affectation=${idAffectation} periode=${periode} ${heure_entree}-${heure_sortie}`
      );
    }

    res.json({ message: 'Creneau enregistre.' });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/creneaux/:id
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [[ctx]] = await pool.query(
      `SELECT p.service_id
       FROM creneau_travail ct
       JOIN affectation a ON a.id_affectation = ct.affectation_id
       JOIN planning p ON p.id_planning = a.planning_id
       WHERE ct.id_creneau = ?`,
      [id]
    );
    if (!ctx) return res.status(404).json({ message: 'Creneau introuvable.' });
    if (req.user.role === 'CHEF_SERVICE' && Number(ctx.service_id) !== Number(req.user.id_service)) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }
    await pool.query('DELETE FROM creneau_travail WHERE id_creneau = ?', [id]);
    res.json({ message: 'Creneau supprime.' });
  } catch (err) {
    next(err);
  }
}

// GET /api/types-horaires
async function listTypesHoraires(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM type_horaire WHERE actif = 1 ORDER BY libelle');
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

module.exports = { upsert, remove, listTypesHoraires };