'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bell, BriefcaseBusiness, CalendarDays, Check, ChevronRight, CircleUserRound,
  Clock3, Hotel, LockKeyhole, LogOut, PanelLeft, Rows3, Rows4,
  Settings, ShieldCheck, UserRound, Users, Languages,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import Modal from '@/components/Modal';
import { api } from '@/lib/api';
import { getToken, getUser, logout } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import { LANGUES, useI18n } from '@/lib/i18n';

const CLE_DENSITE = 'zomatel:densite-tableaux';
const CLE_PROFIL_SIDEBAR = 'zomatel:profil-sidebar';

const LIBELLES_ROLE = {
  ADMIN: 'Administrateur',
  RH: 'Ressources Humaines',
  CHEF_SERVICE: 'Chef de service',
};

function appliquerDensite(mode) {
  if (typeof document !== 'undefined') document.documentElement.dataset.densite = mode;
}

function urlPhoto(chemin) {
  if (!chemin) return null;
  if (chemin.startsWith('http')) return chemin;
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api')
    .replace(/\/api\/?$/, '');
  return `${base}${chemin}`;
}

export default function ParametresPage() {
  const { autorise, chargees } = usePermissions();
  const { langue, setLangue, t } = useI18n();
  const [user, setUser] = useState(null);
  const [nomService, setNomService] = useState('');
  const [densite, setDensite] = useState('confort');
  const [profilSidebar, setProfilSidebar] = useState(true);
  const [confirmDeconnexion, setConfirmDeconnexion] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = getToken();
    const compte = getUser();
    if (!token || !compte) {
      router.replace('/login');
      return;
    }
    setUser(compte);

    const d = localStorage.getItem(CLE_DENSITE);
    if (d === 'compact' || d === 'confort') {
      setDensite(d);
      appliquerDensite(d);
    }
    setProfilSidebar(localStorage.getItem(CLE_PROFIL_SIDEBAR) !== '0');

    if (compte.id_service) {
      api.get('/services', token).then((services) => {
        const service = Array.isArray(services)
          ? services.find((item) => Number(item.id_service) === Number(compte.id_service))
          : null;
        setNomService(service?.nom || '');
      }).catch(() => setNomService(''));
    }
  }, [router]);

  function choisirDensite(mode) {
    setDensite(mode);
    appliquerDensite(mode);
    try {
      localStorage.setItem(CLE_DENSITE, mode);
    } catch {
      // La préférence reste appliquée pour cette session.
    }
  }

  function basculerProfilSidebar() {
    const nouveau = !profilSidebar;
    setProfilSidebar(nouveau);
    try {
      localStorage.setItem(CLE_PROFIL_SIDEBAR, nouveau ? '1' : '0');
    } catch {
      // La préférence reste appliquée pour cette session.
    }
    window.dispatchEvent(new CustomEvent('zomatel:preferences'));
  }

  function seDeconnecter() {
    setConfirmDeconnexion(false);
    logout();
    router.push('/login');
  }

  const sections = [
    {
      id: 'profil',
      titre: t('settings.profile'),
      description: t('settings.profileDescription'),
      href: '/profile',
      action: t('settings.editProfile'),
      icone: CircleUserRound,
      visible: true,
    },
    {
      id: 'utilisateurs',
      titre: t('settings.users'),
      description: t('settings.usersDescription'),
      href: '/utilisateurs',
      action: t('settings.manageUsers'),
      icone: Users,
      visible: autorise('user.view'),
      detail: [
        autorise('user.create') && t('permissions.createAllowed'),
        autorise('user.update') && t('permissions.updateAllowed'),
      ].filter(Boolean),
    },
    {
      id: 'services',
      titre: t('settings.services'),
      description: t('settings.servicesDescription'),
      href: '/service',
      action: t('settings.manageServices'),
      icone: Hotel,
      visible: autorise('service.manage'),
    },
    {
      id: 'regles',
      titre: t('settings.planningRules'),
      description: t('settings.planningRulesDescription'),
      href: autorise('planning.create')
        ? '/planning/new'
        : autorise('planning.view')
          ? '/planning/gestion'
          : '/validations',
      action: autorise('planning.create')
        ? t('settings.openCreation')
        : autorise('planning.view')
          ? t('settings.viewPlannings')
          : t('settings.openValidations'),
      icone: CalendarDays,
      visible: autorise('planning.view') || autorise('planning.create') || autorise('planning.validate'),
      detail: ['planning.submit', 'planning.validate', 'planning.update']
        .filter((code) => autorise(code)).length ? [t('settings.actionsByPermission')] : [],
    },
    {
      id: 'notifications',
      titre: t('settings.notifications'),
      description: t('settings.notificationsDescription'),
      href: '/historique',
      action: t('settings.viewHistory'),
      icone: Bell,
      visible: true,
    },
  ].filter((section) => section.visible);

  const initiales = [user?.prenom, user?.nom]
    .filter(Boolean)
    .map((partie) => partie.trim()[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase() || user?.login?.slice(0, 2).toUpperCase() || '?';
  const photo = urlPhoto(user?.photo_profil);

  return (
    <AppShell>
      <div className="container parametres-page">
        <header className="parametres-entete">
          <div>
            <p className="parametres-surtitre">{t('settings.accountApp')}</p>
            <h1><Settings size={21} aria-hidden="true" /> {t('settings.title')}</h1>
            <p className="muted">{t('settings.subtitle')}</p>
          </div>
        </header>

        {chargees && (
          <nav className="parametres-navigation" aria-label="Catégories des paramètres">
            {sections.map(({ id, titre, icone: Icone }) => (
              <a href={`#param-${id}`} key={id}>
                <Icone size={15} aria-hidden="true" /> {titre}
              </a>
            ))}
            <a href="#param-securite"><LockKeyhole size={15} aria-hidden="true" /> {t('settings.security')}</a>
            <a href="#param-preferences"><Rows3 size={15} aria-hidden="true" /> {t('settings.preferences')}</a>
          </nav>
        )}

        <div className="parametres-grille">
          <section id="param-profil" className="card parametres-carte parametres-profil">
            <div className="parametres-titre-section">
              <CircleUserRound size={18} aria-hidden="true" />
              <div>
                <h2>Mon profil</h2>
                <p>{t('settings.profileIdentity')}</p>
              </div>
            </div>
            <div className="parametres-identite">
              {photo
                ? <img className="parametres-avatar" src={photo} alt="Photo de profil" />
                : <span className="parametres-avatar parametres-avatar-initiales">{initiales}</span>}
              <div className="parametres-identite-texte">
                <strong>{[user?.prenom, user?.nom].filter(Boolean).join(' ') || 'Mon compte'}</strong>
                <span>{user?.login ? `@${user.login}` : t('settings.usernameMissing')}</span>
              </div>
            </div>
            <dl className="parametres-profil-details">
              <div><dt><ShieldCheck size={14} aria-hidden="true" /> {t('profile.role')}</dt><dd>{LIBELLES_ROLE[user?.role] ? t(`role.${user.role === 'ADMIN' ? 'admin' : user.role === 'RH' ? 'hr' : 'chef'}`) : user?.role || '—'}</dd></div>
              <div><dt><BriefcaseBusiness size={14} aria-hidden="true" /> {t('profile.service')}</dt><dd>{nomService || (user?.id_service ? t('common.loading') : t('settings.notProvided'))}</dd></div>
            </dl>
            <Link href="/profile" className="btn secondary parametres-action">
              <UserRound size={15} aria-hidden="true" /> {t('settings.editProfile')} <ChevronRight size={15} aria-hidden="true" />
            </Link>
          </section>

          {sections.filter((section) => section.id !== 'profil').map((section) => {
            const Icone = section.icone;
            return (
              <section id={`param-${section.id}`} className="card parametres-carte" key={section.id}>
                <div className="parametres-titre-section">
                  <Icone size={18} aria-hidden="true" />
                  <div>
                    <h2>{section.titre}</h2>
                    <p>{section.description}</p>
                  </div>
                </div>
                {section.detail?.length > 0 && (
                  <p className="parametres-detail-permission">{section.detail.join(' · ')}</p>
                )}
                {section.id === 'regles' && (
                  <ul className="parametres-regles">
                    <li><Clock3 size={14} aria-hidden="true" /> {t('settings.weeklyReference')}</li>
                    <li><Check size={14} aria-hidden="true" /> {t('settings.planningRulesIntegrated')}</li>
                    <li><CalendarDays size={14} aria-hidden="true" /> {t('settings.dynamicWeeks')}</li>
                  </ul>
                )}
                {section.id === 'notifications' && (
                  <p className="parametres-note">
                    {t('settings.noNotificationOptions')}
                  </p>
                )}
                <Link href={section.href} className="btn secondary parametres-action">
                  {section.action} <ChevronRight size={15} aria-hidden="true" />
                </Link>
              </section>
            );
          })}

          <section id="param-securite" className="card parametres-carte">
            <div className="parametres-titre-section">
              <LockKeyhole size={18} aria-hidden="true" />
              <div><h2>{t('settings.security')}</h2><p>{t('settings.securityDescription')}</p></div>
            </div>
            <p className="parametres-note">
              {t('settings.noSecurityApi')}
            </p>
            <button type="button" className="btn secondary parametres-action" onClick={() => setConfirmDeconnexion(true)}>
              <LogOut size={15} aria-hidden="true" /> {t('settings.logout')}
            </button>
          </section>

          <section id="param-preferences" className="card parametres-carte parametres-preferences">
            <div className="parametres-titre-section">
              <Rows3 size={18} aria-hidden="true" />
              <div><h2>{t('settings.preferences')}</h2><p>{t('settings.localPreferences')}</p></div>
            </div>
            <div className="param-ligne">
              <span>{t('settings.language')}<span className="muted" style={{ display: 'block', fontSize: 12 }}>{t('settings.languageDescription')}</span></span>
              <label className="parametres-langue">
                <Languages size={15} aria-hidden="true" />
                <select aria-label={t('settings.language')} value={langue} onChange={(event) => setLangue(event.target.value)}>
                  {LANGUES.map((option) => <option key={option.code} value={option.code}>{option.nom}</option>)}
                </select>
              </label>
            </div>
            <div className="param-ligne">
              <span>{t('settings.density')}<span className="muted" style={{ display: 'block', fontSize: 12 }}>{t('settings.densityDescription')}</span></span>
              <span className="parametres-choix">
                <button type="button" className={`btn secondary ${densite === 'confort' ? 'param-actif' : ''}`} onClick={() => choisirDensite('confort')} aria-pressed={densite === 'confort'}>
                  {densite === 'confort' ? <Check size={14} aria-hidden="true" /> : <Rows3 size={14} aria-hidden="true" />} {t('settings.comfort')}
                </button>
                <button type="button" className={`btn secondary ${densite === 'compact' ? 'param-actif' : ''}`} onClick={() => choisirDensite('compact')} aria-pressed={densite === 'compact'}>
                  {densite === 'compact' ? <Check size={14} aria-hidden="true" /> : <Rows4 size={14} aria-hidden="true" />} {t('settings.compact')}
                </button>
              </span>
            </div>
            <div className="param-ligne">
              <span>{t('settings.sidebarProfile')}<span className="muted" style={{ display: 'block', fontSize: 12 }}>{t('settings.sidebarProfileDescription')}</span></span>
              <button type="button" className="btn secondary" onClick={basculerProfilSidebar} aria-pressed={profilSidebar}>
                <PanelLeft size={14} aria-hidden="true" /> {profilSidebar ? t('settings.shown') : t('settings.hidden')}
              </button>
            </div>
            <div className="parametres-valeurs-defaut">
              <span><strong>{t('settings.dateFormat')}</strong> {t('settings.localeDateValue')}</span>
              <span><strong>{t('settings.weekStarts')}</strong> {t('settings.monday')}</span>
              <small>{t('settings.noLocalePreferences')}</small>
            </div>
          </section>
        </div>

        {confirmDeconnexion && (
          <Modal titre={t('settings.logoutConfirm')} onClose={() => setConfirmDeconnexion(false)} largeur={400}>
            <p style={{ marginTop: 0 }}>{t('settings.logoutPrompt')}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn secondary" onClick={() => setConfirmDeconnexion(false)}>{t('common.cancel')}</button>
              <button className="btn danger" onClick={seDeconnecter}><LogOut size={14} aria-hidden="true" /> {t('settings.logout')}</button>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  );
}
