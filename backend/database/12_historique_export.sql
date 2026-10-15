-- =====================================================================
-- 12_historique_export.sql — traçage des EXPORTS EXCEL des plannings
-- Exigence « Historique — plannings exportés » : chaque export réussi
-- (simple ou multi-services) est enregistré avec la date, l'heure,
-- l'utilisateur, le fichier produit, la semaine, le(s) service(s) et
-- la liste des plannings exportés.
-- Un fichier regroupant plusieurs services d'une MÊME semaine est
-- enregistré comme export MULTI (type_export + liste des services).
--
-- ADDITIVE et IDEMPOTENTE : table nouvelle, aucune donnée, table ou
-- permission existante modifiée ni supprimée.
--
-- Usage : mysql -u root gestion_plannings_hotel < backend/database/12_historique_export.sql
--         (ou via scripts/migrate-12-historique-export.js)
-- =====================================================================
USE gestion_plannings_hotel;

CREATE TABLE IF NOT EXISTS historique_export (
  id_export      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  utilisateur_id INT UNSIGNED NOT NULL,
  type_export    ENUM('SIMPLE','MULTI') NOT NULL DEFAULT 'SIMPLE',
  numero_semaine INT NOT NULL,
  annee          INT NOT NULL,
  nb_plannings   INT UNSIGNED NOT NULL DEFAULT 0,
  nom_fichier    VARCHAR(255) NOT NULL,
  details        JSON DEFAULT NULL, -- liste des plannings exportés
  -- [{id_planning, service, numero_semaine}]
  date_export    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY fk_hexport_utilisateur (utilisateur_id),
  KEY idx_hexport_date (date_export),
  CONSTRAINT fk_hexport_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vérification finale (lecture seule)
SHOW COLUMNS FROM historique_export;
