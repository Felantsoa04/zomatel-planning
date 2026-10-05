-- =====================================================================
-- ZOMATEL - Migration 03 : permissions par utilisateur (RBAC)
-- ADDITIVE uniquement : aucune donnee existante n'est modifiee ni supprimee.
-- Les droits ACTUELS de chaque compte (issus de son role) sont copies en
-- permissions individuelles a la migration -> zero regression.
-- A executer UNE SEULE FOIS :
--   mysql -u root gestion_plannings_hotel < backend/database/03_permissions.sql
-- =====================================================================
USE gestion_plannings_hotel;

-- 1. Catalogue des permissions = fonctionnalites REELLES du projet
--    (une ligne par route existante verifiee dans backend/src/routes/).
--    Le catalogue est complet AVANT l'initialisation (etape 3).
CREATE TABLE IF NOT EXISTS permission (
  code         VARCHAR(60) PRIMARY KEY,
  libelle      VARCHAR(120) NOT NULL,
  categorie    VARCHAR(40)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permission (code, libelle, categorie) VALUES
  ('employes.lire',           'Consulter les employes',              'Employes'),
  ('employes.gerer',          'Ajouter/modifier/desactiver les employes', 'Employes'),
  ('services.gerer',          'Gerer les services',                  'Services'),
  ('plannings.lire_tous',     'Consulter tous les plannings',        'Plannings'),
  ('plannings.gerer_service', 'Gerer les plannings de SON service',  'Plannings'),
  ('plannings.valider',       'Valider / refuser les plannings',     'Plannings'),
  ('plannings.rouvrir',       'Rouvrir un planning valide',          'Plannings'),
  ('utilisateurs.lire',       'Consulter les comptes utilisateurs',  'Utilisateurs'),
  ('utilisateurs.gerer',      'Gerer les comptes utilisateurs',      'Utilisateurs')
ON DUPLICATE KEY UPDATE libelle = VALUES(libelle), categorie = VALUES(categorie);

-- 2. Permissions individuelles (UNE ligne par utilisateur x permission)
CREATE TABLE IF NOT EXISTS utilisateur_permission (
  id_utilisateur INT UNSIGNED NOT NULL,
  code           VARCHAR(60)  NOT NULL,
  PRIMARY KEY (id_utilisateur, code),
  CONSTRAINT fk_up_utilisateur FOREIGN KEY (id_utilisateur)
    REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_up_permission FOREIGN KEY (code)
    REFERENCES permission(code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Initialisation : les droits ACTUELS de chaque role, copies tels quels
--    (identiques aux requireRole() verifiees dans les routes existantes).
INSERT IGNORE INTO utilisateur_permission (id_utilisateur, code)
SELECT u.id_utilisateur, p.code
FROM utilisateur u
JOIN permission p ON (
     (u.role = 'ADMIN')                      -- acces global (permis existants)
  OR (u.role = 'RH' AND p.code IN (
       'employes.lire','employes.gerer','services.gerer',
       'plannings.lire_tous','plannings.valider','plannings.rouvrir',
       'utilisateurs.lire','utilisateurs.gerer'))
  OR (u.role = 'CHEF_SERVICE' AND p.code IN (
       'employes.lire','employes.gerer','plannings.gerer_service'))
  -- EMPLOYE : aucune permission globale. Sa consultation personnelle passe
  -- par les routes dediees /employes/me/* (authRequired, auto-restreintes).
);

-- 4. Verification
SELECT u.login, u.role, u.actif, GROUP_CONCAT(up.code ORDER BY up.code) AS permissions
FROM utilisateur u
LEFT JOIN utilisateur_permission up ON up.id_utilisateur = u.id_utilisateur
GROUP BY u.id_utilisateur, u.login, u.role, u.actif
ORDER BY u.role, u.login;
