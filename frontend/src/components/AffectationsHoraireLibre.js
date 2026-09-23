'use client';

import { useState } from 'react';

// Ecran de saisie pour les services HORAIRE_LIBRE (ex: STOCK CONGELATEUR).
// Jours en lignes, horaires en colonnes (le Chef de service definit lui-meme
// les colonnes horaires de la semaine), REPOS/CONGE/OBS en colonnes fixes.
// Dans chaque case horaire, on assigne un ou plusieurs employes (comme sur le papier).

function cle(jour, horaireId) {
  return `${jour}__${horaireId}`;
}

export default function AffectationsHoraireLibre({ jours, employes, valeurInitiale, onChange }) {
  // horaires : [{ id, debut, fin }]
  const [horaires, setHoraires] = useState(valeurInitiale?.horaires || []);
  // matrice : { [cle(jour, horaireId)]: [employeId, ...] }
  const [matrice, setMatrice] = useState(valeurInitiale?.matrice || {});
  // statutsJour : { [jour]: { REPOS: [employeId...], CONGE: [employeId...] } }
  const [statutsJour, setStatutsJour] = useState(valeurInitiale?.statutsJour || {});
  // observations : { [jour]: { [employeId]: texte } }
  const [observations, setObservations] = useState(valeurInitiale?.observations || {});

  function notifier(next) {
    onChange?.(next);
  }

  function ajouterHoraire() {
    const id = `h${Date.now()}`;
    const nouveaux = [...horaires, { id, debut: '06:00', fin: '14:00' }];
    setHoraires(nouveaux);
    notifier({ horaires: nouveaux, matrice, statutsJour, observations });
  }

  function modifierHoraire(id, champ, valeur) {
    const nouveaux = horaires.map((h) => (h.id === id ? { ...h, [champ]: valeur } : h));
    setHoraires(nouveaux);
    notifier({ horaires: nouveaux, matrice, statutsJour, observations });
  }

  function supprimerHoraire(id) {
    const nouveaux = horaires.filter((h) => h.id !== id);
    // Nettoie les cases de la matrice qui referencaient cet horaire
    const nouvelleMatrice = { ...matrice };
    jours.forEach((jour) => delete nouvelleMatrice[cle(jour, id)]);
    setHoraires(nouveaux);
    setMatrice(nouvelleMatrice);
    notifier({ horaires: nouveaux, matrice: nouvelleMatrice, statutsJour, observations });
  }

  function toggleEmployeDansCase(jour, horaireId, employeId) {
    const k = cle(jour, horaireId);
    const actuel = matrice[k] || [];
    const nouveau = actuel.includes(employeId)
      ? actuel.filter((id) => id !== employeId)
      : [...actuel, employeId];
    const nouvelleMatrice = { ...matrice, [k]: nouveau };
    setMatrice(nouvelleMatrice);
    notifier({ horaires, matrice: nouvelleMatrice, statutsJour, observations });
  }

  function toggleStatutJour(jour, statut, employeId) {
    const actuelJour = statutsJour[jour] || { REPOS: [], CONGE: [] };
    const actuelListe = actuelJour[statut] || [];
    const nouvelleListe = actuelListe.includes(employeId)
      ? actuelListe.filter((id) => id !== employeId)
      : [...actuelListe, employeId];
    const nouveauStatutsJour = { ...statutsJour, [jour]: { ...actuelJour, [statut]: nouvelleListe } };
    setStatutsJour(nouveauStatutsJour);
    notifier({ horaires, matrice, statutsJour: nouveauStatutsJour, observations });
  }

  function modifierObservation(jour, employeId, texte) {
    const actuelJour = observations[jour] || {};
    const nouvelObservations = { ...observations, [jour]: { ...actuelJour, [employeId]: texte } };
    setObservations(nouvelObservations);
    notifier({ horaires, matrice, statutsJour, observations: nouvelObservations });
  }

  return (
    <div className="ahl-conteneur">
      <div className="ahl-toolbar">
        <span>Créneaux horaires de la semaine :</span>
        {horaires.map((h) => (
          <div key={h.id} className="ahl-horaire-edit">
            <input type="time" value={h.debut} onChange={(e) => modifierHoraire(h.id, 'debut', e.target.value)} />
            <span>–</span>
            <input type="time" value={h.fin} onChange={(e) => modifierHoraire(h.id, 'fin', e.target.value)} />
            <button className="ahl-suppr" onClick={() => supprimerHoraire(h.id)} title="Supprimer ce créneau">
              ×
            </button>
          </div>
        ))}
        <button className="btn secondary" onClick={ajouterHoraire}>+ Créneau</button>
      </div>

      <table className="edt-libre-table">
        <thead>
          <tr>
            <th className="edt-libre-coin">Jours</th>
            {horaires.map((h) => (
              <th key={h.id}>{h.debut} - {h.fin}</th>
            ))}
            <th>REPOS</th>
            <th>CONGE</th>
            <th>OBS.</th>
          </tr>
        </thead>
        <tbody>
          {jours.map((jour) => (
            <tr key={jour}>
              <td className="edt-libre-jour">{libelleCourt(jour)}</td>

              {horaires.map((h) => (
                <td key={h.id}>
                  <SelecteurEmployes
                    employes={employes}
                    selection={matrice[cle(jour, h.id)] || []}
                    onToggle={(empId) => toggleEmployeDansCase(jour, h.id, empId)}
                  />
                </td>
              ))}

              <td>
                <SelecteurEmployes
                  employes={employes}
                  selection={statutsJour[jour]?.REPOS || []}
                  onToggle={(empId) => toggleStatutJour(jour, 'REPOS', empId)}
                />
              </td>
              <td>
                <SelecteurEmployes
                  employes={employes}
                  selection={statutsJour[jour]?.CONGE || []}
                  onToggle={(empId) => toggleStatutJour(jour, 'CONGE', empId)}
                />
              </td>
              <td>
                <input
                  className="ahl-obs-input"
                  placeholder="Note..."
                  onBlur={(e) => {
                    // Simplification : une observation generale par jour, rattachee
                    // au premier employe concerne. A affiner si vous voulez une
                    // observation par employe plutot que par jour.
                    if (e.target.value) modifierObservation(jour, 'general', e.target.value);
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Multi-selection compacte : coche les employes presents dans une case donnee.
// Affiche les noms selectionnes, avec une liste depliable au clic pour cocher/decocher.
function SelecteurEmployes({ employes, selection, onToggle }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="ahl-select-conteneur">
      <button type="button" className="ahl-select-bouton" onClick={() => setOuvert((v) => !v)}>
        {selection.length > 0
          ? employes.filter((e) => selection.includes(e.id_employe)).map((e) => e.nom).join(', ')
          : '—'}
      </button>

      {ouvert && (
        <div className="ahl-select-liste">
          {employes.map((e) => (
            <label key={e.id_employe} className="ahl-select-item">
              <input
                type="checkbox"
                checked={selection.includes(e.id_employe)}
                onChange={() => onToggle(e.id_employe)}
              />
              {e.nom}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function libelleCourt(jour) {
  const JOURS_FR = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(a, m - 1, j);
  return `${JOURS_FR[d.getDay()]} ${String(j).padStart(2, '0')}`;
}

// Convertit l'etat interne en liste d'affectations plate, au meme format
// que celui attendu par POST /affectations (voir page.js).
export function versAffectationsPlates({ horaires, matrice, statutsJour, observations }, jours) {
  const resultat = [];

  jours.forEach((jour) => {
    horaires.forEach((h) => {
      const employesAssignes = matrice[cle(jour, h.id)] || [];
      employesAssignes.forEach((employeId) => {
        resultat.push({ employeId, jour, type: 'TRAVAIL', debut: h.debut, fin: h.fin });
      });
    });

    (statutsJour[jour]?.REPOS || []).forEach((employeId) => {
      resultat.push({ employeId, jour, type: 'REPOS' });
    });
    (statutsJour[jour]?.CONGE || []).forEach((employeId) => {
      resultat.push({ employeId, jour, type: 'CONGE' });
    });
  });

  return resultat;
}