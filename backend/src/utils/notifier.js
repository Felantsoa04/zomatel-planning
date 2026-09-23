const pool = require('../config/db');

// Cree une notification pour UN destinataire. Tolérant aux pannes :
// une notification ne doit JAMAIS faire echouer l'action métier qui la declenche.
async function notifierUtilisateur(utilisateurId, planningId, titre, message) {
  try {
    if (!utilisateurId) return;
    await pool.query(
      'INSERT INTO notification (utilisateur_id, planning_id, titre, message) VALUES (?, ?, ?, ?)',
      [utilisateurId, planningId || null, titre, message]
    );
  } catch (err) {
    console.error('Notification non creee :', err.message);
  }
}

// Notifie tous les comptes actifs d'un role (ex. tous les RH) en excluant
// eventuellement l'auteur de l'action.
async function notifierRole(role, planningId, titre, message, { exceptUtilisateurId } = {}) {
  try {
    const [rows] = await pool.query(
      'SELECT id_utilisateur FROM utilisateur WHERE role = ? AND actif = 1',
      [role]
    );
    for (const row of rows) {
      if (exceptUtilisateurId && row.id_utilisateur === exceptUtilisateurId) continue;
      await notifierUtilisateur(row.id_utilisateur, planningId, titre, message);
    }
  } catch (err) {
    console.error('Notification de role non envoyee :', err.message);
  }
}

module.exports = { notifierUtilisateur, notifierRole };
