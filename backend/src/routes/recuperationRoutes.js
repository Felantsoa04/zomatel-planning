const express = require('express');
const { create, list } = require('../controllers/recuperationController');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, list);
router.post('/', authRequired, requireRole('CHEF_SERVICE', 'RH'), create);

module.exports = router;