'use client';

/* ÉDITEUR DU MODÈLE SECURITE (SHIFT_POSTE) — grille Jour × Shift × Postes.
 * Configuration lue depuis lib/planningModels.js (shifts, postes) : rien
 * n'est codé dans l'interface. Employés réels du service, dates réelles du
 * planning. Chaque case = un employé ; cellule vide = aucune affectation
 * (jamais remplie automatiquement).
 * Persistance : l'état remonte via onChange au format interne du modèle,
 * la transformation vers affectation/creneau_travail reste centralisée.
 */
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { libelleJourModel } from '@/lib/planningModels';

export default function PlanningEditorShiftPoste({ jours, employes, valeur, onChange, lectureSeule }) {
  const config = valeur.config; // { shifts, postes }
  const donnees = valeur.donnees || {}; // { "jour|shift|posteId": id_employe }
  const [caseOuverte, setCaseOuverte] = useState(null); // { jour, shift, posteId }

  const employesParId = useMemo(
    () => Object.fromEntries((employes || []).map((e) => [e.id_employe, e])),
    [employes]
  );

  function nomEmploye(id) {
    const e = employesParId[id];
    return e ? e.nom : '';
  }

  function definir(jour, shift, posteId, employeId) {
    const cle = `${jour}|${shift}|${posteId}`;
    const suivant = { ...donnees };
    if (employeId) suivant[cle] = employeId;
    else delete suivant[cle];
    onChange({ config, donnees: suivant });
    setCaseOuverte(null);
  }

  return (
    <div className="pm-conteneur">
      <table className="pm-table pm-table-securite">
        <thead>
          <tr>
            <th>ANDRO</th>
            <th>SHIFT</th>
            {config.postes.map((p) => (
              <th key={p}>{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jours.map((jour) =>
            config.shifts.map((shift, indexShift) => (
              <tr key={`${jour}|${shift}`}>
                {indexShift === 0 && (
                  <td rowSpan={config.shifts.length} className="pm-jour">
                    {libelleJourModel(jour, 'MAJ')}
                  </td>
                )}
                <td className="pm-shift">{shift}</td>
                {config.postes.map((p, i) => {
                  const posteId = `poste${i + 1}`;
                  const cle = `${jour}|${shift}|${posteId}`;
                  const idEmp = donnees[cle];
                  return (
                    <td key={posteId} className="pm-case">
                      {lectureSeule ? (
                        idEmp ? nomEmploye(idEmp) : <span className="muted">&nbsp;</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="pm-case-btn"
                            onClick={() => setCaseOuverte({ jour, shift, posteId })}
                            title="Affecter un employé"
                          >
                            {idEmp ? nomEmploye(idEmp) : <Plus size={13} aria-hidden="true" />}
                          </button>
                          {idEmp && (
                            <button
                              type="button"
                              className="pm-case-vider"
                              onClick={() => definir(jour, shift, posteId, null)}
                              title="Vider la case"
                              aria-label="Vider la case"
                            >
                              <X size={10} aria-hidden="true" />
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {caseOuverte && (
        <div className="pm-voile" onClick={() => setCaseOuverte(null)}>
          <div className="pm-popover" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choisir un employé">
            <div className="pm-popover-titre">
              {libelleJourModel(caseOuverte.jour, 'MAJ')} · {caseOuverte.shift} ·{' '}
              {config.postes[Number(String(caseOuverte.posteId).replace('poste', '')) - 1]}
            </div>
            <button className="pm-popover-item" onClick={() => definir(caseOuverte.jour, caseOuverte.shift, caseOuverte.posteId, null)}>
              <X size={13} aria-hidden="true" /> Aucun (vider)
            </button>
            {(employes || []).map((e) => (
              <button
                key={e.id_employe}
                className="pm-popover-item"
                onClick={() => definir(caseOuverte.jour, caseOuverte.shift, caseOuverte.posteId, e.id_employe)}
              >
                {e.nom}
                {e.matricule ? <span className="muted"> ({e.matricule})</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
