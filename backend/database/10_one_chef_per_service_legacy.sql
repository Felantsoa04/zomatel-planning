-- One account per service, enforced by MariaDB even for concurrent requests.
-- Existing account rows remain intact; this migration will fail if duplicate
-- CHEF_SERVICE assignments already exist and must be resolved before retrying.
USE zomatel_planning;

ALTER TABLE utilisateur
  ADD COLUMN chef_service_unique_id INT UNSIGNED
    GENERATED ALWAYS AS (
      CASE WHEN role = 'CHEF_SERVICE' THEN service_id ELSE NULL END
    ) PERSISTENT,
  ADD UNIQUE KEY uq_utilisateur_chef_service (chef_service_unique_id);
