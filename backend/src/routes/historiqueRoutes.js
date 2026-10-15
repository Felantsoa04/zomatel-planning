const express = require('express');
const pool = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Historique : toutes les routes exigent une session valide (JWT).
// Les événements existants du compte restent servis par /api/notifications ;
// ce routeur ajoute la lecture du tracé des EXPORTS (plannings exportés).
router.use(authRequired);

/* GET /api/historique/exports — plannings exportés PAR l'utilisateur courant
 * (les exports sont réservés au RH, l'historique reste donc personnel).
 * Chaque ligne : date, heure, utilisateur, fichier, semaine, année, type
 * (SIMPLE / MULTI), services et plannings exportés. */
router.get('/exports', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.id_export, e.type_export, e.numero_semaine, e.annee,
              e.nb_plannings, e.nom_fichier, e.details, e.date_export,
              u.id_utilisateur,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.prenom, u.nom_utilisateur)), ''), u.login) AS nom_utilisateur
       FROM historique_export e
       JOIN utilisateur u ON u.id_utilisateur = e.utilisateur_id
       WHERE e.utilisateur_id = ?
       ORDER BY e.date_export DESC, e.id_export DESC
       LIMIT 200`,
      [req.user.id_utilisateur]
    );
    // mysql2 décode déjà la colonne JSON en objet/array : accepter les deux
    // formes (chaîne JSON ou valeur déjà décodée).
    for (const r of rows) {
      if (Array.isArray(r.details)) continue;
      try {
        const d = JSON.parse(r.details || '[]');
        r.details = Array.isArray(d) ? d : [];
      } catch { r.details = []; }
    }
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
