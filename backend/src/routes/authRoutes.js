const express = require('express');
const { login, me, listPermissions, createUser, listUsers, updateUser, desactiverUser } = require('../controllers/authController');
const { definirPhoto, supprimerPhoto } = require('../controllers/photoProfilController');
const { authRequired } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

const router = express.Router();

// Authentification (inchangee)
router.post('/login', login);
router.get('/me', authRequired, me);

// Photo de profil du compte CONNECTE (id jamais pris du body) :
// aucune permission requise au-dela d'etre authentifie — chacun gere SA photo.
router.put('/profile/photo', authRequired, definirPhoto);
router.delete('/profile/photo', authRequired, supprimerPhoto);

// Catalogue des permissions + defauts par role (pour le formulaire RH)
router.get('/permissions', authRequired, requirePermission('user.view'), listPermissions);

// Gestion des utilisateurs : permissions en base (RBAC), verifiees a chaque requete.
router.get('/users', authRequired, requirePermission('user.view'), listUsers);
router.post('/users', authRequired, requirePermission('user.create'), createUser);
router.put('/users/:id', authRequired, requirePermission('user.update'), updateUser);
router.delete('/users/:id', authRequired, requirePermission('user.update'), desactiverUser);

module.exports = router;
