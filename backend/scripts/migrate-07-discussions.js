/* Migration 07 — GESTION DES DISCUSSIONS MESSENGER (additive, idempotente).
 * Execute les memes ordres SQL que database/07_messenger_discussions.sql via
 * le pool mysql2 du projet. Trois colonnes d'etat PAR MEMBRE sur la table
 * EXISTANTE conversation_membres :
 *   - epinglee  : discussion placee en haut de la liste du membre ;
 *   - archivee  : discussion dans la section « Archivees » (messages intacts) ;
 *   - supprimee : discussion masquee du membre (« Supprimer » avec
 *     confirmation) ; les messages restent en base, la discussion reapparait
 *     si l'autre membre ecrit a nouveau.
 * Rejouable sans risque : chaque colonne n'est ajoutee que si absente.
 * Usage : node scripts/migrate-07-discussions.js
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
    console.log('Migration 07 — discussions messenger :');
    await ajouterColonneSiAbsente(conn, 'conversation_membres', 'epinglee', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ajouterColonneSiAbsente(conn, 'conversation_membres', 'archivee', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ajouterColonneSiAbsente(conn, 'conversation_membres', 'supprimee', 'TINYINT(1) NOT NULL DEFAULT 0');

    // Verification : structure finale
    const [cols] = await conn.query(`SHOW COLUMNS FROM conversation_membres`);
    console.log('Structure conversation_membres :');
    for (const c of cols) console.log(`  - ${c.Field} (${c.Type})`);

    console.log('Migration 07 OK (idempotente : rejouable sans risque).');
    process.exit(0);
  } catch (err) {
    console.error('ECHEC migration 07 :', err.code || '', err.message);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
