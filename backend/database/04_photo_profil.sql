-- =====================================================================
-- 04_photo_profil.sql — photo de profil (migration minimale)
-- Ajoute UNIQUEMENT la colonne photo_profil a la table utilisateur.
-- - chemin RELATIF servi par Express (ex. /uploads/profiles/user_1_1690000000.jpg)
-- - NULL = aucune photo (avatar par defaut affiche cote frontend)
-- - aucun role, aucune permission, aucune autre colonne modifies
-- Re-jouable sans danger (IF NOT EXISTS sur la colonne via INFORMATION_SCHEMA).
-- =====================================================================

-- MariaDB ne supporte pas "ADD COLUMN IF NOT EXISTS" de facon portable :
-- on construit la requete conditionnellement.
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE utilisateur ADD COLUMN photo_profil VARCHAR(255) DEFAULT NULL AFTER actif',
    'SELECT ''Colonne photo_profil deja presente'' AS info'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'utilisateur'
    AND COLUMN_NAME  = 'photo_profil'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
