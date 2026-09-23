-- =====================================================================
-- GESTION PLANNINGS HOTEL - Donnees de test
-- Prerequis : gestion_plannings_hotel_schema.sql
--   mysql -u root -p < backend/database/gestion_plannings_hotel_seed.sql
-- Comptes : admin/admin123, rh/rh123, chef/chef123
-- =====================================================================
USE gestion_plannings_hotel;

-- ---------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------
INSERT INTO service (id_service, nom_service, type_affichage, description) VALUES
  (1, 'Réception',           'PERIODES_FIXES', 'Accueil et check-in/out'),
  (2, 'Restauration',        'PERIODES_FIXES', 'Restaurant et snack'),
  (3, 'Housekeeping',        'HORAIRE_LIBRE',  'Nettoyage des chambres'),
  (4, 'Sécurité',            'PERIODES_FIXES', 'Ronde jour et nuit'),
  (5, 'Maintenance',         'HORAIRE_LIBRE',  'Technique et entretien')
ON DUPLICATE KEY UPDATE nom_service = VALUES(nom_service);

-- ---------------------------------------------------------------------
-- Comptes utilisateurs (hashes bcrypt de admin123 / rh123 / chef123)
-- ---------------------------------------------------------------------
INSERT INTO utilisateur (id_utilisateur, nom_utilisateur, prenom, login, mot_de_passe, role, service_id) VALUES
  (1, 'ADMIN',    'Systeme', 'admin', '$2b$10$mH38mzvEFvwDiLpXSmzEWe8oYkQOvzh/Ir57Ax5dnSXXZmupd3F9u', 'ADMIN',        NULL),
  (2, 'RAKOTO',   'Hery',    'rh',    '$2b$10$Gcp8KAWCBV4iU4UgLpnXZu4AncddADagD7TaeizjcHX4C/KfV.xki', 'RH',           NULL),
  (3, 'RANDRIA',  'Lala',    'chef',  '$2b$10$lS8GDoefTvTP/H6a1bgjhuTFseUSayyscNfMb7o3Aiw3CoGBoCTyq', 'CHEF_SERVICE', 1)
ON DUPLICATE KEY UPDATE nom_utilisateur = VALUES(nom_utilisateur);

-- ---------------------------------------------------------------------
-- Employes
-- ---------------------------------------------------------------------
INSERT INTO employe (id_employe, matricule, nom, statut, fonction, service_id, reference_hebdo, date_entree) VALUES
  (1,  'EMP001', 'RAMORA',  'TITULAIRE', 'Réceptionniste',     1, 44.00, '2024-01-15'),
  (2,  'EMP002', 'ROSTAND', 'TITULAIRE', 'Réceptionniste',     1, 44.00, '2024-03-01'),
  (3,  'EMP003', 'RINO',    'STAGIAIRE', 'Stagiaire accueil',  1, 20.00, '2026-09-01'),
  (4,  'EMP004', 'RA',      'TITULAIRE', 'Chef de rang',       2, 44.00, '2023-11-10'),
  (5,  'EMP005', 'JEAN',    'TITULAIRE', 'Serveur',            2, 48.00, '2023-06-20'),
  (6,  'EMP006', 'MARIE',   'STAGIAIRE', 'Stagiaire cuisine',  2, 20.00, '2026-09-01'),
  (7,  'EMP007', 'PAUL',    'TITULAIRE', 'Femme de chambre',   3, 44.00, '2022-05-02'),
  (8,  'EMP008', 'ANTOINE', 'TITULAIRE', 'Agent de sécurité',  4, 48.00, '2021-09-13'),
  (9,  'EMP009', 'SARAH',   'TITULAIRE', 'Technicienne',       5, 44.00, '2025-02-17'),
  (10, 'EMP010', 'BRICE',   'TITULAIRE', 'Veilleur de nuit',   1, 44.00, '2020-08-03')
ON DUPLICATE KEY UPDATE nom = VALUES(nom);

-- ---------------------------------------------------------------------
-- Types d'horaires (libelle/actif = contrat GET /api/types-horaires)
-- ---------------------------------------------------------------------
INSERT INTO type_horaire (id_type_horaire, libelle, heure_debut, heure_fin, type_creneau) VALUES
  (1,  'Matin 06h-14h',       '06:00', '14:00', 'MATIN'),
  (2,  'Matin 08h-12h',       '08:00', '12:00', 'MATIN'),
  (3,  'Après-midi 14h-18h',  '14:00', '18:00', 'APRES_MIDI'),
  (4,  'Après-midi 14h-22h',  '14:00', '22:00', 'APRES_MIDI'),
  (5,  'Soir 18h-23h',        '18:00', '23:00', 'SOIR'),
  (6,  'Journée 08h-16h',     '08:00', '16:00', 'MATIN')
ON DUPLICATE KEY UPDATE libelle = VALUES(libelle);

-- ---------------------------------------------------------------------
-- Plannings de la semaine 37 (07/09/2026 - 13/09/2026)
-- ---------------------------------------------------------------------
INSERT INTO planning (id_planning, service_id, annee, numero_semaine, date_debut_semaine, date_fin_semaine, statut, cree_par) VALUES
  (1, 1, 2026, 37, '2026-09-07', '2026-09-13', 'BROUILLON', 3),
  (2, 2, 2026, 37, '2026-09-07', '2026-09-13', 'BROUILLON', 3)
ON DUPLICATE KEY UPDATE statut = VALUES(statut);

-- ---------------------------------------------------------------------
-- Affectations semaine 37 - service Réception (planning 1)
-- ---------------------------------------------------------------------
INSERT INTO affectation (id_affectation, planning_id, employe_id, date_jour, statut, commentaire) VALUES
  (1,  1, 1, '2026-09-07', 'TRAVAIL', NULL),
  (2,  1, 1, '2026-09-08', 'TRAVAIL', NULL),
  (3,  1, 1, '2026-09-09', 'TRAVAIL', NULL),
  (4,  1, 1, '2026-09-10', 'TRAVAIL', NULL),
  (5,  1, 1, '2026-09-11', 'TRAVAIL', NULL),
  (6,  1, 1, '2026-09-12', 'REPOS',   NULL),
  (7,  1, 1, '2026-09-13', 'REPOS',   NULL),
  (8,  1, 2, '2026-09-07', 'TRAVAIL', NULL),
  (9,  1, 2, '2026-09-08', 'TRAVAIL', NULL),
  (10, 1, 2, '2026-09-09', 'REPOS',   NULL),
  (11, 1, 2, '2026-09-10', 'TRAVAIL', NULL),
  (12, 1, 2, '2026-09-11', 'TRAVAIL', NULL),
  (13, 1, 2, '2026-09-12', 'TRAVAIL', NULL),
  (14, 1, 2, '2026-09-13', 'TRAVAIL', NULL),
  (15, 1, 3, '2026-09-07', 'TRAVAIL', 'Formation accueil'),
  (16, 1, 3, '2026-09-08', 'TRAVAIL', 'Formation accueil'),
  (17, 1, 3, '2026-09-09', 'ABSENCE', 'Justificatif fourni'),
  (18, 1, 10, '2026-09-07', 'REPOS',  NULL),
  (19, 1, 10, '2026-09-08', 'REPOS',  NULL),
  (20, 1, 10, '2026-09-09', 'TRAVAIL', 'Veille nuit'),
  (21, 1, 10, '2026-09-10', 'TRAVAIL', 'Veille nuit')
ON DUPLICATE KEY UPDATE statut = VALUES(statut);

-- ---------------------------------------------------------------------
-- Créneaux (respectent la règle 8h/jour, aucun chevauchement)
-- ---------------------------------------------------------------------
INSERT INTO creneau_travail (id_creneau, affectation_id, type_creneau, heure_entree, heure_sortie) VALUES
  -- RAMORA : 8h/jour x 5 jours = 40h
  (1,  1,  'MATIN', '06:00', '14:00'),
  (2,  2,  'MATIN', '06:00', '14:00'),
  (3,  3,  'MATIN', '06:00', '14:00'),
  (4,  4,  'MATIN', '06:00', '14:00'),
  (5,  5,  'MATIN', '06:00', '14:00'),
  -- ROSTAND : 8h/jour x 6 jours = 48h
  (6,  8,  'APRES_MIDI', '14:00', '22:00'),
  (7,  9,  'APRES_MIDI', '14:00', '22:00'),
  (8,  11, 'APRES_MIDI', '14:00', '22:00'),
  (9,  12, 'APRES_MIDI', '14:00', '22:00'),
  (10, 13, 'APRES_MIDI', '14:00', '22:00'),
  (11, 14, 'APRES_MIDI', '14:00', '22:00'),
  -- RINO (stagiaire 20h) : 4h/jour
  (12, 15, 'MATIN', '08:00', '12:00'),
  (13, 16, 'MATIN', '08:00', '12:00'),
  -- BRICE : veille de nuit 8h
  (14, 20, 'SOIR',  '22:00', '23:59'),
  (15, 21, 'SOIR',  '22:00', '23:59')
ON DUPLICATE KEY UPDATE heure_entree = VALUES(heure_entree);

-- ---------------------------------------------------------------------
-- Congés (validation RH), récupérations, indisponibilités
-- ---------------------------------------------------------------------
INSERT INTO conge (id_conge, employe_id, date_debut, date_fin, type_conge, statut, motif, demande_par, valide_par, date_decision) VALUES
  (1, 4, '2026-10-05', '2026-10-16', 'ANNUEL', 'VALIDE',    'Congé annuel',       3, 2, '2026-09-05 10:00:00'),
  (2, 5, '2026-10-12', '2026-10-14', 'ANNUEL', 'EN_ATTENTE', 'Demande en cours',  3, NULL, NULL)
ON DUPLICATE KEY UPDATE statut = VALUES(statut);

INSERT INTO recuperation (id_recuperation, employe_id, date_recuperation, nombre_heures, motif, saisi_par) VALUES
  (1, 1, '2026-09-19', 4.00, 'Récupération heure supp semaine 36', 2),
  (2, 7, '2026-09-26', 2.50, 'Heures récupérées housekeeping',     3)
ON DUPLICATE KEY UPDATE nombre_heures = VALUES(nombre_heures);

INSERT INTO indisponibilite (id_indisponibilite, employe_id, date_debut, date_fin, type_indispo, motif, declare_par) VALUES
  (1, 9, '2026-09-21', '2026-09-22', 'FORMATION', 'Formation technique chaudière', 2)
ON DUPLICATE KEY UPDATE motif = VALUES(motif);

-- ---------------------------------------------------------------------
-- Besoins de couverture standards (Réception, semaine type)
-- ---------------------------------------------------------------------
INSERT INTO besoin_couverture (id_besoin, service_id, jour_semaine, type_creneau, effectif_requis) VALUES
  (1,  1, 1, 'MATIN',      2),
  (2,  1, 1, 'APRES_MIDI', 1),
  (3,  1, 1, 'SOIR',       1),
  (4,  1, 2, 'MATIN',      2),
  (5,  1, 2, 'APRES_MIDI', 1),
  (6,  1, 3, 'MATIN',      2),
  (7,  1, 3, 'APRES_MIDI', 1),
  (8,  1, 4, 'MATIN',      2),
  (9,  1, 4, 'APRES_MIDI', 1),
  (10, 1, 5, 'MATIN',      2),
  (11, 1, 5, 'APRES_MIDI', 1),
  (12, 1, 6, 'MATIN',      1),
  (13, 1, 7, 'MATIN',      1)
ON DUPLICATE KEY UPDATE effectif_requis = VALUES(effectif_requis);

-- ---------------------------------------------------------------------
-- Jours fériés 2026
-- ---------------------------------------------------------------------
INSERT INTO jour_ferie (date_ferie, libelle) VALUES
  ('2026-11-01', 'Toussaint'),
  ('2026-12-25', 'Noël')
ON DUPLICATE KEY UPDATE libelle = VALUES(libelle);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
INSERT INTO notification (id_notification, utilisateur_id, planning_id, titre, message) VALUES
  (1, 2, 1, 'Planning soumis', 'Le planning S37 Réception attend votre validation.')
ON DUPLICATE KEY UPDATE titre = VALUES(titre);
