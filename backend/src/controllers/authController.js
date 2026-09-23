const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { signToken } = require('../utils/jwt');

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { login, mot_de_passe } = req.body;
    if (!login || !mot_de_passe) {
      return res.status(400).json({ message: 'Login et mot de passe requis.' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM utilisateur WHERE login = ? AND actif = 1',
      [login]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Identifiants incorrects.' });
    }

    const valide = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!valide) {
      return res.status(401).json({ message: 'Identifiants incorrects.' });
    }

    // L'Employe n'utilise pas l'application (aucun espace personnel) :
    // sa connexion est refusee ici, cote serveur, meme si un compte existe.
    if (user.role === 'EMPLOYE') {
      return res.status(403).json({
        message: "Les employés n'ont pas d'accès à l'application. Seuls l'Administrateur, la RH et les Chefs de service se connectent.",
      });
    }

    const payload = {
      id_utilisateur: user.id_utilisateur,
      nom: user.nom_utilisateur,
      prenom: user.prenom || '',
      role: user.role,
      id_service: user.service_id,
      id_employe: user.id_employe || null,
    };
    const token = signToken(payload);

    res.json({ token, user: payload });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/me
async function me(req, res) {
  res.json({ user: req.user });
}

// POST /api/auth/users  (RH ou ADMIN : creer un compte CHEF DE SERVICE uniquement)
// La creation d'autres roles (RH/ADMIN) n'est pas exposee par cette route.
async function createUser(req, res, next) {
  try {
    const { nom, prenom, login, mot_de_passe, id_service } = req.body;
    if (!nom || !prenom || !login || !mot_de_passe) {
      return res.status(400).json({ message: 'nom, prenom, login et mot_de_passe requis.' });
    }
    if (!id_service) {
      return res.status(400).json({
        message: 'id_service requis : un chef de service est rattache a UN seul service.',
      });
    }

    // Le service doit exister
    const [[service]] = await pool.query(
      'SELECT id_service FROM service WHERE id_service = ?',
      [id_service]
    );
    if (!service) {
      return res.status(404).json({ message: 'Service introuvable.' });
    }

    // Unicite du login
    const [[existant]] = await pool.query(
      'SELECT id_utilisateur FROM utilisateur WHERE login = ?',
      [login]
    );
    if (existant) {
      return res.status(409).json({ message: 'Ce login est deja utilise.' });
    }

    const hash = await bcrypt.hash(mot_de_passe, 10);
    const [result] = await pool.query(
      `INSERT INTO utilisateur (nom_utilisateur, prenom, login, mot_de_passe, role, service_id)
       VALUES (?, ?, ?, ?, 'CHEF_SERVICE', ?)`,
      [nom, prenom, login, hash, id_service]
    );

    res.status(201).json({
      id_utilisateur: result.insertId,
      message: 'Chef de service cree et rattache au service.',
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/users  (RH ou ADMIN) : liste des comptes avec leur service
async function listUsers(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT u.id_utilisateur, u.nom_utilisateur AS nom, u.prenom, u.login,
              u.role, u.service_id AS id_service, u.id_employe, u.actif,
              u.date_creation, s.nom_service
       FROM utilisateur u
       LEFT JOIN service s ON s.id_service = u.service_id
       ORDER BY u.role, u.nom_utilisateur`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// PUT /api/auth/users/:id  (RH ou ADMIN) : modification d'un compte CHEF DE SERVICE
// Champs acceptes : nom, prenom, login, id_service, mot_de_passe, actif.
// Le role n'est PAS modifiable par cette route (securite des elevations).
async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { nom, prenom, login, id_service, mot_de_passe, actif } = req.body;

    const [[cible]] = await pool.query(
      'SELECT id_utilisateur, role FROM utilisateur WHERE id_utilisateur = ?',
      [id]
    );
    if (!cible) return res.status(404).json({ message: 'Compte introuvable.' });
    if (cible.role !== 'CHEF_SERVICE') {
      return res.status(403).json({ message: 'Seuls les comptes Chef de service sont modifiables via cette route.' });
    }

    if (id_service) {
      const [[service]] = await pool.query(
        'SELECT id_service FROM service WHERE id_service = ?',
        [id_service]
      );
      if (!service) return res.status(404).json({ message: 'Service introuvable.' });
    }
    if (login) {
      const [[existant]] = await pool.query(
        'SELECT id_utilisateur FROM utilisateur WHERE login = ? AND id_utilisateur <> ?',
        [login, id]
      );
      if (existant) return res.status(409).json({ message: 'Ce login est deja utilise.' });
    }

    let hash = null;
    if (mot_de_passe) hash = await bcrypt.hash(mot_de_passe, 10);

    await pool.query(
      `UPDATE utilisateur SET
         nom_utilisateur = COALESCE(?, nom_utilisateur),
         prenom          = COALESCE(?, prenom),
         login           = COALESCE(?, login),
         service_id      = COALESCE(?, service_id),
         mot_de_passe    = COALESCE(?, mot_de_passe),
         actif           = COALESCE(?, actif)
       WHERE id_utilisateur = ?`,
      [nom || null, prenom || null, login || null, id_service || null, hash, actif === undefined ? null : (actif ? 1 : 0), id]
    );

    res.json({ message: 'Compte mis a jour.' });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/auth/users/:id  (RH ou ADMIN) : DESACTIVATION (soft delete)
// Aucune donnee n'est supprimee : le compte passe actif = 0 et ne peut plus se connecter.
async function desactiverUser(req, res, next) {
  try {
    const { id } = req.params;
    const [[cible]] = await pool.query(
      'SELECT id_utilisateur, role FROM utilisateur WHERE id_utilisateur = ?',
      [id]
    );
    if (!cible) return res.status(404).json({ message: 'Compte introuvable.' });
    if (cible.role !== 'CHEF_SERVICE') {
      return res.status(403).json({ message: 'Seuls les comptes Chef de service sont desactivables via cette route.' });
    }
    if (Number(id) === req.user.id_utilisateur) {
      return res.status(400).json({ message: 'Impossible de desactiver son propre compte.' });
    }

    await pool.query('UPDATE utilisateur SET actif = 0 WHERE id_utilisateur = ?', [id]);
    res.json({ message: 'Compte desactive (acces coupe, donnees conservees).' });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, me, createUser, listUsers, updateUser, desactiverUser };