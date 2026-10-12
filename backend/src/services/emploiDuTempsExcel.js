/* Générateur d'EMPLOI DU TEMPS Excel — édition XML DIRECTE du MODÈLE du projet :
 *   document utiliise/EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx
 *
 * MÉTHODE (fidélité maximale au fichier de référence) :
 *   le fichier exporté EST le fichier modèle : copie du zip (styles.xml,
 *   theme, sharedStrings, médias, les autres feuilles intacts), chaque feuille
 *   générée est réécrite cellule par cellule PAR RÉFÉRENCE au XML original du
 *   modèle — pour chaque cellule générée, on repart du XML de la cellule
 *   canonique du modèle (mêmes attributs s=, t=, f= : mêmes styles, mêmes
 *   formats, mêmes formules) et on substitue uniquement la VALEUR dynamique.
 *   Rien d'autre n'est touché : couleurs, bordures, polices, alignements,
 *   fusions (titre E2:I3 + 7x3 périodes), largeurs de colonnes, hauteurs,
 *   zoom, pageSetup A4 portrait, marges, sortState : conservés à l'octet près.
 *
 * EXPORT SIMPLE : 1 planning sélectionné -> la feuille 1 du modèle reçoit ses
 *   données (comportement historique, inchangé).
 * EXPORT MULTI : N plannings sélectionnés -> un CLASSEUR UNIQUE contenant
 *   UNIQUEMENT les feuilles des plannings (une par planning, ordre demandé) :
 *   le modèle ne fournit QUE la structure et la mise en forme — les feuilles
 *   d'exemple du modèle (Réception, etc.) ne sont JAMAIS copiées dans
 *   l'export (règle projet : zéro donnée d'exemple dans le fichier généré).
 *
 * CELLULES FIXES (jamais modifiées, valeurs originales du modèle) :
 *   en-têtes (Personne/entrée/sortie/durée/durée total), libellés périodes
 *   (matin/après-midi/soir), ligne 4 (espace), fusions, largeurs de colonnes,
 *   pageSetup. Les libellés jours viennent du modèle (G5 LUNDI via formule
 *   externe [1]MAINTENANCE!G5, G21 MARDI en sharedString).
 *
 * CELLULES DYNAMIQUES (substituées avec les données du planning VALIDÉ) :
 *   E2 (titre = service + semaine), C5.. (nom du service), H5.. (dates série
 *   Excel du lundi au dimanche du planning), A/B (matricule + nom employés),
 *   C..K (heures entrée/sortie en fraction de jour, format h:mm du modèle :
 *   0.25 = 06:00 ; Repos/Congé/Absence en M), SUM des totaux par période
 *   (formules du modèle, plages ajustées), RECAP (totaux hebdo réels).
 *
 * PLANNING VALIDÉ UNIQUEMENT : la fonction lève une erreur si le statut d'un
 * planning n'est pas VALIDE (double contrôle avec le contrôleur HTTP).
 * Le fichier modèle original n'est JAMAIS modifié.
 */
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const MODELE = path.resolve(__dirname, '..', '..', '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');

const JOURS_SEMAINE = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];
const PERIODES = ['MATIN', 'APRES_MIDI', 'SOIR'];
const POSITIONS = { MATIN: ['C', 'D', 'E'], APRES_MIDI: ['F', 'G', 'H'], SOIR: ['I', 'J', 'K'] };
const EMPLOYES_PAR_FEUILLE = 12;
const LIGNES_PAR_JOUR = 17;

/* Fenêtres des créneaux du modèle (bornes issues de la logique existante du
 * projet : periodeSelonEntree du contrôleur de grille — <12:00 matin,
 * 12:00-17:59 après-midi, >=18:00 soir). Un horaire réel [deb, fin) est
 * DÉCOUPÉ par intersection avec ces fenêtres : chaque partie tombe dans sa
 * colonne (ex. 07:00-15:00 -> matin 07:00-12:00 + après-midi 12:00-15:00) ;
 * les créneaux non concernés restent vides. Aucune heure n'est inventée ni
 * déplacée : les bornes des parties sont les bornes réelles intersectées. */
const FENETRES_CRENEAUX = [
  { p: 'MATIN', deb: 0, fin: 12 * 60 },
  { p: 'APRES_MIDI', deb: 12 * 60, fin: 18 * 60 },
  { p: 'SOIR', deb: 18 * 60, fin: 24 * 60 },
];

/* ---------------- Aides heures (mêmes règles que le contrôleur de grille) -- */
function enMinutes(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).slice(0, 5).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
const fractionJour = (minutes) => minutes / 1440; // 0.25 = 06:00, comme le modèle
/* Découpe une plage [deb, fin) en minutes dans les fenêtres du modèle.
 * Retourne { MATIN: {entree,sortie,minutes} | null, ... } + le total. */
function repartirDansCreneaux(heureEntree, heureSortie) {
  const parPeriode = { MATIN: null, APRES_MIDI: null, SOIR: null };
  let total = 0;
  const d = enMinutes(heureEntree);
  if (d == null) return { parPeriode, total };
  const f = Math.max(d, enMinutes(heureSortie)); // robustesse fin <= début
  for (const w of FENETRES_CRENEAUX) {
    const a = Math.max(d, w.deb);
    const b = Math.min(f, w.fin);
    if (b <= a) continue; // la plage ne concerne pas ce créneau -> vide
    parPeriode[w.p] = {
      entree: fractionJour(a),
      sortie: fractionJour(Math.min(b, 1439)),
      minutes: b - a,
    };
    total += b - a;
  }
  return { parPeriode, total };
}
// Borne à 15 chiffres significatifs (comportement d'Excel)
function nombreExcel(x) {
  return Number(x.toPrecision(15));
}

/* ---------------- XML ---------------- */
function echapper(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function colVersLettres(n) {
  let s = '';
  n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function lettresVersCol(l) {
  let n = 0;
  for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
// Numéro de série Excel (1899-12-30 = 0). Vérifié : 2026-09-07 -> 46251,
// la même valeur que H115 (LUNDI semaine 37) dans le modèle.
function dateExcel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
}

/* Découpage du XML du modèle en dictionnaires de lignes et de cellules.
 * Chaque cellule conserve son XML original (attributs + contenu). */
function parserFeuille(xml) {
  const lignes = {};   // numéro -> XML complet de la <row>
  const cellules = {}; // "A8" -> XML complet de la <c>
  for (const m of xml.matchAll(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g)) {
    const num = Number(m[1]);
    lignes[num] = m[0];
    for (const c of m[0].matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      cellules[c[1]] = c[0];
    }
  }
  return { lignes, cellules };
}

/* Recopie la cellule canonique du modèle vers `refCible` en substituant la
 * valeur. La copie préserve le XML original (attributs s=, f= partagées...)
 * ; seuls la référence et le contenu changent.
 *   - valeur null/''/undefined -> cellule stylée vide (attributs conservés)
 *   - nombre                   -> <v>nombre</v>
 *   - texte                    -> t="inlineStr" ajouté
 *   - formule                  -> { f, v } remplace le contenu
 */
function clonerCellule(celluleModele, refCible, valeur) {
  if (!celluleModele) return `<c r="${refCible}"/>`;
  // Attributs d'ouverture originaux : marche pour <c .../> ET <c ...>contenu</c>
  // (le groupe 1 capture les attributs, sans aucun '>' car [^>]*?)
  const m = celluleModele.match(/^<c\s+([^>]*?)(?:\/>|>(?:[\s\S]*))$/);
  let attrs = (m ? m[1] : '')
    .replace(/^\s*r="[^"]*"/, '')   // référence remplacée par refCible
    .replace(/\s*t="[^"]*"/g, '')   // type recalculé selon la valeur
    .trim();

  if (valeur === null || valeur === undefined || valeur === '') {
    return `<c r="${refCible}"${attrs ? ' ' + attrs : ''}/>`;
  }
  if (typeof valeur === 'number') {
    return `<c r="${refCible}"${attrs ? ' ' + attrs : ''}><v>${nombreExcel(valeur)}</v></c>`;
  }
  if (typeof valeur === 'object' && valeur.f) {
    return `<c r="${refCible}"${attrs ? ' ' + attrs : ''}><f>${echapper(valeur.f)}</f><v>${nombreExcel(valeur.v)}</v></c>`;
  }
  return `<c r="${refCible}"${attrs ? ' ' + attrs : ''} t="inlineStr"><is><t xml:space="preserve">${echapper(valeur)}</t></is></c>`;
}

/* Parse les attributs d'une <row> originale (ht, customHeight, s...).
 * Le gabarit ne contient pas toutes les lignes générées (ex. 38, 55, 72,
 * 89, 106, 123-125 absentes du modèle) : rowXml peut être undefined ->
 * aucun attribut à reprendre (ligne à hauteur par défaut). */
function attributsLigne(rowXml) {
  if (!rowXml) return '';
  const m = rowXml.match(/^<row r="\d+"([^>]*)>/);
  let a = m ? m[1] : '';
  a = a.replace(/\s*r="\d+"/, '');
  a = a.replace(/\s*spans="[^"]*"/, ''); // recalculé selon les cellules
  return a.trim();
}

/* ---------------- Données d'un planning (partagé mono / multi) ------------- */
/* Lit le planning + sa grille (affectations + créneaux). RÈGLE MÉTIER :
 * erreur 403 si le statut n'est pas VALIDE (contrôle doublé par le HTTP). */
async function chargerPlanningComplet(pool, id_planning) {
  const [[planning]] = await pool.query(
    `SELECT p.id_planning, p.annee, p.numero_semaine, p.date_debut_semaine,
            p.statut, s.nom_service, s.type_affichage
     FROM planning p JOIN service s ON s.id_service = p.service_id
     WHERE p.id_planning = ?`,
    [id_planning]
  );
  if (!planning) {
    const err = new Error(`Planning introuvable (${id_planning}).`);
    err.status = 404;
    throw err;
  }
  if (planning.statut !== 'VALIDE') {
    const err = new Error(`Export réservé aux plannings validés (statut actuel : ${planning.statut}).`);
    err.status = 403;
    throw err;
  }

  const [affectations] = await pool.query(
    `SELECT a.id_affectation, a.employe_id AS id_employe, a.date_jour AS jour,
            a.statut AS statut_jour, a.commentaire AS observation,
            e.nom, e.matricule, e.fonction
     FROM affectation a
     JOIN employe e ON e.id_employe = a.employe_id
     WHERE a.planning_id = ?
     ORDER BY e.nom, a.date_jour`,
    [id_planning]
  );
  const [creneaux] = await pool.query(
    `SELECT ct.affectation_id, ct.type_creneau AS periode, ct.heure_entree, ct.heure_sortie
     FROM creneau_travail ct
     JOIN affectation a ON a.id_affectation = ct.affectation_id
     WHERE a.planning_id = ?`,
    [id_planning]
  );

  const creneauxParAff = {};
  for (const c of creneaux) (creneauxParAff[c.affectation_id] = creneauxParAff[c.affectation_id] || []).push(c);

  const grille = {};
  const employesMap = new Map();
  for (const a of affectations) {
    if (!employesMap.has(a.id_employe)) employesMap.set(a.id_employe, {
      id_employe: a.id_employe,
      nom: a.nom,
      matricule: a.matricule || '',
      fonction: a.fonction || '',
    });
    grille[a.id_employe] = grille[a.id_employe] || {};
    grille[a.id_employe][String(a.jour).slice(0, 10)] = {
      statut_jour: a.statut_jour,
      observation: a.observation,
      nomEmploye: a.nom,
      fonction: a.fonction || '',
      creneaux: creneauxParAff[a.id_affectation] || [],
    };
  }
  return { planning, employes: [...employesMap.values()], grille };
}

/* ---------------- Modèle Excel unique pour tous les services ---------------- */
/* La feuille SECURITE (sheet23.xml) sert de gabarit à toutes les feuilles.
 * Chaque onglet garde les positions fixes des jours et les 12 lignes prévues
 * par jour ; les effectifs supplémentaires continuent sur un onglet identique. */
const GABARIT_SECURITE = 'xl/worksheets/sheet23.xml';

function construireXmlFeuilleSecurite(xmlModele, planning, employes, grille) {
  const { cellules: CEL, lignes: LIGNES_MODELE } = parserFeuille(xmlModele);

  // Cellules canoniques (XML originaux de la feuille SECURITE du modèle)
  const can = {
    titre: CEL['E2'],
    titreVide: CEL['F2'],
    espace: CEL['E4'],
    jour: CEL['C5'],          // C5 service (s2), G5 jour (s5), H5 date (s6)
    jourLabel: CEL['G5'],
    jourDate: CEL['H5'],
    periodes: { C: CEL['C6'], D: CEL['D6'], E: CEL['E6'], F: CEL['F6'], G: CEL['G6'], H: CEL['H6'], I: CEL['I6'], J: CEL['J6'], K: CEL['K6'] },
    entetes: { B: CEL['B7'], C: CEL['C7'], D: CEL['D7'], E: CEL['E7'], F: CEL['F7'], G: CEL['G7'], H: CEL['H7'], I: CEL['I7'], J: CEL['J7'], K: CEL['K7'], L: CEL['L7'] },
    // Lignes employés canoniques : r8..r19 = les 12 positions employés du bloc
    // jour du modèle (r8..r15 SANS colonne N, r16..r19 AVEC colonne N s24).
    // Chaque position k du bloc reprend la ligne homologue du modèle : le
    // rythme de styles du modèle (ombrage alterné de la colonne B, bordure de
    // bas de bloc sur r19, etc.) est ainsi respecté exactement.
    employe: Array.from({ length: EMPLOYES_PAR_FEUILLE }, (_, k) => 8 + k).map((rr) => ({
      A: CEL['A' + rr], B: CEL['B' + rr],
      C: CEL['C' + rr], D: CEL['D' + rr], E: CEL['E' + rr],
      F: CEL['F' + rr], G: CEL['G' + rr], H: CEL['H' + rr],
      I: CEL['I' + rr], J: CEL['J' + rr], K: CEL['K' + rr],
      L: CEL['L' + rr],
      N: rr >= 16 ? CEL['N' + rr] : null,
    })),
    // Totaux : r20 (s15, formules SUM E..L + fantôme N s24) puis r21 (N seul)
    totaux: { C: CEL['C20'], D: CEL['D20'], E: CEL['E20'], F: CEL['F20'], G: CEL['G20'], H: CEL['H20'], I: CEL['I20'], J: CEL['J20'], K: CEL['K20'], L: CEL['L20'], N: CEL['N20'] },
    fantomeN: CEL['N21'],
    // RECAP hebdo (lignes 126..137 du modèle) : A s3 / B (s24, s26, s27...)
    // / C s21 (format durée du modèle). Chaque ligne RECAP garde le style de
    // sa position d'origine (bordures de fin de tableau, alternance, etc.).
    recapLignes: Array.from({ length: EMPLOYES_PAR_FEUILLE }, (_, k) => 126 + k).map((rr) => ({
      A: CEL['A' + rr], B: CEL['B' + rr], C: CEL['C' + rr],
    })),
  };

  const lignes = [];
  const merges = ['E2:I3'];

  const push = (r, cells) => {
    const attrs = attributsLigne(LIGNES_MODELE[r]);
    lignes.push(`<row r="${r}"${attrs ? ` ${attrs}` : ''} spans="1:14">${cells.join('')}</row>`);
  };

  // ---- Titre (E2:I3) + espace (l.4) — XML du modèle, seule la valeur change
  push(2, [
    // Zone 1 : titre au FORMAT DU MODÈLE « EMPLOI DU TEMPS <service> WEEK n »
    clonerCellule(can.titre, 'E2', `EMPLOI DU TEMPS ${planning.nom_service} WEEK ${planning.numero_semaine}`),
    ...['F2', 'G2', 'H2', 'I2'].map((c) => clonerCellule(can.titreVide, c, '')),
  ]);
  push(3, ['E3', 'F3', 'G3', 'H3', 'I3'].map((c) => clonerCellule(can.titreVide, c, '')));
  push(4, [
    clonerCellule(can.espace, 'E4', ''),
    ...['F4', 'G4', 'H4', 'I4'].map((c) => clonerCellule(can.espace, c, '')),
  ]);

  // 7 dates réelles du planning (date_debut_semaine = lundi ; DB dateStrings)
  const base = String(planning.date_debut_semaine).slice(0, 10);
  const datesJours = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Date(new Date(base + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10)
  );

  // ---- 7 blocs jour (17 lignes chacun, comme la feuille SECURITE) ----------
  let r = 5;
  let hPrec = null;
  for (let i = 0; i < 7; i++) {
    const serie = dateExcel(datesJours[i]);

    // Ligne jour : C=service, G=libellé jour, H=date (H5 littéral, puis +Hprec+1)
    push(r, [
      clonerCellule(can.jour, 'C' + r, planning.nom_service),
      clonerCellule(can.jourLabel, 'G' + r, JOURS_SEMAINE[i]),
      i === 0
        ? clonerCellule(can.jourDate, 'H' + r, serie)
        : clonerCellule(can.jourDate, 'H' + r, { f: `+H${hPrec}+1`, v: serie }),
    ]);
    hPrec = r;
    r++;

    // Ligne périodes (3 fusions C:E F:H I:K, cellules du modèle clonées)
    push(r, ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((col) =>
      clonerCellule(can.periodes[col], col + r, { C: 'matin', F: 'après-midi', I: 'soir' }[col] || '')
    ));
    merges.push(`C${r}:E${r}`, `F${r}:H${r}`, `I${r}:K${r}`);
    r++;

    // En-têtes (cellules FIXES du modèle)
    const libelles = { B: 'Personne', C: 'entrée', D: 'sortie', E: 'durée', F: 'entrée', G: 'sortie', H: 'durée', I: 'entrée', J: 'sortie', K: 'durée', L: 'durée total' };
    push(r, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((col) =>
      clonerCellule(can.entetes[col], col + r, libelles[col])
    ));
    r++;

    // Lignes employés (données réelles) — chaque position k garde le style de
    // la ligne homologue du modèle (r8..r19 : alternance ombrage B, bordure finale r19)
    const debBloc = r;
    for (let k = 0; k < Math.min(employes.length, EMPLOYES_PAR_FEUILLE); k++) {
      const emp = employes[k];
      const aff = (grille[emp.id_employe] || {})[datesJours[i]] || null;
      const creneauxJour = (aff && aff.creneaux) || [];
      let totalMinutes = 0;
      const parPeriode = { MATIN: null, APRES_MIDI: null, SOIR: null };
      for (const c of creneauxJour) {
        const rep = repartirDansCreneaux(c.heure_entree, c.heure_sortie);
        for (const p of PERIODES) {
          if (rep.parPeriode[p]) parPeriode[p] = rep.parPeriode[p];
        }
        totalMinutes += rep.total;
      }

      const statut = aff && aff.statut_jour && aff.statut_jour !== 'TRAVAIL' ? aff.statut_jour : '';
      // Convention de l'application : un statut non-travail (REPOS/CONGE/
      // ABSENCE) est AFFICHÉ en colonne B et les horaires hérités éventuels
      // sont masqués (durées 0) — le gabarit Sécurité n'a ni colonne M ni
      // ligne REPOS dédiée.
      const nonTravaille = statut !== '';
      const canon = can.employe[k] || can.employe[can.employe.length - 1];
      if (nonTravaille) { parPeriode.MATIN = null; parPeriode.APRES_MIDI = null; parPeriode.SOIR = null; totalMinutes = 0; }

      const nomFonction = emp.fonction ? `${emp.nom || ''} (${emp.fonction})` : (emp.nom || '');
      const nomAffiche = nonTravaille ? `${nomFonction} (${statut})` : nomFonction;
      const valeurs = { A: emp.matricule || '', B: nomAffiche, L: fractionJour(totalMinutes) };
      for (const p of PERIODES) {
        const c = parPeriode[p];
        const [ce, cs, cd] = POSITIONS[p];
        valeurs[ce] = c ? c.entree : '';
        valeurs[cs] = c ? c.sortie : '';
        valeurs[cd] = c ? fractionJour(c.minutes) : 0;
      }

      const cells = [];
      for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'N']) {
        const src = canon[col];
        if (!src) continue;
        cells.push(clonerCellule(src, col + r, valeurs[col] !== undefined ? valeurs[col] : ''));
      }
      push(r, cells);
      r++;
    }
    // COMPLÉMENT du modèle : les lignes employés NON UTILISÉES restent dans
    // la feuille, avec leur style du modèle (cellules stylées vides). Le
    // bloc dur reste donc 5 + 12 + 2 = 17 lignes, les 7 jours gardent EXACTEMENT
    // les lignes du modèle (totaux à r20/23/40/.../122, RECAP à 126+).
    for (; r <= debBloc + (EMPLOYES_PAR_FEUILLE - 1); r++) {
      const k = r - debBloc;
      const canon = can.employe[k];
      const cells = [];
      for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'N']) {
        const src = canon[col];
        if (!src) continue;
        cells.push(clonerCellule(src, col + r, ''));
      }
      push(r, cells);
    }
    const finBloc = r - 1; // toujours debBloc + 11 : plage complète du modèle

    // Totaux par période (formules SUM, plages réelles) — style r20 du modèle
    const minutesParCol = { E: 0, H: 0, K: 0, L: 0 };
    for (const emp of employes.slice(0, EMPLOYES_PAR_FEUILLE)) {
      const aff = (grille[emp.id_employe] || {})[datesJours[i]];
      for (const c of (aff && aff.creneaux) || []) {
        const rep = repartirDansCreneaux(c.heure_entree, c.heure_sortie);
        for (const p of PERIODES) {
          if (rep.parPeriode[p]) minutesParCol[POSITIONS[p][2]] += rep.parPeriode[p].minutes;
        }
        minutesParCol.L += rep.total;
      }
    }
    const formulesTotaux = {
      E: { f: `SUM(E${debBloc}:E${finBloc})`, v: fractionJour(minutesParCol.E) },
      H: { f: `SUM(H${debBloc}:H${finBloc})`, v: fractionJour(minutesParCol.H) },
      K: { f: `SUM(K${debBloc}:K${finBloc})`, v: fractionJour(minutesParCol.K) },
      L: { f: `SUM(L${debBloc}:L${finBloc})`, v: fractionJour(minutesParCol.L) },
    };
    push(r, ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'N'].map((col) =>
      clonerCellule(can.totaux[col], col + r, formulesTotaux[col] || '')
    ));
    r++;
    // Fantôme N s24 (comme la ligne 21 du modèle)
    push(r, [clonerCellule(can.fantomeN, 'N' + r, '')]);
    r++;
  }

  // Le modèle réserve les lignes 124-125 avant le récapitulatif 126-137.
  while (r < 126) {
    push(r, []);
    r++;
  }

  // ---- RECAP hebdomadaire (réels) — chaque ligne garde le style du modèle
  // (A s3 / B s24,s26,s27... / C s21 format durée [h]:mm). Les 12 lignes du
  // tableau sont présentes comme dans le modèle, même si l'équipe est plus
  // petite (lignes stylées vides) : le tableau ne change pas de hauteur.
  for (let k = 0; k < EMPLOYES_PAR_FEUILLE; k++) {
    const canon = can.recapLignes[k] || can.recapLignes[0];
    const emp = employes[k] || null;
    let t = 0;
    if (emp) {
      for (const d of Object.keys(grille[emp.id_employe] || {})) {
        for (const c of grille[emp.id_employe][d].creneaux || []) {
          const deb = enMinutes(c.heure_entree);
          if (deb == null) continue;
          t += Math.max(0, enMinutes(c.heure_sortie) - deb);
        }
      }
    }
    push(r, [
      clonerCellule(canon.A, 'A' + r, emp ? (emp.matricule || '') : ''),
      clonerCellule(canon.B, 'B' + r, emp ? (emp.nom || '') : ''),
      clonerCellule(canon.C, 'C' + r, emp ? fractionJour(t) : ''),
    ]);
    r++;
  }

  /* ---------------- Assemblage de la feuille (head/tail SECURITE) --------- */
  const iD = xmlModele.indexOf('<sheetData>');
  const iF = xmlModele.indexOf('</sheetData>');
  const head = xmlModele.slice(0, iD);
  const finModele = xmlModele.slice(iF + '</sheetData>'.length);
  const mergeXml = merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('');
  const mergeCellsXml = `<mergeCells count="${merges.length}">${mergeXml}</mergeCells>`;
  const tailFinal = finModele
    .replace(/<mergeCells[\s\S]*?<\/mergeCells>/, mergeCellsXml)
    .replace(/<sortState[\s\S]*?<\/sortState>/, '') // plage du modèle obsolète
    .replace(/<dimension ref="[^"]*"\/>/, '');
  const dimension = `<dimension ref="A2:N${Math.max(r - 1, 137)}"/>`;
  const headFinal = head.replace(/<dimension ref="[^"]*"\/>/, dimension);
  const sheetXml = headFinal + '<sheetData>' + lignes.join('') + '</sheetData>' + tailFinal;

  const nomFeuille = String(planning.nom_service).slice(0, 31).replace(/[[\]*?/\\:]/g, ' ');
  return { sheetXml, nomFeuille };
}

/* ---------------- Feuille SECURITE (modèle SHIFT_POSTE) --------------------
 * Structure fidèle au modèle papier du service : ANDRO | SHIFT | postes.
 * Un bloc de 2 lignes (MATIN / SOIR) par jour, une colonne par poste.
 * Les affectations viennent des commentaires SHIFT:xxx|POSTE:yyy écrits par
 * la saisie (planningData.js) — aucune donnée inventée, cellule vide = vide.
 */
function construireXmlFeuilleShiftPoste(xmlModele, planning, employes, grille) {
  const { cellules: CEL } = parserFeuille(xmlModele);
  const can = {
    titre: CEL['E2'], titreVide: CEL['F2'], espace: CEL['E4'],
    jour: CEL['C5'], jourLabel: CEL['G5'], jourDate: CEL['H5'],
  };
  // Styles de cellules du gabarit réutilisés (bordures/en-têtes) :
  const sEnTete = (CEL['B7'] || '').match(/s="(\d+)"/) ? RegExp.$1 : '8';
  const sCellule = (CEL['A16'] || '').match(/s="(\d+)"/) ? RegExp.$1 : '3';
  const celluleTexte = (ref, texte, s) =>
    `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${echapper(texte)}</t></is></c>`;

  const SHIFTS = ['MATIN', 'SOIR'];
  const POSTES = ['Chef de poste 1', 'Chef de poste 2', 'Côté réception', 'Côté Snack'];
  const LETTRES = ['D', 'E', 'F', 'G']; // postes à partir de la colonne D

  // Index des affectations SECURITE : "jour|shift|poste" -> nom employé réel
  const cases = {};
  const nomParId = Object.fromEntries((employes || []).map((e) => [e.id_employe, e.nom]));
  for (const [idEmp, joursGrille] of Object.entries(grille)) {
    for (const [jour, info] of Object.entries(joursGrille)) {
      const m = /SHIFT:([^|]+)\|POSTE:(.+)/.exec(String(info.observation || ''));
      if (m && info.statut_jour === 'TRAVAIL') {
        cases[`${jour}|${m[1]}|${m[2]}`] = info.nomEmploye || nomParId[idEmp] || '';
      }
    }
  }

  const lignes = [];
  const merges = ['E2:I3'];

  // En-tête du document (identique au gabarit) :
  lignes.push(`<row r="2" spans="1:14">${celluleTexte('E2', `EMPLOI DU TEMPS ${planning.nom_service} WEEK ${planning.numero_semaine}`, '171')}${['F2', 'G2', 'H2', 'I2'].map((c) => celluleTexte(c, '', '171')).join('')}</row>`);
  lignes.push(`<row r="3" spans="1:14">${['E3', 'F3', 'G3', 'H3', 'I3'].map((c) => celluleTexte(c, '', '171')).join('')}</row>`);
  lignes.push(`<row r="4" spans="1:14">${['E4', 'F4', 'G4', 'H4', 'I4'].map((c) => celluleTexte(c, '', '4')).join('')}</row>`);

  const base = String(planning.date_debut_semaine).slice(0, 10);
  const datesJours = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Date(new Date(base + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10));

  let r = 5;
  let hPrec = null;
  for (let i = 0; i < 7; i++) {
    const serie = dateExcel(datesJours[i]);
    lignes.push(`<row r="${r}" spans="1:14">` + [
      celluleTexte('C' + r, planning.nom_service, '2'),
      celluleTexte('G' + r, JOURS_SEMAINE[i], '5'),
      i === 0 ? celluleTexte('H' + r, serie, '6') : `<c r="H${r}" s="6"><f>+H${hPrec}+1</f><v>${serie}</v></c>`,
    ].join('') + '</row>');
    hPrec = r;
    r++;

    // Ligne d'en-têtes du tableau : ANDRO | SHIFT | postes
    const entetes = ['ANDRO', 'SHIFT', ...POSTES];
    lignes.push(`<row r="${r}" spans="1:14">` +
      entetes.map((t, k) => celluleTexte(lettresCol(k + 2) + r, t, sEnTete)).join('') + '</row>');
    r++;

    // 2 lignes par jour (un par shift)
    for (const shift of SHIFTS) {
      const cells = [
        celluleTexte('B' + r, `${JOURS_SEMAINE[i]} ${datesJours[i].slice(8, 10)}`, sCellule),
        celluleTexte('C' + r, shift, sCellule),
      ];
      POSTES.forEach((poste, k) => {
        const nom = cases[`${datesJours[i]}|${shift}|poste${k + 1}`] || '';
        cells.push(nom
          ? celluleTexte(lettresCol(k + 3) + r, nom, sCellule)
          : `<c r="${lettresCol(k + 3)}${r}"${sCellule ? ` s="${sCellule}"` : ''}/>`);
      });
      lignes.push(`<row r="${r}" spans="1:14">` + cells.join('') + '</row>');
      r++;
    }
    // ligne d'espacement entre jours
    lignes.push(`<row r="${r}" spans="1:14"><c r="B${r}"/></row>`);
    r++;
  }

  const iD = xmlModele.indexOf('<sheetData>');
  const head = xmlModele.slice(0, iD);
  const finModele = xmlModele.slice(xmlModele.indexOf('</sheetData>') + '</sheetData>'.length);
  const mergeCellsXml = `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
  const tailFinal = finModele
    .replace(/<mergeCells[\s\S]*?<\/mergeCells>/, mergeCellsXml)
    .replace(/<sortState[\s\S]*?<\/sortState>/, '')
    .replace(/<dimension ref="[^"]*"\/>/, '');
  const sheetXml = head.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A2:N${r}"/>`) +
    '<sheetData>' + lignes.join('') + '</sheetData>' + tailFinal;
  const nomFeuille = String(planning.nom_service).slice(0, 31).replace(/[[\]*?/\\:]/g, ' ');
  return { sheetXml, nomFeuille };
}

// Numéro de colonne -> lettres (A=0)
function lettresCol(n) {
  let s = '';
  n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* ---------------- Génération du XML d'UNE feuille -------------------------- */
/* RÈGLE MULTI-MODÈLES : chaque service est exporté selon SON modèle —
 *   SHIFT_POSTE         -> feuille ANDRO/SHIFT/postes (SECURITE) ;
 *   HORAIRES_COLONNES   -> gabarit standard (les colonnes horaires du modèle
 *                          sont portées par les créneaux réels, le rendu
 *                          employé × jour × périodes reste fidèle au classeur
 *                          de référence) ;
 *   PERIODES_FIXES      -> gabarit standard (comportement historique inchangé).
 */
function construireXmlFeuille(xmlModele, planning, employes, grille) {
  const lots = [];
  for (let debut = 0; debut < Math.max(employes.length, 1); debut += EMPLOYES_PAR_FEUILLE) {
    const lot = employes.slice(debut, debut + EMPLOYES_PAR_FEUILLE);
    lots.push(construireXmlFeuilleSecurite(xmlModele, planning, lot, grille));
  }
  return lots;
}

/* ---------------- Assemblage du CLASSEUR (1..n feuilles générées) ---------- */
/* Le modèle ne fournit que la STRUCTURE et la MISE EN FORME : le classeur
 * exporté ne contient QUE les feuilles des plannings générées (clonage XML de
 * la feuille 1 du modèle), JAMAIS les 24 autres feuilles d'exemple du modèle
 * (Réception, etc.). Repart TOUJOURS du zip du modèle (jamais modifié) :
 *   - conservés : styles.xml, theme, sharedStrings, liens externes (utilisés
 *     par les gabarits), docProps ;
 *   - supprimés : feuilles 2..N du modèle (données d'exemple), leurs .rels,
 *     les annotations d'exemple (drawing, ink, media) et leurs déclarations
 *     dans [Content_Types].xml, le calcChain obsolète ;
 *   - workbook.xml : la liste des onglets = uniquement nos feuilles, dans
 *     l'ordre demandé (1re sur le support sheet1.xml, suivantes en nouvelles
 *     entrées) ; definedNames du modèle retirés (ils référencent les feuilles
 *     supprimées) ; ouverture sur la 1re feuille ; fullCalcOnLoad=1. */
function assemblerClasseur(feuilles, sortie) {
  // Noms d'onglets uniques (Excel interdit les doublons) : en cas de collision
  // (même service + même semaine), suffixe -2, -3...
  const vus = new Set();
  const noms = feuilles.map((f) => {
    let n = f.nomFeuille;
    const base = n;
    let k = 2;
    while (vus.has(n)) n = `${base.slice(0, 28)}-${k++}`;
    vus.add(n);
    return n;
  });

  const zip = new AdmZip(MODELE); // le modèle original n'est JAMAIS modifié
  const entryWb = zip.getEntry('xl/workbook.xml');
  let workbookXml = entryWb.getData().toString('utf8');
  const entryRels = zip.getEntry('xl/_rels/workbook.xml.rels');
  const relsModele = entryRels ? entryRels.getData().toString('utf8') : '';
  const nbFeuillesModele = (workbookXml.match(/<sheet [^>]*\/>/g) || []).length;
  const maxRid = Math.max(0, ...[...relsModele.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])));
  const maxSheetId = Math.max(0, ...[...workbookXml.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1])));

  // 1) SUPPRESSION des feuilles d'exemple du modèle : seule sheet1.xml reste
  //    (support de la 1re feuille générée, mêmes styles/mises en page).
  const cibleRid = {};
  for (const m of relsModele.matchAll(/<Relationship [^>]*Type="[^"]*\/worksheet"[^>]*>/g)) {
    cibleRid[(m[0].match(/Id="(rId\d+)"/) || [])[1]] =
      'xl/' + ((m[0].match(/Target="([^"]*)"/) || [])[1] || '').replace(/^\//, '');
  }
  const ordreModele = workbookXml.match(/<sheet [^>]*r:id="(rId\d+)"[^>]*\/>/g) || [];
  const supprimees = new Set();
  for (const s of ordreModele) {
    const cible = cibleRid[(s.match(/r:id="(rId\d+)"/) || [])[1]];
    if (cible && cible !== 'xl/worksheets/sheet1.xml') supprimees.add(cible);
  }
  for (const cible of supprimees) if (zip.getEntry(cible)) zip.deleteEntry(cible);
  // .rels des feuilles supprimées + annotations d'exemple (dessins/encre/images)
  for (const e of [...zip.getEntries()]) {
    const n = e.entryName;
    if (/^xl\/worksheets\/_rels\//.test(n)) zip.deleteEntry(n); // sheet1 n'a pas de .rels
    if (/^xl\/(ink|media|drawings)\//.test(n)) zip.deleteEntry(n);
  }

  // 2) workbook.xml : onglets = UNIQUEMENT nos feuilles (ordre demandé) ;
  //    definedNames retirés (ils pointent vers les feuilles supprimées).
  const nos = noms.map((nom, k) =>
    `<sheet name="${echapper(nom)}" sheetId="${maxSheetId + 1 + k}" r:id="rId${maxRid + 1 + k}"/>`).join('');
  workbookXml = workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${nos}</sheets>`);
  workbookXml = workbookXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, '');
  // Le modèle s'ouvrait en plein milieu du classeur : ouvrir sur la 1re feuille
  workbookXml = workbookXml.replace(/\sfirstSheet="\d+"/, ' firstSheet="0"')
    .replace(/\sactiveTab="\d+"/, ' activeTab="0"');
  // Recalcul complet à l'ouverture (calcChain retiré ci-dessous)
  if (!workbookXml.includes('fullCalcOnLoad')) {
    workbookXml = workbookXml.replace(/<calcPr([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  }
  entryWb.setData(Buffer.from(workbookXml, 'utf8'));

  // 3) rels : relations NON-worksheet du modèle conservées telles quelles
  //    (theme, styles, sharedStrings, externalLink) + nos N feuilles.
  if (entryRels) {
    let rels = relsModele.replace(/<Relationship [^>]*Type="[^"]*\/worksheet"[^>]*\/>/g, '');
    rels = rels.replace('</Relationships>',
      feuilles.map((_, k) =>
        `<Relationship Id="rId${maxRid + 1 + k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${k === 0 ? 'sheet1.xml' : `sheet${nbFeuillesModele + k}.xml`}"/>`
      ).join('') + '</Relationships>');
    entryRels.setData(Buffer.from(rels, 'utf8'));
  }

  // 4) Contenu des feuilles générées : 1re sur le support sheet1.xml,
  //    suivantes en nouvelles entrées (jamais au milieu des noms du modèle).
  zip.getEntry('xl/worksheets/sheet1.xml').setData(feuilles[0].sheetXml);
  feuilles.forEach((f, i) => {
    if (i > 0) zip.addFile(`xl/worksheets/sheet${nbFeuillesModele + i}.xml`, Buffer.from(f.sheetXml, 'utf8'));
  });

  // 5) [Content_Types].xml : retirer les déclarations des parts supprimées
  //    (feuilles d'exemple, calcChain, annotations), ajouter celles des
  //    nouvelles feuilles (multi).
  const entryCT = zip.getEntry('[Content_Types].xml');
  if (entryCT) {
    let ct = entryCT.getData().toString('utf8')
      .replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    const presentes = new Set(zip.getEntries().map((e) => e.entryName));
    ct = ct.replace(/<Override PartName="\/([^"]+)"[^>]*\/>/g, (m, part) => (presentes.has(part) ? m : ''));
    ct = ct.replace('</Types>', feuilles.map((_, k) => k === 0 ? '' :
      `<Override PartName="/xl/worksheets/sheet${nbFeuillesModele + k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join('') + '</Types>');
    entryCT.setData(Buffer.from(ct, 'utf8'));
  }

  // calcChain obsolète (formules déplacées) : Excel le régénère silencieusement
  if (zip.getEntry('xl/calcChain.xml')) zip.deleteEntry('xl/calcChain.xml');

  zip.writeZip(sortie);
  return { noms };
}

/* ---------------- Points d'entrée ------------------------------------------ */
/* Source du gabarit (STRUCTURE uniquement) : la feuille SECURITE du modèle.
 * Tous les services exportés reproduisent ce tableau, rempli de leurs
 * données réelles — jamais les données d'exemple du modèle. */
function chargerXmlGabarit() {
  if (!fs.existsSync(MODELE)) {
    const err = new Error(`Modèle Excel introuvable sur le serveur : ${MODELE}.`);
    err.status = 500;
    throw err;
  }
  const zip = new AdmZip(MODELE);
  const entree = zip.getEntry(GABARIT_SECURITE);
  if (!entree) {
    const err = new Error(`Gabarit « ${GABARIT_SECURITE} » absent du modèle Excel (feuille SECURITE renommée ou supprimée ?).`);
    err.status = 500;
    throw err;
  }
  return entree.getData().toString('utf8');
}

/* Export SIMPLE : 1 planning sélectionné par son ID -> 1 fichier (historique). */
async function genererEmploiDuTempsExcel({ id_planning, sortie }) {
  const pool = require('../config/db');
  const { planning, employes, grille } = await chargerPlanningComplet(pool, id_planning);

  const xmlModele = chargerXmlGabarit();
  const lots = construireXmlFeuille(xmlModele, planning, employes, grille);

  assemblerClasseur(lots, sortie);
  return { sortie, planning, nbEmployes: employes.length };
}

/* Regroupement par WEEK (fonction pure, testée unitairement) :
 * clé réelle = (annee, numero_semaine) ; ordre des groupes = annee puis
 * semaine ; ordre interne = ordre de sélection. RÈGLE : même WEEK = même
 * fichier, WEEK différente = fichier différent. */
function grouperParSemaine(feuilles) {
  const groupes = new Map(); // "annee-num" -> { annee, numero_semaine, feuilles }
  for (const f of feuilles) {
    const cle = `${f.annee}-${f.numero_semaine}`;
    if (!groupes.has(cle)) groupes.set(cle, { annee: f.annee, numero_semaine: f.numero_semaine, feuilles: [] });
    groupes.get(cle).feuilles.push(f);
  }
  return [...groupes.values()].sort((a, b) =>
    (a.annee - b.annee) || (a.numero_semaine - b.numero_semaine));
}

/* Export GROUPÉ PAR SEMAINE : N plannings sélectionnés par leur ID (ordre
 * conservé, doublons ignorés) -> UN FICHIER PAR WEEK dans `dossier` :
 *   WEEK_39.xlsx = tous les services de la semaine 39 (une feuille chacun)
 *   WEEK_40.xlsx = tous les services de la semaine 40, etc.
 * Renvoie la liste des fichiers produits. Le modèle ne fournit que la
 * structure et la présentation ; seules les données réelles sont écrites. */
async function genererClasseursParSemaine({ ids_plannings, dossier }) {
  if (!Array.isArray(ids_plannings) || ids_plannings.length === 0) {
    const err = new Error('Fournir ids_plannings : tableau non vide.');
    err.status = 400;
    throw err;
  }
  const ids = [...new Set(ids_plannings.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    const err = new Error('Identifiants de plannings invalides.');
    err.status = 400;
    throw err;
  }

  const pool = require('../config/db');
  const path = require('path');
  const xmlModele = chargerXmlGabarit();

  // Construction de la feuille de CHAQUE planning (données réelles uniquement).
  // construireXmlFeuille renvoie UN LOT PAR 12 EMPLOYES (tableau de feuilles
  // { sheetXml, nomFeuille }) : chaque lot devient une feuille du classeur.
  const feuilles = [];
  for (const id of ids) {
    const { planning, employes, grille } = await chargerPlanningComplet(pool, id);
    const lots = construireXmlFeuille(xmlModele, planning, employes, grille);
    for (const lot of lots) {
      feuilles.push({
        ...lot,
        id_planning: planning.id_planning,
        nom_service: planning.nom_service,
        numero_semaine: planning.numero_semaine,
        annee: planning.annee,
        nbEmployes: employes.length,
      });
    }
  }

  // RÈGLE FINALE : regroupement automatique par WEEK — 1 WEEK = 1 fichier
  const groupes = grouperParSemaine(feuilles);
  const produits = [];
  const nomsDejaPris = new Set();
  for (const g of groupes) {
    // Convention de nommage RH : « Emploi_du_temps_<annee>_S<semaine>.xlsx »
    // (l'année est réelle — celle des données, jamais en dur). Un export =
    // UNE semaine : le nom identifie sans ambiguïté la semaine exportée.
    let nomFichier = `Emploi_du_temps_${g.annee}_S${g.numero_semaine}.xlsx`;
    // Collision (deux années pour le même numéro de semaine) : l'année est
    // ajoutée pour distinguer les fichiers.
    if (nomsDejaPris.has(nomFichier)) nomFichier = `Emploi_du_temps_${g.annee}_S${g.numero_semaine}.xlsx`;
    nomsDejaPris.add(nomFichier);
    const fichier = path.join(dossier, nomFichier);
    assemblerClasseur(g.feuilles, fichier);
    produits.push({
      fichier,
      nomFichier,
      numero_semaine: g.numero_semaine,
      annee: g.annee,
      nbPlannings: g.feuilles.length,
      onglets: g.feuilles.map((f) => f.nomFeuille),
      plannings: g.feuilles.map((f) => f.id_planning),
    });
  }
  return produits;
}

module.exports = { genererEmploiDuTempsExcel, genererClasseursParSemaine, grouperParSemaine };
