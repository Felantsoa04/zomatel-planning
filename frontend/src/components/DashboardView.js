'use client';

// VUE DASHBOARD PARTAGEE — une seule implementation, montee par 3 pages :
//   /dashboard/admin (ADMIN) · /dashboard/rh (RH) · /dashboard/chef (CHEF_SERVICE)
// Garde double : la page verifie le role AVANT le rendu, et ce composant le
// reverifie apres montage (un chef ne peut pas voir la vue RH en changeant l'URL).
// Donnees 100 % reelles via les API existantes ; l'EMPLOYE n'a pas d'espace.
// Regles heures reutilisees : Administration 44 h min, autres 48 h min,
// depassement important = nb_exces calcule par l'API (seuil + 8 h).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users, KeyRound, Hotel, FileText, Upload, XCircle,
  CalendarPlus, Eye, Pencil, Trash2, Unlock, Send,
  RefreshCw, Download, TriangleAlert, CircleAlert, CircleCheck,
  X, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
} from 'lucide-react';
import DashShell from '@/components/DashShell';
import ModalNouveauPlanning from '@/components/ModalNouveauPlanning';
import PlanningRhSemaineSection from '@/components/PlanningRhSemaineSection';
import { api } from '@/lib/api';
import { getToken, getUser, logout } from '@/lib/auth';
import { LABELS_STATUT, periodeCourte, dashboardDe } from '@/lib/dash';

// Annonce des filtres portés par un lien (?statut=&annee=&service=) pour que
// le dashboard les applique même SANS remontage (clic carte statut alors qu'on
// est déjà sur la page — corrige le filtre qui n'était lu qu'au montage).
function annoncerFiltres(href) {
  try {
    const q = new URL(href, 'http://local').searchParams;
    window.dispatchEvent(
      new CustomEvent('zomatel:filtres', {
        detail: {
          annee: q.get('annee') || '',
          statut: q.get('statut') || '',
          service: q.get('service') || '',
        },
      })
    );
  } catch (_) {
    /* href non parsable : ignoré */
  }
}

export default function DashboardView({ roleAutorise }) {
  const [user, setUser] = useState(null);
  const [plannings, setPlannings] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [services, setServices] = useState([]);
  const [nbUtilisateurs, setNbUtilisateurs] = useState(null);
  const [nbChefs, setNbChefs] = useState(null);
  const [erreurServices, setErreurServices] = useState('');
  const [anneeFiltre, setAnneeFiltre] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('');
  const [serviceFiltre, setServiceFiltre] = useState('');
  const [tri, setTri] = useState({ colonne: null, direction: 'asc' });
  const [pagePlannings, setPagePlannings] = useState(1);
  const [error, setError] = useState('');
  const [loadingPlannings, setLoadingPlannings] = useState(true);
  const [derniereMaj, setDerniereMaj] = useState(null);
  const [modalPlanningOuvert, setModalPlanningOuvert] = useState(false);
  const router = useRouter();

  // Employes + services : necessaires aux cartes statistiques et au filtre
  // par service (le filtrage reel reste cote backend sur /plannings).
  const chargerEmployesEtServices = useCallback(async () => {
    try {
      const tokenActuel = getToken();
      const [emps, srv] = await Promise.all([
        api.get('/employes', tokenActuel),
        api.get('/services', tokenActuel),
      ]);
      setEmployes(Array.isArray(emps) ? emps : []);
      setServices(Array.isArray(srv) ? srv : []);
    } catch (err) {
      setErreurServices(err.message);
    }
  }, []);

  // Plannings : chargeur dédié (état de chargement + horodatage de fraîcheur).
  const chargerPlannings = useCallback(async () => {
    setLoadingPlannings(true);
    try {
      const liste = await api.get('/plannings', getToken());
      setPlannings(Array.isArray(liste) ? liste : []);
      setDerniereMaj(new Date());
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
        // Plannings (backend : chef -> son service uniquement, EMPLOYE -> 403)
        await chargerPlannings();

        // Employes + services (compteurs + filtre)
        chargerEmployesEtServices();

        // Specifique ADMIN : comptes utilisateurs
        if (u.role === 'ADMIN') {
          const users = await api.get('/auth/users', token);
          const usersList = Array.isArray(users) ? users : [];
          setNbUtilisateurs(usersList.length);
          setNbChefs(usersList.filter((x) => x.role === 'CHEF_SERVICE').length);
        }
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [router, roleAutorise, chargerPlannings, chargerEmployesEtServices]);

  // Filtres reçus via événement (clic carte statut sans remontage) ou via
  // l'URL au montage ; les changements sont reflétés dans l'URL (partageable).
  useEffect(() => {
    function onFiltres(ev) {
      const d = ev.detail || {};
      if (d.annee !== undefined) setAnneeFiltre(d.annee);
      if (d.statut !== undefined) setStatutFiltre(d.statut);
      if (d.service !== undefined) setServiceFiltre(d.service);
      setPagePlannings(1);
      // L'URL devient partageable (sans recharger la page).
      const u = new URL(window.location.href);
      const q = u.searchParams;
      if (d.statut !== undefined) {
        if (d.statut) q.set('statut', d.statut);
        else q.delete('statut');
      }
      if (d.annee !== undefined) {
        if (d.annee) q.set('annee', d.annee);
        else q.delete('annee');
      }
      if (d.service !== undefined) {
        if (d.service) q.set('service', d.service);
        else q.delete('service');
      }
      window.history.replaceState(null, '', u.toString());
    }
    window.addEventListener('zomatel:filtres', onFiltres);
    return () => window.removeEventListener('zomatel:filtres', onFiltres);
  }, []);

  // Tableaux sûrs : les useMemo travaillent toujours sur des tableaux, même
  // quand les données API ne sont pas encore chargées (useState([]) initial).
  const listePlannings = Array.isArray(plannings) ? plannings : [];

  // ---- Statistiques derivees des donnees reelles --------------------------
  const stats = useMemo(() => {
    const parStatut = { BROUILLON: 0, SOUMIS: 0, VALIDE: 0, REJETE: 0 };
    for (const p of listePlannings) {
      if (parStatut[p.statut] !== undefined) parStatut[p.statut] += 1;
    }
    // Annees disponibles : depuis les donnees + annee courante (aucune en dur)
    const annees = [...new Set([...listePlannings.map((p) => p.annee), new Date().getFullYear()])]
      .sort((a, b) => b - a);
    return { parStatut, annees };
  }, [listePlannings]);

  // Filtre + tri de la liste des plannings (mémorisé). NB : ce hook DOIT être
  // appelé AVANT tout return conditionnel (règle des Hooks de React).
  const planningsFiltres = useMemo(() => {
    let liste = listePlannings.filter((p) => {
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
          case 'heures':
            return dir * ((Number(a.total_heures) || -1) - (Number(b.total_heures) || -1));
          case 'statut':
            return dir * String(a.statut || '').localeCompare(String(b.statut || ''));
          default:
            return 0;
        }
      });
    }
    return liste;
  }, [listePlannings, anneeFiltre, statutFiltre, serviceFiltre, tri]);

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

  // Export CSV de la liste filtrée + triée (généré côté client, aucun appel API).
  function exportCsv() {
    const sep = ';';
    const entetes = ['Service', 'Semaine', 'Annee', 'Debut', 'Fin', 'Total heures', 'Heures insuff.', 'Depassements', 'Statut'];
    const lignes = planningsFiltres.map((p) => [
      p.service_nom || '',
      `S${p.numero_semaine}`,
      p.annee,
      String(p.date_debut_semaine || p.date_debut || '').slice(0, 10),
      String(p.date_fin_semaine || p.date_fin || '').slice(0, 10),
      p.total_heures != null ? Number(p.total_heures).toFixed(1) : '',
      Number(p.nb_manques) || 0,
      Number(p.nb_exces) || 0,
      LABELS_STATUT[p.statut] || p.statut,
    ]);
    // BOM : les accents passent correctement dans Excel.
    const csv = '\ufeff' + [entetes, ...lignes].map((l) => l.join(sep)).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `plannings_zomatel_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!user) {
    return (
      <DashShell user={null}>
        <div className="container">
          <p className="muted">Chargement...</p>
        </div>
      </DashShell>
    );
  }

  const estChef = user.role === 'CHEF_SERVICE';
  // Nom du service du chef déduit de la liste (le JWT ne contient que id_service).
  // NB : l'API /services retourne `nom` (alias du contrôleur), pas nom_service.
  const nomService = user.id_service
    ? (services.find((s) => Number(s.id_service) === Number(user.id_service)) || {}).nom || null
    : null;

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
    <DashShell user={{ ...user, service_nom: nomService }}>
      <h1 className="dash-titre">
        Bonjour, {[user.prenom, user.nom].filter(Boolean).join(' ') || user.nom_utilisateur || user.login}
      </h1>
      <p className="dash-soustitre">
        {estChef
          ? `Vue de votre service${nomService ? ` : ${nomService}` : ''}`
          : "Vue globale de l'établissement"}
      </p>

      {error && <div className="error">{error}</div>}
      {erreurServices && <div className="error">{erreurServices}</div>}

      {/* ===== Cartes statistiques (cliquables vers les filtres existants) =====
          DASHBOARD RH : masquées — son contenu principal est l'EMPLOI DU
          TEMPS uniquement (les accès restent disponibles via la sidebar). */}
      {user.role !== 'RH' && (
      <div className="dash-stats">
        {user.role === 'ADMIN' && (
          <>
            <Stat valeur={nbUtilisateurs ?? '…'} libelle="Utilisateurs" classe="dash-stat-bleu" icone={KeyRound} href="/utilisateurs" />
            <Stat valeur={nbChefs ?? '…'} libelle="Chefs de service" classe="dash-stat-gris" icone={Users} href="/utilisateurs" />
          </>
        )}
        <Stat
          valeur={employes.length}
          libelle={estChef ? 'Employés du service' : 'Employés'}
          classe="dash-stat"
          icone={Users}
          href="/employees"
        />
        <Stat valeur={services.length} libelle="Services" classe="dash-stat" icone={Hotel} href="/service" />
        <Stat
          valeur={stats.parStatut.BROUILLON}
          libelle="Brouillons"
          classe="dash-stat-gris"
          icone={FileText}
          href={estChef ? '/dashboard/chef?statut=BROUILLON' : `/dashboard/${user.role === 'RH' ? 'rh' : 'admin'}?statut=BROUILLON`}
        />
        <Stat
          valeur={stats.parStatut['SOUMIS'] || 0}
          libelle="Soumis"
          classe="dash-stat-orange"
          icone={Upload}
          href={estChef ? '/dashboard/chef?statut=SOUMIS' : `/dashboard/${user.role === 'RH' ? 'rh' : 'admin'}?statut=SOUMIS`}
        />
        <Stat
          valeur={stats.parStatut.VALIDE}
          libelle="Validés"
          classe="dash-stat-vert"
          icone={CircleCheck}
          href={estChef ? '/dashboard/chef?statut=VALIDE' : `/dashboard/${user.role === 'RH' ? 'rh' : 'admin'}?statut=VALIDE`}
        />
        {stats.parStatut.REJETE > 0 && (
          <Stat
            valeur={stats.parStatut.REJETE}
            libelle="Rejetés"
            classe="dash-stat-rouge"
            icone={XCircle}
            href={estChef ? '/dashboard/chef?statut=REJETE' : `/dashboard/${user.role === 'RH' ? 'rh' : 'admin'}?statut=REJETE`}
          />
        )}
      </div>
      )}
      {/* ===== Répartition des plannings par statut =====
          DASHBOARD RH : masquée (contenu principal = Emploi du temps). */}
      {user.role !== 'RH' && (
      <div className="dash-carte" style={{ marginBottom: 20 }}>
        <h3>Répartition des plannings par statut</h3>
        <div className="stat-repartition">
          {[
            { statut: 'BROUILLON', label: 'Brouillon', nombre: stats.parStatut.BROUILLON, couleur: 'var(--zom-texte-2)' },
            { statut: 'SOUMIS', label: 'Soumis', nombre: stats.parStatut['SOUMIS'] || 0, couleur: 'var(--c-warn)' },
            { statut: 'VALIDE', label: 'Validé', nombre: stats.parStatut.VALIDE, couleur: 'var(--c-ok)' },
            { statut: 'REJETE', label: 'Rejeté', nombre: stats.parStatut.REJETE, couleur: 'var(--c-danger)' },
          ].map((s) => {
            const cible = estChef ? '/dashboard/chef' : `/dashboard/${user.role === 'RH' ? 'rh' : 'admin'}`;
            const href = `${cible}?statut=${s.statut}`;
            return (
              <Link
                key={s.statut}
                href={href}
                className="stat-repartition-item"
                onClick={() => annoncerFiltres(href)}
              >
                <span className="stat-repartition-pastille" style={{ background: s.couleur }} />
                <span className="stat-repartition-nombre">{s.nombre}</span>
                <span className="stat-repartition-label">{s.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
      )}

      {/* ===== EMPLOI DU TEMPS RH : sélection PAR SEMAINE -> export Excel =====
          Semaine = critère de sélection/export (plusieurs services d'une même
          semaine exportables ensemble dans UN seul fichier) ; dates début/fin
          = informations affichées uniquement. */}
      {user.role === 'RH' && (
        <PlanningRhSemaineSection
          plannings={listePlannings}
          onRafraichir={chargerPlannings}
          chargement={loadingPlannings}
        />
      )}

      {/* ===== Derniers plannings =====
          DASHBOARD RH : masquée — l'Emploi du temps liste déjà tous les
          plannings (toutes semaines, tous services, actions consulter /
          rouvrir). Le RH garde tout dans SON bloc Emploi du temps. */}
      {user.role !== 'RH' && (
      <div className="dash-carte">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>
            {estChef ? 'Mes plannings' : 'Plannings'}
            {loadingPlannings ? (
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> · chargement…</span>
            ) : (
              derniereMaj && (
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  {' '}· maj {derniereMaj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )
            )}
          </h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {planningsFiltres.length > 0 && (
              <button className="btn secondary" onClick={exportCsv} title="Exporter la liste filtrée en CSV">
                <Download size={14} aria-hidden="true" /> CSV
              </button>
            )}
            <button
              className="btn secondary"
              onClick={chargerPlannings}
              disabled={loadingPlannings}
              title="Actualiser la liste des plannings"
            >
              <RefreshCw size={14} aria-hidden="true" /> Actualiser
            </button>
            <select
              value={anneeFiltre}
              onChange={(e) => {
                setAnneeFiltre(e.target.value);
                setPagePlannings(1);
              }}
              style={{ width: 'auto' }}
            >
              <option value="">Toutes les années</option>
              {stats.annees.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            {!estChef && services.length > 1 && (
              <select
                value={serviceFiltre}
                onChange={(e) => {
                  setServiceFiltre(e.target.value);
                  setPagePlannings(1);
                }}
                style={{ width: 'auto' }}
              >
                <option value="">Tous les services</option>
                {services.map((s) => (
                  <option key={s.id_service} value={s.id_service}>
                    {s.nom || s.nom_service}
                  </option>
                ))}
              </select>
            )}
            {estChef && (
              <button
                type="button"
                className="btn"
                onClick={() => setModalPlanningOuvert(true)}
              >
                <CalendarPlus size={15} aria-hidden="true" /> Ajouter un planning
              </button>
            )}
          </div>
        </div>

        {statutFiltre && (
          <p style={{ marginTop: 0 }}>
            <span className="alerte-heures alerte-manque">
              Filtre : {LABELS_STATUT[statutFiltre] || statutFiltre}{' '}
              <button
                onClick={() => {
                  setStatutFiltre('');
                  setPagePlannings(1);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', padding: 2, verticalAlign: 'middle' }}
                title="Retirer le filtre"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          </p>
        )}

        {plannings.length === 0 ? (
          <p className="muted">Aucun planning pour le moment.</p>
        ) : planningsFiltres.length === 0 ? (
          <p className="muted">Aucun planning ne correspond au filtre.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dash-table">
              <thead>
                <tr>
                  {!estChef && (
                    <th className="th-tri" onClick={() => basculerTri('service')}>
                      Service {iconeTri(tri, 'service')}
                    </th>
                  )}
                  <th className="th-tri" onClick={() => basculerTri('semaine')}>
                    Semaine {iconeTri(tri, 'semaine')}
                  </th>
                  <th className="th-tri" onClick={() => basculerTri('periode')}>
                    Période {iconeTri(tri, 'periode')}
                  </th>
                  <th className="th-tri" onClick={() => basculerTri('heures')}>
                    Heures {iconeTri(tri, 'heures')}
                  </th>
                  <th className="th-tri" onClick={() => basculerTri('statut')}>
                    Statut {iconeTri(tri, 'statut')}
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {planningsPage.map((p) => (
                  <tr key={p.id_planning}>
                    {!estChef && <td>{p.service_nom}</td>}
                    <td>S{p.numero_semaine} / {p.annee}</td>
                    <td>{periodeCourte(p).split(' · ')[1] || periodeCourte(p)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {p.total_heures != null ? (
                        <>
                          {Number(p.total_heures).toFixed(1)} h
                          {Number(p.nb_manques) > 0 && (
                            <span className="alerte-heures alerte-manque" title="Heures insuffisantes">
                              <TriangleAlert size={11} aria-hidden="true" /> −{p.nb_manques}
                            </span>
                          )}
                          {Number(p.nb_exces) > 0 && (
                            <span className="alerte-heures alerte-exces" title="Dépassement important">
                              <CircleAlert size={11} aria-hidden="true" /> +{p.nb_exces}
                            </span>
                          )}
                          {Number(p.nb_manques) === 0 && Number(p.nb_exces) === 0 && (
                            <span className="alerte-heures alerte-ok" title="Conforme">
                              <CircleCheck size={11} aria-hidden="true" /> OK
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td><span className={`badge ${p.statut}`}>{LABELS_STATUT[p.statut] || p.statut}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <Link href={`/planning/${p.id_planning}`} className="btn-icone" title="Consulter">
                          <Eye size={15} aria-hidden="true" />
                        </Link>
                        {estChef && ['BROUILLON', 'REJETE'].includes(p.statut) && (
                          <>
                            <Link
                              href={`/planning/gestion?service=${p.id_service ?? ''}&semaine=${p.annee}-W${String(p.numero_semaine).padStart(2, '0')}`}
                              className="btn-icone"
                              title="Modifier la grille"
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </Link>
                            <button className="btn-icone danger" onClick={() => supprimerPlanning(p)} title="Supprimer">
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                            <button className="btn-icone" onClick={() => soumettrePlanning(p)} title="Soumettre à la RH">
                              <Send size={15} aria-hidden="true" />
                            </button>
                          </>
                        )}
                        {!estChef && p.statut === 'VALIDE' && (
                          <button className="btn-icone" onClick={() => rouvrirPlanning(p)} title="Rouvrir : nouvelle validation requise">
                            <Unlock size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination (si plus d'une page) */}
        {nbPages > 1 && (
          <div className="dash-pagination">
            <button
              className="btn secondary"
              disabled={pageCourante <= 1}
              onClick={() => setPagePlannings(pageCourante - 1)}
            >
              <ChevronLeft size={14} aria-hidden="true" /> Précédent
            </button>
            <span className="muted">
              Page {pageCourante} / {nbPages} · {planningsFiltres.length} planning(s)
            </span>
            <button
              className="btn secondary"
              disabled={pageCourante >= nbPages}
              onClick={() => setPagePlannings(pageCourante + 1)}
            >
              Suivant <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        {/* MODAL Nouveau planning (chef uniquement) : formulaire existant,
            meme endpoint POST /plannings ; la liste est reactualisee apres creation */}
        {modalPlanningOuvert && (
          <ModalNouveauPlanning
            onClose={() => setModalPlanningOuvert(false)}
            onCree={() => chargerPlannings()}
          />
        )}

      </div>
      )}
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

// Carte statistique. Si `href` est fourni ET que la page cible existe reellement,
// la carte devient un lien (aucun bouton decoratif : on ne passe href que vers
// des routes existantes — /employees, /service, /utilisateurs, filtres ?statut=).
function Stat({ valeur, libelle, classe = '', icone: Icone, href }) {
  const contenu = (
    <>
      {Icone && <div className="stat-icone"><Icone size={18} aria-hidden="true" /></div>}
      <div className="valeur">{valeur}</div>
      <div className="libelle">{libelle}</div>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className={`dash-stat dash-stat-lien ${classe}`}
        onClick={() => annoncerFiltres(href)}
      >
        {contenu}
      </Link>
    );
  }
  return <div className={`dash-stat ${classe}`}>{contenu}</div>;
}
