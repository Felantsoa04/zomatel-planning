'use client';

// DASHBOARD RH — route dediee /dashboard/rh.
// Garde : seules les sessions RH voient cette page ; tout autre role est
// redirige vers SON dashboard, l'Employe vers le login.

import DashboardView from '@/components/DashboardView';

export default function DashboardRhPage() {
  return <DashboardView roleAutorise="RH" />;
}
