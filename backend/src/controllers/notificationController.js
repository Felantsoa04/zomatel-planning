const pool = require('../config/db');

// GET /api/notifications  -> notifications du compte connecte (tous roles)
async function list(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const [rows] = await pool.query(
      `SELECT n.id_notification, n.utilisateur_id AS id_utilisateur,
              n.planning_id AS id_planning,
              n.titre, n.message, n.lu, n.date_creation,
              s.nom_service AS service_nom,
              p.numero_semaine, p.annee
       FROM notification n
       LEFT JOIN planning p ON p.id_planning = n.planning_id
       LEFT JOIN service s ON s.id_service = p.service_id
       WHERE n.utilisateur_id = ?
       ORDER BY n.date_creation DESC, n.id_notification DESC
       LIMIT ?`,
      [req.user.id_utilisateur, limit]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/notifications/non-lues/count -> badge 🔔
async function nonLuesCount(req, res, next) {
  try {
    const [[row]] = await pool.query(
      'SELECT COUNT(*) AS non_lues FROM notification WHERE utilisateur_id = ? AND lu = 0',
      [req.user.id_utilisateur]
    );
    res.json({ non_lues: row.non_lues });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/:id/lu
async function marquerLue(req, res, next) {
  try {
    const [result] = await pool.query(
      'UPDATE notification SET lu = 1 WHERE id_notification = ? AND utilisateur_id = ?',
      [req.params.id, req.user.id_utilisateur]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Notification introuvable.' });
    }
    res.json({ message: 'Notification marquee comme lue.' });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/marquer-tout-lu
async function marquerToutesLues(req, res, next) {
  try {
    await pool.query(
      'UPDATE notification SET lu = 1 WHERE utilisateur_id = ? AND lu = 0',
      [req.user.id_utilisateur]
    );
    res.json({ message: 'Toutes les notifications sont marquees comme lues.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, nonLuesCount, marquerLue, marquerToutesLues };
