'use client';

// Shell commun des dashboards Zomatel : sidebar moderne + topbar.
// Reutilise par les vues Administrateur, RH et Chef de service (l'Employe
// n'a PAS d'espace dans l'application : voir dashboard/page.js).

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import NotificationBell from '@/components/NotificationBell';
import { logout } from '@/lib/auth';

const LIBELLES_ROLE = {
  ADMIN: 'Administrateur',
  RH: 'Ressources Humaines',
  CHEF_SERVICE: 'Chef de service',
};

export default function DashShell({ user, liens, enfants }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ouvert, setOuvert] = useState(false); // sidebar mobile

  if (!user) return null;

  const initiales = (user.prenom || user.nom_utilisateur || user.login || '?')
    .split(' ')
    .map((m) => m[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  function deconnexion() {
    logout();
    router.push('/login');
  }

  return (
    <div className="dash-layout">
      <aside className={`dash-sidebar ${ouvert ? 'ouverte' : ''}`}>
        <div className="dash-brand">
          <span className="dash-logo">ZP</span>
          <span className="dash-brand-texte">
            <strong>Zomatel</strong>
            <small>Planning hôtelier</small>
          </span>
        </div>

        <nav className="dash-nav">
          {liens.map((l) => {
            const actif = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`dash-lien ${actif ? 'actif' : ''}`}
                onClick={() => setOuvert(false)}
              >
                <span className="dash-icone">{l.icone}</span>
                <span>{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="dash-sidebar-pied">
          <button className="dash-deconnexion" onClick={deconnexion}>
            ⎋ Déconnexion
          </button>
        </div>
      </aside>

      {ouvert && <div className="dash-voile" onClick={() => setOuvert(false)} />}

      <div className="dash-contenu">
        <header className="dash-topbar">
          <button
            className="dash-burger"
            onClick={() => setOuvert((o) => !o)}
            aria-label="Menu"
          >
            ☰
          </button>
          <div className="dash-topbar-titre">
            <strong>{LIBELLES_ROLE[user.role] || user.role}</strong>
            {user.service_nom && <span className="muted"> · {user.service_nom}</span>}
          </div>
          <div className="dash-topbar-droite">
            <NotificationBell />
            <span className="dash-avatar" title={[user.prenom, user.nom].filter(Boolean).join(' ') || user.nom_utilisateur || user.login}>
              {initiales}
            </span>
          </div>
        </header>

        <main className="dash-main">{enfants}</main>
      </div>
    </div>
  );
}
