'use client';

// SHELL APPLICATION des pages hors dashboard (Plannings, Employes, Services,
// Utilisateurs, Profile, Historique, Statistiques, Parametres...).
// Remplace l'ancienne navbar du haut : la navigation est desormais UNIQUEMENT
// dans la sidebar (DashShell) — aucun doublon de menu.
// - Garde de session : redirection /login si pas de token ou role EMPLOYE.
// - NotificationBell conserve dans la topbar (il n'est pas un element de menu :
//   c'est un widget de compte, identique a ce qui existe dans DashShell).
// - user enrichi du nom du service (les pages l'ont deja : prop facultative).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashShell from '@/components/DashShell';
import { getToken, getUser, logout } from '@/lib/auth';
import { dashboardDe } from '@/lib/dash';

export default function AppShell({ children }) {
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const t = getToken();
    const u = getUser();
    if (!t || !u) {
      router.replace('/login');
      return;
    }
    // L'Employe n'a pas d'espace : purge de la session residuelle (regle projet).
    if (u.role === 'EMPLOYE') {
      logout();
      router.replace('/login');
      return;
    }
    setUser(u);
  }, [router]);

  if (!user) return null; // le contenu ne s'affiche qu'apres lecture de la session

  return (
    <DashShell user={{ ...user, dashboardHref: dashboardDe(user.role) }}>
      {children}
    </DashShell>
  );
}
