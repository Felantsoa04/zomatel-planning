const pool = require('../config/db');

async function lister(req, res) {
  try {
    const [services] = await pool.query(
      'SELECT id_service, nom_service AS nom, type_affichage FROM service ORDER BY nom_service'
    );
    res.json(services);
  } catch (err) {
    console.error('Erreur liste services:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
}

async function getById(req, res) {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      'SELECT id_service, nom_service AS nom, type_affichage FROM service WHERE id_service = ?',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Service introuvable' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Erreur get service:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
}

async function creer(req, res) {
  const { nom, type_affichage } = req.body;

  if (!nom || !['PERIODES_FIXES', 'HORAIRE_LIBRE'].includes(type_affichage)) {
    return res.status(400).json({ message: 'Nom et type_affichage (PERIODES_FIXES ou HORAIRE_LIBRE) requis' });
  }

  try {
    const [resultat] = await pool.query(
      'INSERT INTO service (nom_service, type_affichage) VALUES (?, ?)',
      [nom, type_affichage]
    );
    res.status(201).json({ id_service: resultat.insertId, nom, type_affichage });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ce service existe déjà' });
    }
    console.error('Erreur creation service:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
}

async function update(req, res) {
  const { id } = req.params;
  const { nom, type_affichage } = req.body;

  if (!nom || !['PERIODES_FIXES', 'HORAIRE_LIBRE'].includes(type_affichage)) {
    return res.status(400).json({ message: 'Nom et type_affichage (PERIODES_FIXES ou HORAIRE_LIBRE) requis' });
  }

  try {
    const [resultat] = await pool.query(
      'UPDATE service SET nom_service = ?, type_affichage = ? WHERE id_service = ?',
      [nom, type_affichage, id]
    );
    if (resultat.affectedRows === 0) {
      return res.status(404).json({ message: 'Service introuvable' });
    }
    res.json({ id_service: Number(id), nom, type_affichage });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ce service existe déjà' });
    }
    console.error('Erreur update service:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
}

async function supprimer(req, res) {
  const { id } = req.params;
  try {
    const [resultat] = await pool.query('DELETE FROM service WHERE id_service = ?', [id]);
    if (resultat.affectedRows === 0) {
      return res.status(404).json({ message: 'Service introuvable' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('Erreur suppression service:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
}

module.exports = { lister, getById, creer, update, supprimer };