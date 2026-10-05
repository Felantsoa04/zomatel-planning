'use client';

/* ÉDITEUR DU MODÈLE HORAIRE_LIBRE — jours en lignes, COLONNES HORAIRES en
 * colonnes + REPOS / CONGE / OBS. (colonnes propres au modèle).
 * Reprise du comportement de l'existant AffectationsHoraireLibre (Housekeeping,
 * Maintenance, STOCK CONGELATEUR) : le format de données est IDENTIQUE
 * { horaires, matrice, statutsJour, observations } — aucune régression.
 * Les colonnes horaires restent des colonnes d'affectation directes : jamais
 * transformées en "employé + heure début + heure fin".
 * Cellules vides = aucune affectation (jamais préremplies).
 */
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { libelleJourModel } from '@/lib/planningModels';

function cle(jour, horaireId) {
  return `${jour}__${horaireId}`;
}

export default function PlanningEditorHoraireLibre({ jours, employes, valeur, onChange, lectureSeule }) {
  // { horaires: [{id, debut, fin, libelle}], matrice, statutsJour, observations }
  const donnees = valeur.donnees || { horaires: [], matrice: {}, statutsJour: {}, observations: {} };
  const { horaires = [], matrice = {}, statutsJour = {}, observations = {} } = donnees;
  const [caseOuverte, setCaseOuverte] = useState(null); // { jour, colId, type }

  const employesParId = useMemo(
    () => Object.fromEntries((employes || []).map((e) => [e.id_employe, e])),
    [employes]
  );
  function noms(listeIds) {
    return (listeIds || []).map((id) => employesParId[id]?.nom).filter(Boolean).join(', ');
  }

  function notifier(next) {
    onChange({ config: valeur.config, donnees: next });
  }

  function ajouterHoraire() {
    const id = `h${Date.now()}`;
    notifier({ ...donnees, horaires: [...horaires, { id, debut: '06:00', fin: '14:00' }] });
  }
  function modifierHoraire(id, champ, valeurChamp) {
    notifier({ ...donnees, horaires: horaires.map((h) => (h.id === id ? { ...h, [champ]: valeurChamp } : h)) });
  }
  function supprimerHoraire(id) {
    const nouvelleMatrice = { ...matrice };
    jours.forEach((j) => delete nouvelleMatrice[cle(j, id)]);
    notifier({ ...donnees, horaires: horaires.filter((h) => h.id !== id), matrice: nouvelleMatrice });
  }

  function basculerEmploye(jour, colId, employeId) {
    const k = cle(jour, colId);
    const actuel = matrice[k] || [];
    const suivant = actuel.includes(employeId) ? actuel.filter((x) => x !== employeId) : [...actuel, employeId];
    notifier({ ...donnees, matrice: { ...matrice, [k]: suivant } });
  }
  function basculerStatut(jour, statut, employeId) {
    const jourActuel = statutsJour[jour] || { REPOS: [], CONGE: [] };
    const liste = jourActuel[statut] || [];
    const nouvelleListe = liste.includes(employeId) ? liste.filter((x) => x !== employeId) : [...liste, employeId];
    notifier({ ...donnees, statutsJour: { ...statutsJour, [jour]: { ...jourActuel, [statut]: nouvelleListe } } });
  }
  function changerObservation(jour, texte) {
    notifier({ ...donnees, observations: { ...observations, [jour]: texte } });
  }

  const selecteur = (colId, type, jour) => (
    <>
      <button
        type="button"
        className="pm-case-btn pm-case-multi"
        disabled={lectureSeule}
        onClick={() => setCaseOuverte({ jour, colId, type })}
        title="Affecter des employés"
      >
        {type === 'OBSERVATION'
          ? (observations[jour] || <span className="muted">&nbsp;</span>)
          : noms((type === 'REST' ? statutsJour[jour]?.REPOS : type === 'LEAVE' ? statutsJour[jour]?.CONGE : matrice[cle(jour, colId)]) || []) || <Plus size={13} aria-hidden="true" />}
      </button>
      {lectureSeule && null}
    </>
  );

  return (
    <div className="pm-conteneur">
      {!lectureSeule && (
        <div className="pm-toolbar">
          <span className="muted">Créneaux horaires de la semaine :</span>
          {horaires.map((h) => (
            <div key={h.id} className="pm-horaire-edit">
              <input type="time" value={h.debut} disabled={lectureSeule} onChange={(e) => modifierHoraire(h.id, 'debut', e.target.value)} />
              <span>–</span>
              <input type="time" value={h.fin || ''} disabled={lectureSeule} onChange={(e) => modifierHoraire(h.id, 'fin', e.target.value)} />
              {!lectureSeule && (
                <button className="pm-suppr" onClick={() => supprimerHoraire(h.id)} title="Supprimer ce créneau" aria-label="Supprimer ce créneau">
                  <X size={11} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {!lectureSeule && (
            <button className="btn secondary" onClick={ajouterHoraire}>
              <Plus size={13} aria-hidden="true" /> Créneau
            </button>
          )}
        </div>
      )}

      <table className="pm-table pm-table-hl">
        <thead>
          <tr>
            <th>JOURS</th>
            {horaires.map((h) => (
              <th key={h.id}>
                {h.debut} - {h.fin || 'FS'}
              </th>
            ))}
            <th>REPOS</th>
            <th>CONGE</th>
            <th>OBS.</th>
          </tr>
        </thead>
        <tbody>
          {jours.map((jour) => (
            <tr key={jour}>
              <td className="pm-jour">{libelleJourModel(jour, 'NORM')}</td>
              {horaires.map((h) => (
                <td key={h.id} className="pm-case">
                  {lectureSeule ? (
                    noms(matrice[cle(jour, h.id)]) || <span className="muted">&nbsp;</span>
                  ) : (
                    selecteur(h.id, 'HORAIRE', jour)
                  )}
                </td>
              ))}
              <td className="pm-case">
                {lectureSeule ? (
                  noms(statutsJour[jour]?.REPOS) || <span className="muted">&nbsp;</span>
                ) : (
                  selecteur(null, 'REST', jour)
                )}
              </td>
              <td className="pm-case">
                {lectureSeule ? (
                  noms(statutsJour[jour]?.CONGE) || <span className="muted">&nbsp;</span>
                ) : (
                  selecteur(null, 'LEAVE', jour)
                )}
              </td>
              <td className="pm-case pm-case-obs">
                {lectureSeule ? (
                  observations[jour] || <span className="muted">&nbsp;</span>
                ) : (
                  <input
                    className="pm-obs-input"
                    placeholder="Note…"
                    value={observations[jour] || ''}
                    onChange={(e) => changerObservation(jour, e.target.value)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {caseOuverte && (
        <div className="pm-voile" onClick={() => setCaseOuverte(null)}>
          <div className="pm-popover" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choisir des employés">
            <div className="pm-popover-titre">
              {libelleJourModel(caseOuverte.jour, 'NORM')}
              {caseOuverte.type === 'HORAIRE'
                ? ` · ${horaires.find((h) => h.id === caseOuverte.colId)?.debut} - ${horaires.find((h) => h.id === caseOuverte.colId)?.fin || 'FS'}`
                : ` · ${caseOuverte.type === 'REST' ? 'REPOS' : 'CONGE'}`}
            </div>
            {(employes || []).map((e) => {
              const selection =
                caseOuverte.type === 'REST' ? statutsJour[caseOuverte.jour]?.REPOS
                : caseOuverte.type === 'LEAVE' ? statutsJour[caseOuverte.jour]?.CONGE
                : matrice[cle(caseOuverte.jour, caseOuverte.colId)] || [];
              const coche = selection.includes(e.id_employe);
              return (
                <button
                  key={e.id_employe}
                  className={`pm-popover-item ${coche ? 'pm-popover-item-actif' : ''}`}
                  onClick={() =>
                    caseOuverte.type === 'REST'
                      ? basculerStatut(caseOuverte.jour, 'REPOS', e.id_employe)
                      : caseOuverte.type === 'LEAVE'
                        ? basculerStatut(caseOuverte.jour, 'CONGE', e.id_employe)
                        : basculerEmploye(caseOuverte.jour, caseOuverte.colId, e.id_employe)
                  }
                >
                  {e.nom}
                  {e.matricule ? <span className="muted"> ({e.matricule})</span> : null}
                </button>
              );
            })}
            <button className="btn secondary pm-popover-fermer" onClick={() => setCaseOuverte(null)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
