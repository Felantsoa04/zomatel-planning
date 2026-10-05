/* Migration 05 — MESSENGER INTERNE (module additif, idempotent).
 * Execute les memes ordres SQL que database/05_messenger.sql via le pool
 * mysql2 du projet (meme base que .env). Rejouable sans risque : les tables
 * sont en CREATE TABLE IF NOT EXISTS, la permission en ON DUPLICATE KEY et
 * les attributions en INSERT IGNORE. Aucune donnee existante n'est touchee.
 * Usage : node scripts/migrate-05-messenger.js
 */
const pool = require('../src/config/db');

const ORDRES = [
  `CREATE TABLE IF NOT EXISTS conversations (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     derniere_activite DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
       ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // La table residuelle existante n'a pas la colonne : ALTER ajoutant la
  // colonne manquante (le MODIFY d'un ALTER classique echouerait si elle
  // existait deja -> on teste d'abord l'existence).
  async (conn) => {
    const [cols] = await conn.query(`SHOW COLUMNS FROM conversations LIKE 'derniere_activite'`);
    if (cols.length === 0) {
      await conn.query(`ALTER TABLE conversations
        ADD COLUMN derniere_activite DATETIME NOT NULL
          DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
    }
  },

  `CREATE TABLE IF NOT EXISTS conversation_membres (
     conversation_id INT UNSIGNED NOT NULL,
     utilisateur_id  INT UNSIGNED NOT NULL,
     joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (conversation_id, utilisateur_id),
     KEY idx_cm_utilisateur (utilisateur_id),
     CONSTRAINT fk_cm_conversation FOREIGN KEY (conversation_id)
       REFERENCES conversations(id) ON DELETE CASCADE ON UPDATE CASCADE,
     CONSTRAINT fk_cm_utilisateur FOREIGN KEY (utilisateur_id)
       REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS messages (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT,
     conversation_id INT UNSIGNED NOT NULL,
     expediteur_id   INT UNSIGNED NOT NULL,
     contenu         TEXT NOT NULL,
     repondre_a      INT UNSIGNED DEFAULT NULL,
     planning_id     INT UNSIGNED DEFAULT NULL,
     modified_at     DATETIME    DEFAULT NULL,
     deleted_at      DATETIME    DEFAULT NULL,
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS message_lectures (
     message_id     INT UNSIGNED NOT NULL,
     utilisateur_id INT UNSIGNED NOT NULL,
     read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (message_id, utilisateur_id),
     CONSTRAINT fk_ml_message FOREIGN KEY (message_id)
       REFERENCES messages(id) ON DELETE CASCADE ON UPDATE CASCADE,
     CONSTRAINT fk_ml_utilisateur FOREIGN KEY (utilisateur_id)
       REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE ON UPDATE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `INSERT INTO permissions (code, nom, description)
   VALUES ('messenger.use', 'Utiliser la messagerie interne',
           'Acceder aux conversations et envoyer des messages (Messenger)')
   ON DUPLICATE KEY UPDATE nom = VALUES(nom)`,

  `INSERT IGNORE INTO utilisateur_permission (utilisateur_id, permission_id)
   SELECT u.id_utilisateur, p.id
   FROM utilisateur u
   JOIN permissions p ON p.code = 'messenger.use'
   WHERE u.actif = 1 AND u.role IN ('ADMIN', 'RH', 'CHEF_SERVICE')`,
];

(async () => {
  const conn = await pool.getConnection();
  try {
    for (const ordre of ORDRES) {
      if (typeof ordre === 'function') await ordre(conn);
      else await conn.query(ordre);
    }

    // Verification : tables + attribution messenger.use
    const [tables] = await conn.query(
      `SELECT table_name, table_rows FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN ('conversations','conversation_membres','messages','message_lectures')
       ORDER BY table_name`
    );
    console.log('Tables messenger :');
    for (const t of tables) console.log('  -', t.table_name);
    const [verif] = await conn.query(
      `SELECT u.login, u.role, u.actif,
              SUM(p.code = 'messenger.use') AS messenger
       FROM utilisateur u
       LEFT JOIN utilisateur_permission up ON up.utilisateur_id = u.id_utilisateur
       LEFT JOIN permissions p ON p.id = up.permission_id
       WHERE u.role IN ('ADMIN','RH','CHEF_SERVICE')
       GROUP BY u.id_utilisateur, u.login, u.role, u.actif
       ORDER BY u.role, u.login`
    );
    console.log('Permission messenger.use :');
    for (const v of verif) {
      console.log(`  ${String(v.login).padEnd(16)} ${v.role.padEnd(13)} ${v.actif ? 'actif  ' : 'inactif'} messenger=${Number(v.messenger) || 0}`);
    }
    console.log('Migration 05 OK (idempotente : rejouable sans risque).');
    process.exit(0);
  } catch (err) {
    console.error('ECHEC migration 05 :', err.code || '', err.message);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
