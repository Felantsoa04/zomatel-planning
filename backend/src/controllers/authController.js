const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { signToken } = require('../utils/jwt');
const {
  DEFAUTS_PAR_ROLE,
  permissionsDe,
  definirPermissions,
  appliquerDefauts,
} = require('../utils/permissions');

const ROLES_VALIDES = ['ADMIN', 'RH', 'CHEF_SERVICE'];
// REGLE FONCTIONNELLE DU PROJET : l'Employe ne possede PAS de compte
// utilisateur et ne se connecte pas. Les employes existent uniquement
// comme donnees (fiche employe) manipulees par le RH et les Chefs.

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

    // REGLE PROJET : un Employe ne se connecte pas (aucun espace personnel).
    // Bloque cote serveur meme si un compte residuel existe en base.
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
// Session + photo_profil (lu en base : le JWT n'est pas re-emis, la photo
// peut changer sans reconnexion).
async function me(req, res) {
  try {
    const [[compte]] = await pool.query(
      'SELECT photo_profil FROM utilisateur WHERE id_utilisateur = ?',
      [req.user.id_utilisateur]
    );
    res.json({ user: { ...req.user, photo_profil: compte ? compte.photo_profil : null } });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/permissions
// Catalogue + defauts par role (pour le formulaire RH) + permissions du compte connecte.
async function listPermissions(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT code, nom, description FROM permissions ORDER BY code'
    );
    const codesCompte = await permissionsDe(req.user.id_utilisateur);
    res.json({
      catalogue: rows,
      defauts_par_role: DEFAUTS_PAR_ROLE,
      roles_valides: ROLES_VALIDES,
      mes_permissions: codesCompte,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/users  (RH ou ADMIN)
// Creation d'un compte avec ROLE + PERMISSIONS explicites :
// le nom ne determine jamais le role ; le role ne fait que PROPOSER des
// permissions par defaut, modifiables case par case par le RH.
async function createUser(req, res, next) {
  try {
    const { nom, prenom, login, mot_de_passe, role, id_service, permissions } = req.body;
    if (!nom || !login || !mot_de_passe) {
      return res.status(400).json({ message: 'nom, login et mot_de_passe requis.' });
    }
    const roleChoisi = String(role || '').toUpperCase();
    if (roleChoisi === 'EMPLOYE') {
      return res.status(400).json({
        message: "Un employé ne possède pas de compte utilisateur : le rôle EMPLOYE n'est pas créable.",
      });
    }
    if (!ROLES_VALIDES.includes(roleChoisi)) {
      return res.status(400).json({
        message: `Role invalide. Roles valides : ${ROLES_VALIDES.join(', ')}.`,
      });
    }

    // Regles metier par role (deja appliquees par les triggers/controleurs)
    if (roleChoisi === 'CHEF_SERVICE' && !id_service) {
      return res.status(400).json({
        message: 'id_service requis : un chef de service est rattache a UN seul service.',
      });
    }
    if (id_service) {
      const [[service]] = await pool.query(
        'SELECT id_service FROM service WHERE id_service = ?',
        [id_service]
      );
      if (!service) return res.status(404).json({ message: 'Service introuvable.' });
    }

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
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nom, prenom || null, login, hash, roleChoisi, id_service || null]
    );
    const id = result.insertId;

    // Permissions : liste explicite si fournie, sinon defauts du role choisi.
    const codesFinaux = Array.isArray(permissions)
      ? await definirPermissions(id, permissions)
      : await appliquerDefauts(id, roleChoisi);

    res.status(201).json({
      id_utilisateur: id,
      role: roleChoisi,
      permissions: codesFinaux,
      message: `Compte ${roleChoisi} cree.`,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/users  (RH ou ADMIN) : liste des comptes avec service + permissions
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
    const [attrib] = await pool.query(
      `SELECT up.utilisateur_id, p.code
       FROM utilisateur_permission up
       JOIN permissions p ON p.id = up.permission_id`
    );
    const parUser = {};
    for (const a of attrib) {
      (parUser[a.utilisateur_id] = parUser[a.utilisateur_id] || []).push(a.code);
    }
    res.json(rows.map((u) => ({ ...u, permissions: parUser[u.id_utilisateur] || [] })));
  } catch (err) {
    next(err);
  }
}

// PUT /api/auth/users/:id  (RH ou ADMIN)
// Champs acceptes : nom, prenom, login, role, id_service,
// mot_de_passe (optionnel : vide = inchangé), actif, permissions.
// (id_employe n'est pas modifiable : l'Employe n'a pas de compte.)
async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { nom, prenom, login, role, id_service, mot_de_passe, actif, permissions } = req.body;

    const [[cible]] = await pool.query(
      'SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur = ?',
      [id]
    );
    if (!cible) return res.status(404).json({ message: 'Compte introuvable.' });

    const roleChoisi = role ? String(role).toUpperCase() : null;
    if (roleChoisi && !ROLES_VALIDES.includes(roleChoisi)) {
      return res.status(400).json({
        message: `Role invalide. Roles valides : ${ROLES_VALIDES.join(', ')}.`,
      });
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
         role            = COALESCE(?, role),
         service_id      = COALESCE(?, service_id),
         mot_de_passe    = COALESCE(?, mot_de_passe),
         actif           = COALESCE(?, actif)
       WHERE id_utilisateur = ?`,
      [
        nom || null,
        prenom || null,
        login || null,
        roleChoisi,
        id_service || null,
        hash,
        actif === undefined ? null : (actif ? 1 : 0),
        id,
      ]
    );

    // Permissions : mises a jour uniquement si une liste est envoyee
    // (sinon les permissions actuelles sont conservees telles quelles).
    let codesFinaux = null;
    if (Array.isArray(permissions)) {
      // Anti-blocage : impossible de se retirer sa propre permission de gestion
      if (Number(id) === req.user.id_utilisateur) {
        const apres = (await definirPermissions(id, permissions)) || [];
        if (!apres.includes('user.update')) {
          // restauration de la permission obligatoire
          const [[p]] = await pool.query("SELECT id FROM permissions WHERE code = 'user.update'");
          if (p) {
            await pool.query(
              'INSERT IGNORE INTO utilisateur_permission (utilisateur_id, permission_id) VALUES (?, ?)',
              [id, p.id]
            );
          }
          return res.status(400).json({
            message: "Impossible de retirer 'user.update' de votre propre compte.",
          });
        }
        codesFinaux = apres;
      } else {
        codesFinaux = await definirPermissions(id, permissions);
      }
    }

    res.json({
      message: 'Compte mis a jour.',
      permissions: codesFinaux || (await permissionsDe(id)),
    });
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
      'SELECT id_utilisateur FROM utilisateur WHERE id_utilisateur = ?',
      [id]
    );
    if (!cible) return res.status(404).json({ message: 'Compte introuvable.' });
    if (Number(id) === req.user.id_utilisateur) {
      return res.status(400).json({ message: 'Impossible de desactiver son propre compte.' });
    }

    await pool.query('UPDATE utilisateur SET actif = 0 WHERE id_utilisateur = ?', [id]);
    res.json({ message: 'Compte desactive (acces coupe, donnees conservees).' });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, me, listPermissions, createUser, listUsers, updateUser, desactiverUser };
