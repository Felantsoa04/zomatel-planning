'use client';

// SECTION « EMPLOI DU TEMPS » DU DASHBOARD RH — sélection PAR SEMAINE.
// RÈGLE MÉTIER (critère de regroupement, sélection et export) :
//   - le RH choisit UNE semaine (S40, S41...) -> seuls les plannings de CETTE
//     semaine (numero_semaine) sont listés, cochables et exportables ;
//   - date début / date fin = INFORMATIONS AFFICHÉES UNIQUEMENT (des périodes
//     différentes au sein d'une même semaine n'empêchent JAMAIS la sélection) ;
//   - changer de semaine vide automatiquement la sélection ;
//   - un export = UNE SEULE semaine + plusieurs services + UN SEUL fichier
//     .xlsx (regroupement par semaine déjà assuré par le backend).
// L'export réutilise l'endpoint existant POST /plannings/emploi-du-temps-multi.xlsx
// (modèle Excel de référence : document utiliise/EMPLOI DU TEMPS ZOMATEL).
// Le composant REÇOIT services et plannings déjà chargés par DashboardView
// (aucun appel API supplémentaire).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays, FileSpreadsheet, Eye, Loader2, Clock,
} from 'lucide-react';
import BadgeStatutPlanning from '@/components/BadgeStatutPlanning';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

export default function PlanningRhSemaineSection({ plannings, chargement = false, exportAutorise = false }) {
  const { t } = useI18n();
  // Liste déroulante "Semaine : [ S40 ▼ ]" — construite depuis les données
  // réelles (aucune valeur en dur), semaine récente d'abord.
  const semaines = useMemo(() => {
    const map = new Map();
    for (const p of plannings || []) {
      const cle = `${p.annee}-${p.numero_semaine}`;
      if (!map.has(cle)) map.set(cle, { annee: p.annee, numero_semaine: p.numero_semaine });
    }
    return [...map.values()].sort((a, b) =>
      (b.annee - a.annee) || (b.numero_semaine - a.numero_semaine));
  }, [plannings]);

  // Semaine sélectionnée : "annee-numero_semaine" (ex. "2026-40")
  const [semaineChoisie, setSemaineChoisie] = useState('');
  const [selection, setSelection] = useState(() => new Set());
  const [exportEnCours, setExportEnCours] = useState(false);
  const [exportEnCoursId, setExportEnCoursId] = useState(null);
  const [message, setMessage] = useState(null); // { type: 'ok'|'erreur', texte }

  // Changement de semaine : la sélection est AUTOMATIQUEMENT vidée (règle 4).
  function choisirSemaine(cle) {
    setSemaineChoisie(cle);
    setSelection(new Set());
    setMessage(null);
  }

  // Plannings de la semaine choisie UNIQUEMENT — la sélection d'un planning
  // d'une autre semaine est structurellement impossible : ils ne sont pas
  // affichés (pas de risque de mélanger S40 et S41).
  const planningsSemaine = useMemo(
    () => (plannings || []).filter((p) => `${p.annee}-${p.numero_semaine}` === semaineChoisie),
    [plannings, semaineChoisie]
  );

  // Plannings de la semaine NON exportables (tout statut autre que VALIDE :
  // BROUILLON, SOUMIS, REJETE) : affichés pour information, jamais cochables.
  const selectionEstTotale = planningsSemaine.length > 0 &&
    planningsSemaine.every((p) => p.statut === 'VALIDE') &&
    selection.size === planningsSemaine.filter((p) => p.statut === 'VALIDE').length;

  function basculerSelection(id) {
    setSelection((prec) => {
      const s = new Set(prec);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  // « Sélectionner tous » / « Désélectionner tout » : UNIQUEMENT les plannings
  // VALIDÉS de la semaine affichée (l'export est réservé aux validés).
  function toutSelectionner() {
    setSelection(new Set(planningsSemaine.filter((p) => p.statut === 'VALIDE').map((p) => p.id_planning)));
  }
  function toutDeselectionner() {
    setSelection(new Set());
  }

  // Période affichée EN JOURS (« Lundi → Dimanche ») : information seule,
  // JAMAIS comparée (des dates différentes dans la même semaine n'empêchent
  // pas la sélection — la semaine reste le seul critère de regroupement).
  const JOURS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  function jourDe(iso) {
    if (!iso) return null;
    const d = new Date(String(iso).slice(0, 10));
    return Number.isNaN(d.getTime()) ? null : JOURS_FR[d.getDay()];
  }
  function formatPeriode(p) {
    const d = jourDe(p.date_debut);
    const f = jourDe(p.date_fin);
    return `${d || '—'} → ${f || '—'}`;
  }

  // ---- EXPORT : UN SEUL fichier .xlsx pour toute la sélection --------------
  // Validation préalable (règle 6) : au moins un planning, tous de la même
  // semaine (garanti par l'interface), données présentes. Le serveur contrôle
  // à nouveau statut VALIDE + périmètre, et regroupe par semaine.
  async function exporterEmploiDuTemps() {
    if (selection.size === 0) {
      setMessage({ type: 'erreur', texte: 'Veuillez sélectionner au moins un planning à exporter.' });
      return;
    }
    const choisis = planningsSemaine.filter((p) => selection.has(p.id_planning));
    const semainesDifferentes = new Set(choisis.map((p) => `${p.annee}-${p.numero_semaine}`));
    if (semainesDifferentes.size > 1) {
      setMessage({ type: 'erreur', texte: 'Les plannings sélectionnés doivent appartenir à la même semaine.' });
      return;
    }
    setMessage(null);
    setExportEnCours(true);
    try {
      const flux = await api.postBrut('/plannings/emploi-du-temps-multi.xlsx', {
        ids_plannings: choisis.map((p) => p.id_planning),
      });
      const url = URL.createObjectURL(flux.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = flux.nomFichier;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({
        type: 'ok',
        texte: `L'emploi du temps de la semaine S${choisis[0].numero_semaine}${choisis[0].annee ? '/' + choisis[0].annee : ''} a été exporté avec succès.`,
      });
    } catch (e) {
      setMessage({ type: 'erreur', texte: 'Export impossible : ' + e.message });
    } finally {
      setExportEnCours(false);
    }
  }

  // Export SIMPLE d'une ligne : même endpoint mono-planning existant (1 fichier).
  async function exporterLigne(p) {
    setMessage(null);
    setExportEnCoursId(p.id_planning);
    try {
      const flux = await api.getBrut(`/plannings/${p.id_planning}/emploi-du-temps.xlsx`);
      const url = URL.createObjectURL(flux.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = flux.nomFichier;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({
        type: 'ok',
        texte: `L'emploi du temps de la semaine S${p.numero_semaine}${p.annee ? '/' + p.annee : ''} a été exporté avec succès.`,
      });
    } catch (e) {
      setMessage({ type: 'erreur', texte: 'Export impossible : ' + e.message });
    } finally {
      setExportEnCoursId(null);
    }
  }

  return (
    <div className="dash-carte" id="emploi-du-temps">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarDays size={17} aria-hidden="true" /> {t('nav.planning')}
        </h3>
      </div>

      {/* Sélecteur de semaine */}
      <div className="rh-edt-barre">
        <label className="rh-edt-label" htmlFor="rh-edt-semaine">
          {t('common.week')}:
        </label>
        <select
          id="rh-edt-semaine"
          className="rh-edt-select"
          value={semaineChoisie}
          onChange={(e) => choisirSemaine(e.target.value)}
        >
          <option value="">— {t('common.week')} —</option>
          {semaines.map((s) => (
            <option key={`${s.annee}-${s.numero_semaine}`} value={`${s.annee}-${s.numero_semaine}`}>
              Semaine {s.numero_semaine} · {s.annee}
            </option>
          ))}
        </select>
        {chargement && (
          <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <Loader2 size={13} className="spin" aria-hidden="true" /> {t('common.loading')}
          </span>
        )}
      </div>

      {/* États de l'interface */}
      {!chargement && semaines.length === 0 && (
        <p className="muted">Aucun planning disponible.</p>
      )}
      {semaineChoisie && !chargement && planningsSemaine.length === 0 && (
        <p className="muted">Aucun planning disponible pour cette semaine.</p>
      )}
      {semaineChoisie && planningsSemaine.length > 0 && (
        <>
          <div className="rh-edt-actions">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="rh-case-coche"
                checked={selectionEstTotale}
                onChange={selectionEstTotale ? toutDeselectionner : toutSelectionner}
                title={selectionEstTotale ? 'Désélectionner tous les plannings validés de la semaine' : 'Sélectionner tous les plannings validés de la semaine'}
              />
              <span style={{ fontSize: 13 }}>
                {selectionEstTotale ? 'Désélectionner tout' : 'Sélectionner tous les plannings validés'}
              </span>
            </label>
            {exportAutorise && (
              <button
                className="btn"
                onClick={exporterEmploiDuTemps}
                disabled={selection.size === 0 || exportEnCours}
                title="Générer UN SEUL fichier Excel regroupant les plannings sélectionnés de la semaine"
              >
                {exportEnCours
                  ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Génération du fichier Excel…</>
                  : <><FileSpreadsheet size={15} aria-hidden="true" /> Exporter l&apos;emploi du temps</>}
              </button>
            )}
          </div>

          {message && (
            <p className={message.type === 'ok' ? 'rh-edt-message rh-edt-message-ok' : 'rh-edt-message rh-edt-message-erreur'}>
              {message.texte}
            </p>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table className="dash-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Service</th>
                  <th>Semaine</th>
                  <th>Période</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {planningsSemaine.map((p) => (
                  <tr key={p.id_planning}>
                    <td>
                      <input
                        type="checkbox"
                        className="rh-case-coche"
                        checked={selection.has(p.id_planning)}
                        disabled={p.statut !== 'VALIDE'}
                        onChange={() => basculerSelection(p.id_planning)}
                        title={p.statut === 'VALIDE' ? 'Inclure ce planning dans l\'export' : 'Export réservé aux plannings validés'}
                      />
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.service_nom}</td>
                    <td>S{p.numero_semaine} / {p.annee}</td>
                    {/* date début / date fin : INFORMATIONS AFFICHÉES uniquement */}
                    <td>{formatPeriode(p)}</td>
                    <td><BadgeStatutPlanning statut={p.statut} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <Link href={`/planning/${p.id_planning}`} className="btn-icone" title="Consulter le planning">
                          <Eye size={15} aria-hidden="true" />
                        </Link>
                        {exportAutorise && p.statut === 'VALIDE' ? (
                          <button
                            className="btn-icone"
                            onClick={() => exporterLigne(p)}
                            disabled={exportEnCoursId === p.id_planning || exportEnCours}
                            title="Exporter l'emploi du temps Excel de ce planning seul"
                          >
                            {exportEnCoursId === p.id_planning
                              ? <Loader2 size={15} className="spin" aria-hidden="true" />
                              : <FileSpreadsheet size={15} aria-hidden="true" />}
                          </button>
                        ) : exportAutorise ? (
                          <span className="btn-icone rh-export-indispo" title="Export réservé aux plannings validés">
                            <FileSpreadsheet size={15} aria-hidden="true" />
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Légende des indications de la ligne */}
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            <Clock size={11} aria-hidden="true" /> période indicative · seuls les plannings validés sont exportables.
          </p>
        </>
      )}
    </div>
  );
}
