'use client';

// VUE DASHBOARD PARTAGEE — une seule implementation, montee par 3 pages :
//   /dashboard/admin (ADMIN) · /dashboard/rh (RH) · /dashboard/chef (CHEF_SERVICE)
// Garde double : la page verifie le role AVANT le rendu, et ce composant le
// reverifie apres montage (un chef ne peut pas voir la vue RH en changeant l'URL).
// Donnees 100 % reelles via les API existantes ; l'EMPLOYE n'a pas d'espace.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, CalendarDays, Eye, Pencil, Trash2, Unlock, Send,
  RefreshCw, X, ChevronLeft, ChevronRight,
  ChevronsUpDown, ChevronUp, ChevronDown,
} from 'lucide-react';
import DashShell from '@/components/DashShell';
import BadgeStatutPlanning, { IconeStatutPlanning } from '@/components/BadgeStatutPlanning';
import CalendarWidget from '@/components/CalendarWidget';
import PlanningRhSemaineSection from '@/components/PlanningRhSemaineSection';
import { api } from '@/lib/api';
import { getToken, getUser, logout } from '@/lib/auth';
import { periodeCourte, dashboardDe } from '@/lib/dash';
import { useI18n } from '@/lib/i18n';

function libelleStatut(statut, traduire) {
  if (!statut) return '—';
  const cle = `status.${statut}`;
  const libelle = traduire(cle);
  return libelle === cle ? statut : libelle;
}

export default function DashboardView({ roleAutorise }) {
  const { t } = useI18n();
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [plannings, setPlannings] = useState([]);
  const [services, setServices] = useState([]);
  const [semaineFiltre, setSemaineFiltre] = useState('');
  const [anneeFiltre, setAnneeFiltre] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('');
  const [serviceFiltre, setServiceFiltre] = useState('');
  const [tri, setTri] = useState({ colonne: null, direction: 'asc' });
  const [pagePlannings, setPagePlannings] = useState(1);
  const [error, setError] = useState('');
  const [loadingPlannings, setLoadingPlannings] = useState(true);
  const router = useRouter();

  // Les plannings alimentent la liste et les outils opérationnels du dashboard.
  const chargerPlannings = useCallback(async () => {
    setLoadingPlannings(true);
    try {
      const liste = await api.get('/plannings', getToken());
      setPlannings(Array.isArray(liste) ? liste : []);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoadingPlannings(false);
    }
  }, []);

  useEffect(() => {
    // Session lue APRES montage (pattern anti-hydratation du projet).
    const u = getUser();
    const token = getToken();
    if (!token || !u) {
      router.replace('/login');
      return;
    }
    // L'EMPLOYE n'a pas d'espace dans l'application : purge de la session
    // residuelle (sinon le token reste et produit des 403 sur les appels API).
    if (u.role === 'EMPLOYE') {
      logout();
      router.replace('/login');
      return;
    }
    // GARDE DE ROLE : chacun ne voit que SON dashboard, meme en modifiant l'URL.
    if (u.role !== roleAutorise) {
      router.replace(dashboardDe(u.role) || '/login');
      return;
    }
    setUser(u);
    // Filtre statut depuis l'URL (acces rapides "A valider" / "A soumettre")
    const s = new URLSearchParams(window.location.search).get('statut');
    if (s) setStatutFiltre(s);

    (async () => {
      try {
        const session = await api.get('/auth/me', token);
        const compte = session?.user;
        if (!compte || !Array.isArray(compte.permissions)) {
          throw new Error('Les autorisations du compte ne sont pas disponibles.');
        }
        const compteActuel = { ...u, ...compte };
        const permissionsActuelles = compte.permissions;
        setUser(compteActuel);
        setPermissions(permissionsActuelles);

        // Plannings (backend : chef -> son service uniquement, EMPLOYE -> 403)
        if (permissionsActuelles.includes('planning.view')) {
          await chargerPlannings();
        } else {
          setLoadingPlannings(false);
        }

        // La liste des services sert uniquement au filtre des plannings.
        const srv = await api.get('/services', token);
        setServices(Array.isArray(srv) ? srv : []);
      } catch (err) {
        setError(err.message);
        setLoadingPlannings(false);
      }
    })();
  }, [router, roleAutorise, chargerPlannings]);

  const autorise = (...codes) => codes.every((code) => permissions.includes(code));

  // Tableaux sûrs : les useMemo travaillent toujours sur des tableaux, même
  // quand les données API ne sont pas encore chargées (useState([]) initial).
  const listePlannings = Array.isArray(plannings) ? plannings : [];

  const annees = useMemo(
    () => [...new Set([...listePlannings.map((p) => p.annee), new Date().getFullYear()])]
      .sort((a, b) => b - a),
    [listePlannings]
  );
  const semaines = useMemo(
    () => [...new Map(listePlannings.map((p) => {
      const cle = `${p.annee}-W${String(p.numero_semaine).padStart(2, '0')}`;
      return [cle, { cle, annee: p.annee, numero: p.numero_semaine }];
    })).values()].sort((a, b) => b.annee - a.annee || b.numero - a.numero),
    [listePlannings]
  );

  // Filtre + tri de la liste des plannings (mémorisé). NB : ce hook DOIT être
  // appelé AVANT tout return conditionnel (règle des Hooks de React).
  const planningsFiltres = useMemo(() => {
    let liste = listePlannings.filter((p) => {
      const cleSemaine = `${p.annee}-W${String(p.numero_semaine).padStart(2, '0')}`;
      if (semaineFiltre && cleSemaine !== semaineFiltre) return false;
      if (anneeFiltre && String(p.annee) !== String(anneeFiltre)) return false;
      if (statutFiltre && p.statut !== statutFiltre) return false;
      if (serviceFiltre && String(p.id_service) !== String(serviceFiltre)) return false;
      return true;
    });
    // Tri par colonne (clic sur l'en-tête du tableau).
    if (tri.colonne) {
      const dir = tri.direction === 'asc' ? 1 : -1;
      liste = [...liste].sort((a, b) => {
        switch (tri.colonne) {
          case 'service':
            return dir * String(a.service_nom || '').localeCompare(String(b.service_nom || ''), 'fr');
          case 'semaine':
            return dir * ((a.annee - b.annee) || (a.numero_semaine - b.numero_semaine));
          case 'periode':
            return dir * String(a.date_debut_semaine || a.date_debut || '').localeCompare(
              String(b.date_debut_semaine || b.date_debut || '')
            );
          case 'statut':
            return dir * String(a.statut || '').localeCompare(String(b.statut || ''));
          default:
            return 0;
        }
      });
    }
    return liste;
  }, [listePlannings, semaineFiltre, anneeFiltre, statutFiltre, serviceFiltre, tri]);

  // ---- Actions sur un planning (conservees de l'ancien dashboard) ---------
  async function supprimerPlanning(p) {
    if (!confirm(`Supprimer le planning ${p.service_nom} S${p.numero_semaine}/${p.annee} ? Cette action est definitive.`)) return;
    setError('');
    try {
      await api.delete(`/plannings/${p.id_planning}`, getToken());
      setPlannings((liste) => liste.filter((x) => x.id_planning !== p.id_planning));
    } catch (err) {
      setError(err.message);
    }
  }

  async function soumettrePlanning(p) {
    if (!confirm('Soumettre ce planning a la RH pour validation ?')) return;
    setError('');
    try {
      await api.patch(`/plannings/${p.id_planning}/soumettre`, {}, getToken());
      setPlannings((liste) => liste.map((x) => (x.id_planning === p.id_planning ? { ...x, statut: 'SOUMIS' } : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function rouvrirPlanning(p) {
    if (!confirm('Rouvrir ce planning valide ? Il repassera en BROUILLON et devra etre soumis a nouveau a la RH.')) return;
    setError('');
    try {
      await api.patch(`/plannings/${p.id_planning}/rouvrir`, {}, getToken());
      setPlannings((liste) => liste.map((x) => (x.id_planning === p.id_planning ? { ...x, statut: 'BROUILLON' } : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) {
    return (
      <DashShell user={null}>
        <div className="container">
          <p className="muted">{t('common.loading')}</p>
        </div>
      </DashShell>
    );
  }

  // Pagination du tableau (8 par page) — retour page 1 quand un filtre change.
  const PAR_PAGE = 8;
  const nbPages = Math.max(1, Math.ceil(planningsFiltres.length / PAR_PAGE));
  const pageCourante = Math.min(pagePlannings, nbPages);
  const planningsPage = planningsFiltres.slice(
    (pageCourante - 1) * PAR_PAGE,
    pageCourante * PAR_PAGE
  );

  // Clic sur un en-tête : tri asc → desc → neutre.
  function basculerTri(colonne) {
    setTri((t) =>
      t.colonne === colonne
        ? t.direction === 'asc'
          ? { colonne, direction: 'desc' }
          : { colonne: null, direction: 'asc' }
        : { colonne, direction: 'asc' }
    );
  }

  return (
    <DashShell user={user}>
      <div className="dashboard-main-layout">
        <div className="dashboard-main">
          {error && <div className="error">{error}</div>}

      {/* Outil RH de sélection et d'export des emplois du temps. */}
      {user.role === 'RH' && autorise('planning.export_edt') && autorise('planning.view') && (
        <PlanningRhSemaineSection
          plannings={listePlannings}
          chargement={loadingPlannings}
          exportAutorise={user.role === 'RH' && autorise('planning.export_edt')}
        />
      )}

      {/* Liste opérationnelle des plannings et actions disponibles selon le rôle. */}
      {autorise('planning.view') && (
        <section className="dash-carte dashboard-plannings" aria-labelledby="dashboard-plannings-title">
          <div className="dashboard-plannings-heading">
            <h3 id="dashboard-plannings-title">{t('dashboard.myPlannings')}</h3>
            <div className="dashboard-plannings-primary-actions">
              <button
                type="button"
                className="btn secondary dashboard-refresh"
                onClick={chargerPlannings}
                disabled={loadingPlannings}
                title={t('dashboard.refreshPlans')}
                aria-label={t('dashboard.refreshPlans')}
              >
                <RefreshCw size={14} aria-hidden="true" /> <span>{t('common.refresh')}</span>
              </button>
              <Link href="/planning/gestion" className="btn">
                {t('dashboard.viewPlans')} <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="dashboard-plannings-filters" role="group" aria-label={t('dashboard.filter')}>
            <label>
              <span>{t('common.week')}</span>
              <select
                value={semaineFiltre}
                onChange={(e) => {
                  setSemaineFiltre(e.target.value);
                  setPagePlannings(1);
                }}
                aria-label={t('common.week')}
              >
                <option value="">{t('dashboard.allWeeks')}</option>
                {semaines.map(({ cle, annee, numero }) => (
                  <option key={cle} value={cle}>S{String(numero).padStart(2, '0')} / {annee}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('common.year')}</span>
              <select
                value={anneeFiltre}
                onChange={(e) => {
                  setAnneeFiltre(e.target.value);
                  setPagePlannings(1);
                }}
                aria-label={t('dashboard.allYears')}
              >
                <option value="">{t('dashboard.allYears')}</option>
                {annees.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            {autorise('planning.view_all') && services.length > 1 && (
              <label>
                <span>{t('common.service')}</span>
                <select
                  value={serviceFiltre}
                  onChange={(e) => {
                    setServiceFiltre(e.target.value);
                    setPagePlannings(1);
                  }}
                  aria-label={t('dashboard.allServices')}
                >
                  <option value="">{t('dashboard.allServices')}</option>
                  {services.map((s) => (
                    <option key={s.id_service} value={s.id_service}>
                      {s.nom || s.nom_service}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

        {statutFiltre && (
          <div className="dashboard-plannings-active-filter">
            <BadgeStatutPlanning statut={statutFiltre} title={`${t('dashboard.filter')}: ${t(`status.${statutFiltre}`)}`} />
            <button
              type="button"
              className="dashboard-plannings-clear-filter"
              onClick={() => {
                setStatutFiltre('');
                setPagePlannings(1);
              }}
              title={t('dashboard.clearFilter')}
              aria-label={t('dashboard.clearFilter')}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        )}

        {loadingPlannings && plannings.length === 0 ? (
          <p className="dashboard-plannings-loading muted">{t('common.loading')}</p>
        ) : plannings.length === 0 ? (
          <div className="dashboard-plannings-empty">
            <CalendarDays size={19} aria-hidden="true" />
            <span>{t('dashboard.noPlansYet')}</span>
          </div>
        ) : planningsFiltres.length === 0 ? (
          <div className="dashboard-plannings-empty">
            <CalendarDays size={19} aria-hidden="true" />
            <span>{t('dashboard.noPlansForFilter')}</span>
          </div>
        ) : (
          <div className="dashboard-plannings-list" role="table" aria-label={t('dashboard.myPlannings')}>
            <div className="dashboard-plannings-columns" role="row">
              {[
                { colonne: 'service', label: t('common.service') },
                { colonne: 'periode', label: t('dashboard.period') },
              ].map(({ colonne, label }) => (
                <div
                  className={`dashboard-plannings-column dashboard-plannings-column-${colonne}`}
                  role="columnheader"
                  aria-sort={tri.colonne === colonne ? (tri.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  key={colonne}
                >
                  <button type="button" onClick={() => basculerTri(colonne)}>
                    {label} {iconeTri(tri, colonne)}
                  </button>
                </div>
              ))}
              <div className="dashboard-plannings-column dashboard-plannings-column-heures" role="columnheader">
                {t('planning.hours')}
              </div>
              <div
                className="dashboard-plannings-column dashboard-plannings-column-statut"
                role="columnheader"
                aria-sort={tri.colonne === 'statut' ? (tri.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" onClick={() => basculerTri('statut')}>
                  {t('common.status')} {iconeTri(tri, 'statut')}
                </button>
              </div>
              <div className="dashboard-plannings-column dashboard-plannings-column-actions" role="columnheader" aria-label={t('common.actions')} />
            </div>
            <div role="rowgroup">
              {planningsPage.map((p) => (
                <div className="dashboard-planning-row" role="row" key={p.id_planning}>
                  <div className="dashboard-planning-service" role="cell">
                    {p.service_nom || t('common.service')}
                  </div>
                  <div className="dashboard-planning-period" role="cell">
                    {periodeCourte(p)}
                  </div>
                  <div className="dashboard-planning-hours" role="cell">
                    {p.total_heures != null
                      ? <span className="dashboard-hours-value">{Number(p.total_heures).toFixed(1)} h</span>
                      : <span className="muted">—</span>}
                  </div>
                  <div className="dashboard-planning-status" role="cell">
                    <span
                      className={`dashboard-status-badge dashboard-status-${String(p.statut || '').toLowerCase()}`}
                      role="img"
                      title={p.statut ? libelleStatut(p.statut, t) : undefined}
                      aria-label={libelleStatut(p.statut, t)}
                    >
                      <IconeStatutPlanning statut={p.statut} size={14} />
                      <span>{libelleStatut(p.statut, t)}</span>
                    </span>
                  </div>
                  <div className="dashboard-planning-actions" role="cell">
                      {autorise('planning.view') && (
                        <Link
                          href={`/planning/${p.id_planning}`}
                          className="btn-icone"
                          title={t('common.view')}
                          aria-label={t('common.view')}
                        >
                          <Eye size={15} aria-hidden="true" />
                        </Link>
                      )}
                      {autorise('planning.update') && ['BROUILLON', 'REJETE'].includes(p.statut) && (
                        <Link
                          href={`/planning/gestion?service=${p.id_service ?? ''}&semaine=${p.annee}-W${String(p.numero_semaine).padStart(2, '0')}&modifier=1`}
                          className="btn-icone"
                          title={t('planning.edit')}
                          aria-label={t('planning.edit')}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </Link>
                      )}
                      {autorise('planning.delete') && ['BROUILLON', 'REJETE'].includes(p.statut) && (
                        <button
                          className="btn-icone danger"
                          onClick={() => supprimerPlanning(p)}
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      )}
                      {autorise('planning.submit') && ['BROUILLON', 'REJETE'].includes(p.statut) && (
                        <button
                          className="btn-icone"
                          onClick={() => soumettrePlanning(p)}
                          title={t('planning.submit')}
                          aria-label={t('planning.submit')}
                        >
                          <Send size={15} aria-hidden="true" />
                        </button>
                      )}
                      {autorise('planning.reopen') && p.statut === 'VALIDE' && (
                        <button
                          className="btn-icone"
                          onClick={() => rouvrirPlanning(p)}
                          title={t('planning.reopen')}
                          aria-label={t('planning.reopen')}
                        >
                          <Unlock size={15} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {nbPages > 1 && (
            <div className="dash-pagination">
              <button
                className="btn secondary"
                disabled={pageCourante <= 1}
                onClick={() => setPagePlannings(pageCourante - 1)}
              >
                <ChevronLeft size={14} aria-hidden="true" /> {t('common.previous')}
              </button>
              <button
                className="btn secondary"
                disabled={pageCourante >= nbPages}
                onClick={() => setPagePlannings(pageCourante + 1)}
              >
                {t('common.next')} <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </section>
      )}
        </div>
        <aside className="dashboard-calendar">
          <CalendarWidget plannings={listePlannings} />
        </aside>
      </div>
    </DashShell>
  );
}

// Fleche de tri pour l'en-tete du tableau (neutre / asc / desc) — icones lucide.
function iconeTri(tri, colonne) {
  const taille = 11;
  if (tri.colonne !== colonne) return <ChevronsUpDown size={taille} aria-hidden="true" />;
  return tri.direction === 'asc'
    ? <ChevronUp size={taille} aria-hidden="true" />
    : <ChevronDown size={taille} aria-hidden="true" />;
}
