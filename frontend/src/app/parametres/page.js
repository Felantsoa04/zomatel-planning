'use client';

// PAGE PARAMETRES — configuration reelle de l'interface, en sections.
// - Apparence : densite des tableaux (localStorage, data-densite) et affichage
//   du bloc profil de la sidebar (preference locale).
// - Notifications : le systeme existant est la cloche (NotificationBell) —
//   aucun parametre backend invente.
// - Compte : utilisateur connecte, acces Profil, deconnexion avec confirmation
//   (fonction logout existante — aucune modification d'authentification).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Settings, Users, Hotel, Bell, Rows3, Rows4, Check, LogOut,
  PanelLeft, User, CircleUser,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import Modal from '@/components/Modal';
import { getToken, getUser, logout } from '@/lib/auth';

const CLE_DENSITE = 'zomatel:densite-tableaux'; // 'confort' (defaut) | 'compact'
const CLE_PROFIL_SIDEBAR = 'zomatel:profil-sidebar'; // '1' (defaut) | '0'

function appliquerDensite(mode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.densite = mode;
}

const LIBELLES_ROLE = {
  ADMIN: 'Administrateur',
  RH: 'Ressources Humaines',
  CHEF_SERVICE: 'Chef de service',
};

export default function ParametresPage() {
  const [user, setUser] = useState(null);
  const [densite, setDensite] = useState('confort');
  const [profilSidebar, setProfilSidebar] = useState(true);
  const [confirmDeconnexion, setConfirmDeconnexion] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    // Preferences lues APRES montage (pattern anti-hydratation du projet).
    const d = localStorage.getItem(CLE_DENSITE);
    if (d === 'compact' || d === 'confort') {
      setDensite(d);
      appliquerDensite(d);
    }
    setProfilSidebar(localStorage.getItem(CLE_PROFIL_SIDEBAR) !== '0');
  }, [router]);

  function choisirDensite(mode) {
    setDensite(mode);
    appliquerDensite(mode);
    try {
      localStorage.setItem(CLE_DENSITE, mode);
    } catch (_) {
      /* stockage indisponible : la preference reste pour la session */
    }
  }

  function basculerProfilSidebar() {
    const nouveau = !profilSidebar;
    setProfilSidebar(nouveau);
    try {
      localStorage.setItem(CLE_PROFIL_SIDEBAR, nouveau ? '1' : '0');
    } catch (_) {
      /* idem */
    }
    // Evenement du projet : les composants reacts a l'evenement se mettent a jour
    window.dispatchEvent(new CustomEvent('zomatel:preferences'));
  }

  function seDeconnecter() {
    setConfirmDeconnexion(false);
    logout();
    router.push('/login');
  }

  const estRHouAdmin = user?.role === 'RH' || user?.role === 'ADMIN';

  const liensGestion = [
    estRHouAdmin && {
      titre: 'Comptes utilisateurs',
      description: 'Rôles, services et permissions des comptes.',
      href: '/utilisateurs',
      icone: Users,
    },
    estRHouAdmin && {
      titre: 'Services',
      description: "Services de l'établissement et type d'affichage des plannings.",
      href: '/service',
      icone: Hotel,
    },
  ].filter(Boolean);

  return (
    <AppShell>
      <div className="container">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings size={20} aria-hidden="true" /> Paramètres
        </h1>
        <p className="muted">Préférences d&apos;interface et raccourcis de gestion.</p>

        {/* ===== Section : Apparence ===== */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Apparence</h3>

          <div className="param-ligne">
            <span>
              Densité des tableaux
              <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                Confort : lignes aérées · Compact : plus de lignes à l&apos;écran
              </span>
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn secondary ${densite === 'confort' ? 'param-actif' : ''}`}
                onClick={() => choisirDensite('confort')}
                aria-pressed={densite === 'confort'}
              >
                {densite === 'confort' ? <Check size={14} aria-hidden="true" /> : <Rows3 size={14} aria-hidden="true" />} Confort
              </button>
              <button
                type="button"
                className={`btn secondary ${densite === 'compact' ? 'param-actif' : ''}`}
                onClick={() => choisirDensite('compact')}
                aria-pressed={densite === 'compact'}
              >
                {densite === 'compact' ? <Check size={14} aria-hidden="true" /> : <Rows4 size={14} aria-hidden="true" />} Compact
              </button>
            </span>
          </div>

          <div className="param-ligne">
            <span>
              Bloc profil dans la sidebar
              <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                Affiche l&apos;avatar et le nom en bas du menu latéral.
              </span>
            </span>
            <button
              type="button"
              className={`btn secondary ${profilSidebar ? 'param-actif' : ''}`}
              onClick={basculerProfilSidebar}
              aria-pressed={profilSidebar}
            >
              <PanelLeft size={14} aria-hidden="true" /> {profilSidebar ? 'Affiché' : 'Masqué'}
            </button>
          </div>
        </div>

        {/* ===== Section : Notifications ===== */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Notifications</h3>
          <div className="param-ligne">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Bell size={15} aria-hidden="true" /> Centre de notifications
              <span className="muted" style={{ fontSize: 12.5 }}>
                accessible depuis la cloche en haut à droite (badge des non-lues).
              </span>
            </span>
          </div>
        </div>

        {/* ===== Section : Gestion (selon role) ===== */}
        {liensGestion.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Gestion</h3>
            {liensGestion.map((l) => {
              const Icone = l.icone;
              return (
                <Link key={l.titre} href={l.href} className="param-ligne" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    <Icone size={15} aria-hidden="true" /> {l.titre}
                  </span>
                  <span className="muted" style={{ fontSize: 12.5 }}>{l.description}</span>
                </Link>
              );
            })}
          </div>
        )}

        {/* ===== Section : Compte ===== */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Compte</h3>
          <div className="param-ligne">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <CircleUser size={15} aria-hidden="true" />
              <span>
                {[user?.prenom, user?.nom].filter(Boolean).join(' ') || user?.nom_utilisateur || user?.login || '—'}
                <span className="muted"> · {LIBELLES_ROLE[user?.role] || user?.role || ''}</span>
              </span>
            </span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href="/profile" className="btn secondary" style={{ textDecoration: 'none' }}>
                <User size={14} aria-hidden="true" /> Mon profil
              </Link>
              <button className="btn danger" onClick={() => setConfirmDeconnexion(true)}>
                <LogOut size={14} aria-hidden="true" /> Déconnexion
              </button>
            </span>
          </div>
        </div>
      </div>

      {confirmDeconnexion && (
        <Modal titre="Confirmer la déconnexion" onClose={() => setConfirmDeconnexion(false)} largeur={400}>
          <p style={{ marginTop: 0 }}>Voulez-vous vraiment vous déconnecter ?</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setConfirmDeconnexion(false)}>Annuler</button>
            <button className="btn danger" onClick={seDeconnecter}>Se déconnecter</button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
