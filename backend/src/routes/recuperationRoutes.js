const express = require('express');
const { create, list } = require('../controllers/recuperationController');
const { authRequired } = require('../middleware/auth');
const { requirePermission, requirePermissionAny } = require('../utils/permissions');

const router = express.Router();

router.get('/', authRequired, list);
// Creation d'une recuperation : chef de service (gere sa grille) ou RH.
// L'ancien requireRole('CHEF_SERVICE','RH') est remplace par la permission
// planning.update (chefs) OU planning.validate (RH) : un des deux suffit,
// le garde ci-dessous accepte si l'utilisateur possede l'un des codes.
router.post('/', authRequired, requirePermissionAny(['planning.update', 'planning.validate']), create);

module.exports = router;
