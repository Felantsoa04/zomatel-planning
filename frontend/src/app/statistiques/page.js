'use client';

// PAGE STATISTIQUES — heures planifiées (route existante /statistiques,
// en-tête du menu inchangé). Données 100 % réelles via l'endpoint dédié
// GET /api/plannings/statistiques-heures (agrégation en MariaDB, périmètre
// serveur). Filtres : période (semaine/mois/année) + service + statut.
//
// Règle métier (lib/dash.js, réutilisée — aucune valeur dupliquée) :
//   Administration = 44 h/semaine, autres services = 48 h/semaine.
//   Objectif de période = seuil hebdo × semaines couvertes (jeudi ISO).
//
// 4 cartes : max / min / total / nb employés à contrôler (écart < 0).
// Employés SANS planning : ligne "Aucun planning", exclus du min/max.
// Graphiques 100 % CSS déjà présents (DashBars / DashDonut) : zéro
// dépendance ajoutée, aucune donnée fictive.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3, Clock, TrendingDown, TrendingUp, AlertTriangle,
  Search, ChevronUp, ChevronDown, ChevronsUpDown, CalendarRange,
  Eye,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import BadgeStatutPlanning from '@/components/BadgeStatutPlanning';
import { DashBars } from '@/components/DashCharts';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import {
  MOIS_FR, objectifPeriode, libellePeriode, estDansPeriode,
  extremesAvecHeures, fmtHeures, fmtEcart, badgeEcart,
  nbSemainesDuMois,
} from '@/lib/statistiquesHeures';
import {
  moisDisponibles, anneesDisponibles, numeroSemaineActuelle,
} from '@/lib/statistiquesPeriodes';

const PAR_PAGE = 10;

export default function StatistiquesPage() {
  const { t } = useI18n();
  const router = useRouter();

  // ----- état des données -----
  const [stats, setStats] = useState({ plannings: [], employes: [] });
  const [services, setServices] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // ----- filtres (par défaut : semaine courante, tous services, tous statuts) -----
  const aujourdhui = new Date();
  const [periode, setPeriode] = useState('semaine');
  const [annee, setAnnee] = useState(aujourdhui.getFullYear());
  const [numeroSemaine, setNumeroSemaine] = useState(numeroSemaineActuelle());
  const [mois, setMois] = useState(aujourdhui.getMonth());
  const [serviceFiltre, setServiceFiltre] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('');

  // ----- tableau (recherche / tri / pagination) -----
  const [recherche, setRecherche] = useState('');
  const [tri, setTri] = useState({ colonne: 'nom', direction: 'asc' });
  const [page, setPage] = useState(1);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        const [st, srv] = await Promise.all([
          api.get('/plannings/statistiques-heures', token),
          api.get('/services', token),
        ]);
        setStats({ plannings: Array.isArray(st?.plannings) ? st.plannings : [], employes: Array.isArray(st?.employes) ? st.employes : [] });
        setServices(Array.isArray(srv) ? srv : []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch quand serviceFiltre/statutFiltre changent (l'endpoint accepte ces
  // filtres en base) ; annee/semaine/mois restent filtrés côté client car
  // l'endpoint renvoie la donnée hebdo brute qui est du domaine du client.
  useEffect(() => {
    const token = getToken();
    if (!token || loading) return;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (serviceFiltre) params.set('id_service', serviceFiltre);
        if (statutFiltre) params.set('statut', statutFiltre);
        if (periode === 'annee') params.set('annee', String(annee));
        const suffixe = params.toString() ? `?${params}` : '';
        const st = await api.get(`/plannings/statistiques-heures${suffixe}`, token);
        setStats({ plannings: Array.isArray(st?.plannings) ? st.plannings : [], employes: Array.isArray(st?.employes) ? st.employes : [] });
        setError('');
      } catch (err) {
        setError(err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceFiltre, statutFiltre, periode, annee]);

  // =====================================================================
  // Agrégation par employé sur la PÉRIODE SÉLECTIONNÉE
  // =====================================================================
  const planningsPeriode = useMemo(
    () => stats.plannings.filter((p) =>
      estDansPeriode(p, periode, { numeroSemaine, annee, mois })),
    [stats.plannings, periode, numeroSemaine, annee, mois],
  );

  // Nombre de semaines couvertes par la période (pour l'objectif annuel/mensuel) :
  // - semaine : 1
  // - mois    : jeudis ISO du mois (cohérent avec le filtre côté client).
  // - annee   : 52 (l'ISO contient toujours 52 ou 53 semaines).
  const nbSemainesPeriode = periode === 'semaine'
    ? 1
    : periode === 'mois'
      ? Math.max(4, nbSemainesDuMois(annee, mois))
      : 52;

  const lignes = useMemo(() => {
    // Clé "annee-Wxx" -> heures par employé, uniquement sur les plannings de
    // la période. Tout créneau compté une seule fois (données déjà agrégées
    // par employé × planning côté backend, aucun double comptage).
    const parEmploye = new Map();

    for (const p of planningsPeriode) {
      for (const l of p.par_employe || []) {
        const cle = l.id_employe;
        const courante = parEmploye.get(cle) || {
          id_employe: l.id_employe,
          nom: l.nom_employe,
          matricule: l.matricule || '',
          id_service: l.id_service,
          service_nom: l.service_nom,
          heures: 0,
          heures_valides: 0,
          heures_non_valides: 0,
          plannings: [],
        };
        courante.heures += Number(l.heures) || 0;
        if (p.statut === 'VALIDE') courante.heures_valides += Number(l.heures) || 0;
        else courante.heures_non_valides += Number(l.heures) || 0;
        courante.plannings.push(p);
        parEmploye.set(cle, courante);
      }
    }

    // Employés actifs du périmètre (service filtré) sans planning sur la
    // période : lignes "Aucun planning" — exclus du min/max et du total
    // mais visibles dans le tableau avec leur objectif réglementaire.
    const vus = new Set(parEmploye.keys());
    for (const e of stats.employes || []) {
      if (serviceFiltre && String(e.id_service) !== String(serviceFiltre)) continue;
      if (!vus.has(e.id_employe)) {
        parEmploye.set(e.id_employe, {
          id_employe: e.id_employe,
          nom: e.nom,
          matricule: e.matricule || '',
          id_service: e.id_service,
          service_nom: e.service_nom,
          heures: 0,
          heures_valides: 0,
          heures_non_valides: 0,
          plannings: [],
        });
      }
    }

    // Objectif de période par employé (selon SON service actuel) + écart.
    const resultat = [...parEmploye.values()].map((r) => {
      const objectif = objectifPeriode(r.service_nom, periode, {
        annee, mois, nbSemaines: nbSemainesPeriode,
      });
      return {
        ...r,
        heures: Math.round(r.heures * 10) / 10,
        heures_valides: Math.round(r.heures_valides * 10) / 10,
        heures_non_valides: Math.round(r.heures_non_valides * 10) / 10,
        objectif,
        ecart: Math.round((r.heures - objectif) * 10) / 10,
      };
    });
    return resultat;
  }, [planningsPeriode, stats.employes, serviceFiltre, periode, annee, mois, nbSemainesPeriode]);

  // =====================================================================
  // Les 4 cartes (recalculées à chaque changement de filtre)
  // =====================================================================
  const cartes = useMemo(() => {
    const { max, min } = extremesAvecHeures(lignes);
    const total = lignes.reduce((s, l) => s + (Number(l.heures) || 0), 0);
    const aControler = lignes.filter((l) => l.heures > 0 && l.ecart < -0.05).length;
    return { max, min, total: Math.round(total * 10) / 10, aControler };
  }, [lignes]);

  // =====================================================================
  // Répartition par service (totaux réels de la période + objectif moyen)
  // =====================================================================
  const donneesService = useMemo(() => {
    const parService = new Map();
    for (const l of lignes) {
      const entree = parService.get(l.id_service) || {
        label: l.service_nom, valeur: 0, nb: 0,
      };
      entree.valeur += Number(l.heures) || 0;
      entree.nb += 1;
      parService.set(l.id_service, entree);
    }
    return [...parService.values()]
      .map((s) => ({ ...s, valeur: Math.round(s.valeur * 10) / 10 }))
      .sort((a, b) => b.valeur - a.valeur || String(a.label).localeCompare(String(b.label), 'fr'));
  }, [lignes]);

  // =====================================================================
  // Graphique "Heures planifiées par employé" (barres + repère objectif)
  // =====================================================================
  const donneesEmploye = useMemo(() => lignes
    .filter((l) => l.heures > 0) // les employés sans planning restent au tableau
    .sort((a, b) => b.heures - a.heures || String(a.nom).localeCompare(String(b.nom), 'fr'))
    .slice(0, 12) // lisibilité : top 12 de la période (moins = on montre tout)
    .map((l) => ({
      label: `${String(l.nom).slice(0, 14)}`,
      valeur: l.heures,
      objectif: l.objectif,
      identite: l,
    })), [lignes]);

  // =====================================================================
  // Tableau : recherche + tri + pagination
  // =====================================================================
  const lignesTableau = useMemo(() => {
    let liste = [...lignes];
    const q = recherche.trim().toLowerCase();
    if (q) {
      liste = liste.filter((l) =>
        String(l.nom).toLowerCase().includes(q)
        || String(l.matricule || '').toLowerCase().includes(q));
    }
    const dir = tri.direction === 'asc' ? 1 : -1;
    const colonne = tri.colonne;
    liste.sort((a, b) => {
      if (colonne === 'heures') return dir * (a.heures - b.heures);
      if (colonne === 'ecart') return dir * (a.ecart - b.ecart);
      if (colonne === 'objectif') return dir * (a.objectif - b.objectif);
      if (colonne === 'service') {
        return dir * String(a.service_nom || '').localeCompare(String(b.service_nom || ''), 'fr');
      }
      return dir * String(a.nom || '').localeCompare(String(b.nom || ''), 'fr');
    });
    return liste;
  }, [lignes, recherche, tri]);

  const nbPages = Math.max(1, Math.ceil(lignesTableau.length / PAR_PAGE));
  const pageCourante = Math.min(page, nbPages);
  const lignesPage = lignesTableau.slice((pageCourante - 1) * PAR_PAGE, pageCourante * PAR_PAGE);

  useEffect(() => { setPage(1); }, [periode, annee, mois, numeroSemaine, serviceFiltre, statutFiltre, recherche]);

  function basculerTri(colonne) {
    setTri((prev) => (
      prev.colonne === colonne
        ? prev.direction === 'asc'
          ? { colonne, direction: 'desc' }
          : { colonne: null, direction: 'asc' }
        : { colonne, direction: 'asc' }
    ));
  }

  const annees = anneesDisponibles(stats.plannings, annee);
  const moisList = moisDisponibles(stats.plannings, annee);
  // Semaines disponibles (celles avec au moins un planning) pour l'année en cours de filtre.
  const semainesList = useMemo(() => {
    const lst = [...new Map(
      stats.plannings.filter((p) => Number(p.annee) === Number(annee))
        .map((p) => [`${annee}-W${String(p.numero_semaine).padStart(2, '0')}`, p.numero_semaine]),
    ).values()].sort((a, b) => a - b);
    return lst.length ? lst : [numeroSemaine];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.plannings, annee]);

  const statutsSansDoublon = ['VALIDE', 'SOUMIS', 'BROUILLON', 'REJETE'];
  const periodeLibelle = libellePeriode(periode, { numeroSemaine, annee, mois });

  // =====================================================================
  // RENDU
  // =====================================================================
  return (
    <AppShell>
      <div className="container">
        <div className="tete-page">
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <BarChart3 size={20} aria-hidden="true" /> {t('nav.statistics')}
            </h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {t('statistics.subtitle')}
            </p>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        {loading ? (
          <div className="sk-stat-technique">
            <div className="sk-stat sk-stat-titre" />
            <div className="sk-stat sk-stat-champ" />
          </div>
        ) : (
          <>
            {/* ============ Filtres ============ */}
            <section className="card stat-heures-filtres" aria-label={t('statistics.filters')}>
              <div className="stat-periode-group" role="group" aria-label={t('statistics.period')}>
                {[
                  ['semaine', t('statistics.periodWeek')],
                  ['mois', t('statistics.periodMonth')],
                  ['annee', t('statistics.periodYear')],
                ].map(([v, lbl]) => (
                  <button
                    type="button"
                    key={v}
                    className={`stat-periode-btn ${periode === v ? 'actif' : ''}`}
                    onClick={() => setPeriode(v)}
                    aria-pressed={periode === v}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="stat-filtres-champs">
                {periode === 'semaine' && (
                  <>
                    <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} aria-label={t('common.year')}>
                      {annees.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <select
                      value={String(numeroSemaine).padStart(2, '0')}
                      onChange={(e) => setNumeroSemaine(Number(e.target.value))}
                      aria-label={t('common.week')}
                    >
                      {semainesList.map((n) => (
                        <option key={n} value={String(n).padStart(2, '0')}>
                          {t('statistics.weekShort')} {String(n).padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {periode === 'mois' && (
                  <>
                    <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} aria-label={t('common.year')}>
                      {annees.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <select value={mois} onChange={(e) => setMois(Number(e.target.value))} aria-label={t('statistics.periodMonth')}>
                      {moisList.map((m) => <option key={m} value={m}>{MOIS_FR[m]}</option>)}
                    </select>
                  </>
                )}
                {periode === 'annee' && (
                  <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} aria-label={t('common.year')}>
                    {annees.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
                <select value={serviceFiltre} onChange={(e) => setServiceFiltre(e.target.value)} aria-label={t('statistics.filterByService')}>
                  <option value="">{t('dashboard.allServices')}</option>
                  {services.map((s) => (
                    <option key={s.id_service} value={s.id_service}>{s.nom || s.nom_service}</option>
                  ))}
                </select>
                <select value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)} aria-label={t('statistics.filterByStatus')}>
                  <option value="">{t('validation.all')}</option>
                  {statutsSansDoublon.map((s) => (
                    <option key={s} value={s}>{t(`status.${s}`)}</option>
                  ))}
                </select>
              </div>
            </section>

            {/* Période analysée : même pour toutes les cartes / graphiques / tableau. */}
            <p className="stat-periode-analyse" aria-live="polite">
              <CalendarRange size={14} aria-hidden="true" />
              <span>
                {t('statistics.analyzedPeriod')} <strong>{periodeLibelle}</strong>
                {statutFiltre && <> · {t('statistics.statusFilter')} <BadgeStatutPlanning statut={statutFiltre} /></>}
              </span>
            </p>

            {/* ============ 4 cartes ============ */}
            <div className="stat-heures-cartes">
              {[
                {
                  icone: TrendingUp, classe: 'stat-carte-max',
                  titre: t('statistics.cardMax'),
                  valeur: cartes.max ? `${fmtHeures(cartes.max.heures)} h` : '—',
                  detail: cartes.max ? cartes.max.nom : t('statistics.noData'),
                  detail2: cartes.max ? cartes.max.service_nom : '',
                },
                {
                  icone: TrendingDown, classe: 'stat-carte-min',
                  titre: t('statistics.cardMin'),
                  valeur: cartes.min ? `${fmtHeures(cartes.min.heures)} h` : '—',
                  detail: cartes.min ? cartes.min.nom : t('statistics.noData'),
                  detail2: cartes.min ? cartes.min.service_nom : '',
                },
                {
                  icone: Clock, classe: 'stat-carte-total',
                  titre: t('statistics.cardTotal'),
                  valeur: `${fmtHeures(cartes.total)} h`,
                  detail: t('statistics.cardTotalDetail'),
                  detail2: '',
                },
                {
                  icone: AlertTriangle, classe: 'stat-carte-controle',
                  titre: t('statistics.cardUnder'),
                  valeur: String(cartes.aControler),
                  detail: t('statistics.cardUnderDetail'),
                  detail2: '',
                },
              ].map((c) => {
                const Icone = c.icone;
                return (
                  <div key={c.titre} className={`card stat-heures-carte ${c.classe}`}>
                    <div className="stat-carte-icone"><Icone size={17} aria-hidden="true" /></div>
                    <div className="stat-carte-corps">
                      <span className="stat-carte-titre">{c.titre}</span>
                      <span className="stat-carte-valeur">{c.valeur}</span>
                      <span className="stat-carte-detail">{c.detail}</span>
                      {c.detail2 ? <span className="stat-carte-serv">{c.detail2}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ============ Graphiques ============ */}
            <div className="stat-grille-graphiques">
              <div className="card stat-carte-graphique">
                <h3>{t('statistics.hoursPerEmployee')}</h3>
                <HeuresEmployeBars data={donneesEmploye} videMsg={t('statistics.noDataPeriod')} traduire={t} />
              </div>
              <div className="card stat-carte-graphique">
                <h3>{t('statistics.hoursByService')}</h3>
                {donneesService.length === 0
                  ? <p className="muted dash-vide">{t('statistics.noDataPeriod')}</p>
                  : <DashBars data={donneesService} unite=" h" />}
              </div>
            </div>

            {/* ============ Tableau ============ */}
            <section className="card" aria-label={t('statistics.table')}>
              <div className="stat-tableau-entete">
                <h3>{t('statistics.table')}</h3>
                <div className="stat-recherche">
                  <Search size={15} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder={t('statistics.searchPlaceholder')}
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                    aria-label={t('statistics.searchPlaceholder')}
                  />
                </div>
              </div>

              {lignesTableau.length === 0 ? (
                <p className="muted dash-vide">{t('statistics.noResults')}</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="dash-table stat-tableau">
                    <thead>
                      <tr>
                        <ThTri label={t('employees.name')} colonne="nom" tri={tri} onTri={basculerTri} />
                        <th>{t('statistics.matricule')}</th>
                        <ThTri label={t('common.service')} colonne="service" tri={tri} onTri={basculerTri} />
                        <ThTri label={t('statistics.plannedHours')} colonne="heures" tri={tri} onTri={basculerTri} aligne="droite" />
                        <ThTri label={t('statistics.periodTarget')} colonne="objectif" tri={tri} onTri={basculerTri} aligne="droite" />
                        <ThTri label={t('statistics.ecart')} colonne="ecart" tri={tri} onTri={basculerTri} aligne="droite" />
                        <th>{t('statistics.controle')}</th>
                        <th><span className="sr-only">{t('common.actions')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesPage.map((l) => {
                        const typeBadge = badgeEcart(l.heures, l.objectif);
                        const cleBadge = {
                          conforme: 'statistics.ctlConforme',
                          insuffisant: 'planning.insufficientHours',
                          exces: 'planning.excessiveHours',
                          aucun: 'statistics.ctlNoPlanning',
                        }[typeBadge];
                        return (
                          <tr key={l.id_employe}>
                            <td>
                              {l.plannings.length > 0 && l.plannings[0].id_planning ? (
                                <Link
                                  href={`/planning/${l.plannings[l.plannings.length - 1].id_planning}`}
                                  className="stat-lien-employe"
                                  title={t('statistics.viewPlanning')}
                                >
                                  {/* lien réel vers le planning existant (route déjà liée) */}
                                  {l.nom}
                                </Link>
                              ) : (
                                l.nom
                              )}
                            </td>
                            <td className="muted">{l.matricule || '—'}</td>
                            <td>{l.service_nom || '—'}</td>
                            <td className="stat-cell-heures">
                              <strong>{fmtHeures(l.heures)} h</strong>
                              {l.heures_non_valides > 0.05 && (
                                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                                  ({t('statistics.nonValidated')} {fmtHeures(l.heures_non_valides)} h)
                                </span>
                              )}
                            </td>
                            <td>{fmtHeures(l.objectif)} h</td>
                            <td className={l.ecart < -0.05 ? 'stat-ecart-neg' : l.ecart > 0.05 ? 'stat-ecart-pos' : 'muted'}>
                              {fmtEcart(l.ecart)}
                            </td>
                            <td>
                              <span className={`stat-badge-ctl stat-badge-${typeBadge}`}>{t(cleBadge)}</span>
                            </td>
                            <td>
                              {l.plannings.length > 0 && (
                                <Link
                                  href={`/planning/${l.plannings[l.plannings.length - 1].id_planning}`}
                                  className="btn-icone"
                                  title={t('common.view')}
                                  aria-label={`${t('common.view')} ${t('planning.title').toLowerCase()}`}
                                >
                                  <Eye size={15} aria-hidden="true" />
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {nbPages > 1 && (
                <div className="dash-pagination">
                  <button className="btn secondary" disabled={pageCourante <= 1} onClick={() => setPage(pageCourante - 1)}>
                    <ChevronUp size={13} aria-hidden="true" /> {t('common.previous')}
                  </button>
                  <span className="muted">{`${t('common.page')} ${pageCourante} / ${nbPages}`}</span>
                  <button className="btn secondary" disabled={pageCourante >= nbPages} onClick={() => setPage(pageCourante + 1)}>
                    {t('common.next')} <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

// ---- En-tête de tableau triable (motif existant : .th-tri) ----
function ThTri({ label, colonne, tri, onTri, aligne = 'gauche' }) {
  const actif = tri.colonne === colonne;
  return (
    <th
      className="th-tri"
      style={{ textAlign: aligne === 'droite' ? 'right' : 'left' }}
      aria-sort={actif ? (tri.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" onClick={() => onTri(colonne)} className="stat-th-btn">
        {label}{' '}
        {!actif
          ? <ChevronsUpDown size={11} className="tri-neutre" aria-hidden="true" />
          : tri.direction === 'asc'
            ? <ChevronUp size={11} className="tri-actif" aria-hidden="true" />
            : <ChevronDown size={11} className="tri-actif" aria-hidden="true" />}
      </button>
    </th>
  );
}

// ---- Graphique "Heures planifiées par employé" (barres SVG maison + repère objectif) ----
// Réutilise le style .bar-chart-du projet (SVG pur, aucune dépendance) et
// ajoute un trait pointillé d'objectif par employé.
function HeuresEmployeBars({ data, videMsg, traduire }) {
  const [survol, setSurvol] = useState(null);
  if (typeof window === 'undefined') return <p className="muted dash-vide">{videMsg}</p>;
  if (!data || data.length === 0) return <p className="muted dash-vide">{videMsg}</p>;

  const LARG = 640;
  const HAUT = 260;
  const m = { h: 16, d: 8, b: 38, g: 38 };
  const maxVal = Math.max(
    1, ...data.map((d) => Math.max(Number(d.valeur), Number(d.objectif) || 0)),
  );
  const pas = 5; // axe en pas de 5 h
  const maxAxe = Math.max(pas, Math.ceil(maxVal / pas) * pas);
  const tranche = (LARG - m.g - m.d) / data.length;
  const y = (v) => HAUT - m.b - (v / maxAxe) * (HAUT - m.h - m.b);
  const ticks = Array.from({ length: Math.floor(maxAxe / pas) + 1 }, (_, i) => i * pas);

  return (
    <div className="bar-chart">
      <svg
        viewBox={`0 0 ${LARG} ${HAUT}`}
        role="img"
        aria-label={traduire('statistics.hoursPerEmployee')}
        className="bar-chart-svg"
        onMouseLeave={() => setSurvol(null)}
      >
        {/* grille + échelle Y */}
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={m.g} x2={LARG - m.d} y1={y(tk)} y2={y(tk)} className="bc-grille" />
            <text x={m.g - 6} y={y(tk)} dy="0.32em" textAnchor="end" className="bc-axe-y">{tk}</text>
          </g>
        ))}
        {/* barre + repère objectif par employé */}
        {data.map((d, i) => {
          const cx = m.g + tranche * i + tranche / 2;
          const w = Math.max(tranche * 0.5, 4);
          const objY = y(Number(d.objectif) || 0);
          const actif = survol === i;
          return (
            <g key={`${d.label}-${i}`}>
              <rect
                x={cx - w / 2}
                y={y(Number(d.valeur))}
                width={w}
                height={Math.max((HAUT - m.b) - y(Number(d.valeur)), 1.5)}
                rx={3}
                className={`bc-barre ${actif ? 'stat-barre-active' : ''}`}
              />
              <line x1={cx - w / 2 - 3} x2={cx + w / 2 + 3} y1={objY} y2={objY} className="stat-obj-cible" />
              {(actif || data.length <= 12) && (
                <text x={cx} y={y(Number(d.valeur)) - 4} textAnchor="middle" className="bc-axe-y stat-val-barre">
                  {fmtHeures(Number(d.valeur))} h
                </text>
              )}
              {/* zone de survol */}
              <rect
                x={m.g + tranche * i}
                y={m.h}
                width={tranche}
                height={HAUT - m.h - m.b}
                fill="transparent"
                onMouseEnter={() => setSurvol(i)}
              />
              <text x={cx} y={HAUT - m.b + 14} textAnchor="middle" className="bc-axe-x">{d.label}</text>
            </g>
          );
        })}
        <line x1={m.g} x2={LARG - m.d} y1={HAUT - m.b} y2={HAUT - m.b} className="bc-axe" />
      </svg>
      <div className="stat-graph-legende bc-legende">
        <span className="bc-legende-item"><span className="bc-pastille bc-pastille-principale" aria-hidden="true" /> {traduire('statistics.legendHours')}</span>
        <span className="bc-legende-item"><span className="stat-obj-cible stat-obj-legende" aria-hidden="true" /> {traduire('statistics.legendTarget')}</span>
      </div>
    </div>
  );
}
