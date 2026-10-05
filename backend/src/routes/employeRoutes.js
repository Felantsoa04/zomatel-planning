const express = require('express');
const { list, create, update, desactiver, monProfil, mesPlannings, monPlanningDetail } = require('../controllers/employeController');
const { authRequired } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

const router = express.Router();

// Consultation : permission en base (RH/ADMIN/chefs l'ont par defaut).
// NB : GET /employes reste interdit a l'EMPLOYE (controleur) — sa
// consultation personnelle passe par /employes/me/* ci-dessous.
router.get('/', authRequired, requirePermission('employe.view'), list);

// Espace personnel EMPLOYE (avant les routes :id pour eviter tout conflit)
router.get('/me/profil', authRequired, monProfil);
router.get('/me/plannings', authRequired, mesPlannings);
router.get('/me/plannings/:id', authRequired, monPlanningDetail);

router.post('/', authRequired, requirePermission('employe.manage'), create);
router.put('/:id', authRequired, requirePermission('employe.manage'), update);
// Suppression = desactivation (soft delete) ; la restriction par service
// est verifiee dans le controleur (un chef ne touche que son service).
router.delete('/:id', authRequired, requirePermission('employe.manage'), desactiver);

module.exports = router;
