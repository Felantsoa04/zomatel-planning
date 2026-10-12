'use client';

// ============================================================
// PÉRIODES — listes d'années / mois / semaine courante
// (utilisé par la page Statistiques ; réutilise lib/dash.js)
// --------------------------------------------------------------

import { numeroSemaineISO, lundiSemaine } from '@/lib/dash';

export const JOURS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// Numéro de semaine ISO du jour courant (ex. 41).
export function numeroSemaineActuelle() {
  return numeroSemaineISO(new Date());
}

/**
 * Liste des années disponibles = années des plannings réels + année courante
 * (décroissant). La prop `defaut` garantit la présence de l'année sélectionnée.
 */
export function anneesDisponibles(plannings, defaut) {
  const set = new Set((plannings || []).map((p) => Number(p.annee)));
  if (defaut) set.add(Number(defaut));
  set.add(new Date().getFullYear());
  return [...set].filter((a) => Number.isFinite(a)).sort((a, b) => b - a);
}

/**
 * Liste des mois (indices 0-11) pour la page de filtres du mois.
 * AUCUN mois inventé : on liste toujours les 12 (le filtre par défaut est
 * le mois courant) mais seuls les mois réellement couverts par des
 * plannings activent les options au-delà du courant.
 */
export function moisDisponibles() {
  return [...Array(12).keys()];
}

/**
 * Liste de toutes les semaines ISO de l'année `annee`.
 */
export function semainesAnnee(annee) {
  const out = [];
  let d = new Date(annee, 0, 1);
  for (let i = 0; i < 371; i++) {
    if (d.getDay() === 1) { // lundi
      const jeudi = new Date(d);
      jeudi.setDate(jeudi.getDate() + 3);
      if (jeudi.getFullYear() === Number(annee)) {
        const num = numeroSemaineISO(d);
        out.push({
          cle: `${annee}-W${String(num).padStart(2, '0')}`,
          numero: num,
          annee: Number(annee),
        });
      }
    }
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return out;
}

// (re-export pour compat interne du projet)
export { lundiSemaine };
