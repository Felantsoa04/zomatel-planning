'use client';

import LegendeStatuts from './LegendeStatuts';
import { api } from '@/lib/api';

// Vue "emploi du temps officiel" reproduisant le format du fichier Excel Zomatel :
// un bloc par jour, employes en lignes, 3 periodes (matin / apres-midi / soir)
// en colonnes avec entree / sortie / duree, puis un bloc RECAP hebdomadaire.

const PERIODES = ['MATIN', 'APRES_MIDI', 'SOIR'];
const LIBELLE_PERIODE = { MATIN: 'matin', APRES_MIDI: 'après-midi', SOIR: 'soir' };

function formatHeure(h) {
  return h ? h.slice(0, 5) : '';
}

// Convertit "06:00" -> minutes, pour calculer les durees a l'affichage
function enMinutes(h) {
  if (!h) return 0;
  const [hh, mm] = h.slice(0, 5).split(':').map(Number);
  return hh * 60 + mm;
}

function formatDuree(minutes) {
  if (!minutes) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function dureeCreneau(creneau) {
  if (!creneau || !creneau.heure_entree || !creneau.heure_sortie) return 0;
  return enMinutes(creneau.heure_sortie) - enMinutes(creneau.heure_entree);
}

function listeJours(dateDebut, dateFin) {
  const jours = [];
  const d = new Date(dateDebut);
  const fin = new Date(dateFin);
  while (d <= fin) {
    jours.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return jours;
}

function libelleJour(jour) {
  return new Date(jour)
    .toLocaleDateString('fr-FR', { weekday: 'long' })
    .toUpperCase();
}

function dateCourte(jour) {
  return new Date(jour).toLocaleDateString('fr-FR');
}

// imprimable = false par defaut (regle : seul un planning VALIDE par le RH
// peut etre imprime — le parent doit passer imprimable={planning.statut === 'VALIDE'}).
export default function EmploiDuTemps({ planning, affectations, employes, imprimable = false }) {
  const jours = listeJours(planning.date_debut, planning.date_fin);

  function affectationDe(employeId, jour) {
    return affectations.find((a) => a.id_employe === employeId && a.jour === jour);
  }

  function creneauDe(affectation, periode) {
    return (affectation?.creneaux || []).find((c) => c.periode === periode);
  }

  // Total hebdomadaire d'un employe, en minutes (jamais stocke : recalcule ici)
  function totalHebdo(employeId) {
    return jours.reduce((total, jour) => {
      const aff = affectationDe(employeId, jour);
      const minutesJour = PERIODES.reduce(
        (s, p) => s + dureeCreneau(creneauDe(aff, p)),
        0
      );
      return total + minutesJour;
    }, 0);
  }

  return (
    <div className="edt-print">
      <div className="edt-entete no-print">
        <h3>
          Emploi du temps — {planning.service_nom} — WEEK {planning.numero_semaine}/{planning.annee}
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {imprimable && (
            <button className="btn secondary" onClick={() => window.print()}>
              Imprimer / PDF
            </button>
          )}
          <button
            className="btn secondary"
            onClick={async () => {
              try {
                // Téléchargement authentifié (token) du fichier généré depuis
                // le modèle Excel de référence ; le modèle original est intact.
                const flux = await api.getBrut(`/plannings/${planning.id_planning}/emploi-du-temps.xlsx`);
                const url = URL.createObjectURL(flux.blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = flux.nomFichier;
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                alert('Export impossible : ' + e.message);
              }
            }}
          >
            Export Excel
          </button>
        </div>
      </div>

      <h2 className="edt-titre">
        EMPLOI DU TEMPS {planning.service_nom} WEEK {planning.numero_semaine}
      </h2>

      <LegendeStatuts />

      {jours.map((jour) => (
        <BlocJour
          key={jour}
          jour={jour}
          planning={planning}
          employes={employes}
          affectationDe={affectationDe}
          creneauDe={creneauDe}
        />
      ))}

      {/* Bloc RECAP : total hebdomadaire par employe */}
      <table className="edt-table edt-recap">
        <thead>
          <tr>
            <th colSpan={3}>RECAP</th>
          </tr>
        </thead>
        <tbody>
          {employes.map((emp) => {
            const total = totalHebdo(emp.id_employe);
            const reference = (emp.reference_hebdo || 44) * 60;
            return (
              <tr key={emp.id_employe} className={total > reference ? 'edt-depassement' : ''}>
                <td>{emp.matricule || emp.statut}</td>
                <td>{emp.nom}</td>
                <td>{formatDuree(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <style jsx global>{`
        /* Impression : meme tableau, meme design ; on neutralise seulement les
           limites de largeur/overflow pour que TOUTES les colonnes tiennent sur
           la page (A4 paysage defini globalement), on evite de couper un bloc
           jour en deux, et chaque page garde son en-tete de tableau. */
        @media print {
          .edt-print {
            width: 100% !important;
            overflow: visible !important;
          }
          .edt-print table {
            width: 100% !important;
            table-layout: auto !important;
            overflow: visible !important;
            font-size: 10px;
          }
          .edt-print td, .edt-print th { overflow: visible !important; }
          .edt-bloc-jour { page-break-inside: avoid; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function BlocJour({ jour, planning, employes, affectationDe, creneauDe }) {
  // Totaux par periode affiches en bas du bloc, comme dans l'Excel
  const totauxPeriode = PERIODES.map((p) =>
    employes.reduce(
      (s, emp) => s + dureeCreneau(creneauDe(affectationDe(emp.id_employe, jour), p)),
      0
    )
  );
  const totalJour = totauxPeriode.reduce((a, b) => a + b, 0);

  return (
    <div className="edt-bloc-jour">
      <table className="edt-table">
        <thead>
          <tr className="edt-ligne-service">
            <th colSpan={2}>{planning.service_nom}</th>
            <th colSpan={9}>
              {libelleJour(jour)} {dateCourte(jour)}
            </th>
            <th colSpan={2}></th>
          </tr>
          <tr className="edt-ligne-periode">
            <th colSpan={2}></th>
            {PERIODES.map((p) => (
              <th key={p} colSpan={3}>{LIBELLE_PERIODE[p]}</th>
            ))}
            {/* Total par periode (entrée/sortie/durée) -> 2 colonnes vides restantes */}
            <th></th>
            <th></th>
          </tr>
          <tr>
            <th></th>
            <th>Personne</th>
            {PERIODES.map((p) => (
              <FragmentEntete key={p} />
            ))}
            <th>durée total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {employes.map((emp) => {
            const aff = affectationDe(emp.id_employe, jour);
            const durees = PERIODES.map((p) => dureeCreneau(creneauDe(aff, p)));
            const totalLigne = durees.reduce((a, b) => a + b, 0);
            const statut = aff?.statut_jour && aff.statut_jour !== 'TRAVAIL' ? aff.statut_jour : '';

            return (
              <tr key={emp.id_employe}>
                <td>{emp.matricule || emp.statut}</td>
                <td>{emp.nom}</td>
                {PERIODES.map((p, i) => {
                  const c = creneauDe(aff, p);
                  return (
                    <FragmentCreneau
                      key={p}
                      entree={formatHeure(c?.heure_entree)}
                      sortie={formatHeure(c?.heure_sortie)}
                      duree={formatDuree(durees[i])}
                    />
                  );
                })}
                <td className="edt-total">{formatDuree(totalLigne)}</td>
                {/* Couleur de statut appliquee sur la cellule d'observation : meme
                    teintes que la legende, structure et donnees inchangees */}
                <td className={`edt-obs ${statut ? `edt-statut-${statut}` : ''}`}>{statut || aff?.observation || ''}</td>
              </tr>
            );
          })}

          <tr className="edt-ligne-totaux">
            <td colSpan={2}></td>
            {totauxPeriode.map((t, i) => (
              <FragmentTotalPeriode key={i} valeur={formatDuree(t)} />
            ))}
            <td className="edt-total">{formatDuree(totalJour)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FragmentEntete() {
  return (
    <>
      <th>entrée</th>
      <th>sortie</th>
      <th>durée</th>
    </>
  );
}

function FragmentCreneau({ entree, sortie, duree }) {
  return (
    <>
      <td>{entree}</td>
      <td>{sortie}</td>
      <td className="edt-duree">{duree}</td>
    </>
  );
}

function FragmentTotalPeriode({ valeur }) {
  return (
    <>
      <td></td>
      <td></td>
      <td className="edt-duree">{valeur}</td>
    </>
  );
}