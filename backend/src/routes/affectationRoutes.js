const express = require('express');
const { remove } = require('../controllers/affectationController');
const { upsert: upsertCreneau } = require('../controllers/creneauController');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.delete('/:id', authRequired, requireRole('CHEF_SERVICE'), remove);

// Creneaux rattaches a une affectation
router.post('/:idAffectation/creneaux', authRequired, requireRole('CHEF_SERVICE'), upsertCreneau);

module.exports = router;