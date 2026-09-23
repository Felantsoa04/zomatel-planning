const express = require('express');
const { list, create, update, desactiver, monProfil, mesPlannings, monPlanningDetail } = require('../controllers/employeController');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, list);

// Espace personnel EMPLOYE (avant les routes :id pour eviter tout conflit)
router.get('/me/profil', authRequired, monProfil);
router.get('/me/plannings', authRequired, mesPlannings);
router.get('/me/plannings/:id', authRequired, monPlanningDetail);

router.post('/', authRequired, requireRole('RH', 'CHEF_SERVICE'), create);
router.put('/:id', authRequired, requireRole('RH', 'CHEF_SERVICE'), update);
// Suppression = desactivation (soft delete) ; la restriction par service
// est verifiee dans le controleur (un chef ne touche que son service).
router.delete('/:id', authRequired, requireRole('RH', 'CHEF_SERVICE'), desactiver);

module.exports = router;