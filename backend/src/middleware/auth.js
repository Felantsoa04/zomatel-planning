const { verifyToken } = require('../utils/jwt');

// Verifie le JWT et attache req.user = { id_utilisateur, role, id_service, nom, prenom }
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentification requise.' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    // [DIAGNOSTIC TEMPORAIRE] - a retirer apres resolution du 403
    console.log(`[AUTH] user id=${payload.id_utilisateur} role=${payload.role} service_id=${payload.id_service}`);
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Session invalide ou expiree.' });
  }
}

// Restreint l'acces a certains roles : requireRole('RH'), requireRole('RH','CHEF_SERVICE')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Acces refuse pour ce role.' });
    }
    next();
  };
}

module.exports = { authRequired, requireRole };