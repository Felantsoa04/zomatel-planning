/* ARCHITECTURE MULTI-MODÈLES DE PLANNING — registre déclaratif central.
 * Un modèle = une configuration indépendante (colonnes, types, règles de
 * saisie, affichage, export, impression). Aucun `if (service === ...)` dans
 * l'application : le résolveur associe un service à un modèle, et chaque
 * écran/rendu/export lit la configuration.
 *
 * AJOUTER UN NOUVEAU MODÈLE = ajouter une entrée dans MODELES ci-dessous
 * (colonnes + règles) et, si la saisie diffère, un composant éditeur dédié
 * référencé par `editeur`. Rien d'autre : gestion, consultation, export et
 * impression lisent cette même définition.
 *
 * RÈGLES GÉNÉRALES :
 *   - aucune donnée d'exemple, aucune date, aucune semaine en dur ;
 *   - les employés viennent de la base (affectations réelles) ;
 *   - les cellules vides restent vides (aucune affectation inventée) ;
 *   - un modèle non reconnu retombe sur MODELE_STANDARD (compatibilité
 *     totale avec les anciens plannings).
 */

/* Types de colonnes supportés (extensible) :
 *   JOUR        : libellé du jour (LUNDI 07) calculé depuis les dates réelles
 *   SHIFT       : ligne de shift du jour (MATIN / SOIR — configurable)
 *   EMPLOYEE    : cellule = affectation d'employé(s)
 *   TIME_RANGE  : colonne horaire directe (ex. 6:00 - 14:00)
 *   REST/LEAVE  : statut de jour par employé (REPOS / CONGE)
 *   OBSERVATION : texte libre
 *   TOTAL       : colonne calculée (total d'heures) — lecture seule
 */
export const TYPES_COLONNE = {
  JOUR: 'JOUR',
  SHIFT: 'SHIFT',
  EMPLOYEE: 'EMPLOYEE',
  TIME_RANGE: 'TIME_RANGE',
  REST: 'REST',
  LEAVE: 'LEAVE',
  OBSERVATION: 'OBSERVATION',
  TOTAL: 'TOTAL',
  CUSTOM: 'CUSTOM',
};

/* Statuts du modèle HORAIRE_LIBRE (repos/congé = colonnes propres au modèle) */
const COLONNES_HORAIRE_LIBRE_FIXES = [
  { id: 'repos', libelle: 'REPOS', type: TYPES_COLONNE.REST },
  { id: 'conge', libelle: 'CONGE', type: TYPES_COLONNE.LEAVE },
  { id: 'obs', libelle: 'OBS.', type: TYPES_COLONNE.OBSERVATION },
];

/* ---------------------------------------------------------------------------
 * MODÈLE STANDARD — la grille actuelle employé × jour (périodes fixes).
 * C'est le modèle par défaut : compatibilité parfaite avec l'existant.
 * ------------------------------------------------------------------------- */
const MODELE_STANDARD = {
  code: 'STANDARD',
  nom: 'Périodes fixes (matin / après-midi / soir)',
  type: 'PERIODES_FIXES',
  parDefaut: true,
  // Saisie : une cellule = un employé × un jour → statut + 1..3 créneaux
  saisie: 'CELLULE_EMPLOYE_JOUR',
  periodes: ['MATIN', 'APRES_MIDI', 'SOIR'],
  statutsJour: ['TRAVAIL', 'REPOS', 'CONGE', 'ABSENCE'],
  colonnes: [], // dérivées des jours (employé × jour)
  affichage: { oriente: 'EMPLOYE_JOUR', totalHebdo: true },
};

/* ---------------------------------------------------------------------------
 * MODÈLE SECURITE — jour × shift × postes/zones.
 * Chaque jour contient plusieurs shifts (configurés ci-dessous, aucune
 * valeur codée dans l'interface) ; chaque shift croise des postes/zones ;
 * chaque case accueille un employé. Stockage : une affectation TRAVAIL par
 * employé et par jour, shift+poste mémorisés dans le commentaire existant
 * (aucune modification de base).
 * ------------------------------------------------------------------------- */
const MODELE_SECURITE = {
  code: 'SECURITE',
  nom: 'Sécurité — shifts et postes',
  type: 'SHIFT_POSTE',
  // Shifts et postes : CONFIGURATION du modèle (modifiable ici sans toucher
  // aux écrans). Les dates/jours restent calculés depuis le planning réel.
  shifts: ['MATIN', 'SOIR'],
  postes: ['Chef de poste 1', 'Chef de poste 2', 'Côté réception', 'Côté Snack'],
  saisie: 'SHIFT_POSTE',
  colonnes: [
    { id: 'jour', libelle: 'ANDRO', type: TYPES_COLONNE.JOUR },
    { id: 'shift', libelle: 'SHIFT', type: TYPES_COLONNE.SHIFT },
    ...['Chef de poste 1', 'Chef de poste 2', 'Côté réception', 'Côté Snack'].map((p, i) => ({
      id: `poste${i + 1}`,
      libelle: p,
      type: TYPES_COLONNE.EMPLOYEE,
      poste: p,
    })),
  ],
  affichage: { oriente: 'JOUR_SHIFT_POSTE', totalHebdo: false },
};

/* ---------------------------------------------------------------------------
 * MODÈLE HORAIRE_LIBRE (ex. STOCK CONGELATEUR) — jours en lignes, COLONNES
 * HORAIRES directes (chaque colonne = une plage d'affectation, pas un couple
 * début/fin par employé) + REPOS / CONGE / OBS. fixes du modèle.
 * Reprise exacte du composant existant AffectationsHoraireLibre (déjà utilisé
 * pour Housekeeping/Maintenance) : le format de données ne change pas.
 * ------------------------------------------------------------------------- */
const MODELE_HORAIRE_LIBRE = {
  code: 'HORAIRE_LIBRE',
  nom: 'Horaires en colonnes (jours × plages)',
  type: 'HORAIRES_COLONNES',
  saisie: 'JOUR_COLONNE_HORAIRE',
  // Colonnes horaires PAR DÉFAUT (le chef garde la main pour les ajuster) :
  // identiques au modèle papier STOCK CONGELATEUR (FS = fin de service).
  horairesDefaut: [
    { id: 'h1', debut: '06:00', fin: '14:00', libelle: '6:00 - 14:00' },
    { id: 'h2', debut: '10:00', fin: '14:00', libelle: '10:00 - 14:00 / 18:00 - FS', double: '18:00', finDouble: 'FS' },
    { id: 'h3', debut: '18:00', fin: null, libelle: '18:00 - FS' },
    { id: 'h4', debut: '14:00', fin: null, libelle: '14:00 - FS' },
  ],
  colonnes: [
    { id: 'jour', libelle: 'JOURS', type: TYPES_COLONNE.JOUR },
    ...[
      { id: 'h1', libelle: '6:00 - 14:00', type: TYPES_COLONNE.TIME_RANGE },
      { id: 'h2', libelle: '10:00 - 14:00 / 18:00 - FS', type: TYPES_COLONNE.TIME_RANGE },
      { id: 'h3', libelle: '18:00 - FS', type: TYPES_COLONNE.TIME_RANGE },
      { id: 'h4', libelle: '14:00 - FS', type: TYPES_COLONNE.TIME_RANGE },
    ],
    ...COLONNES_HORAIRE_LIBRE_FIXES,
  ],
  affichage: { oriente: 'JOUR_HORIZON', totalHebdo: false },
};

/* ---------------------------------------------------------------------------
 * REGISTRE — résolution par nom de service (correspondance souple, insensible
 * à la casse/accents ; jamais de structure générique imposée aux modèles
 * spécifiques). Tout service non listé = MODELE_STANDARD.
 * ------------------------------------------------------------------------- */
export const MODELES = {
  STANDARD: MODELE_STANDARD,
  SECURITE: MODELE_SECURITE,
  HORAIRE_LIBRE: MODELE_HORAIRE_LIBRE,
};

/* Modèle par défaut (toute donnée non reconnue) — exporté pour initialiser
 * proprement l'état des pages avant résolution. */
export const MODELE_STANDARD_PAR_DEFAUT = MODELE_STANDARD;

function normaliser(nom) {
  return String(nom || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

/* Correspondances service -> modèle (configuration, pas du code métier).
 * SECURITE et les services HORAIRE_LIBRE (type_affichage en base) sont
 * reconnus ; tous les autres restent sur le modèle standard. */
const REGLE_SECURITE = /SECURITE|GUARD/;
const REGLE_STOCK_CONGELATEUR = /STOCK CONGELATEUR|CONGELATEUR/;

/* Résolveur principal : service (nom + type_affichage) -> modèle. */
export function resoudreModele(service) {
  if (!service) return MODELE_STANDARD;
  const nom = normaliser(service.nom_service || service.nom);
  const type = service.type_affichage || null;
  // 1. Correspondance explicite par nom (prioritaire)
  if (REGLE_SECURITE.test(nom)) return MODELE_SECURITE;
  if (REGLE_STOCK_CONGELATEUR.test(nom)) return MODELE_HORAIRE_LIBRE;
  // 2. Sinon : le type_affichage en base décide (HORAIRE_LIBRE existant)
  if (type === 'HORAIRE_LIBRE') return MODELE_HORAIRE_LIBRE;
  return MODELE_STANDARD;
}

/* Variante pratique : le modèle d'un planning (objet GET /plannings/:id). */
export function modeleDePlanning(planning) {
  if (!planning) return MODELE_STANDARD;
  return resoudreModele({
    nom_service: planning.service_nom || planning.nom_service,
    type_affichage: planning.type_affichage,
  });
}

/* Libellé d'un jour réel "2026-10-05" -> "LUNDI 05" (aucune date en dur). */
export function libelleJourModel(jourIso, style = 'MAJ') {
  if (!jourIso) return '';
  const d = new Date(`${jourIso}T12:00:00`);
  const JOURS = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
  const nom = JOURS[d.getDay()];
  const num = String(d.getDate()).padStart(2, '0');
  return style === 'MAJ' ? `${nom} ${num}` : `${nom.charAt(0)}${nom.slice(1).toLowerCase()} ${num}`;
}

/* Clé de stockage d'une cellule SECURITE dans le commentaire d'affectation :
 * persistée via la colonne existante `commentaire` (aucune migration). */
export function encoderCelluleSecurite(shift, poste) {
  return `SHIFT:${shift}|POSTE:${poste}`;
}
export function decoderCelluleSecurite(commentaire) {
  const m = /SHIFT:([^|]+)\|POSTE:(.+)/.exec(String(commentaire || ''));
  return m ? { shift: m[1], poste: m[2] } : null;
}

/* Clé de stockage d'une cellule HORAIRE_LIBRE (jour × horaire) — même
 * mécanisme commentaire JSON pour rester compatible avec l'existant. */
export function encoderCelluleHoraireLibre(horaireId) {
  return `HL:${horaireId}`;
}
export function decoderCelluleHoraireLibre(commentaire) {
  const m = /^HL:(.+)$/.exec(String(commentaire || ''));
  return m ? { horaireId: m[1] } : null;
}
