/* Migration 10 — permission dédiée à l'export Excel Emploi du temps.
 * Usage : node scripts/migrate-10-planning-export.js
 * Idempotente : crée/actualise le catalogue et attribue uniquement cette
 * permission aux comptes RH existants.
 */
const pool = require('../src/config/db');

(async () => {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO permissions (code, nom, description)
       VALUES ('planning.export_edt', 'Exporter l’emploi du temps Excel (RH)',
               'Exporter les emplois du temps validés au format Excel')
       ON DUPLICATE KEY UPDATE nom = VALUES(nom), description = VALUES(description)`
    );

    await conn.query(
      `INSERT IGNORE INTO utilisateur_permission (utilisateur_id, permission_id)
       SELECT u.id_utilisateur, p.id
       FROM utilisateur u
       JOIN permissions p ON p.code = 'planning.export_edt'
       WHERE u.role = 'RH'`
    );

    const [[verification]] = await conn.query(
      `SELECT COUNT(*) AS comptes_rh_autorises
       FROM utilisateur u
       JOIN permissions p ON p.code = 'planning.export_edt'
       JOIN utilisateur_permission up
         ON up.utilisateur_id = u.id_utilisateur AND up.permission_id = p.id
       WHERE u.role = 'RH'`
    );
    console.log(`Permission planning.export_edt attribuée à ${verification.comptes_rh_autorises} compte(s) RH.`);
    console.log('Migration 10 OK.');
    process.exit(0);
  } catch (err) {
    console.error('ECHEC migration 10 :', err.code || '', err.message);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
