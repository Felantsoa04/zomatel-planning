const pool = require('../config/db');

// RBAC Zomatel : Utilisateur -> Rôle -> Permissions -> Ressource.
// Reutilise les tables EXISTANTES de la base :
//   permissions (id, code, nom, description)          = catalogue
//   utilisateur_permission (utilisateur_id, permission_id) = attribution
// Les codes nouveaux correspondent tous a des routes REELLES du backend.
// Le role ne sert qu'a proposer des permissions PAR DEFAUT : c'est la
// permission individuelle, verifiee en base a chaque requete, qui decide.

const CATALOGUE = [
  // Plannings (routes planningRoutes.js verifiees)
  ['planning.view',     'Consulter les plannings de son perimetre', null],
  ['planning.view_all', 'Consulter tous les plannings',             null],
  ['planning.create',   'Creer un planning',                        null],
  ['planning.update',   'Modifier la grille d\'un planning',        null],
  ['planning.submit',   'Soumettre un planning a la RH',            null],
  ['planning.delete',   'Supprimer un planning',                    null],
  ['planning.validate', 'Valider / refuser un planning',            null],
  ['planning.reopen',   'Rouvrir un planning valide',               null],
  ['planning.export_edt', 'Exporter l’emploi du temps Excel (RH)',   null],
  // Numérisation des plannings papier (routes numerisationRoutes.js) —
  // réservée au rôle RH (requireRole('RH') s'ajoute à la permission).
  ['numerisation.use',    'Numériser les plannings papier (RH)',      null],
  // Employes (routes employeRoutes.js)
  ['employe.view',      'Consulter les employes',                   null],
  ['employe.manage',    'Ajouter / modifier / desactiver les employes', null],
  // Services (routes serviceRoutes.js)
  ['service.manage',    'Gerer les services',                       null],
  // Utilisateurs (routes authRoutes.js)
  ['user.view',         'Consulter les comptes utilisateurs',       null],
  ['user.create',       'Creer un compte utilisateur',              null],
  ['user.update',       'Modifier / desactiver / reactiver un compte', null],
  // Messagerie interne (routes messengerRoutes.js) — permission UNIQUE :
  // elle couvre consultation + envoi + gestion de ses propres messages.
  ['messenger.use',     'Utiliser la messagerie interne',           null],
];

// Permissions proposees par defaut a la CREATION d'un compte selon son role
// (copie des droits actuels de chaque role — aucune elevation cachee).
const DEFAUTS_PAR_ROLE = {
  ADMIN: CATALOGUE.filter(([code]) => code !== 'planning.export_edt').map(([code]) => code),
  RH: [
    'planning.view', 'planning.view_all', 'planning.validate', 'planning.reopen', 'planning.export_edt',
    'planning.delete', 'employe.view', 'employe.manage', 'service.manage',
    'user.view', 'user.create', 'user.update', 'messenger.use',
    'numerisation.use',
  ],
  CHEF_SERVICE: [
    'planning.view', 'planning.create', 'planning.update', 'planning.submit',
    'planning.delete', 'employe.view', 'employe.manage', 'messenger.use',
  ],
  EMPLOYE: [], // consultation personnelle via les routes /employes/me/* uniquement
};

// Charge les codes de permissions d'un utilisateur (base = source de verite,
// lue a chaque requete : une revocation s'applique immediatement).
async function permissionsDe(id_utilisateur) {
  const [rows] = await pool.query(
    `SELECT p.code FROM utilisateur_permission up
     JOIN permissions p ON p.id = up.permission_id
     WHERE up.utilisateur_id = ?`,
    [id_utilisateur]
  );
  return rows.map((r) => r.code);
}

// Middleware : utilisateur connecte -> permission -> route.
// (non-async : retourne le middleware directement, pas une Promise)
function requirePermission(code) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id_utilisateur) {
        return res.status(401).json({ message: 'Authentification requise.' });
      }
      const perms = await permissionsDe(req.user.id_utilisateur);
      if (!perms.includes(code)) {
        return res.status(403).json({
          message: `Acces refuse : permission '${code}' requise.`,
        });
      }
      req.permissions = perms;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Variante : acces si AU MOINS UNE des permissions est presente
// (ex. creations autorisees au chef ET a la RH sur une meme route).
function requirePermissionAny(codes) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id_utilisateur) {
        return res.status(401).json({ message: 'Authentification requise.' });
      }
      const perms = await permissionsDe(req.user.id_utilisateur);
      if (!codes.some((c) => perms.includes(c))) {
        return res.status(403).json({
          message: `Acces refuse : une de ces permissions est requise (${codes.join(', ')}).`,
        });
      }
      req.permissions = perms;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// (Re)definit la liste exacte des permissions d'un utilisateur.
async function definirPermissions(id_utilisateur, codes) {
  const [ids] = await pool.query('SELECT id, code FROM permissions');
  const valides = ids.filter((p) => (codes || []).includes(p.code));
  await pool.query('DELETE FROM utilisateur_permission WHERE utilisateur_id = ?', [id_utilisateur]);
  for (const p of valides) {
    await pool.query(
      'INSERT IGNORE INTO utilisateur_permission (utilisateur_id, permission_id) VALUES (?, ?)',
      [id_utilisateur, p.id]
    );
  }
  return valides.map((p) => p.code);
}

// Initialise les permissions par defaut d'un nouveau compte selon son role.
async function appliquerDefauts(id_utilisateur, role) {
  const codes = DEFAUTS_PAR_ROLE[role] || [];
  return definirPermissions(id_utilisateur, codes);
}

module.exports = {
  CATALOGUE,
  DEFAUTS_PAR_ROLE,
  permissionsDe,
  requirePermission,
  requirePermissionAny,
  definirPermissions,
  appliquerDefauts,
};
