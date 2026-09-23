const pool = require('../config/db');

// POST /api/recuperations  (CHEF_SERVICE ou RH uniquement, jamais l'employe)
async function create(req, res, next) {
  try {
    const { id_employe, date_recuperation, nombre_heures, motif } = req.body;
    if (!id_employe || !date_recuperation || !nombre_heures) {
      return res.status(400).json({ message: 'id_employe, date_recuperation et nombre_heures requis.' });
    }

    const [result] = await pool.query(
      `INSERT INTO recuperation (employe_id, date_recuperation, nombre_heures, motif, saisi_par)
       VALUES (?, ?, ?, ?, ?)`,
      [id_employe, date_recuperation, nombre_heures, motif || null, req.user.id_utilisateur]
    );

    res.status(201).json({ id_recuperation: result.insertId });
  } catch (err) {
    next(err);
  }
}

// GET /api/recuperations?id_employe=1
async function list(req, res, next) {
  try {
    const { id_employe } = req.query;
    let sql = `SELECT r.id_recuperation, r.employe_id AS id_employe,
                      r.date_recuperation, r.nombre_heures, r.motif,
                      e.nom AS employe_nom
               FROM recuperation r JOIN employe e ON e.id_employe = r.employe_id`;
    const params = [];
    if (id_employe) {
      sql += ' WHERE r.id_employe = ?';
      params.push(id_employe);
    }
    sql += ' ORDER BY r.date_recuperation DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list };