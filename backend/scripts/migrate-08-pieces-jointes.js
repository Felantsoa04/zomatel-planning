/* Migration 08 — MESSENGER : PIECES JOINTES (additive, idempotente).
 * Execute le meme ordre SQL que database/08_messenger_pieces_jointes.sql via
 * le pool mysql2 du projet. Quatre colonnes sur la table EXISTANTE messages :
 *   - type_message   : texte (par defaut) | image | video | audio | fichier ;
 *   - fichier_chemin : chemin relatif servi par express.static (uploads) ;
 *   - nom_fichier    : nom d'origine affiche a l'utilisateur (fichier) ;
 *   - mime_type      : type MIME reel enregistre a l'envoi.
 * Les messages texte existants ne sont PAS touches (DEFAULT 'texte').
 * Rejouable sans risque : chaque colonne n'est ajoutee que si absente.
 * Usage : node scripts/migrate-08-pieces-jointes.js
 */
const pool = require('../src/config/db');

async function ajouterColonneSiAbsente(conn, table, colonne, definition) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, colonne]
  );
  if (cols.length === 0) {
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
    console.log(`  + colonne ${table}.${colonne} ajoutee`);
  } else {
    console.log(`  = colonne ${table}.${colonne} deja presente`);
  }
}

(async () => {
  const conn = await pool.getConnection();
  try {
    console.log('Migration 08 — pieces jointes messenger :');
    await ajouterColonneSiAbsente(
      conn, 'messages', 'type_message',
      "ENUM('texte','image','video','audio','fichier') NOT NULL DEFAULT 'texte' AFTER contenu"
    );
    await ajouterColonneSiAbsente(conn, 'messages', 'fichier_chemin', "VARCHAR(255) DEFAULT NULL AFTER type_message");
    await ajouterColonneSiAbsente(conn, 'messages', 'nom_fichier', "VARCHAR(255) DEFAULT NULL AFTER fichier_chemin");
    await ajouterColonneSiAbsente(conn, 'messages', 'mime_type', "VARCHAR(120) DEFAULT NULL AFTER nom_fichier");

    // Verification : structure finale
    const [cols] = await conn.query(`SHOW COLUMNS FROM messages`);
    console.log('Structure messages :');
    for (const c of cols) console.log(`  - ${c.Field} (${c.Type})`);

    console.log('Migration 08 OK (idempotente : rejouable sans risque).');
    process.exit(0);
  } catch (err) {
    console.error('ECHEC migration 08 :', err.code || '', err.message);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
