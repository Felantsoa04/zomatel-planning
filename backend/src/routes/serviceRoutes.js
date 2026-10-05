const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { authRequired } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

// Consultation libre (le nom du service sert a tous les roles) ;
// ecriture/suppression : permission service.manage verifiee en base.
router.get('/', authRequired, serviceController.lister);
router.post('/', authRequired, requirePermission('service.manage'), serviceController.creer);
router.put('/:id', authRequired, requirePermission('service.manage'), serviceController.update);
router.delete('/:id', authRequired, requirePermission('service.manage'), serviceController.supprimer);

module.exports = router;
