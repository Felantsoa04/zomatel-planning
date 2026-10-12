'use client';

// PARTIE PLANNING DU DASHBOARD RH — parcours demandé :
//   services (cartes cliquables) -> sélection d'un service -> plannings de ce
//   service -> consultation -> Export Excel RÉSERVÉ AUX PLANNINGS VALIDÉS
//   (contrôle double : bouton masqué/désactivé côté front + refus 403 côté
//   serveur). Le fichier généré vient du modèle de référence du projet,
//   endpoint existant GET /plannings/:id/emploi-du-temps.xlsx.
// Le composant REÇOIT services et plannings déjà chargés par DashboardView
// (aucun double appel API). Le sidebar/menu RH n'est pas concerné.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Hotel, Users, CalendarDays, ChevronRight, Download, RefreshCw, Eye, Layers,
} from 'lucide-react';
import BadgeStatutPlanning from '@/components/BadgeStatutPlanning';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

export default function PlanningRhSection({ services, plannings, onRafraichir, chargement, exportAutorise = false }) {
  const { t } = useI18n();
  const [serviceChoisi, setServiceChoisi] = useState(null);
  const [exportEnCours, setExportEnCours] = useState(null);
  // Export groupé : plannings VALIDÉS cochés -> UN classeur Excel, une feuille
  // par planning sélectionné (endpoint POST /plannings/emploi-du-temps-multi.xlsx).
  const [selection, setSelection] = useState(() => new Set());
  const [exportMultiEnCours, setExportMultiEnCours] = useState(false);

  // Services triés par nom (données réelles, aucune valeur en dur)
  const listeServices = useMemo(
    () => [...(services || [])].sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr')),
    [services]
  );

  // Plannings du service sélectionné, triés semaine récente d'abord
  const planningsService = useMemo(() => {
    if (!serviceChoisi) return [];
    return (plannings || [])
      .filter((p) => String(p.id_service) === String(serviceChoisi.id_service))
      .sort((a, b) => (b.annee - a.annee) || (b.numero_semaine - a.numero_semaine));
  }, [plannings, serviceChoisi]);

  // Répartition par statut pour les pastilles des cartes services
  const statsParService = useMemo(() => {
    const map = {};
    for (const p of plannings || []) {
      const cle = String(p.id_service);
      map[cle] = map[cle] || { total: 0, VALIDE: 0, SOUMIS: 0, BROUILLON: 0, REJETE: 0 };
      if (map[cle][p.statut] !== undefined) map[cle][p.statut] += 1;
      map[cle].total += 1;
    }
    return map;
  }, [plannings]);

  // Plannings VALIDÉS du service sélectionné (seuls exportables)
  const planningsValides = useMemo(
    () => planningsService.filter((p) => p.statut === 'VALIDE'),
    [planningsService]
  );

  const basculerSelection = (id) => {
    setSelection((prec) => {
      const s = new Set(prec);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const toutSelectionner = () => {
    setSelection((prec) =>
      planningsValides.length > 0 && prec.size === planningsValides.length
        ? new Set()
        : new Set(planningsValides.map((p) => p.id_planning))
    );
  };

  // Export groupé : les IDs envoyés sont contrôlés un par un par le serveur
  // (existant, service du chef, statut VALIDE) — refus global si un seul n'est
  // pas exportable. RÈGLE FINALE : le serveur REGROUPE PAR SEMAINE —
  // 1 WEEK = 1 fichier Excel (tous les services de la semaine) ; plusieurs
  // semaines -> une archive ZIP d'un fichier par semaine. Le front enregistre
  // simplement le fichier renvoyé (nom lu dans Content-Disposition).
  async function exporterGroupe(ids) {
    setExportMultiEnCours(true);
    try {
      const flux = await api.postBrut('/plannings/emploi-du-temps-multi.xlsx', {
        ids_plannings: ids,
      });
      const url = URL.createObjectURL(flux.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = flux.nomFichier;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export groupé impossible : ' + e.message);
    } finally {
      setExportMultiEnCours(false);
    }
  }

  // Export des plannings cochés du service affiché
  function exporterMultiExcel() {
    return exporterGroupe([...selection]);
  }

  // TOUS les plannings VALIDÉS d'un coup (vue services) : regroupement
  // automatique par semaine côté serveur — 1 WEEK = 1 fichier Excel.
  const listeValides = useMemo(
    () => (plannings || []).filter((p) => p.statut === 'VALIDE'),
    [plannings]
  );
  function toutExporter() {
    return exporterGroupe(listeValides.map((p) => p.id_planning));
  }

  // Export Excel : fichier généré depuis le modèle de référence du projet
  // (endpoint existant, JWT requis) — exactement comme dans la page planning.
  async function exporterExcel(p) {
    setExportEnCours(p.id_planning);
    try {
      const flux = await api.getBrut(`/plannings/${p.id_planning}/emploi-du-temps.xlsx`);
      const url = URL.createObjectURL(flux.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = flux.nomFichier;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export impossible : ' + e.message);
    } finally {
      setExportEnCours(null);
    }
  }

  return (
    <div className="dash-carte">
      {!serviceChoisi ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{t('planning.byService')}</h3>
            <div style={{ display: 'inline-flex', gap: 8 }}>
              {exportAutorise && <button
                className="btn"
                onClick={toutExporter}
                disabled={listeValides.length === 0 || exportMultiEnCours}
                title={t('planning.exportAllHint')}
              >
                <Layers size={14} aria-hidden="true" />
                {t('planning.exportAll')}{listeValides.length > 0 ? ` (${listeValides.length})` : ''}
              </button>}
              <button
                className="btn secondary"
                onClick={onRafraichir}
                disabled={chargement}
                title={t('dashboard.refreshPlans')}
              >
                <RefreshCw size={14} aria-hidden="true" /> {t('common.refresh')}
              </button>
            </div>
          </div>
          {listeServices.length === 0 ? (
            <p className="muted">{t('services.noService')}</p>
          ) : (
            <div className="rh-services-grille">
              {listeServices.map((s) => {
                const st = statsParService[String(s.id_service)] || { total: 0, VALIDE: 0, SOUMIS: 0 };
                return (
                  <button
                    key={s.id_service}
                    type="button"
                    className="rh-service-carte"
                    onClick={() => { setServiceChoisi(s); setSelection(new Set()); }}
                    title={`Voir les plannings de ${s.nom}`}
                  >
                    <div className="rh-service-icone"><Hotel size={17} aria-hidden="true" /></div>
                    <div className="rh-service-info">
                      <div className="rh-service-nom">{s.nom}</div>
                      <div className="rh-service-meta">
                        {st.total > 0 ? (
                          <>
                            {st.total} {t('dashboard.planCount')}
                            {st.VALIDE > 0 && (
                              <BadgeStatutPlanning
                                statut="VALIDE"
                                className="rh-mini-badge rh-mini-valide"
                                size={13}
                                compteur={st.VALIDE}
                                ariaLabel={`${st.VALIDE} ${t('status.VALIDE')}`}
                              />
                            )}
                            {st.SOUMIS > 0 && (
                              <BadgeStatutPlanning
                                statut="SOUMIS"
                                className="rh-mini-badge rh-mini-soumis"
                                size={13}
                                compteur={st.SOUMIS}
                                ariaLabel={`${st.SOUMIS} ${t('status.SOUMIS')}`}
                              />
                            )}
                          </>
                        ) : (
                          <span className="muted">{t('dashboard.noPlansYet')}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} className="rh-service-fleche" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn-icone"
                onClick={() => { setServiceChoisi(null); setSelection(new Set()); }}
                title={t('services.backToServices')}
              >
                <ChevronRight size={15} style={{ transform: 'rotate(180deg)' }} aria-hidden="true" />
              </button>
              {serviceChoisi.nom}
              <span className="muted" style={{ fontSize: 12.5, fontWeight: 400 }}>
                {planningsService.length} {t('dashboard.planCount')}
              </span>
            </h3>
            <button
              className="btn secondary"
              onClick={onRafraichir}
              disabled={chargement}
              title={t('dashboard.refreshPlans')}
            >
              <RefreshCw size={14} aria-hidden="true" /> Actualiser
            </button>
          </div>

          {planningsService.length === 0 ? (
            <p className="muted">Aucun planning pour ce service : l'export sera disponible après validation par la RH.</p>
          ) : (
            <>
              {planningsService.every((p) => p.statut !== 'VALIDE') && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Aucun planning validé disponible pour ce service — l'export Excel est réservé aux plannings validés.
                </p>
              )}
              {exportAutorise && planningsValides.length > 0 && (
                <div className="rh-export-multi">
                  <input
                    type="checkbox"
                    className="rh-case-coche"
                    checked={selection.size > 0 && selection.size === planningsValides.length}
                    onChange={toutSelectionner}
                    title="Sélectionner tous les plannings validés"
                  />
                  <span className="rh-export-multi-info">
                    {selection.size} sélectionné{selection.size > 1 ? 's' : ''} sur {planningsValides.length} planning{planningsValides.length > 1 ? 's' : ''} validé{planningsValides.length > 1 ? 's' : ''}
                  </span>
                  <button
                    className="btn"
                    onClick={exporterMultiExcel}
                    disabled={selection.size === 0 || exportMultiEnCours}
                    title="Exporter les plannings sélectionnés : un fichier Excel par semaine (services regroupés)"
                  >
                    <Layers size={14} aria-hidden="true" />
                    Export groupé{selection.size > 0 ? ` (${selection.size})` : ''}
                  </button>
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
              <table className="dash-table">
                <thead>
                  <tr>
                    {exportAutorise && <th style={{ width: 36 }}></th>}
                    <th>Semaine</th>
                    <th>Période</th>
                    <th>Heures</th>
                    <th>Statut</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {planningsService.map((p) => (
                    <tr key={p.id_planning}>
                      {exportAutorise && <td>
                        <input
                          type="checkbox"
                          className="rh-case-coche"
                          checked={selection.has(p.id_planning)}
                          disabled={p.statut !== 'VALIDE'}
                          onChange={() => basculerSelection(p.id_planning)}
                          title={p.statut === 'VALIDE' ? 'Inclure dans l\'export groupé' : 'Export réservé aux plannings validés'}
                        />
                      </td>}
                      <td>S{p.numero_semaine} / {p.annee}</td>
                      <td>{p.date_debut_semaine ? `${String(p.date_debut_semaine).slice(0, 10)} → ${String(p.date_fin_semaine || '').slice(0, 10)}` : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {p.total_heures != null ? `${Number(p.total_heures).toFixed(1)} h` : <span className="muted">—</span>}
                      </td>
                      <td><BadgeStatutPlanning statut={p.statut} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <Link href={`/planning/${p.id_planning}`} className="btn-icone" title="Consulter le planning">
                            <Eye size={15} aria-hidden="true" />
                          </Link>
                          {exportAutorise && p.statut === 'VALIDE' ? (
                            <button
                              className="btn-icone"
                              onClick={() => exporterExcel(p)}
                              disabled={exportEnCours === p.id_planning}
                              title="Exporter l'emploi du temps Excel (modèle de référence)"
                            >
                              <Download size={15} aria-hidden="true" />
                            </button>
                          ) : exportAutorise ? (
                            <span className="btn-icone rh-export-indispo" title="Export réservé aux plannings validés">
                              <Download size={15} aria-hidden="true" />
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
