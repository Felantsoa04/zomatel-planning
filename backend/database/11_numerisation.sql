-- =====================================================================
-- ZOMATEL - Migration 11 : numérisation des plannings papier (OCR)
-- ADDITIVE uniquement : aucune table, colonne, donnée ou permission
-- existante n'est modifiée ni supprimée.
-- Usage direct : mysql -u root zomatel_planning < backend/database/11_numerisation.sql
-- (ou via le script idempotent : node scripts/migrate-11-numerisation.js)
-- =====================================================================
USE zomatel_planning;

-- ---------------------------------------------------------------------
-- PLANNING_SCAN : un document papier importé (photo/scan) par la RH.
--   statut : RECUE -> OCR_EN_COURS -> OCR_FAITE -> CONFIRME (->XRplanning
--            BROUILLON créé) ; ERREUR / ANNULE pour les documents rebutés.
--   donnees_ocr      : JSON brut de la reconnaissance (jamais modifié)
--   donnees_corrigees: JSON vérifié/corrigé par la RH (source de la
--            confirmation ; null tant que la RH n'a pas vérifié)
--   id_planning : planning BROUILLON créé après confirmation
--   (ON DELETE SET NULL : la suppression d'un planning n'efface JAMAIS
--   la trace du document — règle projet : ne rien détruire).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planning_scan (
  id_scan            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  utilisateur_id     INT UNSIGNED NOT NULL,
  nom_fichier        VARCHAR(255) NOT NULL,
  chemin_fichier     VARCHAR(500) NOT NULL,
  type_mime          VARCHAR(100) NOT NULL,
  taille_octets      INT UNSIGNED NOT NULL,
  statut             ENUM('RECUE','OCR_EN_COURS','OCR_FAITE','CONFIRME','ERREUR','ANNULE')
                       NOT NULL DEFAULT 'RECUE',
  progression        INT UNSIGNED NOT NULL DEFAULT 0,
  message_erreur     VARCHAR(500) DEFAULT NULL,
  service_id         INT UNSIGNED DEFAULT NULL,
  numero_semaine     TINYINT UNSIGNED DEFAULT NULL,
  annee              SMALLINT UNSIGNED DEFAULT NULL,
  date_debut_semaine DATE DEFAULT NULL,
  donnees_ocr        LONGTEXT DEFAULT NULL,
  donnees_corrigees  LONGTEXT DEFAULT NULL,
  id_planning        INT UNSIGNED DEFAULT NULL,
  date_reception     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_ocr           DATETIME DEFAULT NULL,
  date_confirmation  DATETIME DEFAULT NULL,
  KEY idx_scan_statut (statut),
  KEY idx_scan_semaine (annee, numero_semaine),
  CONSTRAINT fk_scan_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON UPDATE CASCADE,
  CONSTRAINT fk_scan_service FOREIGN KEY (service_id)
    REFERENCES service(id_service) ON UPDATE CASCADE,
  CONSTRAINT fk_scan_planning FOREIGN KEY (id_planning)
    REFERENCES planning(id_planning) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Permission dédiée à la numérisation (même modèle que migration 10) :
-- attribuée aux comptes RH existants, jamais retirée à personne.
-- ---------------------------------------------------------------------
INSERT INTO permissions (code, nom, description)
VALUES ('numerisation.use', 'Numériser les plannings papier (RH)',
        'Importer des plannings papier scannés, corriger l\'OCR et créer les plannings')
ON DUPLICATE KEY UPDATE nom = VALUES(nom), description = VALUES(description);

INSERT IGNORE INTO utilisateur_permission (utilisateur_id, permission_id)
SELECT u.id_utilisateur, p.id
FROM utilisateur u
JOIN permissions p ON p.code = 'numerisation.use'
WHERE u.role = 'RH';
