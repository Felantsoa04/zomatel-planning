-- =====================================================================
-- ZOMATEL PLANNING - Creation base + utilisateur applicatif
-- A executer une seule fois avec un compte admin :
--   mysql -u root -p < backend/database/00_create_db.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS zomatel_planning
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Mot de passe a changer avant toute mise en production
CREATE USER IF NOT EXISTS 'zomatel_app'@'localhost' IDENTIFIED BY 'zomatel_dev_2026';
GRANT ALL PRIVILEGES ON zomatel_planning.* TO 'zomatel_app'@'localhost';
FLUSH PRIVILEGES;
