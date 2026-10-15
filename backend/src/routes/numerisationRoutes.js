const express = require('express');
const { authRequired, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');
const nc = require('../controllers/numerisationController');

/* Numérisation des plannings papier : réservée au rôle RH avec la
 * permission numerisation.use (même double contrôle que l'export EDT). */
const router = express.Router();

router.use(authRequired, requireRole('RH'), requirePermission('numerisation.use'));

// Import multi-fichiers (multer jusqu'à 20 fichiers, 12 Mo chacun)
router.post('/fichiers', nc.upload.array('fichiers', 20), nc.importer);

// Suivi de progression + résultats OCR
router.get('/fichiers', nc.lister);

// Document original (ACCÈS AUTHENTIFIÉ, jamais statique public)
router.get('/:id/fichier', nc.fichier);

// Corrections RH : métadonnées (service/semaine) puis données OCR vérifiées
router.patch('/:id/metadata', nc.majMetadata);
router.patch('/:id/donnees', nc.majDonnees);

// Confirmation : création du planning BROUILLON (circuit existant)
router.post('/:id/confirmer', nc.confirmer);

// Retrait d'un document avant confirmation
router.delete('/:id', nc.supprimer);

module.exports = router;
