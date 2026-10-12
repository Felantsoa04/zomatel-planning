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
import { numeroSemaineISO } from '@/lib/dash';

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

  const pairesJours = [];
  for (let i = 0; i < jours.length; i += 2) {
    pairesJours.push(jours.slice(i, i + 2));
  }
  const numeroSemaine = jours.length ? numeroSemaineISO(new Date(`${jours[0]}T12:00:00`)) : null;
  const nomJour = (jour) => libelleJourModel(jour, 'MAJ');
  const nomPoste = (poste) => poste.replace(/^Chef de poste\s+(\d+)$/i, 'Chef de poste$1');

  return (
    <div className="pm-conteneur pm-securite">
      <header className="pm-securite-entete">
        {numeroSemaine !== null && <span className="pm-securite-semaine">WEEK {String(numeroSemaine).padStart(2, '0')}</span>}
        <h2>SECURITE</h2>
      </header>

      <div className="pm-securite-table-wrap">
        <table className="pm-table pm-table-securite">
          <colgroup>
            <col className="pm-securite-col-shift" />
            {Array.from({ length: config.postes.length * 2 }, (_, index) => (
              <col key={index} />
            ))}
          </colgroup>
          {pairesJours.map((paire) => {
            const dimancheSeul = paire.length === 1;
            return (
              <tbody key={paire[0]}>
                <tr className="pm-securite-jours">
                  <th aria-hidden="true" />
                  {dimancheSeul && <th colSpan={config.postes.length / 2} aria-hidden="true" />}
                  {paire.map((jour) => (
                    <th scope="colgroup" colSpan={config.postes.length} key={jour}>
                      {nomJour(jour)}
                    </th>
                  ))}
                  {dimancheSeul && <th colSpan={config.postes.length / 2} aria-hidden="true" />}
                </tr>
                <tr className="pm-securite-postes">
                  <th scope="col" className="pm-securite-shift">SHIFT</th>
                  {dimancheSeul && <th colSpan={config.postes.length / 2} aria-hidden="true" />}
                  {paire.flatMap((jour) => config.postes.map((poste) => (
                    <th scope="col" key={`${jour}|${poste}`}>{nomPoste(poste)}</th>
                  )))}
                  {dimancheSeul && <th colSpan={config.postes.length / 2} aria-hidden="true" />}
                </tr>
                {config.shifts.map((shift) => (
                  <tr key={`${paire[0]}|${shift}`}>
                    <th scope="row" className="pm-securite-shift">{shift}</th>
                    {dimancheSeul && <td colSpan={config.postes.length / 2} aria-hidden="true" />}
                    {paire.flatMap((jour) => config.postes.map((poste, i) => {
                      const posteId = `poste${i + 1}`;
                      const cle = `${jour}|${shift}|${posteId}`;
                      const idEmp = donnees[cle];
                      return (
                        <td key={`${jour}|${posteId}`} className="pm-case">
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
                    }))}
                    {dimancheSeul && <td colSpan={config.postes.length / 2} aria-hidden="true" />}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>

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
