-- =====================================================================
-- ZOMATEL - Migration 05 : MESSENGER INTERNE (module additif)
-- Additive et IDEMPOTENTE : aucune donnee existante modifiee ni supprimee.
--
-- PREREQUIS VERIFIES avant ecriture (cause du precedente errno 150) :
--   SHOW CREATE TABLE utilisateur =>
--     `id_utilisateur` int(10) unsigned NOT NULL AUTO_INCREMENT  (PK)
--   -> TOUTES les FK vers utilisateur ciblent utilisateur(id_utilisateur)
--      avec le type EXACT int(10) unsigned (PAS "id", qui n'existe pas).
--
-- Le role enum() existant de utilisateur est REUTILISE (aucune modification
-- de utilisateur) ; les employes ordinaires ne se connectent pas, ils ne
-- peuvent donc jamais etre ajoutes a une conversation (controle applicatif).
--
-- Usage : mysql -u root gestion_plannings_hotel < backend/database/05_messenger.sql
--         (ou via scripts/migrate-05-messenger.js)
-- =====================================================================
USE gestion_plannings_hotel;

-- ---------------------------------------------------------------------
-- 1. conversations : reprise ADDITIVE de la table residuelle existante
--    (id int unsigned PK, created_at) : on complete avec la colonne
--    derniere_activite. Si la table n'existe pas, elle est creee complete.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  derniere_activite DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cas de la table residuelle deja existante (sans la colonne) :
-- ajout pur et simple, les donnees (aucune) sont conservees.
ALTER TABLE conversations
  MODIFY COLUMN derniere_activite DATETIME NOT NULL
    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------
-- 2. conversation_membres : membres d'une conversation (privee 1-1)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_membres (
  conversation_id INT UNSIGNED NOT NULL,
  utilisateur_id  INT UNSIGNED NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, utilisateur_id),
  KEY idx_cm_utilisateur (utilisateur_id),
  CONSTRAINT fk_cm_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cm_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. messages : contenu + reponse (repondre_a) + planning contextualise
--    (planning_id NULLABLE : la contextualisation est FACULTATIVE)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id INT UNSIGNED NOT NULL,
  expediteur_id   INT UNSIGNED NOT NULL,
  contenu         TEXT NOT NULL,
  repondre_a      INT UNSIGNED DEFAULT NULL,      -- reponse a un message
  planning_id     INT UNSIGNED DEFAULT NULL,      -- contexte planning facultatif
  modified_at     DATETIME    DEFAULT NULL,       -- modifie (jamais physiquement)
  deleted_at      DATETIME    DEFAULT NULL,       -- suppression logique
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_msg_conversation (conversation_id, id),
  KEY idx_msg_expediteur (expediteur_id),
  CONSTRAINT fk_msg_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_msg_expediteur FOREIGN KEY (expediteur_id)
    REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_msg_reponse FOREIGN KEY (repondre_a)
    REFERENCES messages(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_msg_planning FOREIGN KEY (planning_id)
    REFERENCES planning(id_planning) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. message_lectures : acquite de lecture par message et par membre
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_lectures (
  message_id     INT UNSIGNED NOT NULL,
  utilisateur_id INT UNSIGNED NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, utilisateur_id),
  CONSTRAINT fk_ml_message FOREIGN KEY (message_id)
    REFERENCES messages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ml_utilisateur FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. Permission unique messenger.use dans le catalogue EXISTANT
--    (table permissions : id auto, code, nom, description)
-- ---------------------------------------------------------------------
INSERT INTO permissions (code, nom, description)
VALUES ('messenger.use', 'Utiliser la messagerie interne',
        'Acceder aux conversations et envoyer des messages (Messenger)')
ON DUPLICATE KEY UPDATE nom = VALUES(nom);

-- Attribution automatique aux comptes ACTIFS dont le role est autorise
-- (ADMIN, RH, CHEF_SERVICE) : les EMPLOYE n'ont pas d'espace applicatif.
INSERT IGNORE INTO utilisateur_permission (utilisateur_id, permission_id)
SELECT u.id_utilisateur, p.id
FROM utilisateur u
JOIN permissions p ON p.code = 'messenger.use'
WHERE u.actif = 1
  AND u.role IN ('ADMIN', 'RH', 'CHEF_SERVICE');

-- ---------------------------------------------------------------------
-- 6. Verification finale
-- ---------------------------------------------------------------------
SELECT 'conversations' AS table_name, COUNT(*) AS lignes FROM conversations
UNION ALL SELECT 'conversation_membres', COUNT(*) FROM conversation_membres
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'message_lectures', COUNT(*) FROM message_lectures;

SELECT u.login, u.role, u.actif,
       SUM(p.code = 'messenger.use') AS messenger
FROM utilisateur u
LEFT JOIN utilisateur_permission up ON up.utilisateur_id = u.id_utilisateur
LEFT JOIN permissions p ON p.id = up.permission_id
GROUP BY u.id_utilisateur, u.login, u.role, u.actif
ORDER BY u.role, u.login;
