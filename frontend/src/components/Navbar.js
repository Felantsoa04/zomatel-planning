'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, logout } from '@/lib/auth';
import NotificationBell from '@/components/NotificationBell';

export default function Navbar() {
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
            <Link href="/dashboard" style={{ marginLeft: 24 }}>Plannings</Link>
            {user.role === 'CHEF_SERVICE' && <Link href="/planning/gestion">Gestion du planning</Link>}
            {['RH', 'ADMIN'].includes(user.role) && <Link href="/utilisateurs">Utilisateurs</Link>}
            <Link href="/employees">Employés</Link>
          </>
        )}
      </div>
      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ marginRight: 4 }}>
            {[user.prenom, user.nom].filter(Boolean).join(' ') || user.nom_utilisateur || user.login} &middot; {user.role}
          </span>
          <NotificationBell />
          <button className="btn secondary" onClick={handleLogout}>Deconnexion</button>
        </div>
      )}
    </div>
  );
}