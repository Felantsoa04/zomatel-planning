const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { authRequired, requireRole } = require('../middleware/auth');

// Consultation : tout compte authentifie (le nom du service sert a tous les roles).
// Ecriture (creation/modification) : ADMIN ou RH uniquement.
// Suppression : ADMIN uniquement (action la plus destructrice).
router.get('/', authRequired, serviceController.lister);
router.post('/', authRequired, requireRole('ADMIN', 'RH'), serviceController.creer);
router.put('/:id', authRequired, requireRole('ADMIN', 'RH'), serviceController.update);
router.delete('/:id', authRequired, requireRole('ADMIN'), serviceController.supprimer);

module.exports = router;