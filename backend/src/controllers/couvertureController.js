const pool = require('../config/db');

// POST /api/plannings/:id/couverture
// Enregistre le controle de couverture d'un jour/periode pour un planning
// body: { jour, periode, effectif_requis }
// L'effectif reel est calcule automatiquement a partir des creneaux existants.
async function controler(req, res, next) {
  try {
    const { id } = req.params;
    const { jour, periode, effectif_requis } = req.body;

    if (!jour || !periode || effectif_requis === undefined) {
      return res.status(400).json({ message: 'jour, periode et effectif_requis requis.' });
    }

    // Isolation reelle : un chef ne controle la couverture que de SON service
    const [[pl]] = await pool.query(
      'SELECT service_id FROM planning WHERE id_planning = ?',
      [id]
    );
    if (!pl) return res.status(404).json({ message: 'Planning introuvable.' });
    if (req.user.role === 'CHEF_SERVICE' && Number(pl.service_id) !== Number(req.user.id_service)) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }

    const [[{ effectif_reel }]] = await pool.query(
      `SELECT COUNT(*) AS effectif_reel
       FROM creneau_travail ct
       JOIN affectation a ON a.id_affectation = ct.affectation_id
       WHERE a.planning_id = ? AND a.date_jour = ? AND ct.type_creneau = ?`,
      [id, jour, periode]
    );

    // Le stockage utilise SOUS_COUVERTURE/COUVERT/SUR_COUVERTURE ;
    // l'API expose OK/INSUFFISANT/SUREFFECTIF (contrat frontend).
    let resultat = 'COUVERT';
    if (effectif_reel < effectif_requis) resultat = 'SOUS_COUVERTURE';
    else if (effectif_reel > effectif_requis) resultat = 'SUR_COUVERTURE';

    await pool.query(
      `INSERT INTO controle_couverture (planning_id, date_jour, type_creneau, effectif_requis, effectif_reel, resultat)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         effectif_requis = VALUES(effectif_requis),
         effectif_reel = VALUES(effectif_reel),
         resultat = VALUES(resultat)`,
      [id, jour, periode, effectif_requis, effectif_reel, resultat]
    );

    const statut = resultat === 'COUVERT' ? 'OK'
      : resultat === 'SOUS_COUVERTURE' ? 'INSUFFISANT' : 'SUREFFECTIF';

    res.status(201).json({ effectif_reel, statut });
  } catch (err) {
    next(err);
  }
}

module.exports = { controler };