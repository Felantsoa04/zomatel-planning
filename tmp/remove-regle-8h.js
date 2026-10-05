/**
 * Suppression de la règle 8h/jour des triggers MariaDB trg_creneau_bi/bu.
 * Conserve : entree<sortie, statut TRAVAIL, date dans la semaine, max 3 périodes,
 * refus de chevauchement. Supprime UNIQUEMENT le contrôle du total 8h/jour.
 */
const pool = require('../backend/src/config/db');

const TRG_BI = `
CREATE TRIGGER trg_creneau_bi BEFORE INSERT ON creneau_travail
FOR EACH ROW
BEGIN
  DECLARE v_planning_id INT UNSIGNED;
  DECLARE v_statut      VARCHAR(20);
  DECLARE v_date_jour   DATE;
  DECLARE v_employe_id  INT UNSIGNED;
  DECLARE v_chevauche   INT DEFAULT 0;
  DECLARE v_periodes    INT DEFAULT 0;

  IF NEW.heure_sortie <= NEW.heure_entree THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'heure_sortie doit etre superieure a heure_entree';
  END IF;

  SELECT a.planning_id, a.statut, a.date_jour, a.employe_id
    INTO v_planning_id, v_statut, v_date_jour, v_employe_id
  FROM affectation a
  WHERE a.id_affectation = NEW.affectation_id;

  IF v_statut <> 'TRAVAIL' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Impossible : affectation non travail (REPOS/ABSENCE/CONGE)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM planning p
    WHERE p.id_planning = v_planning_id
      AND v_date_jour BETWEEN p.date_debut_semaine AND p.date_fin_semaine
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Date hors de la semaine du planning';
  END IF;

  SELECT COUNT(*) INTO v_periodes
  FROM creneau_travail c
  JOIN affectation a2 ON a2.id_affectation = c.affectation_id
  WHERE a2.planning_id = v_planning_id
    AND a2.employe_id  = v_employe_id
    AND a2.date_jour   = v_date_jour;

  IF v_periodes >= 3 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Maximum 3 creneaux (matin, apres-midi, soir) par jour';
  END IF;

  SELECT COUNT(*) INTO v_chevauche
  FROM creneau_travail c
  JOIN affectation a2 ON a2.id_affectation = c.affectation_id
  WHERE a2.planning_id = v_planning_id
    AND a2.employe_id  = v_employe_id
    AND a2.date_jour   = v_date_jour
    AND NEW.heure_entree < c.heure_sortie
    AND NEW.heure_sortie > c.heure_entree;

  IF v_chevauche > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Conflit d''horaires : chevauchement avec un creneau existant';
  END IF;
END`;

const TRG_BU = `
CREATE TRIGGER trg_creneau_bu BEFORE UPDATE ON creneau_travail
FOR EACH ROW
BEGIN
  DECLARE v_planning_id INT UNSIGNED;
  DECLARE v_statut      VARCHAR(20);
  DECLARE v_date_jour   DATE;
  DECLARE v_employe_id  INT UNSIGNED;
  DECLARE v_chevauche   INT DEFAULT 0;

  IF NEW.heure_sortie <= NEW.heure_entree THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'heure_sortie doit etre superieure a heure_entree';
  END IF;

  SELECT a.planning_id, a.statut, a.date_jour, a.employe_id
    INTO v_planning_id, v_statut, v_date_jour, v_employe_id
  FROM affectation a
  WHERE a.id_affectation = NEW.affectation_id;

  IF v_statut <> 'TRAVAIL' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Impossible : affectation non travail (REPOS/ABSENCE/CONGE)';
  END IF;

  SELECT COUNT(*) INTO v_chevauche
  FROM creneau_travail c
  JOIN affectation a2 ON a2.id_affectation = c.affectation_id
  WHERE a2.planning_id = v_planning_id
    AND a2.employe_id  = v_employe_id
    AND a2.date_jour   = v_date_jour
    AND c.id_creneau  <> NEW.id_creneau
    AND NEW.heure_entree < c.heure_sortie
    AND NEW.heure_sortie > c.heure_entree;

  IF v_chevauche > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Conflit d''horaires : chevauchement avec un creneau existant';
  END IF;
END`;

(async () => {
  // 1. État avant : triggers contenant encore la règle 8h
  const [avant] = await pool.query(
    `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND ACTION_STATEMENT LIKE '%8h/jour%'`
  );
  console.log('Triggers avec regle 8h avant :', avant.map((t) => t.TRIGGER_NAME).join(', ') || '(aucun)');

  // 2. Suppression + recréation sans la règle 8h
  await pool.query('DROP TRIGGER IF EXISTS trg_creneau_bi');
  await pool.query('DROP TRIGGER IF EXISTS trg_creneau_bu');
  await pool.query(TRG_BI);
  await pool.query(TRG_BU);
  console.log('Triggers recrees sans la regle 8h/jour.');

  // 3. Vérification après
  const [apres] = await pool.query(
    `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND ACTION_STATEMENT LIKE '%8h/jour%'`
  );
  console.log('Triggers avec regle 8h apres :', apres.length === 0 ? '(aucun) OK' : apres.map((t) => t.TRIGGER_NAME).join(', '));

  const [liste] = await pool.query(
    `SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME`
  );
  console.log('Triggers restants :');
  for (const t of liste) console.log(`  - ${t.TRIGGER_NAME} (${t.EVENT_MANIPULATION} sur ${t.EVENT_OBJECT_TABLE})`);

  await pool.end();
  process.exit(apres.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERREUR :', e.message);
  process.exit(1);
});
