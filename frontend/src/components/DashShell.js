'use client';

// Shell commun des dashboards Zomatel : sidebar moderne + topbar.
// Reutilise par les vues Administrateur, RH et Chef de service (l'Employe
// n'a PAS d'espace dans l'application : voir dashboard/page.js).
// - Sidebar DEUX MODES : developpee (icone + nom) / reduite (icone seule,
//   tooltip au survol), preference conservee dans localStorage.
// - Menu compact : gaps et tailles reduits (cf. .dash-nav dans globals.css).
// - Topbar : ThemeToggle (clair/sombre), cloche de notifications ET bouton
//   Messages distincts (compteurs rouges independants), profil compact
//   (photo + nom + role) -> /profile.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { saveSession, getToken } from '@/lib/auth';
// NB : la page passe le contenu via children (React) — on le rend ci-dessous.
// (l'ancien prop « enfants » n'a jamais ete alimente : le <main> restait vide)
import NotificationBell from '@/components/NotificationBell';
import MessengerBouton from '@/components/MessengerBouton';
import MessengerBadge from '@/components/MessengerBadge';
import ThemeToggle from '@/components/ThemeToggle';
import Modal from '@/components/Modal';
import { logout } from '@/lib/auth';
import { MENU_PAR_ROLE } from '@/lib/dash';
import {
  LogOut, Menu, User, MessageCircle,
  LayoutDashboard, Users, KeyRound, Hotel, CalendarDays, CalendarPlus, Plus,
  BarChart3, History, Settings, Archive, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

// URL absolue de la photo de profil (chemin relatif servi par l'API).
function urlPhoto(chemin) {
  if (!chemin) return null;
  if (chemin.startsWith('http')) return chemin;
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');
  return `${base}${chemin}`;
}

const LIBELLES_ROLE = {
  ADMIN: 'Administrateur',
  RH: 'Ressources Humaines',
  CHEF_SERVICE: 'Chef de service',
};

const CLE_SIDEBAR_REDUITE = 'zomatel:sidebar-reduite'; // '1' = mode reduit

// Resolution des noms d'icones lucide-react du menu partage (lib/dash.js).
const ICONES = { LayoutDashboard, Users, KeyRound, Hotel, CalendarDays, CalendarPlus, Plus, BarChart3, History, Settings, Archive, MessageCircle };

export default function DashShell({ user, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ouvert, setOuvert] = useState(false); // sidebar mobile (drawer)
  const [reduite, setReduite] = useState(false); // sidebar mode icônes seules
  const [confirmDeconnexion, setConfirmDeconnexion] = useState(false);
  const [photoProfil, setPhotoProfil] = useState(user?.photo_profil || null);
  // Preference d'affichage du bloc profil (Parametres -> Apparence).
  // Lue au montage (pas pendant le render) pour eviter tout mismatch.
  const [profilVisible, setProfilVisible] = useState(true);

  useEffect(() => {
    // Preference sidebar reduite (apres montage : anti-hydratation).
    try {
      setReduite(localStorage.getItem(CLE_SIDEBAR_REDUITE) === '1');
    } catch { setReduite(false); }

    function lirePreference() {
      try {
        setProfilVisible(localStorage.getItem('zomatel:profil-sidebar') !== '0');
      } catch (_) {
        setProfilVisible(true);
      }
    }
    lirePreference();
    window.addEventListener('zomatel:preferences', lirePreference);
    return () => window.removeEventListener('zomatel:preferences', lirePreference);
  }, []);

  // Photo a jour depuis le serveur (le JWT n'est pas re-emis : la photo peut
  // changer sans reconnexion). Un seul appel discret, silencieux en cas d'erreur.
  // Deplace dans un useEffect : AUCUN effet de bord ni setState pendant le
  // rendu (source du warning « Cannot update a component (HotReload) while
  // rendering a different component (DashShell) »). La cle sessionStorage
  // evite les appels repetes. Place AVANT le return conditionnel pour garder
  // un ordre de hooks stable.
  useEffect(() => {
    if (!user?.id_utilisateur) return;
    if (sessionStorage.getItem('zomatel:photo-chargee') === '1') return;
    sessionStorage.setItem('zomatel:photo-chargee', '1');
    api.get('/auth/me').then((data) => {
      if (data?.user?.photo_profil !== undefined) {
        setPhotoProfil(data.user.photo_profil || null);
        saveSession(getToken(), { ...user, photo_profil: data.user.photo_profil });
      }
    }).catch(() => { /* silencieux : la photo ne doit pas casser le shell */ });
  }, [user]);

  if (!user) return null;

  function basculerReduire() {
    setReduite((r) => {
      const prochain = !r;
      try { localStorage.setItem(CLE_SIDEBAR_REDUITE, prochain ? '1' : '0'); } catch { /* session seule */ }
      return prochain;
    });
  }

  const initiales = (user.prenom || user.nom_utilisateur || user.login || '?')
    .split(' ')
    .map((m) => m[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const nomCourt = [user.prenom, user.nom].filter(Boolean).join(' ') || user.nom_utilisateur || user.login || 'Profil';

  // Fonction de déconnexion EXISTANTE (lib/auth) : confirmation avant l'appel.
  function deconnexion() {
    setConfirmDeconnexion(false);
    logout();
    router.push('/login');
  }

  return (
    <div className={`dash-layout ${reduite ? 'dash-sidebar-reduite' : ''}`}>
      <aside className={`dash-sidebar ${ouvert ? 'ouverte' : ''} ${reduite ? 'reduite' : ''}`}>
        <div className="dash-brand">
          {/* Monogramme « Z » : couleur principale Zomatel sur pastille blanche,
              proportion gardée avec le texte (42 px vs 16 px), alignement propre. */}
          <span className="dash-logo-z monogramme-z" aria-hidden="true">Z</span>
          <span className="dash-brand-texte">
            <strong>Zomatel</strong>
            <small>Planning hôtelier</small>
          </span>
        </div>

        <nav className="dash-nav">
          {MENU_PAR_ROLE[user.role].map((l) => {
            const actif = pathname === l.href;
            const Icone = ICONES[l.icone];
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`dash-lien ${actif ? 'actif' : ''}`}
                title={l.label} // tooltip natif (mode développé) + aide
                data-tooltip={l.label} // tooltip CSS (mode réduit, survol/focus)
                aria-current={actif ? 'page' : undefined}
                onClick={() => setOuvert(false)}
              >
                <span className="dash-icone">
                  {Icone ? <Icone size={17} strokeWidth={2} aria-hidden="true" /> : null}
                </span>
                <span className="dash-lien-texte">{l.label}</span>
                {/* Badge non-lus dynamique (données réelles) pour la Messagerie */}
                {l.href === '/messagerie' && <MessengerBadge />}
              </Link>
            );
          })}
        </nav>

        <div className="dash-sidebar-pied">
          {/* Reduire / developper le menu : icône seule en mode reduit. */}
          <button
            className="dash-reduire"
            onClick={basculerReduire}
            title={reduite ? 'Développer le menu' : 'Réduire le menu'}
            data-tooltip={reduite ? 'Développer le menu' : 'Réduire le menu'}
            aria-label={reduite ? 'Développer le menu' : 'Réduire le menu'}
            aria-expanded={!reduite}
          >
            {reduite ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
            <span className="dash-lien-texte">Réduire le menu</span>
          </button>

          {/* Profil cliquable -> page /profile (avatar + nom, meme cible que la topbar).
              Masquable depuis Parametres -> Apparence (preference locale). */}
          {profilVisible && (
          <Link
            href="/profile"
            className="dash-profil"
            title="Mon profil"
            data-tooltip="Mon profil"
          >
            {urlPhoto(photoProfil) ? (
              <img src={urlPhoto(photoProfil)} alt="" className="dash-avatar dash-avatar-photo" />
            ) : (
              <span className="dash-avatar" aria-hidden="true"><User size={15} /></span>
            )}
            <span className="dash-profil-texte">
              <span className="dash-profil-nom">{nomCourt}</span>
              <small className="dash-profil-role">{LIBELLES_ROLE[user.role] || user.role}</small>
            </span>
          </Link>
          )}
          <button
            className="dash-deconnexion"
            onClick={() => setConfirmDeconnexion(true)}
            title="Déconnexion"
            data-tooltip="Déconnexion"
          >
            <LogOut size={15} aria-hidden="true" /> <span className="dash-lien-texte">Déconnexion</span>
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
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="dash-topbar-titre">
            <strong>{LIBELLES_ROLE[user.role] || user.role}</strong>
            {user.service_nom && <span className="muted"> · {user.service_nom}</span>}
          </div>
          <div className="dash-topbar-droite">
            <ThemeToggle />
            {/* Messages : element DISTINCT de la cloche (icône + compteur rouge
                propre, aucun mélange des deux compteurs). */}
            <MessengerBouton />
            <NotificationBell />
            {/* Profil compact : photo + nom + role -> /profile.
                Sur petit ecran, seul l'avatar reste visible (CSS). */}
            <Link href="/profile" className="navbar-profil" title="Mon profil">
              {urlPhoto(photoProfil) ? (
                <img src={urlPhoto(photoProfil)} alt="" className="navbar-profil-avatar-img" />
              ) : (
                <span className="navbar-profil-avatar" aria-hidden="true">{initiales}</span>
              )}
              <span className="navbar-profil-texte">
                <strong>{nomCourt}</strong>
                <small>{LIBELLES_ROLE[user.role] || user.role}</small>
              </span>
            </Link>
          </div>
        </header>

        <main className="dash-main">{children}</main>
      </div>

      {confirmDeconnexion && (
        <Modal titre="Confirmer la déconnexion" onClose={() => setConfirmDeconnexion(false)} largeur={400}>
          <p style={{ marginTop: 0 }}>Voulez-vous vraiment vous déconnecter ?</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setConfirmDeconnexion(false)}>Annuler</button>
            <button className="btn danger" onClick={deconnexion}>Se déconnecter</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
