'use client';

// DASHBOARD CHEF DE SERVICE — route dediee /dashboard/chef.
// Garde : seules les sessions CHEF_SERVICE voient cette page ; tout autre
// role est redirige vers SON dashboard, l'Employe vers le login.
// Le chef ne voit que SON service : le filtrage est garanti par le backend
// (req.user.id_service du JWT issu de MariaDB) sur /plannings et /employes.

import DashboardView from '@/components/DashboardView';

export default function DashboardChefPage() {
  return <DashboardView roleAutorise="CHEF_SERVICE" />;
}
