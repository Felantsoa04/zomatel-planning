'use client';

// SHELL APPLICATION des pages hors dashboard (Plannings, Employes, Services,
// Utilisateurs, Profile, Historique, Statistiques, Parametres...).
// Remplace l'ancienne navbar du haut : la navigation est desormais UNIQUEMENT
// dans la sidebar (DashShell) — aucun doublon de menu.
// - Garde de session : redirection /login si pas de token ou role EMPLOYE.
// - NotificationBell conserve dans la topbar (il n'est pas un element de menu :
//   c'est un widget de compte, identique a ce qui existe dans DashShell).
// - user enrichi du nom du service (les pages l'ont deja : prop facultative).

import { useEffect, useMemo, useState } from 'react';
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

  // user enrichi du dashboard du role, MEMORISE : sans memo, un nouvel objet
  // (reference instable) etait transmis a DashShell a CHAQUE re-render de la
  // page. L'effet de DashShell depend de [user] : il se rejouait donc a chaque
  // frappe clavier, repassait permissionsChargees a false, ce qui declenchait
  // le remount complet de la page dans <main> (consequence : perte du focus
  // des champs de saisie apres 1 caractere dans toute l'application).
  const shellUser = useMemo(
    () => (user ? { ...user, dashboardHref: dashboardDe(user.role) } : null),
    [user]
  );

  if (!shellUser) return null; // le contenu ne s'affiche qu'apres lecture de la session

  return (
    <DashShell user={shellUser}>
      {children}
    </DashShell>
  );
}
