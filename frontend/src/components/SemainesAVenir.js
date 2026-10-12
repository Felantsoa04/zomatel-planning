'use client';

// WIDGET « PROCHAINES SEMAINES » du dashboard Zomatel.
// Grille compacte : lignes = services, colonnes = les 6 prochaines semaines
// (calcul ISO dynamique — aucune date en dur). Chaque cellule montre l'ETAT
// du planning du service pour cette semaine, à partir des données réelles
// /plannings (statuts) : Aucun · Brouillon · Soumis · Validé · Rejeté.
// Clic sur une cellule : ouvre la grille de planning pour ce service/semaine
// (page /planning/gestion existante, paramètres ?service=&semaine= déjà gérés).

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import BadgeStatutPlanning from '@/components/BadgeStatutPlanning';
import { libelleStatut, semainesAVenir } from '@/lib/dash';
import { useI18n } from '@/lib/i18n';

// Statuts sur lesquels le Chef peut encore agir (modifier/préparer) : un
// planning SOUMIS ou VALIDE est dans le circuit RH (workflow Chef -> RH,
// non modifiable directement). AUCUN (pas de planning) est géré à part.
const ACTIF_POSSIBLE = ['BROUILLON', 'REJETE'];

export default function SemainesAVenir({ plannings = [], services = [], estChef = false, idServiceChef = null }) {
  const router = useRouter();
  const { t } = useI18n();

  // Les 6 semaines à venir (courante incluse), dynamiques.
  const semaines = useMemo(() => semainesAVenir(6), []);

  // Services à afficher (chef → le sien uniquement ; le filtrage réel reste
  // côté backend : /plannings ne renvoie déjà que les siens).
  const servicesAffiches = useMemo(() => {
    if (estChef && idServiceChef != null) {
      return services.filter((s) => Number(s.id_service) === Number(idServiceChef));
    }
    return services;
  }, [services, estChef, idServiceChef]);

  // Index : "serviceId|annee|numero" → planning (le plus récent si doublon).
  const indexPlannings = useMemo(() => {
    const m = {};
    for (const p of plannings) {
      if (p.id_service == null) continue;
      const cle = `${p.id_service}|${p.annee}|${p.numero_semaine}`;
      const cur = m[cle];
      if (!cur || p.updated_at >= cur.updated_at || !cur.updated_at) m[cle] = p;
    }
    return m;
  }, [plannings]);

  // Compteurs d'en-tête : combien de services ont un planning validé / à faire.
  const totaux = useMemo(() => {
    let valides = 0;
    let aFaire = 0;
    let cases = 0;
    for (const s of servicesAffiches) {
      for (const w of semaines) {
        const p = indexPlannings[`${s.id_service}|${w.annee}|${w.numero}`];
        if (p) {
          if (p.statut === 'VALIDE') valides++;
          else if (ACTIF_POSSIBLE.includes(p.statut)) aFaire++;
        }
        cases++;
      }
    }
    return { valides, aFaire, cases, aucun: cases - valides - aFaire };
  }, [servicesAffiches, semaines, indexPlannings]);

  // Format date court : "07/09".
  const fmt = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

  function allerPlanning(serviceId, semaine) {
    router.push(`/planning/gestion?service=${serviceId}&semaine=${semaine.annee}-W${String(semaine.numero).padStart(2, '0')}`);
  }

  return (
    <div className="dash-carte">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{t('dashboard.upcoming')}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          <BadgeStatutPlanning statut="VALIDE" compteur={totaux.valides} /> · {totaux.aFaire} {t('dashboard.toSubmit').toLowerCase()} · {totaux.aucun} {t('dashboard.noPlansYet').toLowerCase()}
        </p>
      </div>

      {servicesAffiches.length === 0 ? (
        <p className="muted">{t('common.noData')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="swv-table">
            <thead>
              <tr>
                <th className="swv-col-service">Service</th>
                {semaines.map((w) => (
                  <th key={`${w.annee}-${w.numero}`} className={w.numero === semaines[0].numero ? 'swv-courante' : ''}>
                    S{w.numero}
                    <span className="swv-dates">{fmt(w.debut)} → {fmt(w.fin)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {servicesAffiches.map((s) => (
                <tr key={s.id_service}>
                  <td className="swv-service" title={s.nom || s.nom_service}>
                    {s.nom || s.nom_service}
                  </td>
                  {semaines.map((w) => {
                    const p = indexPlannings[`${s.id_service}|${w.annee}|${w.numero}`];
                    const statut = p ? p.statut : 'AUCUN';
                    // Chef : cliquable si pas de planning (créer) ou modifiable
                    // (BROUILLON/REJETE). RH/ADMIN : cliquable si un planning
                    // existe (consultation de la grille).
                    const cliquable = estChef
                      ? statut === 'AUCUN' || ACTIF_POSSIBLE.includes(statut)
                      : !!p;
                    const titrePlanning = `${t('planning.title')} ${libelleStatut(statut, t)} S${w.numero}/${w.annee}`;
                    return (
                      <td key={`${s.id_service}-${w.annee}-${w.numero}`} className={w.numero === semaines[0].numero ? 'swv-courante' : ''}>
                        {cliquable ? (
                          statut === 'AUCUN' ? (
                            <button
                              type="button"
                              className="badge swv-aucun"
                              title={`${t('planning.title')} · ${s.nom_service || s.nom} S${w.numero}/${w.annee}`}
                              onClick={() => allerPlanning(s.id_service, w)}
                            >
                              —
                            </button>
                          ) : (
                            <BadgeStatutPlanning
                              as="button"
                              statut={statut}
                              title={titrePlanning}
                              ariaLabel={titrePlanning}
                              onClick={() => allerPlanning(s.id_service, w)}
                            />
                          )
                        ) : (
                          statut === 'AUCUN'
                            ? <span className="badge swv-aucun">—</span>
                            : <BadgeStatutPlanning statut={statut} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
        {estChef
          ? t('dashboard.upcoming')
          : t('dashboard.viewPlans')}
      </p>
    </div>
  );
}
