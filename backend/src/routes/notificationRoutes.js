const express = require('express');
const { list, nonLuesCount, marquerLue, marquerToutesLues } = require('../controllers/notificationController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Toutes les notifications sont personnelles : le filtre est req.user.id_utilisateur.
router.get('/', authRequired, list);
router.get('/non-lues/count', authRequired, nonLuesCount);
router.patch('/marquer-tout-lu', authRequired, marquerToutesLues);
router.patch('/:id/lu', authRequired, marquerLue);

module.exports = router;
