-- =====================================================================
-- ZOMATEL PLANNING - Schema de reference MariaDB (base existante)
-- Reflete l'etat reel de la base zomatel_planning apres application
-- de 01_compat_alter.sql. Pour une installation neuve :
--   1) mysql -u root -p < backend/database/00_create_db.sql
--   2) mysql -u root -p zomatel_planning < backend/database/schema.sql
-- =====================================================================
USE zomatel_planning;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- SERVICE : type_affichage distingue les plannings a periodes fixes
--   (matin/apres-midi/soir, modele Excel) des grilles horaire libre
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service (
  id_service     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_service    VARCHAR(100) NOT NULL,
  type_affichage ENUM('PERIODES_FIXES','HORAIRE_LIBRE') NOT NULL DEFAULT 'PERIODES_FIXES',
  description    VARCHAR(255) DEFAULT NULL,
  date_creation  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY nom_service (nom_service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- UTILISATEUR : login = identifiant de connexion (unique),
--   nom_utilisateur = nom affiche. Roles : ADMIN, RH, CHEF_SERVICE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS utilisateur (
  id_utilisateur  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom_utilisateur VARCHAR(100) NOT NULL,
  login           VARCHAR(100) NOT NULL,
  prenom          VARCHAR(100) DEFAULT NULL,
  mot_de_passe    VARCHAR(255) NOT NULL,               -- hash bcrypt
  role            ENUM('ADMIN','RH','CHEF_SERVICE') NOT NULL,
  service_id      INT UNSIGNED DEFAULT NULL,           -- renseigne pour CHEF_SERVICE
  actif           TINYINT(1) NOT NULL DEFAULT 1,
  date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY nom_utilisateur (nom_utilisateur),
  UNIQUE KEY uq_utilisateur_login (login),
  KEY idx_utilisateur_role (role),
  KEY idx_utilisateur_service (service_id),
  CONSTRAINT fk_utilisateur_service FOREIGN KEY (service_id)
    REFERENCES service(id_service) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- EMPLOYE : personnels planifies (ne se connectent pas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employe (
  id_employe      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom             VARCHAR(150) NOT NULL,
  matricule       VARCHAR(50) DEFAULT NULL,
  statut          ENUM('TITULAIRE','STAGIAIRE') NOT NULL,
  fonction        VARCHAR(100) DEFAULT NULL,
  date_entree     DATE DEFAULT NULL,
  actif           TINYINT(1) NOT NULL DEFAULT 1,
  service_id      INT UNSIGNED NOT NULL,
  reference_hebdo DECIMAL(5,2) NOT NULL DEFAULT 44.00,
  date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY matricule (matricule),
  KEY idx_employe_service (service_id),
  CONSTRAINT fk_employe_service FOREIGN KEY (service_id)
    REFERENCES service(id_service) ON UPDATE CASCADE,
  CONSTRAINT chk_reference_hebdo CHECK (reference_hebdo > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- PLANNING : une semaine pour un service
--   Workflow : BROUILLON -> SOUMIS -> VALIDE / REJETE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planning (
  id_planning         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  service_id          INT UNSIGNED NOT NULL,
  annee               SMALLINT UNSIGNED NOT NULL,
  numero_semaine      TINYINT UNSIGNED NOT NULL,
  date_debut_semaine  DATE NOT NULL,
  date_fin_semaine    DATE NOT NULL,
  statut              ENUM('BROUILLON','SOUMIS','VALIDE','REJETE') NOT NULL DEFAULT 'BROUILLON',
  cree_par            INT UNSIGNED NOT NULL,
  date_creation       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_modification   DATETIME DEFAULT NULL,
  UNIQUE KEY uq_planning_service_semaine (service_id, date_debut_semaine),
  UNIQUE KEY uq_planning_annee_semaine (service_id, annee, numero_semaine),
  KEY fk_planning_createur (cree_par),
  KEY idx_planning_statut (statut),
  CONSTRAINT fk_planning_createur FOREIGN KEY (cree_par)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE,
  CONSTRAINT fk_planning_service FOREIGN KEY (service_id)
    REFERENCES service(id_service) ON UPDATE CASCADE,
  CONSTRAINT chk_dates_planning CHECK (date_fin_semaine >= date_debut_semaine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- AFFECTATION : un employe pour un jour d'un planning (UNIQUE)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affectation (
  id_affectation INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  planning_id    INT UNSIGNED NOT NULL,
  employe_id     INT UNSIGNED NOT NULL,
  date_jour      DATE NOT NULL,
  statut         ENUM('TRAVAIL','REPOS','ABSENCE','CONGE') NOT NULL,
  commentaire    VARCHAR(255) DEFAULT NULL,
  UNIQUE KEY uq_affectation (planning_id, employe_id, date_jour),
  KEY idx_affectation_date (date_jour),
  KEY idx_affectation_employe (employe_id),
  CONSTRAINT fk_affectation_employe FOREIGN KEY (employe_id)
    REFERENCES employe(id_employe) ON UPDATE CASCADE,
  CONSTRAINT fk_affectation_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- CRENEAU_TRAVAIL : entree/sortie d'une periode pour une affectation
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creneau_travail (
  id_creneau      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  affectation_id  INT UNSIGNED NOT NULL,
  type_creneau    ENUM('MATIN','APRES_MIDI','SOIR') NOT NULL,
  heure_entree    TIME NOT NULL,
  heure_sortie    TIME NOT NULL,
  UNIQUE KEY uq_creneau_type (affectation_id, type_creneau),
  KEY idx_creneau_type (type_creneau),
  CONSTRAINT fk_creneau_affectation FOREIGN KEY (affectation_id)
    REFERENCES affectation(id_affectation) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_creneau_horaire CHECK (heure_sortie > heure_entree)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- TYPE_HORAIRE : creneaux types (Matin 06h-14h, etc.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS type_horaire (
  id_type_horaire INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nom             VARCHAR(100) NOT NULL,
  heure_debut     TIME NOT NULL,
  heure_fin       TIME NOT NULL,
  type_creneau    ENUM('MATIN','APRES_MIDI','SOIR') NOT NULL,
  CONSTRAINT chk_type_horaire CHECK (heure_fin > heure_debut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- VALIDATION_RH : historique des decisions RH
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_rh (
  id_validation   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  planning_id     INT UNSIGNED NOT NULL,
  rh_id           INT UNSIGNED NOT NULL,
  decision        ENUM('VALIDE','REJETE') NOT NULL,
  commentaire     TEXT DEFAULT NULL,
  date_validation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY fk_validation_planning (planning_id),
  KEY fk_validation_rh (rh_id),
  CONSTRAINT fk_validation_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_validation_rh FOREIGN KEY (rh_id)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- CONTROLE_COUVERTURE : effectif requis vs reel par jour/periode
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS controle_couverture (
  id_controle     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  planning_id     INT UNSIGNED NOT NULL,
  date_jour       DATE NOT NULL,
  type_creneau    ENUM('MATIN','APRES_MIDI','SOIR') NOT NULL,
  effectif_requis INT UNSIGNED NOT NULL,
  effectif_reel   INT UNSIGNED NOT NULL,
  resultat        ENUM('SOUS_COUVERTURE','COUVERT','SUR_COUVERTURE') NOT NULL,
  date_controle   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_controle (planning_id, date_jour, type_creneau),
  CONSTRAINT fk_controle_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- HISTORIQUE_MODIFICATION : tracabilite des actions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historique_modification (
  id_historique  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  planning_id    INT UNSIGNED NOT NULL,
  utilisateur_id INT UNSIGNED NOT NULL,
  action         VARCHAR(100) NOT NULL,
  description    TEXT DEFAULT NULL,
  date_action    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY fk_historique_planning (planning_id),
  KEY fk_historique_utilisateur (utilisateur_id),
  CONSTRAINT fk_historique_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_historique_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- RECUPERATION : heures de recuperation accordees
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recuperation (
  id_recuperation   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employe_id        INT UNSIGNED NOT NULL,
  date_recuperation DATE NOT NULL,
  nombre_heures     DECIMAL(5,2) NOT NULL,
  motif             VARCHAR(255) DEFAULT NULL,
  saisi_par         INT UNSIGNED NOT NULL,
  date_saisie       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY fk_recuperation_employe (employe_id),
  KEY fk_recuperation_utilisateur (saisi_par),
  CONSTRAINT fk_recuperation_employe FOREIGN KEY (employe_id)
    REFERENCES employe(id_employe) ON UPDATE CASCADE,
  CONSTRAINT fk_recuperation_utilisateur FOREIGN KEY (saisi_par)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE,
  CONSTRAINT chk_nombre_heures_recup CHECK (nombre_heures > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- BESOIN_COUVERTURE : effectif requis par service/jour/periode
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
  CONSTRAINT chk_jour_semaine CHECK (jour_semaine BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- JOUR_FERIE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jour_ferie (
  id_jour_ferie INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  date_ferie    DATE NOT NULL,
  libelle       VARCHAR(150) NOT NULL,
  UNIQUE KEY date_ferie (date_ferie)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NOTIFICATION
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification (
  id_notification INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  utilisateur_id  INT UNSIGNED NOT NULL,
  planning_id     INT UNSIGNED DEFAULT NULL,
  titre           VARCHAR(150) NOT NULL,
  message         TEXT NOT NULL,
  lu              TINYINT(1) NOT NULL DEFAULT 0,
  date_creation   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY fk_notification_planning (planning_id),
  KEY idx_notification_lu (utilisateur_id, lu),
  CONSTRAINT fk_notification_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_notification_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- VUES : durees calculees + total hebdomadaire par employe
--   v_total_hebdo_employe : colonnes attendues par le frontend
--   (id_planning, id_employe, nom, reference_hebdo,
--    total_heures_semaine, depassement)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_duree_creneau AS
SELECT c.id_creneau, c.affectation_id, c.type_creneau,
       c.heure_entree, c.heure_sortie,
       ROUND(TIMESTAMPDIFF(MINUTE, c.heure_entree, c.heure_sortie) / 60, 2) AS duree_heures
FROM creneau_travail c;

CREATE OR REPLACE VIEW v_duree_jour AS
SELECT a.id_affectation, a.planning_id, a.employe_id, a.date_jour, a.statut,
       ROUND(COALESCE(SUM(v.duree_heures), 0), 2) AS heures_jour
FROM affectation a
LEFT JOIN v_duree_creneau v ON v.affectation_id = a.id_affectation
GROUP BY a.id_affectation, a.planning_id, a.employe_id, a.date_jour, a.statut;

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

SET FOREIGN_KEY_CHECKS = 1;
