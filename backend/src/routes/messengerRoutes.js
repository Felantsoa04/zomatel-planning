const express = require('express');
const ctrl = require('../controllers/messengerController');
const { authRequired } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

const router = express.Router();

// Toutes les routes Messenger : JWT (authRequired) + permission unique
// messenger.use (identique aux autres modules du projet : RBAC en base).
router.use(authRequired, requirePermission('messenger.use'));

router.get('/utilisateurs', ctrl.utilisateursAutorises);
router.get('/conversations', ctrl.listerConversations);
router.post('/conversations', ctrl.creerConversation);
// Gestion d'une discussion (etat PAR membre) : épingler / archiver / supprimer
router.patch('/conversations/:id/epingle', ctrl.definirEpingle);
router.patch('/conversations/:id/archive', ctrl.definirArchive);
router.delete('/conversations/:id', ctrl.supprimerConversation);
router.get('/conversations/:id/messages', ctrl.listerMessages);
router.post('/conversations/:id/messages', ctrl.envoyerMessage);
// Piece jointe (multipart/form-data, champ "fichier") : image, video, audio
// (vocal) ou document — meme permission messenger.use, meme controle membre.
router.post('/conversations/:id/fichiers', ctrl.envoyerPieceJointe);
router.post('/conversations/:id/read', ctrl.marquerLu);
router.get('/unread-count', ctrl.compteurNonLus);
router.patch('/messages/:id', ctrl.modifierMessage);
router.delete('/messages/:id', ctrl.supprimerMessage);

module.exports = router;
