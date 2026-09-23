const express = require('express');
const { remove } = require('../controllers/creneauController');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.delete('/:id', authRequired, requireRole('CHEF_SERVICE'), remove);

module.exports = router;