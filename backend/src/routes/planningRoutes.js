const express = require('express');
const { create, list, getById, supprimer, rouvrir } = require('../controllers/planningController');
const grille = require('../controllers/planningGrilleController');
const { upsert: upsertAffectation } = require('../controllers/affectationController');
const { valider, historiqueValidations } = require('../controllers/validationController');
const { controler } = require('../controllers/couvertureController');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, list);
router.post('/', authRequired, requireRole('CHEF_SERVICE'), create);
router.get('/:id', authRequired, getById);
router.patch('/:id/soumettre', authRequired, requireRole('CHEF_SERVICE'), grille.soumettre);
// Suppression : chef (son planning, BROUILLON/REJETE uniquement) ou RH/ADMIN
router.delete('/:id', authRequired, requireRole('CHEF_SERVICE', 'RH'), supprimer);
// Rouverture d'un planning VALIDE par la RH : retour en BROUILLON, le circuit
// de soumission/validation repart de zero (jamais de modification silencieuse)
router.patch('/:id/rouvrir', authRequired, requireRole('RH', 'ADMIN'), rouvrir);

// Saisie directe de la grille hebdomadaire (Gestion du planning)
router.get('/:id/grille', authRequired, requireRole('CHEF_SERVICE', 'RH'), grille.getGrille);
router.put('/:id/grille', authRequired, requireRole('CHEF_SERVICE'), grille.saveGrille);
router.get('/:id/modifiable', authRequired, requireRole('CHEF_SERVICE', 'RH'), grille.modifiable);

// Affectations rattachees a un planning
router.post('/:idPlanning/affectations', authRequired, requireRole('CHEF_SERVICE'), upsertAffectation);

// Validation RH
router.post('/:id/validation', authRequired, requireRole('RH'), valider);
router.get('/:id/validations', authRequired, historiqueValidations);

// Controle de couverture
router.post('/:id/couverture', authRequired, requireRole('CHEF_SERVICE', 'RH'), controler);

module.exports = router;