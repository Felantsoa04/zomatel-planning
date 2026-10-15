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
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { saveSession, getToken, getUser } from '@/lib/auth';
// NB : la page passe le contenu via children (React) — on le rend ci-dessous.
// (l'ancien prop « enfants » n'a jamais ete alimente : le <main> restait vide)
import NotificationBell from '@/components/NotificationBell';
import MessengerBouton from '@/components/MessengerBouton';
import MessengerBadge from '@/components/MessengerBadge';
import ThemeToggle from '@/components/ThemeToggle';
import Modal from '@/components/Modal';
import { logout } from '@/lib/auth';
import { dashboardDe, MENU_PRINCIPAL } from '@/lib/dash';
import { permissionRequisePourPage } from '@/lib/permissions';
import { useI18n } from '@/lib/i18n';
import {
  LogOut, Menu, User, MessageCircle,
  LayoutDashboard, Users, KeyRound, Hotel, CalendarDays,
  BarChart3, History, Settings, Archive, PanelLeftClose, PanelLeftOpen, ClipboardCheck, ScanLine,
} from 'lucide-react';

// URL absolue de la photo de profil (chemin relatif servi par l'API).
function urlPhoto(chemin) {
  if (!chemin) return null;
  if (chemin.startsWith('http')) return chemin;
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');
  return `${base}${chemin}`;
}

const CLE_SIDEBAR_REDUITE = 'zomatel:sidebar-reduite'; // '1' = mode reduit

// Resolution des noms d'icones lucide-react du menu partage (lib/dash.js).
const ICONES = { LayoutDashboard, Users, KeyRound, Hotel, CalendarDays, BarChart3, History, Settings, Archive, MessageCircle, ClipboardCheck, ScanLine };
const MENU_CLES_TRADUCTION = {
  '/dashboard': 'nav.dashboard',
  '/validations': 'nav.validations',
  '/planning/gestion': 'nav.planning',
  '/planning/numerisation': 'nav.numerisation',
  '/employees': 'nav.employees',
  '/service': 'nav.services',
  '/messagerie': 'nav.messenger',
  '/statistiques': 'nav.statistics',
  '/archives': 'nav.archives',
  '/historique': 'nav.history',
  '/utilisateurs': 'nav.users',
};

function groupeDuLien(href) {
  if (href.startsWith('/dashboard') || href.startsWith('/planning/') || ['/employees', '/service', '/validations'].includes(href)) {
    return 'Principal';
  }
  if (['/utilisateurs', '/parametres'].includes(href)) return 'Administration';
  return 'Outils';
}

function lienEstActif(href, pathname) {
  if (pathname === href) return true;
  return href === '/planning/gestion'
    && pathname.startsWith('/planning/');
}

export default function DashShell({ user, children }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [ouvert, setOuvert] = useState(false); // sidebar mobile (drawer)
  const [reduite, setReduite] = useState(false); // sidebar mode icônes seules
  const [confirmDeconnexion, setConfirmDeconnexion] = useState(false);
  const [photoProfil, setPhotoProfil] = useState(user?.photo_profil || null);
  const [permissions, setPermissions] = useState([]);
  const [permissionsChargees, setPermissionsChargees] = useState(false);
  const [erreurPermissions, setErreurPermissions] = useState('');
  const [tooltip, setTooltip] = useState(null);
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

  // Permissions et photo viennent de la session API ; les droits sont relus
  // pour refléter immédiatement les changements faits par un administrateur.
  // FIX POPS DE FOCUS (cause racine) : l'effet dépend de l'IDENTIFIANT du
  // compte, pas de la REFÉRENCE de l'objet user. Avant, tout fournisseur qui
  // recréait l'objet user (même avec les mêmes données) rejouait l'effet :
  // permissionsChargees -> false -> REMONTAGE des children -> perte de focus
  // après chaque caractère saisi. La clé stable corrige durablement pour
  // toute l'application.
  useEffect(() => {
    const identifiant = user?.id_utilisateur;
    if (!identifiant) return;
    setPermissionsChargees(false);
    api.get('/auth/me').then((data) => {
      const compte = data?.user;
      if (!compte || !Array.isArray(compte.permissions)) {
        throw new Error('Les autorisations du compte ne sont pas disponibles.');
      }
      setPermissions(compte.permissions);
      setPhotoProfil(compte.photo_profil || null);
      setErreurPermissions('');
      // Fusion de session : on repart de la session ACTUELLE (getUser) et non
      // de la closure `user` — l'objet est enrichi sans restaurer une version
      // périmée si le compte a été rechargé entre-temps.
      const sessionActuelle = getUser() || {};
      saveSession(getToken(), { ...sessionActuelle, ...compte });
    }).catch((err) => {
      setPermissions([]);
      setErreurPermissions(err.message || 'Impossible de charger les autorisations.');
    }).finally(() => setPermissionsChargees(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id_utilisateur]);

  if (!user) return null;

  function basculerReduire() {
    setTooltip(null);
    setReduite((r) => {
      const prochain = !r;
      try { localStorage.setItem(CLE_SIDEBAR_REDUITE, prochain ? '1' : '0'); } catch { /* session seule */ }
      return prochain;
    });
  }

  function afficherTooltip(label, element) {
    if (!reduite || window.matchMedia('(max-width: 900px)').matches) return;
    const rect = element.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  }

  function masquerTooltip() {
    setTooltip(null);
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

  const menus = MENU_PRINCIPAL
    .map((item) => item.href === '/dashboard'
      ? { ...item, href: dashboardDe(user.role) }
      : item)
    .map((item) => ({ ...item, label: t(MENU_CLES_TRADUCTION[item.href] || 'nav.dashboard') }))
    .filter((item) => !item.permission || permissions.includes(item.permission))
    .filter((item) => !item.permissions || item.permissions.every((code) => permissions.includes(code)))
    .filter((item) => !item.permissionsAny || item.permissionsAny.some((code) => permissions.includes(code)));
  const groupesMenu = [
    { label: 'nav.main', id: 'Principal' },
    { label: 'nav.tools', id: 'Outils' },
    { label: 'nav.admin', id: 'Administration' },
  ]
    .map(({ label, id }) => ({ label: t(label), liens: menus.filter((l) => groupeDuLien(l.href) === id) }))
    .filter((groupe) => groupe.liens.length > 0);

  const permissionsPage = permissionRequisePourPage(pathname || '');
  const accesPageAutorise = permissionsPage.every((alternatives) =>
    alternatives.some((code) => permissions.includes(code))
  );

  return (
    <div className={`dash-layout ${reduite ? 'dash-sidebar-reduite' : ''}`}>
      <aside
        id="navigation-principale"
        className={`dash-sidebar ${ouvert ? 'ouverte' : ''} ${reduite ? 'reduite' : ''}`}
        aria-label="Navigation principale"
      >
        <div className="dash-brand">
          <img src="/logo-zomatel-embleme.svg" alt="Zomatel" className="dash-logo dash-logo-z" />
          <span className="dash-brand-texte">
            <strong>Zomatel</strong>
            <small>{t('app.subtitle')}</small>
          </span>
        </div>

        <nav className="dash-nav">
          {groupesMenu.map((groupe) => (
            <div className="dash-nav-groupe" key={groupe.label}>
              <span className="dash-nav-groupe-label">{groupe.label}</span>
              {groupe.liens.map((l) => {
                const actif = lienEstActif(l.href, pathname || '');
                const Icone = ICONES[l.icone];
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`dash-lien ${actif ? 'actif' : ''}`}
                    data-tooltip={l.label}
                    aria-current={actif ? 'page' : undefined}
                    onMouseEnter={(event) => afficherTooltip(l.label, event.currentTarget)}
                    onMouseLeave={masquerTooltip}
                    onFocus={(event) => afficherTooltip(l.label, event.currentTarget)}
                    onBlur={masquerTooltip}
                    onClick={() => { setOuvert(false); masquerTooltip(); }}
                  >
                    <span className="dash-icone">
                      {Icone ? <Icone size={17} strokeWidth={2} aria-hidden="true" /> : null}
                    </span>
                    <span className="dash-lien-texte">{l.label}</span>
                    {l.href === '/messagerie' && <MessengerBadge />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="dash-sidebar-pied">
          {/* Reduire / developper le menu : icône seule en mode reduit. */}
          <button
            className="dash-reduire"
            onClick={basculerReduire}
            data-tooltip={reduite ? t('nav.expand') : t('nav.collapse')}
            aria-label={reduite ? t('nav.expand') : t('nav.collapse')}
            aria-expanded={!reduite}
            aria-controls="navigation-principale"
            onMouseEnter={(event) => afficherTooltip(reduite ? t('nav.expand') : t('nav.collapse'), event.currentTarget)}
            onMouseLeave={masquerTooltip}
            onFocus={(event) => afficherTooltip(reduite ? 'Développer le menu' : 'Réduire le menu', event.currentTarget)}
            onBlur={masquerTooltip}
          >
            {reduite ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
            <span className="dash-lien-texte">{reduite ? t('nav.expand') : t('nav.collapse')}</span>
          </button>

          {/* Profil cliquable -> page /profile (avatar + nom, meme cible que la topbar).
              Masquable depuis Parametres -> Apparence (preference locale). */}
          {profilVisible && (
          <Link
            href="/profile"
            className={`dash-profil ${pathname === '/profile' ? 'actif' : ''}`}
            aria-label={`${t('nav.profile')} : ${nomCourt}`}
            aria-current={pathname === '/profile' ? 'page' : undefined}
            data-tooltip={t('nav.profile')}
            onMouseEnter={(event) => afficherTooltip(t('nav.profile'), event.currentTarget)}
            onMouseLeave={masquerTooltip}
            onFocus={(event) => afficherTooltip('Mon profil', event.currentTarget)}
            onBlur={masquerTooltip}
          >
            {urlPhoto(photoProfil) ? (
              <img src={urlPhoto(photoProfil)} alt="" className="dash-avatar dash-avatar-photo" />
            ) : (
              <span className="dash-avatar" aria-hidden="true"><User size={15} /></span>
            )}
            <span className="dash-profil-texte">
              <span className="dash-profil-nom">{nomCourt}</span>
              <small className="dash-profil-role">{t(`role.${user.role === 'ADMIN' ? 'admin' : user.role === 'RH' ? 'hr' : 'chef'}`)}</small>
            </span>
          </Link>
          )}
          <button
            className="dash-deconnexion"
            onClick={() => setConfirmDeconnexion(true)}
            aria-label={t('nav.logout')}
            data-tooltip={t('nav.logout')}
            onMouseEnter={(event) => afficherTooltip(t('nav.logout'), event.currentTarget)}
            onMouseLeave={masquerTooltip}
            onFocus={(event) => afficherTooltip('Déconnexion', event.currentTarget)}
            onBlur={masquerTooltip}
          >
            <LogOut size={15} aria-hidden="true" /> <span className="dash-lien-texte">{t('nav.logout')}</span>
          </button>
        </div>
      </aside>

      {ouvert && <div className="dash-voile" onClick={() => setOuvert(false)} />}

      <div className="dash-contenu">
        <header className="dash-topbar">
          <button
            className="dash-burger"
            onClick={() => setOuvert((o) => !o)}
            aria-label={t('nav.main')}
            aria-expanded={ouvert}
            aria-controls="navigation-principale"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="dash-topbar-titre">
            <strong>{t(`role.${user.role === 'ADMIN' ? 'admin' : user.role === 'RH' ? 'hr' : 'chef'}`)}</strong>
          </div>
          <div className="dash-topbar-droite">
            <ThemeToggle />
            {/* Paramètres : accès principal de l'application, en haut de la
                page près du profil (l'entrée a été retirée de la sidebar). */}
            <Link
              href="/parametres"
              className={`navbar-profil dash-outil-parametres ${pathname.startsWith('/parametres') ? 'actif' : ''}`}
              aria-label="Paramètres"
              title="Paramètres"
              aria-current={pathname === '/parametres' ? 'page' : undefined}
            >
              <Settings size={18} aria-hidden="true" />
              <span className="navbar-profil-texte">
                <strong>Paramètres</strong>
              </span>
            </Link>
            {/* Messages : element DISTINCT de la cloche (icône + compteur rouge
                propre, aucun mélange des deux compteurs). */}
            {permissions.includes('messenger.use') && <MessengerBouton />}
            <NotificationBell />
            {/* Profil compact : photo + nom + role -> /profile.
                Sur petit ecran, seul l'avatar reste visible (CSS). */}
            <Link href="/profile" className="navbar-profil" aria-label={`${t('nav.profile')} : ${nomCourt}`} aria-current={pathname === '/profile' ? 'page' : undefined}>
              {urlPhoto(photoProfil) ? (
                <img src={urlPhoto(photoProfil)} alt="" className="navbar-profil-avatar-img" />
              ) : (
                <span className="navbar-profil-avatar" aria-hidden="true">{initiales}</span>
              )}
              <span className="navbar-profil-texte">
                <strong>{nomCourt}</strong>
                <small>{t(`role.${user.role === 'ADMIN' ? 'admin' : user.role === 'RH' ? 'hr' : 'chef'}`)}</small>
              </span>
            </Link>
          </div>
        </header>

        <main className="dash-main">
          {erreurPermissions && (
            <div className="error" role="alert">{erreurPermissions}</div>
          )}
          {!permissionsChargees ? (
            <p className="muted">{t('common.loadingPermissions')}</p>
          ) : !accesPageAutorise ? (
            <div className="container">
              <div className="error" role="alert">{t('common.permissionRequired')}</div>
            </div>
          ) : children}
        </main>
      </div>

      {confirmDeconnexion && (
        <Modal titre={t('settings.logoutConfirm')} onClose={() => setConfirmDeconnexion(false)} largeur={400}>
          <p style={{ marginTop: 0 }}>{t('settings.logoutPrompt')}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setConfirmDeconnexion(false)}>{t('common.cancel')}</button>
            <button className="btn danger" onClick={deconnexion}>{t('settings.logout')}</button>
          </div>
        </Modal>
      )}
      {tooltip && typeof document !== 'undefined' && createPortal(
        <span
          id="dash-tooltip"
          role="tooltip"
          className="dash-tooltip"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          {tooltip.label}
        </span>,
        document.body
      )}
    </div>
  );
}
