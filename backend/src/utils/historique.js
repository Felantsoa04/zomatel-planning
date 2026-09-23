const pool = require('../config/db');

// Enregistre une ligne de tracabilite pour un planning donne
async function logAction(id_planning, id_utilisateur, action, details = null) {
  await pool.query(
    `INSERT INTO historique_modification (planning_id, utilisateur_id, action, description)
     VALUES (?, ?, ?, ?)`,
    [id_planning, id_utilisateur, action, details]
  );
}

module.exports = { logAction };