const express = require('express');
const { login, me, createUser, listUsers, updateUser, desactiverUser } = require('../controllers/authController');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.get('/me', authRequired, me);

// Gestion des comptes CHEF DE SERVICE (RH et ADMIN)
router.get('/users', authRequired, requireRole('RH', 'ADMIN'), listUsers);
router.post('/users', authRequired, requireRole('RH', 'ADMIN'), createUser);
router.put('/users/:id', authRequired, requireRole('RH', 'ADMIN'), updateUser);
router.delete('/users/:id', authRequired, requireRole('RH', 'ADMIN'), desactiverUser);

module.exports = router;