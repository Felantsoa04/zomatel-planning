function aAccesServicePlanning(req, serviceId) {
  if (!req.user || req.user.role === 'EMPLOYE') return false;
  const correspondAuService = Number(serviceId) === Number(req.user.id_service);
  if (req.user.role === 'CHEF_SERVICE') return correspondAuService;
  if (Array.isArray(req.permissions) && req.permissions.includes('planning.view_all')) return true;
  return Boolean(req.user.id_service) && correspondAuService;
}

module.exports = { aAccesServicePlanning };
