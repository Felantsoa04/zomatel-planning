const express = require('express');
const { create, list, getById, supprimer, rouvrir } = require('../controllers/planningController');
const grille = require('../controllers/planningGrilleController');
const { upsert: upsertAffectation } = require('../controllers/affectationController');
const { valider, historiqueValidations } = require('../controllers/validationController');
const { controler } = require('../controllers/couvertureController');
const { exporter, exporterMulti } = require('../controllers/exportEdtController');
const { authRequired } = require('../middleware/auth');
const { requirePermission } = require('../utils/permissions');

const router = express.Router();

router.get('/', authRequired, list);
router.post('/', authRequired, requirePermission('planning.create'), create);
router.get('/:id', authRequired, getById);
router.patch('/:id/soumettre', authRequired, requirePermission('planning.submit'), grille.soumettre);
// Suppression : chef (son planning, BROUILLON/REJETE uniquement) ou RH/ADMIN
router.delete('/:id', authRequired, requirePermission('planning.delete'), supprimer);
// Rouverture d'un planning VALIDE par la RH : retour en BROUILLON, le circuit
// de soumission/validation repart de zero (jamais de modification silencieuse)
router.patch('/:id/rouvrir', authRequired, requirePermission('planning.reopen'), rouvrir);

// Saisie directe de la grille hebdomadaire (Gestion du planning)
router.get('/:id/grille', authRequired, requirePermission('planning.view'), grille.getGrille);
router.put('/:id/grille', authRequired, requirePermission('planning.update'), grille.saveGrille);
router.get('/:id/modifiable', authRequired, requirePermission('planning.view'), grille.modifiable);

// Affectations rattachees a un planning
router.post('/:idPlanning/affectations', authRequired, requirePermission('planning.update'), upsertAffectation);

// Validation RH
router.post('/:id/validation', authRequired, requirePermission('planning.validate'), valider);
router.get('/:id/validations', authRequired, historiqueValidations);

// Controle de couverture
router.post('/:id/couverture', authRequired, requirePermission('planning.view'), controler);

// Export Excel de l'emploi du temps (fidele au modele du projet)
router.get('/:id/emploi-du-temps.xlsx', authRequired, requirePermission('planning.view'), exporter);
// Export GROUPE : plusieurs plannings valides selectionnes -> UN classeur,
// une feuille par planning (meme permission que la consultation)
router.post('/emploi-du-temps-multi.xlsx', authRequired, requirePermission('planning.view'), exporterMulti);

module.exports = router;
