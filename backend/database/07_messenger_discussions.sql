-- =====================================================================
-- 07_messenger_discussions.sql — gestion des discussions Messenger
-- Actions demandees par l'interface : EPINGLER / ARCHIVER / SUPPRIMER une
-- discussion (etat PAR MEMBRE : chacun gere sa propre liste, l'autre
-- membre n'est jamais affecte).
--
-- AJOUTATIF et IDEMPOTENT : trois colonnes TINYINT sur la table EXISTANTE
-- conversation_membres. Aucune donnee existante modifiee ni supprimee,
-- aucune autre table touchée, aucune permission ajoutée.
--   epinglee  : discussion placee en haut de la liste du membre
--   archivee  : discussion retiree de la liste principale, conservee dans
--               la section « Archivees » (messages intacts)
--   supprimee : discussion masquee de la liste du membre (« Supprimer »).
--               Les messages restent en base : si l'autre membre ecrit a
--               nouveau, la discussion reaparait (flag remis a 0).
--
-- Usage : mysql -u root gestion_plannings_hotel < backend/database/07_messenger_discussions.sql
--         (ou via scripts/migrate-07-discussions.js)
-- =====================================================================
USE gestion_plannings_hotel;

-- ---------------------------------------------------------------------
-- Colonnes ajoutees une par une, uniquement si absentes (portable :
-- INFORMATION_SCHEMA + requete preparee, meme pattern que 04_photo_profil)
-- ---------------------------------------------------------------------
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE conversation_membres ADD COLUMN epinglee TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT ''Colonne epinglee deja presente'' AS info'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'conversation_membres'
    AND COLUMN_NAME  = 'epinglee'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE conversation_membres ADD COLUMN archivee TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT ''Colonne archivee deja presente'' AS info'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'conversation_membres'
    AND COLUMN_NAME  = 'archivee'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE conversation_membres ADD COLUMN supprimee TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT ''Colonne supprimee deja presente'' AS info'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'conversation_membres'
    AND COLUMN_NAME  = 'supprimee'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- Verification finale
-- ---------------------------------------------------------------------
SHOW COLUMNS FROM conversation_membres;
