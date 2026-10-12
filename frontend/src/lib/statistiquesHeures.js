'use client';

// ============================================================
// CALCULS / HELPERS — heures planifiées + objectifs (page Statistiques)
// ============================================================
// Règle métier Zomatel (seuils centralisés lib/dash.js, jamais dupliqués) :
//   - Administration : 44 h/semaine.
//   - Tous les autres services : 48 h/semaine.
// --------------------------------------------------------------

import { numeroSemaineISO, lundiSemaine, seuilMinHeures } from '@/lib/dash';

export { seuilMinHeures };

export const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// ---------- Conversion des horaires ----------
// "07:30" ou "07:30:00" (hh:mm) => minutes. null si invalide/incomplet.
function hhmmVersMinutes(valeur) {
  const s = String(valeur ?? '').trim();
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const [h, m] = s.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Durée en minutes d'un créneau horaire.
 * - Gère les horaires qui passent après minuit (ex. 22:00 → 06:00 : 8 h).
 * - Un rangement "24:00" en heure de fin est interprété comme fin de journée.
 * - Retourne null si la durée est invalide (bornes incomplètes, > 24 h).
 */
export function dureeCreneauMinutes(heureEntree, heureSortie) {
  const entree = hhmmVersMinutes(heureEntree);
  if (entree === null) return null;
  let sortie = hhmmVersMinutes(heureSortie);
  if (sortie === null) return null;
  if (sortie === 24 * 60) sortie = 0;
  let minutes = sortie - entree;
  if (minutes <= 0) {
    // Passage après minuit : la sortie est le lendemain.
    minutes += 24 * 60;
  }
  return minutes > 24 * 60 ? null : minutes;
}

/**
 * Durée en minutes d'une liste de créneaux d'une même affectation.
 * Somme des durées valides ; flag `invalide` si au moins un créneau est
 * incomplet (une seule borne) ou aberrant (> 24 h) : signalé mais non compté.
 */
export function dureeAffectationMinutes(creneaux) {
  if (!Array.isArray(creneaux)) return { minutes: 0, invalide: false };
  let total = 0;
  let invalide = false;
  for (const c of creneaux) {
    if (!c) continue;
    const hasEntree = c.heure_entree != null && String(c.heure_entree).trim() !== '';
    const hasSortie = c.heure_sortie != null && String(c.heure_sortie).trim() !== '';
    if (hasEntree !== hasSortie) {
      invalide = true; // une seule borne renseignée
      continue;
    }
    const minutes = hasEntree ? dureeCreneauMinutes(c.heure_entree, c.heure_sortie) : null;
    if (minutes === null) {
      invalide = true;
      continue;
    }
    total += minutes;
  }
  return { minutes: total, invalide };
}

// ---------- Objectifs de la période ----------

/**
 * Liste des semaines ISO couvertes par le mois `moisIndex` (0-11) de `annee`.
 * Une semaine appartient au mois de son jeudi (convention ISO 8601, la même
 * que numeroSemaineISO() de lib/dash.js déjà utilisée dans le projet).
 */
export function semainesDuMois(annee, moisIndex) {
  const premier = new Date(annee, moisIndex, 1);
  const dernier = new Date(annee, moisIndex + 1, 0); // dernier jour du mois
  const seen = new Map();
  let d = new Date(premier);
  while (d <= dernier) {
    if (d.getDay() === 4) { // jeudi
      const lundi = lundiSemaine(d);
      const num = numeroSemaineISO(lundi);
      const jeudiAnnee = new Date(lundi);
      jeudiAnnee.setDate(jeudiAnnee.getDate() + 3);
      seen.set(num, {
        cle: `${jeudiAnnee.getFullYear()}-W${String(num).padStart(2, '0')}`,
        numero: num,
        annee: jeudiAnnee.getFullYear(),
      });
    }
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return [...seen.values()].sort((a, b) => a.numero - b.numero);
}

export function nbSemainesDuMois(annee, moisIndex) {
  return semainesDuMois(annee, moisIndex).length || 0;
}

/**
 * Objectif total (en heures) pour un employé de `serviceNom` sur la période :
 *  - 'semaine' : seuil hebdomadaire direct (44 Administration / 48 autres).
 *  - 'mois'    : seuil hebdo × nombre de semaines couvertes par le mois
 *                (les jeudis appartenant au mois, cohérent avec le filtre).
 *  - 'annee'   : seuil hebdo × 52 (l'ISO contient toujours 52 ou 53 semaines ;
 *                le paramètre nbSemaines permet de passer 53 sans casser).
 */
export function objectifPeriode(serviceNom, periode, { annee, mois, nbSemaines } = {}) {
  const seuil = seuilMinHeures(serviceNom);
  if (periode === 'semaine') return seuil;
  if (periode === 'mois') return seuil * nbSemainesDuMois(annee, mois);
  return seuil * (Number(nbSemaines) || 52);
}

/**
 * Libellé humain de la période sélectionnée.
 * Exemples : "Semaine 41 / 2026", "Octobre 2026", "Année 2026".
 */
export function libellePeriode(periode, { numeroSemaine, annee, mois } = {}) {
  if (periode === 'semaine') return `Semaine ${numeroSemaine ?? '—'} / ${annee ?? ''}`;
  if (periode === 'mois') return `${MOIS_FR[mois] ?? ''} ${annee ?? ''}`.trim();
  return `Année ${annee ?? ''}`;
}

// ---------- Filtre de période (plannings backend) ----------
export function estDansPeriode(p, periode, { numeroSemaine, annee, mois } = {}) {
  if (!p) return false;
  const anneeP = Number(p.annee);
  const numP = Number(p.numero_semaine);
  if (periode === 'semaine') {
    return anneeP === Number(annee) && numP === Number(numeroSemaine);
  }
  if (periode === 'mois') {
    // Le planning appartient au mois de son jeudi ISO (cohérent avec
    // objectifPeriode()). La date de début doit exister.
    const debut = String(p.date_debut ?? p.date_debut_semaine ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut)) return false;
    const jeudi = new Date(debut);
    jeudi.setDate(jeudi.getDate() + 3);
    return jeudi.getFullYear() === Number(annee) && jeudi.getMonth() === Number(mois);
  }
  return anneeP === Number(annee);
}

// ---------- Extremes (sans compter les employés sans plannings) ----------
export function extremesAvecHeures(liste) {
  const avec = (liste || []).filter((r) => (Number(r.heures) || 0) > 0);
  if (avec.length === 0) return { max: null, min: null };
  const triNom = (a, b) => String(a.nom || a.nom_employe || '').localeCompare(
    String(b.nom || b.nom_employe || ''), 'fr'
  );
  const max = [...avec].sort((a, b) => b.heures - a.heures || triNom(a, b))[0];
  const min = [...avec].sort((a, b) => a.heures - b.heures || triNom(a, b))[0];
  return { max, min };
}

// ---------- Formatage ----------
export function fmtHeures(v) {
  const n = Number(v) || 0;
  const r = Math.round(n * 10) / 10;
  return String(Number.isInteger(r) ? r : r.toFixed(1));
}
export function fmtEcart(v) {
  const n = Number(v) || 0;
  const s = fmtHeures(Math.abs(n));
  const signe = n > 0.05 ? '+' : n < -0.05 ? '−' : '';
  return `${signe}${s} h`;
}
export function badgeEcart(heures, objectif) {
  const e = Number(heures) - Number(objectif);
  if (Number(heures) <= 0) return 'aucun';
  if (e < -0.05) return 'insuffisant';
  if (e > 0.05) return 'exces';
  return 'conforme';
}
