const express = require('express');
const { create, list, getById, supprimer, rouvrir } = require('../controllers/planningController');
const grille = require('../controllers/planningGrilleController');
const { upsert: upsertAffectation } = require('../controllers/affectationController');
const { valider, historiqueValidations } = require('../controllers/validationController');
const { controler } = require('../controllers/couvertureController');
const { exporter, exporterMulti } = require('../controllers/exportEdtController');
const { statistiquesHeures } = require('../controllers/statistiquesHeuresController');
const { authRequired, requireRole } = require('../middleware/auth');
const { requirePermission, requirePermissionAny } = require('../utils/permissions');

const router = express.Router();

router.get('/', authRequired, requirePermission('planning.view'), list);
router.post('/', authRequired, requirePermission('planning.create'), create);
// Statistiques des heures planifiées (page Statistiques) : agrégation en base,
// périmètre appliqué côté serveur selon les permissions (planning.view_all).
// AVANT /:id pour éviter le conflit de route (id === "statistiques-heures").
router.get('/statistiques-heures', authRequired, requirePermissionAny(['planning.view', 'employe.view']), statistiquesHeures);
router.get('/validations', authRequired, requirePermission('planning.validate'), list);
router.get('/:id', authRequired, requirePermissionAny(['planning.view', 'planning.validate']), getById);
router.patch('/:id/soumettre', authRequired, requirePermission('planning.submit'), grille.soumettre);
// Suppression : chef (son planning, BROUILLON/REJETE uniquement) ou RH/ADMIN
router.delete('/:id', authRequired, requirePermission('planning.delete'), supprimer);
// Rouverture d'un planning VALIDE par la RH : retour en BROUILLON, le circuit
// de soumission/validation repart de zero (jamais de modification silencieuse)
router.patch('/:id/rouvrir', authRequired, requirePermission('planning.reopen'), rouvrir);

// Saisie directe de la grille hebdomadaire (Gestion du planning)
router.get('/:id/grille', authRequired, requirePermissionAny(['planning.view', 'planning.validate']), grille.getGrille);
router.put('/:id/grille', authRequired, requirePermission('planning.update'), grille.saveGrille);
router.get('/:id/modifiable', authRequired, requirePermissionAny(['planning.view', 'planning.update']), grille.modifiable);

// Affectations rattachees a un planning
router.post('/:idPlanning/affectations', authRequired, requirePermission('planning.update'), upsertAffectation);

// Validation RH
router.post('/:id/validation', authRequired, requirePermission('planning.validate'), valider);
router.get('/:id/validations', authRequired, requirePermissionAny(['planning.view', 'planning.validate']), historiqueValidations);

// Controle de couverture
router.post('/:id/couverture', authRequired, requirePermission('planning.view'), controler);

// Export Excel de l'emploi du temps : réservé au rôle RH et à sa permission dédiée.
router.get('/:id/emploi-du-temps.xlsx', authRequired, requireRole('RH'), requirePermission('planning.export_edt'), exporter);
// Export GROUPE : plusieurs plannings valides selectionnes -> UN classeur,
// une feuille par planning (réservé au rôle RH et à sa permission dédiée)
router.post('/emploi-du-temps-multi.xlsx', authRequired, requireRole('RH'), requirePermission('planning.export_edt'), exporterMulti);

module.exports = router;
