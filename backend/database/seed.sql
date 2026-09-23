-- =====================================================================
-- ZOMATEL - Comptes de demonstration (non destructif, a executer APRES
-- 01_compat_alter.sql) :
--   mysql -u root zomatel_planning < backend/database/seed.sql
--
-- Le compte "admin" preexistant est laisse intact : on lui known-only
-- redefinit pas le mot de passe ici.
-- Comptes de test crees / reinitialises :
--   RH   : login "rh"   / mot de passe "rh123"
--   Chef : login "chef" / mot de passe "chef123" (service RECEPTION si existe)
-- (A supprimer avant mise en production.)
-- =====================================================================
USE zomatel_planning;

-- Types d'horaires de reference (idempotent)
INSERT INTO type_horaire (nom, heure_debut, heure_fin, type_creneau)
  SELECT 'Matin 06h-14h', '06:00', '14:00', 'MATIN'
  WHERE NOT EXISTS (SELECT 1 FROM type_horaire WHERE nom = 'Matin 06h-14h');

INSERT INTO type_horaire (nom, heure_debut, heure_fin, type_creneau)
  SELECT 'Après-midi 14h-22h', '14:00', '22:00', 'APRES_MIDI'
  WHERE NOT EXISTS (SELECT 1 FROM type_horaire WHERE nom = 'Après-midi 14h-22h');

-- NB : la contrainte chk_type_horaire (heure_fin > heure_debut) interdit
-- les creneaux a cheval sur minuit ; le type SOIR reste intra-journalier.
INSERT INTO type_horaire (nom, heure_debut, heure_fin, type_creneau)
  SELECT 'Soir 18h-23h', '18:00', '23:00', 'SOIR'
  WHERE NOT EXISTS (SELECT 1 FROM type_horaire WHERE nom = 'Soir 18h-23h');

-- Compte RH de demonstration (rh123)
SET @hash_rh = '$2b$10$9AKHt8c3I7SS5ZElHwyKDOGPsDA4h.5WL2vA5dwK3jj/m/DSYI27S';

INSERT INTO utilisateur (nom_utilisateur, prenom, login, mot_de_passe, role, service_id)
  SELECT 'DEMO', 'Rh', 'rh', @hash_rh, 'RH', NULL
  WHERE NOT EXISTS (SELECT 1 FROM utilisateur WHERE login = 'rh');

-- Compte chef de service de demonstration (chef123), rattache au
-- service "RECEPTION" s'il existe, sinon au premier service dispo.
SET @hash_chef = '$2b$10$9C3GkdePjxKlwzJIWbPbZumsK5JJJlIhiOhM0oeFaJuraOyUvUuEK';

INSERT INTO utilisateur (nom_utilisateur, prenom, login, mot_de_passe, role, service_id)
  SELECT 'DEMO', 'Chef', 'chef', @hash_chef, 'CHEF_SERVICE',
         COALESCE(
           (SELECT id_service FROM service WHERE nom_service LIKE '%RECEPTION%' LIMIT 1),
           (SELECT id_service FROM service ORDER BY id_service LIMIT 1)
         )
  WHERE NOT EXISTS (SELECT 1 FROM utilisateur WHERE login = 'chef');
