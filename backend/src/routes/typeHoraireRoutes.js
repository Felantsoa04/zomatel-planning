const express = require('express');
const { listTypesHoraires } = require('../controllers/creneauController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, listTypesHoraires);

module.exports = router;