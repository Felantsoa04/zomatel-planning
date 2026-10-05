/* Migration 03 (RBAC) — utilise le catalogue EXISTANT permissions (pluriel).
 * - ajoute les codes manquants (ON DUPLICATE KEY UPDATE : idempotent)
 * - initialise les permissions de chaque compte selon son role ACTUEL
 *   (copie des droits verifiables dans les routes : zero regression)
 * - aucune donnee supprimee, aucune table recreee.
 * Usage : node scripts/migrate-03.js
 */
const pool = require('../src/config/db');

const CATALOGUE = [
  ['planning.view',      'Consulter les plannings de son perimetre'],
  ['planning.view_all',  'Consulter tous les plannings'],
  ['planning.create',    'Creer un planning'],
  ['planning.update',    'Modifier la grille d\'un planning'],
  ['planning.submit',    'Soumettre un planning a la RH'],
  ['planning.delete',    'Supprimer un planning'],
  ['planning.validate',  'Valider / refuser un planning'],
  ['planning.reopen',    'Rouvrir un planning valide'],
  ['employe.view',       'Consulter les employes'],
  ['employe.manage',     'Ajouter / modifier / desactiver les employes'],
  ['service.manage',     'Gerer les services'],
  ['user.view',          'Consulter les comptes utilisateurs'],
  ['user.create',        'Creer un compte utilisateur'],
  ['user.update',        'Modifier / desactiver / reactiver un compte'],
];

// Copie des droits actuels (verifiables dans les routes existantes)
const PAR_ROLE = {
  ADMIN: CATALOGUE.map(([code]) => code),
  RH: [
    'planning.view', 'planning.view_all', 'planning.validate', 'planning.reopen',
    'planning.delete', 'employe.view', 'employe.manage', 'service.manage',
    'user.view', 'user.create', 'user.update',
  ],
  CHEF_SERVICE: [
    'planning.view', 'planning.create', 'planning.update', 'planning.submit',
    'planning.delete', 'employe.view', 'employe.manage',
  ],
  EMPLOYE: [], // consultation personnelle : routes /employes/me/* (auto-restreintes)
};

(async () => {
  let conn;
  try {
    conn = await pool.getConnection();

    // 1. Catalogue : codes manquants seulement, la table existe deja
    for (const [code, nom] of CATALOGUE) {
      await conn.query(
        `INSERT INTO permissions (code, nom, description) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE nom = VALUES(nom)`,
        [code, nom, nom]
      );
    }

    // 2. Initialisation des comptes existants selon leur role actuel
    const [users] = await conn.query('SELECT id_utilisateur, role FROM utilisateur');
    const [cat] = await conn.query('SELECT id, code FROM permissions');
    const idParCode = Object.fromEntries(cat.map((p) => [p.code, p.id]));
    let attributions = 0;

    for (const u of users) {
      const codes = PAR_ROLE[u.role] || [];
      for (const code of codes) {
        await conn.query(
          'INSERT IGNORE INTO utilisateur_permission (utilisateur_id, permission_id) VALUES (?, ?)',
          [u.id_utilisateur, idParCode[code]]
        );
        attributions++;
      }
    }

    // 3. Verification
    const [verif] = await conn.query(
      `SELECT u.login, u.role, u.actif,
              GROUP_CONCAT(p.code ORDER BY p.code) AS permissions
       FROM utilisateur u
       LEFT JOIN utilisateur_permission up ON up.utilisateur_id = u.id_utilisateur
       LEFT JOIN permissions p ON p.id = up.permission_id
       GROUP BY u.id_utilisateur, u.login, u.role, u.actif
       ORDER BY u.role, u.login`
    );
    console.log('Migration 03 OK —', users.length, 'comptes,', attributions, 'attributions :');
    for (const v of verif) {
      console.log(`  ${String(v.login).padEnd(18)} ${v.role.padEnd(13)} ${v.actif ? 'actif  ' : 'inactif'} ${v.permissions || '(aucune)'}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('ECHEC migration :', err.message);
    process.exit(1);
  } finally {
    if (conn) conn.release();
  }
})();
