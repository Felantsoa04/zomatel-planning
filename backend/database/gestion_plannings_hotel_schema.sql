-- =====================================================================
-- GESTION PLANNINGS HOTEL - Schema MariaDB complet
-- Base : gestion_plannings_hotel
-- Adapté au backend existant (contrat API conservé) + règles métier :
--   * refus des conflits d'horaires (chevauchement de créneaux, trigger)
--   * une affectation TRAVAIL exige au moins 1 créneau (trigger)
--   * dates d'affectation bornées à la semaine du planning (trigger)
--   * validation RH réservée aux comptes RH (trigger sur validation_rh)
--   * congés/récupérations enregistrés par RH ou chef (triggers)
-- Exécution :
--   mysql -u root -p < backend/database/gestion_plannings_hotel_schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS gestion_plannings_hotel
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gestion_plannings_hotel;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. SERVICE : type d'affichage du planning
--    PERIODES_FIXES  = matin / après-midi / soir (modèle Excel Zomatel)
--    HORAIRE_LIBRE   = grille jours x créneaux libres
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service (
  id_service     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_service    VARCHAR(100) NOT NULL,
  type_affichage ENUM('PERIODES_FIXES','HORAIRE_LIBRE') NOT NULL DEFAULT 'PERIODES_FIXES',
  description    VARCHAR(255) DEFAULT NULL,
  date_creation  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_service_nom (nom_service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. UTILISATEUR : comptes applicatifs (ADMIN / RH / CHEF_SERVICE)
--    CHEF_SERVICE est toujours rattaché à exactement un service
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS utilisateur (
  id_utilisateur  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_utilisateur VARCHAR(100) NOT NULL,
  prenom          VARCHAR(100) DEFAULT NULL,
  login           VARCHAR(100) NOT NULL,
  mot_de_passe    VARCHAR(255) NOT NULL,               -- hash bcrypt
  role            ENUM('ADMIN','RH','CHEF_SERVICE') NOT NULL,
  service_id      INT UNSIGNED DEFAULT NULL,
  actif           TINYINT(1) NOT NULL DEFAULT 1,
  date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_utilisateur_login (login),
  KEY idx_utilisateur_role (role),
  KEY idx_utilisateur_service (service_id),
  CONSTRAINT fk_utilisateur_service FOREIGN KEY (service_id)
    REFERENCES service(id_service) ON DELETE SET NULL ON UPDATE CASCADE
  -- NB : la regle "CHEF_SERVICE => service_id NOT NULL" est appliquee par
  -- les triggers trg_utilisateur_bi/bu (CHECK interdit sur colonne FK)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. EMPLOYE : personnels planifiés (ne se connectent pas à l'app)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employe (
  id_employe      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  matricule       VARCHAR(50) DEFAULT NULL,
  nom             VARCHAR(150) NOT NULL,
  statut          ENUM('TITULAIRE','STAGIAIRE') NOT NULL DEFAULT 'TITULAIRE',
  fonction        VARCHAR(100) DEFAULT NULL,
  service_id      INT UNSIGNED NOT NULL,
  reference_hebdo DECIMAL(5,2) NOT NULL DEFAULT 44.00,
  date_entree     DATE DEFAULT NULL,
  actif           TINYINT(1) NOT NULL DEFAULT 1,
  date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employe_matricule (matricule),
  KEY idx_employe_service (service_id),
  CONSTRAINT fk_employe_service FOREIGN KEY (service_id)
    REFERENCES service(id_service) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_employe_reference CHECK (reference_hebdo > 0 AND reference_hebdo <= 60)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. TYPE_HORAIRE : créneaux types (Matin 06h-14h...)
--    Contrat backend : colonnes actif + libelle (GET /api/types-horaires)
--    NB : pas de CHECK heure_fin > heure_debut : le type "nuit" traverse minuit
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS type_horaire (
  id_type_horaire INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  libelle         VARCHAR(100) NOT NULL,
  heure_debut     TIME NOT NULL,
  heure_fin       TIME NOT NULL,
  type_creneau    ENUM('MATIN','APRES_MIDI','SOIR') NOT NULL,
  actif           TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_type_horaire_libelle (libelle)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. PLANNING : une semaine pour un service
--    Workflow : BROUILLON -> SOUMIS -> VALIDE / REJETE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planning (
  id_planning        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  service_id         INT UNSIGNED NOT NULL,
  annee              SMALLINT UNSIGNED NOT NULL,
  numero_semaine     TINYINT UNSIGNED NOT NULL,
  date_debut_semaine DATE NOT NULL,
  date_fin_semaine   DATE NOT NULL,
  statut             ENUM('BROUILLON','SOUMIS','VALIDE','REJETE') NOT NULL DEFAULT 'BROUILLON',
  cree_par           INT UNSIGNED NOT NULL,
  date_creation      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_modification  DATETIME DEFAULT NULL,
  UNIQUE KEY uq_planning_semaine (service_id, annee, numero_semaine),
  UNIQUE KEY uq_planning_dates (service_id, date_debut_semaine),
  KEY idx_planning_statut (statut),
  KEY idx_planning_annee (annee),
  CONSTRAINT fk_planning_service FOREIGN KEY (service_id)
    REFERENCES service(id_service) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_planning_createur FOREIGN KEY (cree_par)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE,
  CONSTRAINT chk_planning_dates CHECK (date_fin_semaine >= date_debut_semaine),
  CONSTRAINT chk_planning_semaine CHECK (numero_semaine BETWEEN 1 AND 53),
  CONSTRAINT chk_planning_annee CHECK (annee BETWEEN 2000 AND 2100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. AFFECTATION : un employé pour un jour d'un planning
--    statut_jour : TRAVAIL / REPOS / ABSENCE / CONGE
--    (REPOS, ABSENCE, CONGE : pas de créneaux — contrôlé par trigger)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affectation (
  id_affectation INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  planning_id    INT UNSIGNED NOT NULL,
  employe_id     INT UNSIGNED NOT NULL,
  date_jour      DATE NOT NULL,
  statut         ENUM('TRAVAIL','REPOS','ABSENCE','CONGE') NOT NULL DEFAULT 'TRAVAIL',
  commentaire    VARCHAR(255) DEFAULT NULL,
  UNIQUE KEY uq_affectation (planning_id, employe_id, date_jour),
  KEY idx_affectation_employe_date (employe_id, date_jour),
  KEY idx_affectation_date (date_jour),
  CONSTRAINT fk_affectation_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_affectation_employe FOREIGN KEY (employe_id)
    REFERENCES employe(id_employe) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. CRENEAU_TRAVAIL : entrée/sortie d'une période pour une affectation
--    Une seule ligne par (affectation, période) ; max 3 périodes/jour
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creneau_travail (
  id_creneau     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  affectation_id INT UNSIGNED NOT NULL,
  type_creneau   ENUM('MATIN','APRES_MIDI','SOIR') NOT NULL,
  heure_entree   TIME NOT NULL,
  heure_sortie   TIME NOT NULL,
  UNIQUE KEY uq_creneau_periode (affectation_id, type_creneau),
  KEY idx_creneau_affectation (affectation_id),
  CONSTRAINT fk_creneau_affectation FOREIGN KEY (affectation_id)
    REFERENCES affectation(id_affectation) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 8. CONGE : congés validés par la RH (statut EN_ATTENTE / VALIDE / REFUSE)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conge (
  id_conge      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employe_id    INT UNSIGNED NOT NULL,
  date_debut    DATE NOT NULL,
  date_fin      DATE NOT NULL,
  type_conge    ENUM('ANNUEL','MALADIE','MATERNITE','EXCEPTIONNEL') NOT NULL DEFAULT 'ANNUEL',
  statut        ENUM('EN_ATTENTE','VALIDE','REFUSE') NOT NULL DEFAULT 'EN_ATTENTE',
  motif         VARCHAR(255) DEFAULT NULL,
  demande_par   INT UNSIGNED NOT NULL,
  valide_par    INT UNSIGNED DEFAULT NULL,
  date_decision DATETIME DEFAULT NULL,
  date_demande  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_conge_employe (employe_id, date_debut),
  KEY idx_conge_statut (statut),
  CONSTRAINT fk_conge_employe FOREIGN KEY (employe_id)
    REFERENCES employe(id_employe) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_conge_demandeur FOREIGN KEY (demande_par)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE,
  CONSTRAINT fk_conge_valideur FOREIGN KEY (valide_par)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE,
  CONSTRAINT chk_conge_dates CHECK (date_fin >= date_debut)
  -- NB : la regle "decision => valide_par renseigne" est appliquee par
  -- les triggers trg_conge_bi/bu (CHECK interdit sur colonne FK)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 9. RECUPERATION : heures de récupération accordées par la RH/chef
--    Contrat backend : employe_id, date_recuperation, nombre_heures,
--    motif, saisi_par (POST/GET /api/recuperations)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recuperation (
  id_recuperation   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employe_id        INT UNSIGNED NOT NULL,
  date_recuperation DATE NOT NULL,
  nombre_heures     DECIMAL(5,2) NOT NULL,
  motif             VARCHAR(255) DEFAULT NULL,
  saisi_par         INT UNSIGNED NOT NULL,
  date_saisie       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_recuperation_employe (employe_id, date_recuperation),
  CONSTRAINT fk_recuperation_employe FOREIGN KEY (employe_id)
    REFERENCES employe(id_employe) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_recuperation_saisi_par FOREIGN KEY (saisi_par)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE,
  CONSTRAINT chk_recuperation_heures CHECK (nombre_heures > 0 AND nombre_heures <= 12)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 10. INDISPONIBILITE : absences/indisponibilités déclarées
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indisponibilite (
  id_indisponibilite INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employe_id         INT UNSIGNED NOT NULL,
  date_debut         DATE NOT NULL,
  date_fin           DATE NOT NULL,
  type_indispo       ENUM('ABSENCE','MALADIE','FORMATION','AUTRE') NOT NULL DEFAULT 'ABSENCE',
  motif              VARCHAR(255) DEFAULT NULL,
  declare_par        INT UNSIGNED NOT NULL,
  date_declaration   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_indispo_employe (employe_id, date_debut),
  CONSTRAINT fk_indispo_employe FOREIGN KEY (employe_id)
    REFERENCES employe(id_employe) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_indispo_declare_par FOREIGN KEY (declare_par)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE,
  CONSTRAINT chk_indispo_dates CHECK (date_fin >= date_debut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 11. VALIDATION_RH : historique des décisions RH sur les plannings
--    Trigger : seuls les comptes RH peuvent insérer ici
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_rh (
  id_validation   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  planning_id     INT UNSIGNED NOT NULL,
  rh_id           INT UNSIGNED NOT NULL,
  decision        ENUM('VALIDE','REJETE') NOT NULL,
  commentaire     TEXT DEFAULT NULL,
  date_validation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_validation_planning (planning_id),
  KEY idx_validation_rh (rh_id),
  CONSTRAINT fk_validation_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_validation_rh FOREIGN KEY (rh_id)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 12. CONTROLE_COUVERTURE : effectif requis vs réel par jour/période
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS controle_couverture (
  id_controle     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  planning_id     INT UNSIGNED NOT NULL,
  date_jour       DATE NOT NULL,
  type_creneau    ENUM('MATIN','APRES_MIDI','SOIR') NOT NULL,
  effectif_requis INT UNSIGNED NOT NULL,
  effectif_reel   INT UNSIGNED NOT NULL DEFAULT 0,
  resultat        ENUM('SOUS_COUVERTURE','COUVERT','SUR_COUVERTURE') NOT NULL,
  date_controle   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_controle (planning_id, date_jour, type_creneau),
  CONSTRAINT fk_controle_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 13. BESOIN_COUVERTURE : effectif requis standard service/jour/période
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS besoin_couverture (
  id_besoin       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  service_id      INT UNSIGNED NOT NULL,
  jour_semaine    TINYINT UNSIGNED NOT NULL,           -- 1=lundi ... 7=dimanche
  type_creneau    ENUM('MATIN','APRES_MIDI','SOIR') NOT NULL,
  effectif_requis INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_besoin (service_id, jour_semaine, type_creneau),
  CONSTRAINT fk_besoin_service FOREIGN KEY (service_id)
    REFERENCES service(id_service) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_besoin_jour CHECK (jour_semaine BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 14. HISTORIQUE_MODIFICATION : traçabilité des actions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historique_modification (
  id_historique  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  planning_id    INT UNSIGNED NOT NULL,
  utilisateur_id INT UNSIGNED NOT NULL,
  action         VARCHAR(100) NOT NULL,
  description    TEXT DEFAULT NULL,
  date_action    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_historique_planning (planning_id),
  KEY idx_historique_utilisateur (utilisateur_id),
  CONSTRAINT fk_historique_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_historique_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 15. JOUR_FERIE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jour_ferie (
  id_jour_ferie INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  date_ferie    DATE NOT NULL,
  libelle       VARCHAR(150) NOT NULL,
  UNIQUE KEY uq_jour_ferie (date_ferie)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 16. NOTIFICATION
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification (
  id_notification INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  utilisateur_id  INT UNSIGNED NOT NULL,
  planning_id     INT UNSIGNED DEFAULT NULL,
  titre           VARCHAR(150) NOT NULL,
  message         TEXT NOT NULL,
  lu              TINYINT(1) NOT NULL DEFAULT 0,
  date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notification_lu (utilisateur_id, lu),
  CONSTRAINT fk_notification_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notification_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- VUES
-- =====================================================================

-- Durée de chaque créneau en heures
CREATE OR REPLACE VIEW v_duree_creneau AS
SELECT c.id_creneau, c.affectation_id, c.type_creneau,
       c.heure_entree, c.heure_sortie,
       ROUND(TIMESTAMPDIFF(MINUTE, c.heure_entree, c.heure_sortie) / 60, 2) AS duree_heures
FROM creneau_travail c;

-- Durée travaillée par jour et par employé
CREATE OR REPLACE VIEW v_duree_jour AS
SELECT a.id_affectation, a.planning_id, a.employe_id, a.date_jour, a.statut,
       ROUND(COALESCE(SUM(v.duree_heures), 0), 2) AS heures_jour
FROM affectation a
LEFT JOIN v_duree_creneau v ON v.affectation_id = a.id_affectation
GROUP BY a.id_affectation, a.planning_id, a.employe_id, a.date_jour, a.statut;

-- Total hebdomadaire par employé et planning (contrat backend/frontend :
-- colonnes id_planning, id_employe, nom, reference_hebdo,
-- total_heures_semaine, depassement)
CREATE OR REPLACE VIEW v_total_hebdo_employe AS
SELECT
  a.planning_id AS id_planning,
  a.employe_id  AS id_employe,
  e.nom         AS nom,
  e.reference_hebdo,
  ROUND(COALESCE(SUM(
    CASE WHEN a.statut = 'TRAVAIL'
         THEN (TIME_TO_SEC(c.heure_sortie) - TIME_TO_SEC(c.heure_entree)) / 3600
         ELSE 0 END
  ), 0), 2) AS total_heures_semaine,
  (ROUND(COALESCE(SUM(
    CASE WHEN a.statut = 'TRAVAIL'
         THEN (TIME_TO_SEC(c.heure_sortie) - TIME_TO_SEC(c.heure_entree)) / 3600
         ELSE 0 END
  ), 0), 2) > e.reference_hebdo) AS depassement
FROM affectation a
JOIN employe e ON e.id_employe = a.employe_id
LEFT JOIN creneau_travail c ON c.affectation_id = a.id_affectation
GROUP BY a.planning_id, a.employe_id, e.nom, e.reference_hebdo;

-- Emploi du temps généré : 1 ligne par employé/jour, créneaux par période
-- (base de la génération automatique de l'emploi du temps)
CREATE OR REPLACE VIEW v_emploi_du_temps AS
SELECT
  p.id_planning,
  p.service_id,
  p.numero_semaine,
  p.annee,
  a.employe_id,
  e.nom          AS employe_nom,
  e.matricule,
  a.date_jour,
  DAYNAME(a.date_jour) AS jour_libelle,
  a.statut       AS statut_jour,
  MAX(CASE WHEN c.type_creneau = 'MATIN'      THEN CONCAT(TIME_FORMAT(c.heure_entree,'%H:%i'), '-', TIME_FORMAT(c.heure_sortie,'%H:%i')) END) AS matin,
  MAX(CASE WHEN c.type_creneau = 'APRES_MIDI' THEN CONCAT(TIME_FORMAT(c.heure_entree,'%H:%i'), '-', TIME_FORMAT(c.heure_sortie,'%H:%i')) END) AS apres_midi,
  MAX(CASE WHEN c.type_creneau = 'SOIR'       THEN CONCAT(TIME_FORMAT(c.heure_entree,'%H:%i'), '-', TIME_FORMAT(c.heure_sortie,'%H:%i')) END) AS soir,
  ROUND(COALESCE(SUM(
    CASE WHEN a.statut = 'TRAVAIL'
         THEN (TIME_TO_SEC(c.heure_sortie) - TIME_TO_SEC(c.heure_entree)) / 3600
         ELSE 0 END
  ), 0), 2) AS heures_jour
FROM planning p
JOIN affectation a   ON a.planning_id = p.id_planning
JOIN employe e       ON e.id_employe  = a.employe_id
LEFT JOIN creneau_travail c ON c.affectation_id = a.id_affectation
GROUP BY p.id_planning, p.service_id, p.numero_semaine, p.annee,
         a.employe_id, e.nom, e.matricule, a.date_jour, a.statut
ORDER BY p.id_planning, a.date_jour, e.nom;

-- =====================================================================
-- TRIGGERS : règles métier appliquées EN BASE
-- =====================================================================
DELIMITER //

-- (a) Créneau : cohérence horaire, conflits d'horaires
DROP TRIGGER IF EXISTS trg_creneau_bi//
CREATE TRIGGER trg_creneau_bi BEFORE INSERT ON creneau_travail
FOR EACH ROW
BEGIN
  DECLARE v_planning_id INT UNSIGNED;
  DECLARE v_statut      VARCHAR(20);
  DECLARE v_date_jour   DATE;
  DECLARE v_employe_id  INT UNSIGNED;
  DECLARE v_chevauche   INT DEFAULT 0;
  DECLARE v_periodes    INT DEFAULT 0;

  -- Le créneau doit respecter entree < sortie (pas de nuit traversante ici)
  IF NEW.heure_sortie <= NEW.heure_entree THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'heure_sortie doit etre superieure a heure_entree';
  END IF;

  SELECT a.planning_id, a.statut, a.date_jour, a.employe_id
    INTO v_planning_id, v_statut, v_date_jour, v_employe_id
  FROM affectation a
  WHERE a.id_affectation = NEW.affectation_id;

  -- L'affectation doit etre en TRAVAIL pour avoir des creneaux
  IF v_statut <> 'TRAVAIL' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Impossible : affectation non travail (REPOS/ABSENCE/CONGE)';
  END IF;

  -- La date doit appartenir a la semaine du planning
  IF NOT EXISTS (
    SELECT 1 FROM planning p
    WHERE p.id_planning = v_planning_id
      AND v_date_jour BETWEEN p.date_debut_semaine AND p.date_fin_semaine
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Date hors de la semaine du planning';
  END IF;

  -- Maximum 3 creneaux (MATIN, APRES_MIDI, SOIR) par jour
  SELECT COUNT(*) INTO v_periodes
  FROM creneau_travail c
  JOIN affectation a2 ON a2.id_affectation = c.affectation_id
  WHERE a2.planning_id = v_planning_id
    AND a2.employe_id  = v_employe_id
    AND a2.date_jour   = v_date_jour;

  IF v_periodes >= 3 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Maximum 3 creneaux (matin, apres-midi, soir) par jour';
  END IF;

  -- Conflit d'horaires : chevauchement avec un creneau existant du meme jour
  SELECT COUNT(*) INTO v_chevauche
  FROM creneau_travail c
  JOIN affectation a2 ON a2.id_affectation = c.affectation_id
  WHERE a2.planning_id = v_planning_id
    AND a2.employe_id  = v_employe_id
    AND a2.date_jour   = v_date_jour
    AND NEW.heure_entree < c.heure_sortie
    AND NEW.heure_sortie > c.heure_entree;

  IF v_chevauche > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Conflit d''horaires : chevauchement avec un creneau existant';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_creneau_bu//
CREATE TRIGGER trg_creneau_bu BEFORE UPDATE ON creneau_travail
FOR EACH ROW
BEGIN
  DECLARE v_planning_id INT UNSIGNED;
  DECLARE v_statut      VARCHAR(20);
  DECLARE v_date_jour   DATE;
  DECLARE v_employe_id  INT UNSIGNED;
  DECLARE v_chevauche   INT DEFAULT 0;

  IF NEW.heure_sortie <= NEW.heure_entree THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'heure_sortie doit etre superieure a heure_entree';
  END IF;

  SELECT a.planning_id, a.statut, a.date_jour, a.employe_id
    INTO v_planning_id, v_statut, v_date_jour, v_employe_id
  FROM affectation a
  WHERE a.id_affectation = NEW.affectation_id;

  IF v_statut <> 'TRAVAIL' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Impossible : affectation non travail (REPOS/ABSENCE/CONGE)';
  END IF;

  -- Conflit d'horaires : chevauchement avec un creneau existant du meme jour
  SELECT COUNT(*) INTO v_chevauche
  FROM creneau_travail c
  JOIN affectation a2 ON a2.id_affectation = c.affectation_id
  WHERE a2.planning_id = v_planning_id
    AND a2.employe_id  = v_employe_id
    AND a2.date_jour   = v_date_jour
    AND c.id_creneau  <> NEW.id_creneau
    AND NEW.heure_entree < c.heure_sortie
    AND NEW.heure_sortie > c.heure_entree;

  IF v_chevauche > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Conflit d''horaires : chevauchement avec un creneau existant';
  END IF;
END//

-- (b) Affectation : date bornee a la semaine + incoherences statut/creneaux
DROP TRIGGER IF EXISTS trg_affectation_bi//
CREATE TRIGGER trg_affectation_bi BEFORE INSERT ON affectation
FOR EACH ROW
BEGIN
  DECLARE v_debut DATE;
  DECLARE v_fin   DATE;
  DECLARE v_creneaux INT DEFAULT 0;

  SELECT p.date_debut_semaine, p.date_fin_semaine INTO v_debut, v_fin
  FROM planning p WHERE p.id_planning = NEW.planning_id;

  IF NEW.date_jour < v_debut OR NEW.date_jour > v_fin THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Date d''affectation hors de la semaine du planning';
  END IF;

  IF NEW.statut <> 'TRAVAIL' THEN
    SELECT COUNT(*) INTO v_creneaux
    FROM creneau_travail c WHERE c.affectation_id = NEW.id_affectation;
    IF v_creneaux > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Affectation non travail avec creneaux existants';
    END IF;
  END IF;
END//

-- (c) Validation RH : reservee aux comptes RH
DROP TRIGGER IF EXISTS trg_validation_rh_bi//
CREATE TRIGGER trg_validation_rh_bi BEFORE INSERT ON validation_rh
FOR EACH ROW
BEGIN
  DECLARE v_role VARCHAR(20);
  SELECT u.role INTO v_role FROM utilisateur u WHERE u.id_utilisateur = NEW.rh_id;
  IF v_role <> 'RH' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Seul un compte RH peut valider un planning';
  END IF;
END//

-- (d) Congé : décision => valide_par RH obligatoire ; décision tracée
DROP TRIGGER IF EXISTS trg_conge_bi//
CREATE TRIGGER trg_conge_bi BEFORE INSERT ON conge
FOR EACH ROW
BEGIN
  DECLARE v_role VARCHAR(20);
  IF NEW.statut IN ('VALIDE','REFUSE') THEN
    IF NEW.valide_par IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Un conge valide/refuse doit mentionner le RH decisionnaire';
    END IF;
    SELECT u.role INTO v_role FROM utilisateur u WHERE u.id_utilisateur = NEW.valide_par;
    IF v_role <> 'RH' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Seul un compte RH peut valider ou refuser un conge';
    END IF;
    IF NEW.date_decision IS NULL THEN
      SET NEW.date_decision = NOW();
    END IF;
  END IF;
END//

DROP TRIGGER IF EXISTS trg_conge_bu//
CREATE TRIGGER trg_conge_bu BEFORE UPDATE ON conge
FOR EACH ROW
BEGIN
  DECLARE v_role VARCHAR(20);
  IF NEW.statut <> OLD.statut AND NEW.statut IN ('VALIDE','REFUSE') THEN
    IF NEW.valide_par IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Un conge valide/refuse doit mentionner le RH decisionnaire';
    END IF;
    SELECT u.role INTO v_role FROM utilisateur u WHERE u.id_utilisateur = NEW.valide_par;
    IF v_role <> 'RH' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Seul un compte RH peut valider ou refuser un conge';
    END IF;
    IF NEW.date_decision IS NULL THEN
      SET NEW.date_decision = NOW();
    END IF;
  END IF;
END//

-- (e) Récupération : saisie réservée aux RH et chefs de service
DROP TRIGGER IF EXISTS trg_recuperation_bi//
CREATE TRIGGER trg_recuperation_bi BEFORE INSERT ON recuperation
FOR EACH ROW
BEGIN
  DECLARE v_role VARCHAR(20);
  SELECT u.role INTO v_role FROM utilisateur u WHERE u.id_utilisateur = NEW.saisi_par;
  IF v_role NOT IN ('RH','ADMIN','CHEF_SERVICE') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Seuls RH, ADMIN ou CHEF_SERVICE peuvent enregistrer une recuperation';
  END IF;
END//

-- (f) Utilisateur : un chef de service doit appartenir a un service
DROP TRIGGER IF EXISTS trg_utilisateur_bi//
CREATE TRIGGER trg_utilisateur_bi BEFORE INSERT ON utilisateur
FOR EACH ROW
BEGIN
  IF NEW.role = 'CHEF_SERVICE' AND NEW.service_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un chef de service doit etre rattache a un service';
  END IF;
END//

DROP TRIGGER IF EXISTS trg_utilisateur_bu//
CREATE TRIGGER trg_utilisateur_bu BEFORE UPDATE ON utilisateur
FOR EACH ROW
BEGIN
  IF NEW.role = 'CHEF_SERVICE' AND NEW.service_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un chef de service doit etre rattache a un service';
  END IF;
END//

DELIMITER ;

SET FOREIGN_KEY_CHECKS = 1;
