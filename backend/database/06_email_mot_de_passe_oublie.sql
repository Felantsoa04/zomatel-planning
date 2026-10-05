-- =====================================================================
-- 06_email_mot_de_passe_oublie.sql — migration MINIMALE ET ADDITIVE
-- 1. Colonne utilisateur.email : VARCHAR(255) NULL UNIQUE
--    (exigence 21 : NE PAS creer de nouvelle table pour les emails ;
--    aucun compte existant n'est modifie ni supprime).
-- 2. Table password_resets : codes de recuperation de mot de passe.
--    - code_hash : le code n'est JAMAIS stocke en clair (sha256) ;
--    - expire a NOW() + 15 minutes ;
--    - usage UNIQUE (utilise = 1) et invalide apres usage ;
--    - un nouveau code invalide les anciens du meme compte.
-- Idempotente et rejouable sans danger (aucune donnee perdue).
-- Usage : mysql -u root gestion_plannings_hotel < backend/database/06_email_mot_de_passe_oublie.sql
-- =====================================================================
USE gestion_plannings_hotel;

-- ---------------------------------------------------------------------
-- 1. Colonne utilisateur.email (VARCHAR(255) NULL UNIQUE)
--    MariaDB ne supporte pas "ADD COLUMN IF NOT EXISTS" de facon portable :
--    requete construite conditionnellement (pattern 04_photo_profil.sql).
-- ---------------------------------------------------------------------
SET @sql_email = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE utilisateur ADD COLUMN email VARCHAR(255) DEFAULT NULL AFTER login',
    'SELECT ''Colonne email deja presente'' AS info'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'utilisateur'
    AND COLUMN_NAME  = 'email'
);
PREPARE stmt FROM @sql_email;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index UNIQUE (permet plusieurs NULL : les comptes sans email restent valides)
SET @sql_uk = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE utilisateur ADD UNIQUE KEY uq_utilisateur_email (email)',
    'SELECT ''Index uq_utilisateur_email deja present'' AS info'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'utilisateur'
    AND INDEX_NAME   = 'uq_utilisateur_email'
);
PREPARE stmt FROM @sql_uk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. Table password_resets (codes de recuperation, JAMAIS en clair)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  utilisateur_id INT UNSIGNED NOT NULL,
  code_hash     CHAR(64) NOT NULL,              -- sha256 hex (code jamais en clair)
  expire_a      DATETIME NOT NULL,              -- NOW() + 15 minutes a la creation
  utilise       TINYINT(1) NOT NULL DEFAULT 0,  -- usage unique
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pr_utilisateur (utilisateur_id),
  KEY idx_pr_code (code_hash),
  CONSTRAINT fk_pr_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. Verification finale
-- ---------------------------------------------------------------------
SELECT 'colonne utilisateur.email' AS element,
       COUNT(*) AS present
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'utilisateur' AND COLUMN_NAME = 'email'
UNION ALL
SELECT 'table password_resets', COUNT(*) FROM password_resets;
