'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, logout } from '@/lib/auth';
import NotificationBell from '@/components/NotificationBell';
import { MENU_PRINCIPAL, dashboardDe } from '@/lib/dash';
import { usePermissions } from '@/lib/permissions';
import { useI18n } from '@/lib/i18n';

const MENU_CLES_TRADUCTION = {
  '/dashboard': 'nav.dashboard',
  '/validations': 'nav.validations',
  '/planning/gestion': 'nav.planning',
  '/employees': 'nav.employees',
  '/service': 'nav.services',
  '/messagerie': 'nav.messenger',
  '/statistiques': 'nav.statistics',
  '/archives': 'nav.archives',
  '/historique': 'nav.history',
  '/utilisateurs': 'nav.users',
  '/parametres': 'nav.settings',
};

export default function Navbar() {
  const { permissions } = usePermissions();
  const { t } = useI18n();
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    setUser(getUser());
  }, []);

  function handleLogout() {
    logout();
    router.push('/login');
  }

  return (
    <div className="navbar">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* Monogramme « Z » : couleur principale Zomatel, proportion gardée
            avec le texte, alignement vertical propre. */}
        <span
          className="monogramme-z"
          style={{ width: 34, height: 34, fontSize: 21, borderRadius: 8, marginRight: 8 }}
          aria-hidden="true"
        >Z</span>
        <span className="brand">Zomatel Planning</span>
        {user && (
          <>
            {MENU_PRINCIPAL
              .map((item) => item.href === '/dashboard'
                ? { ...item, href: dashboardDe(user.role) }
                : item)
              .filter((item) =>
                (!item.permission || permissions.includes(item.permission))
                && (!item.permissions || item.permissions.every((code) => permissions.includes(code)))
                && (!item.permissionsAny || item.permissionsAny.some((code) => permissions.includes(code)))
              )
              .map((item) => (
                <Link key={item.href} href={item.href} style={{ marginLeft: 24 }}>{t(MENU_CLES_TRADUCTION[item.href] || item.label)}</Link>
              ))}
          </>
        )}
      </div>
      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ marginRight: 4 }}>
            {[user.prenom, user.nom].filter(Boolean).join(' ') || user.nom_utilisateur || user.login} &middot; {user.role}
          </span>
          <NotificationBell />
          <button className="btn secondary" onClick={handleLogout}>{t('nav.logout')}</button>
        </div>
      )}
    </div>
  );
}