USE gestion_plannings_hotel;

ALTER TABLE service
  MODIFY COLUMN type_affichage
    ENUM('PERIODES_FIXES', 'HORAIRE_LIBRE', 'SHIFT_POSTE')
    NOT NULL DEFAULT 'PERIODES_FIXES';

-- Convert legacy name-based models into explicit service configuration.
UPDATE service
SET type_affichage = 'SHIFT_POSTE'
WHERE nom_service IN ('Sécurité', 'Securite', 'Security')
  AND type_affichage = 'PERIODES_FIXES';

UPDATE service
SET type_affichage = 'HORAIRE_LIBRE'
WHERE nom_service IN ('Stock Congélateur', 'Stock Congelateur')
  AND type_affichage = 'PERIODES_FIXES';
