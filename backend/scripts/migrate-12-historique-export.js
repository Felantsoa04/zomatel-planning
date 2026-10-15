/* Migration 12 — historique des exports Excel des plannings.
 * Usage : node scripts/migrate-12-historique-export.js
 * ADDITIVE et IDEMPOTENTE : crée la table historique_export (traçage des
 * exports réussis, simple ou multi-services). Aucune donnée, table ou
 * permission existante n'est modifiée ni supprimée.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const SQL = fs.readFileSync(
  path.resolve(__dirname, '..', 'database', '12_historique_export.sql'),
  'utf8'
);

(async () => {
  const conn = await pool.getConnection();
  try {
    const blocTable = SQL.match(/CREATE TABLE IF NOT EXISTS historique_export[\s\S]*?\) ENGINE=InnoDB[^;]*;/);
    if (!blocTable) throw new Error('Bloc CREATE TABLE historique_export introuvable.');
    await conn.query(blocTable[0]);

    const [[tableOk]] = await conn.query(
      `SELECT COUNT(*) AS existe FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historique_export'`
    );
    console.log(`Table historique_export : ${tableOk.existe ? 'OK' : 'ABSENTE'}.`);
    console.log('Migration 12 OK (aucune donnée existante modifiée).');
    process.exit(0);
  } catch (err) {
    console.error('ECHEC migration 12 :', err.code || '', err.message);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
