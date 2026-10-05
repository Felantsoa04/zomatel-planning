/* CONVERSIONS DE DONNÉES PAR MODÈLE — seul endroit où le format interne des
 * modèles rencontre le format de stockage existant (affectation + creneau_travail).
 * Les écrans ne connaissent JAMAIS la persistance ; la base ne connaît JAMAIS
 * les modèles. Ajouter un modèle = ajouter 2 fonctions ici (vers/depuis).
 *
 * Rappels du format de stockage (inchangé) :
 *   affectation { planning_id, employe_id, date_jour, statut, commentaire }
 *   creneau_travail { affectation_id, type_creneau MATIN|APRES_MIDI|SOIR,
 *                     heure_entree, heure_sortie }
 *   règle serveur : la période est déduite de l'HEURE DE DÉBUT.
 */

/* ---------- Helpers partagés ---------- */

// Période déduite de l'heure de début (règle Excel du projet, identique au
// contrôleur de grille côté serveur).
export function periodeDe(entree) {
  if (!entree) return 'MATIN';
  const [hh, mm] = String(entree).slice(0, 5).split(':').map(Number);
  const m = hh * 60 + (mm || 0);
  if (m < 12 * 60) return 'MATIN';
  if (m < 18 * 60) return 'APRES_MIDI';
  return 'SOIR';
}

function enMinutes(h) {
  if (!h) return 0;
  const [hh, mm] = String(h).slice(0, 5).split(':').map(Number);
  return hh * 60 + (mm || 0);
}

/* ---------- MODELE STANDARD (grille employé × jour existante) ---------- */
/* Format interne : { "employeId|jour": { statut_jour, entree, sortie } }
 * (identique à l'état actuel de la page gestion — aucune régression). */

export function versInterneStandard(affectations, creneaux) {
  const etat = {};
  const creneauParAffectation = Object.fromEntries((creneaux || []).map((c) => [c.id_affectation, c]));
  for (const a of affectations || []) {
    const c = creneauParAffectation[a.id_affectation];
    etat[`${a.id_employe}|${a.jour}`] = {
      statut_jour: a.statut_jour,
      entree: c ? String(c.heure_entree).slice(0, 5) : '',
      sortie: c ? String(c.heure_sortie).slice(0, 5) : '',
    };
  }
  return etat;
}

export function depuisInterneStandard(etat, affectationsExistantes) {
  const cellules = [];
  for (const [cle, cel] of Object.entries(etat || {})) {
    const [id_employe, jour] = cle.split('|');
    cellules.push({
      id_employe: Number(id_employe),
      jour,
      statut_jour: cel.statut_jour,
      creneau:
        cel.statut_jour === 'TRAVAIL' && cel.entree && cel.sortie
          ? { periode: periodeDe(cel.entree), heure_entree: cel.entree, heure_sortie: cel.sortie }
          : null,
    });
  }
  // Cellules existantes vidées à l'écran -> suppression (logique existante)
  for (const a of affectationsExistantes || []) {
    if (!etat[`${a.id_employe}|${a.jour}`]) {
      cellules.push({ id_employe: a.id_employe, jour: a.jour, statut_jour: 'VIDE', creneau: null });
    }
  }
  return cellules;
}

/* ---------- MODELE SECURITE (jour × shift × postes) ---------- */
/* Format interne : { "jour|shift|posteId": id_employe }
 * Stockage : 1 affectation TRAVAIL par (employé, jour) ; shift+poste dans le
 * COMMENTAIRE existant (`SHIFT:MATIN|POSTE:poste1`) ; le créneau porte la
 * fourchette du shift (06:00-18:00 / 18:00-24:00 — lisible dans l'export).
 * Plusieurs postes d'un même shift = plusieurs affectations du même employé
 * impossible : une case = un employé (une affectation par jour/employé).
 */

export function versInterneSecurite(affectations, creneaux) {
  const donnees = {};
  const creneauParAffectation = Object.fromEntries((creneaux || []).map((c) => [c.id_affectation, c]));
  for (const a of affectations || []) {
    if (a.statut_jour !== 'TRAVAIL') continue;
    const decodage = /SHIFT:([^|]+)\|POSTE:(.+)/.exec(String(a.observation || a.commentaire || ''));
    if (!decodage) continue; // ancienne donnée standard : ignorée par ce modèle
    const creneau = creneauParAffectation[a.id_affectation];
    const cle = `${String(a.jour).slice(0, 10)}|${decodage[1]}|${decodage[2]}`;
    donnees[cle] = a.id_employe;
    void creneau; // l'horaire affiché vient du shift, pas de la saisie
  }
  return donnees;
}

// Le shift détermine la fourchette horaire (config, aucune valeur écran).
export function creneauDeShift(shift) {
  switch (String(shift).toUpperCase()) {
    case 'MATIN': return { heure_entree: '06:00', heure_sortie: '18:00' };
    case 'SOIR': return { heure_entree: '18:00', heure_sortie: '23:59' };
    default: return { heure_entree: '08:00', heure_sortie: '16:00' };
  }
}

export function depuisInterneSecurite(donnees, config, affectationsExistantes) {
  const cellules = [];
  // Toutes les cases du modèle : présentes -> affectation avec commentaire
  // SHIFT|POSTE ; absentes -> suppression de l'ancienne ligne correspondante.
  const attendues = new Set(); // "employe|jour" -> { shift, poste }
  const parEmployeJour = {}; // "employe|jour" -> [{ shift, posteId, poste }]
  for (const [cle, idEmploye] of Object.entries(donnees || {})) {
    const [jour, shift, posteId] = cle.split('|');
    const poste = (config.postes || []).find((p, i) => `poste${i + 1}` === posteId) || posteId;
    (parEmployeJour[`${idEmploye}|${jour}`] = parEmployeJour[`${idEmploye}|${jour}`] || []).push({ shift, posteId, poste });
  }
  for (const [cle, liste] of Object.entries(parEmployeJour)) {
    const [id_employe, jour] = cle.split('|');
    attendues.add(cle);
    const premier = liste[0];
    const commentaire = `SHIFT:${premier.shift}|POSTE:${premier.posteId}`;
    const cren = creneauDeShift(premier.shift);
    cellules.push({
      id_employe: Number(id_employe),
      jour,
      statut_jour: 'TRAVAIL',
      observation: commentaire,
      creneau: { periode: periodeDe(cren.heure_entree), ...cren },
    });
  }
  // Suppression : anciennes affectations SECURITE non conservées à l'écran
  for (const a of affectationsExistantes || []) {
    const estSecurite = /SHIFT:[^|]+\|POSTE:/.test(String(a.observation || a.commentaire || ''));
    const cle = `${a.id_employe}|${String(a.jour).slice(0, 10)}`;
    if (estSecurite && !attendues.has(cle)) {
      cellules.push({ id_employe: a.id_employe, jour: String(a.jour).slice(0, 10), statut_jour: 'VIDE', creneau: null });
    }
  }
  return cellules;
}

/* ---------- MODELE HORAIRE_LIBRE (jour × colonnes horaires) ---------- */
/* Format interne : { horaires, matrice, statutsJour, observations } —
 * IDENTIQUE au composant historique AffectationsHoraireLibre.
 * Stockage : pour chaque (jour, horaire) : 1 affectation TRAVAIL par employé
 * concerné, commentaire `HL:<horaireId>` ; les horaires du modèle sont
 * ré-encodés dans le commentaire de la PREMIÈRE affectation du jour
 * (`HL_CONF:{...}`) pour recharger exactement les colonnes à la réouverture.
 * REPOS/CONGE : affectation statut REPOS/CONGE (commentaire HL:<jour>).
 * OBSERVATION : commentaire `HL_OBS:<texte>` rattaché à la première
 * affectation du jour (ou à une affectation CONGE/REPOS existante).
 */

const CLE_CONF = 'HL_CONF:';

export function versInterneHoraireLibre(affectations, creneaux) {
  const creneauParAffectation = Object.fromEntries((creneaux || []).map((c) => [c.id_affectation, c]));
  const matrice = {};
  const statutsJour = {};
  const observations = {};
  let horaires = null;
  let confBrute = null;

  // Recharge la configuration des colonnes horaires mémorisée (aucune valeur
  // en dur : la config sauvegardée par le chef fait foi).
  for (const a of affectations || []) {
    const obs = String(a.observation || a.commentaire || '');
    if (obs.startsWith(CLE_CONF)) {
      try { confBrute = JSON.parse(obs.slice(CLE_CONF.length)); } catch { confBrute = null; }
      break;
    }
  }
  if (confBrute && Array.isArray(confBrute.horaires)) horaires = confBrute.horaires;

  for (const a of affectations || []) {
    const jour = String(a.jour).slice(0, 10);
    const obs = String(a.observation || a.commentaire || '');
    if (a.statut_jour === 'REPOS') (statutsJour[jour] = statutsJour[jour] || { REPOS: [], CONGE: [] }).REPOS.push(a.id_employe);
    else if (a.statut_jour === 'CONGE') (statutsJour[jour] = statutsJour[jour] || { REPOS: [], CONGE: [] }).CONGE.push(a.id_employe);
    else if (a.statut_jour === 'TRAVAIL') {
      const m = /^HL:(.+)$/.exec(obs);
      if (m) {
        const k = `${jour}__${m[1]}`;
        (matrice[k] = matrice[k] || []).push(a.id_employe);
      }
    }
    // Observation de jour (préfixe HL_OBS:) sur n'importe quelle ligne du jour
    const mo = /^HL_OBS:(.*)$/.exec(obs);
    if (mo && mo[1] && !observations[jour]) observations[jour] = mo[1];
    void creneauParAffectation; // les colonnes horaires ne portent pas de créneau
  }
  return { horaires: horaires || [], matrice, statutsJour, observations };
}

export function depuisInterneHoraireLibre(donnees, affectationsExistantes, idService) {
  void idService;
  const { horaires = [], matrice = {}, statutsJour = {}, observations = {} } = donnees || {};
  const cellules = [];
  const conf = CLE_CONF + JSON.stringify({ horaires });

  // Index des affectations existantes HL (pour les suppressions)
  const conservees = new Set(); // "employe|jour|code"

  for (const [jour, statuts] of Object.entries(statutsJour)) {
    for (const idEmp of statuts.REPOS || []) {
      cellules.push({ id_employe: idEmp, jour, statut_jour: 'REPOS', observation: null, creneau: null });
      conservees.add(`${idEmp}|${jour}|REPOS`);
    }
    for (const idEmp of statuts.CONGE || []) {
      cellules.push({ id_employe: idEmp, jour, statut_jour: 'CONGE', observation: null, creneau: null });
      conservees.add(`${idEmp}|${jour}|CONGE`);
    }
  }
  for (const [k, listeEmployes] of Object.entries(matrice)) {
    const [jour, horaireId] = k.split('__');
    for (const idEmp of listeEmployes || []) {
      const h = horaires.find((x) => x.id === horaireId);
      cellules.push({
        id_employe: idEmp,
        jour,
        statut_jour: 'TRAVAIL',
        observation: `HL:${horaireId}`,
        // Le créneau réel porte la plage de la colonne (info export/impression)
        creneau: h && h.debut && h.fin
          ? { periode: periodeDe(h.debut), heure_entree: h.debut, heure_sortie: h.fin }
          : null,
      });
      conservees.add(`${idEmp}|${jour}|HL:${horaireId}`);
    }
  }

  // Observations de jour : attachées à la première cellule du jour (réelles)
  for (const [jour, texte] of Object.entries(observations)) {
    if (!texte) continue;
    const premiere = cellules.find((c) => c.jour === jour) ||
      (affectationsExistantes || []).find((a) => String(a.jour).slice(0, 10) === jour);
    if (premiere) {
      premiere.observation = [String(premiere.observation || '').replace(/^HL_OBS:.*$/, ''), `HL_OBS:${texte}`]
        .filter(Boolean).join('|');
    }
  }

  // Ligne porteuse de la configuration des colonnes (premier employé du
  // service : créneau nul, statut TRAVAIL, commentaire HL_CONF). C'est une
  // vraie affectation du service, jamais une donnée d'exemple.
  const premierEmploye = (affectationsExistantes || [])[0]?.id_employe;
  if (premierEmploye && horaires.length > 0) {
    const jourReference = Object.keys(matrice)[0]?.split('__')[0] || Object.keys(statutsJour)[0];
    if (jourReference) {
      cellules.push({
        id_employe: premierEmploye,
        jour: jourReference,
        statut_jour: 'TRAVAIL',
        observation: conf,
        creneau: null,
      });
    }
  }

  // Suppressions : anciennes lignes HL non conservées
  for (const a of affectationsExistantes || []) {
    const obs = String(a.observation || a.commentaire || '');
    const jour = String(a.jour).slice(0, 10);
    if (/^HL:/.test(obs)) {
      if (!conservees.has(`${a.id_employe}|${jour}|${obs}`)) {
        cellules.push({ id_employe: a.id_employe, jour, statut_jour: 'VIDE', creneau: null });
      }
    } else if (['REPOS', 'CONGE'].includes(a.statut_jour) && !conservees.has(`${a.id_employe}|${jour}|${a.statut_jour}`)) {
      // anciens statuts du modèle non conservés -> vidés
      cellules.push({ id_employe: a.id_employe, jour, statut_jour: 'VIDE', creneau: null });
    }
  }
  return cellules;
}

/* ---------- Point d'entrée unique (résolution par modèle) ---------- */
export function versInterne(modele, affectations, creneaux) {
  switch (modele.code) {
    case 'SECURITE': return versInterneSecurite(affectations, creneaux);
    case 'HORAIRE_LIBRE': return versInterneHoraireLibre(affectations, creneaux);
    default: return versInterneStandard(affectations, creneaux);
  }
}

export function depuisInterne(modele, donnees, contexte) {
  switch (modele.code) {
    case 'SECURITE': return depuisInterneSecurite(donnees, modele, contexte.affectationsExistantes);
    case 'HORAIRE_LIBRE': return depuisInterneHoraireLibre(donnees, contexte.affectationsExistantes, contexte.idService);
    default: return depuisInterneStandard(donnees, contexte.affectationsExistantes);
  }
}

/* Total d'heures hebdo d'un employé (tous modèles) — pour les contrôles. */
export function totalHeuresEmploye(modele, donnees, idEmploye) {
  if (modele.code === 'STANDARD') {
    let total = 0;
    for (const [cle, cel] of Object.entries(donnees || {})) {
      const [id, ] = cle.split('|');
      if (Number(id) === Number(idEmploye) && cel.statut_jour === 'TRAVAIL') {
        total += Math.max(0, enMinutes(cel.sortie) - enMinutes(cel.entree));
      }
    }
    return total;
  }
  if (modele.code === 'SECURITE') {
    let total = 0;
    for (const [cle, id] of Object.entries(donnees || {})) {
      if (Number(id) !== Number(idEmploye)) continue;
      const shift = cle.split('|')[1];
      const cren = creneauDeShift(shift);
      total += Math.max(0, enMinutes(cren.heure_sortie) - enMinutes(cren.heure_entree));
    }
    return total;
  }
  if (modele.code === 'HORAIRE_LIBRE') {
    let total = 0;
    for (const [k, liste] of Object.entries((donnees && donnees.matrice) || {})) {
      const horaireId = k.split('__')[1];
      const h = ((donnees && donnees.horaires) || []).find((x) => x.id === horaireId);
      if (!h) continue;
      for (const id of liste) {
        if (Number(id) === Number(idEmploye)) total += Math.max(0, enMinutes(h.fin) - enMinutes(h.debut));
      }
    }
    return total;
  }
  return 0;
}
