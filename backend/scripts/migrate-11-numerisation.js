/* Migration 11 — numérisation des plannings papier (OCR).
 * Usage : node scripts/migrate-11-numerisation.js
 * ADDITIVE et IDCMPOTENTE : crée la table planning_scan et la permission
 * numerisation.use, attribuée aux comptes RH existants. Aucune donnée ou
 * table existante n'est modifiée ni supprimée.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

/* Table reprise de database/11_numerisation.sql (mêmes colonnes/contraintes). */
const SQL_TABLE = fs.readFileSync(
  path.resolve(__dirname, '..', 'database', '11_numerisation.sql'),
  'utf8'
);

(async () => {
  const conn = await pool.getConnection();
  try {
    // 1) Table planning_scan (CREATE IF NOT EXISTS : idempotent, non destructif)
    // On isole la partie CREATE TABLE du fichier SQL (le reste — USE, GRANT —
    // est exécuté via des requêtes dédiées plus bas).
    const blocTable = SQL_TABLE.match(/CREATE TABLE IF NOT EXISTS planning_scan[\s\S]*?\) ENGINE=InnoDB[^;]*;/);
    if (!blocTable) throw new Error('Bloc CREATE TABLE introuvable dans 11_numerisation.sql');
    await conn.query(blocTable[0]);

    // 2) Permission dédiée (catalogue = table permissions existante)
    await conn.query(
      `INSERT INTO permissions (code, nom, description)
       VALUES ('numerisation.use', 'Numériser les plannings papier (RH)',
               'Importer des plannings papier scannés, corriger l’OCR et créer les plannings')
       ON DUPLICATE KEY UPDATE nom = VALUES(nom), description = VALUES(description)`
    );

    // 3) Attribution aux comptes RH existants (jamais retirée à qui que ce soit)
    await conn.query(
      `INSERT IGNORE INTO utilisateur_permission (utilisateur_id, permission_id)
       SELECT u.id_utilisateur, p.id
       FROM utilisateur u
       JOIN permissions p ON p.code = 'numerisation.use'
       WHERE u.role = 'RH'`
    );

    // 4) Vérification (rapport, lecture seule)
    const [[tableOk]] = await conn.query(
      `SELECT COUNT(*) AS existe FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planning_scan'`
    );
    const [[rhOk]] = await conn.query(
      `SELECT COUNT(*) AS comptes_rh_autorises
       FROM utilisateur u
       JOIN permissions p ON p.code = 'numerisation.use'
       JOIN utilisateur_permission up
         ON up.utilisateur_id = u.id_utilisateur AND up.permission_id = p.id
       WHERE u.role = 'RH'`
    );
    console.log(`Table planning_scan : ${tableOk.existe ? 'OK' : 'ABSENTE'}.`);
    console.log(`Permission numerisation.use attribuée à ${rhOk.comptes_rh_autorises} compte(s) RH.`);
    console.log('Migration 11 OK (aucune donnée existante modifiée).');
    process.exit(0);
  } catch (err) {
    console.error('ECHEC migration 11 :', err.code || '', err.message);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
