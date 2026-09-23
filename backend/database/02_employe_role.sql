-- =====================================================================
-- ZOMATEL - Migration 02 : role EMPLOYE + lien utilisateur -> employe
-- Non destructif : elargit l'enum 'role' et ajoute une colonne nullable.
-- A executer UNE SEULE FOIS :
--   mysql -u root gestion_plannings_hotel < backend/database/02_employe_role.sql
-- =====================================================================
USE gestion_plannings_hotel;

-- 1. Le role EMPLOYE rejoint les roles existants (ADMIN / RH / CHEF_SERVICE)
ALTER TABLE utilisateur
  MODIFY COLUMN role ENUM('ADMIN','RH','CHEF_SERVICE','EMPLOYE') NOT NULL;

-- 2. Lien d'un compte utilisateur vers SA fiche employe (consultation personnelle)
ALTER TABLE utilisateur
  ADD COLUMN IF NOT EXISTS id_employe INT UNSIGNED NULL AFTER service_id,
  ADD CONSTRAINT fk_utilisateur_employe FOREIGN KEY (id_employe)
    REFERENCES employe(id_employe) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD UNIQUE KEY uq_utilisateur_employe (id_employe);

-- 3. Verification
SELECT id_utilisateur, nom_utilisateur, login, role, service_id, id_employe, actif
FROM utilisateur ORDER BY id_utilisateur;
