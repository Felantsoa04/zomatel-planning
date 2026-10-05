'use client';

// /dashboard = REDIRECTEUR vers le dashboard du role connecte :
//   ADMIN -> /dashboard/admin · RH -> /dashboard/rh · CHEF_SERVICE -> /dashboard/chef
// L'ancienne vue unique a ete deplacee dans components/DashboardView.js.
// Aucune statistique n'est chargee ici : redirection immediate, apres montage
// (pattern anti-hydratation du projet).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { getToken, getUser, logout } from '@/lib/auth';
import { dashboardDe } from '@/lib/dash';

export default function DashboardRedirect() {
  const router = useRouter();
  const [message, setMessage] = useState('Chargement...');

  useEffect(() => {
    const u = getUser();
    const token = getToken();
    if (!token || !u) {
      router.replace('/login');
      return;
    }
    // L'Employe n'a pas d'espace : purge de la session residuelle.
    if (u.role === 'EMPLOYE') {
      logout();
      router.replace('/login');
      return;
    }
    const cible = dashboardDe(u.role);
    if (!cible) {
      // Role inconnu : on ne tente rien, session purge et retour au login.
      logout();
      router.replace('/login');
      return;
    }
    router.replace(cible);
  }, [router]);

  return (
    <AppShell>
      <div className="container" style={{ padding: 20 }}>
        <p className="muted">{message}</p>
      </div>
    </AppShell>
  );
}
