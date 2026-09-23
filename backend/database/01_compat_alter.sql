-- =====================================================================
-- ZOMATEL - Mise a niveau de la base EXISTANTE pour le code applicatif
-- Non destructif : ajoute uniquement les colonnes/index manquants.
-- A executer UNE SEULE FOIS :
--   mysql -u root zomatel_planning < backend/database/01_compat_alter.sql
-- =====================================================================
USE zomatel_planning;

-- ---------------------------------------------------------------------
-- SERVICE : type d'affichage du planning (periodes fixes ou horaire libre)
-- ---------------------------------------------------------------------
ALTER TABLE service
  ADD COLUMN type_affichage ENUM('PERIODES_FIXES','HORAIRE_LIBRE')
    NOT NULL DEFAULT 'PERIODES_FIXES' AFTER nom_service;

-- ---------------------------------------------------------------------
-- UTILISATEUR : login distinct du nom affiche + prenom + activation
--   (nom_utilisateur reste le nom affiche ; login sert a la connexion)
-- ---------------------------------------------------------------------
ALTER TABLE utilisateur
  ADD COLUMN login VARCHAR(100) NULL AFTER nom_utilisateur,
  ADD COLUMN prenom VARCHAR(100) NULL AFTER login,
  ADD COLUMN actif TINYINT(1) NOT NULL DEFAULT 1 AFTER service_id;

-- Le compte "admin" existe deja : son login devient "admin"
UPDATE utilisateur SET login = nom_utilisateur WHERE login IS NULL;
ALTER TABLE utilisateur MODIFY COLUMN login VARCHAR(100) NOT NULL;
ALTER TABLE utilisateur ADD UNIQUE KEY uq_utilisateur_login (login);

-- ---------------------------------------------------------------------
-- EMPLOYE : fonction et date d'entree
-- ---------------------------------------------------------------------
ALTER TABLE employe
  ADD COLUMN fonction VARCHAR(100) NULL AFTER statut,
  ADD COLUMN date_entree DATE NULL AFTER fonction,
  ADD COLUMN actif TINYINT(1) NOT NULL DEFAULT 1 AFTER date_entree;

-- ---------------------------------------------------------------------
-- PLANNING : annee + numero de semaine ISO (calcules depuis la date)
-- ---------------------------------------------------------------------
ALTER TABLE planning
  ADD COLUMN annee SMALLINT UNSIGNED NULL AFTER service_id,
  ADD COLUMN numero_semaine TINYINT UNSIGNED NULL AFTER annee;

UPDATE planning
SET annee = YEAR(date_debut_semaine),
    numero_semaine = WEEK(date_debut_semaine, 1);  -- mode ISO

ALTER TABLE planning
  MODIFY COLUMN annee SMALLINT UNSIGNED NOT NULL,
  MODIFY COLUMN numero_semaine TINYINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_planning_annee_semaine (service_id, annee, numero_semaine);

-- ---------------------------------------------------------------------
-- AFFECTATION : ajoute le statut CONGE + colonne observation
--   (la colonne "commentaire" existante sert d'observation)
-- ---------------------------------------------------------------------
ALTER TABLE affectation
  MODIFY COLUMN statut ENUM('TRAVAIL','REPOS','ABSENCE','CONGE') NOT NULL;

-- ---------------------------------------------------------------------
-- VUE v_total_hebdo_employe : total hebdo par employe/planning
--   Colonnes attendues par le frontend :
--   id_planning, id_employe, nom, reference_hebdo,
--   total_heures_semaine, depassement (0/1)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_total_hebdo_employe AS
SELECT
  a.planning_id                          AS id_planning,
  a.employe_id                           AS id_employe,
  e.nom                                  AS nom,
  e.reference_hebdo                      AS reference_hebdo,
  ROUND(COALESCE(SUM(
    CASE WHEN a.statut = 'TRAVAIL'
         THEN (TIME_TO_SEC(c.heure_sortie) - TIME_TO_SEC(c.heure_entree)) / 3600
         ELSE 0 END
  ), 0), 2)                              AS total_heures_semaine,
  (ROUND(COALESCE(SUM(
    CASE WHEN a.statut = 'TRAVAIL'
         THEN (TIME_TO_SEC(c.heure_sortie) - TIME_TO_SEC(c.heure_entree)) / 3600
         ELSE 0 END
  ), 0), 2) > e.reference_hebdo)         AS depassement
FROM affectation a
JOIN employe e ON e.id_employe = a.employe_id
LEFT JOIN creneau_travail c ON c.affectation_id = a.id_affectation
GROUP BY a.planning_id, a.employe_id, e.nom, e.reference_hebdo;
