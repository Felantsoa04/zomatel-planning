'use client';

// DASHBOARD ADMINISTRATEUR — route dediee /dashboard/admin.
// Garde : seules les sessions ADMIN voient cette page ; toute autre role
// (RH, chef) est redirige vers SON dashboard, l'Employe vers le login.

import DashboardView from '@/components/DashboardView';

export default function DashboardAdminPage() {
  return <DashboardView roleAutorise="ADMIN" />;
}
