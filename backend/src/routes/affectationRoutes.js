const express = require('express');
const { remove } = require('../controllers/affectationController');
const { upsert: upsertCreneau } = require('../controllers/creneauController');
const { authRequired } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

const router = express.Router();

// Gestion de grille : permission planning.update en base (les chefs l'ont
// par defaut) ; la restriction par service reste verifiee dans le controleur.
router.delete('/:id', authRequired, requirePermission('planning.update'), remove);

// Creneaux rattaches a une affectation
router.post('/:idAffectation/creneaux', authRequired, requirePermission('planning.update'), upsertCreneau);

module.exports = router;
