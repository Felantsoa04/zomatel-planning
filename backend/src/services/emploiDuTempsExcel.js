/* Générateur d'EMPLOI DU TEMPS Excel — édition XML DIRECTE du MODÈLE du projet :
 *   document utiliise/EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx
 *
 * MÉTHODE (fidélité maximale au fichier de référence) :
 *   le fichier exporté EST construit à partir du fichier modèle : copie du zip
 *   (styles.xml, theme, sharedStrings, médias, liens externes intacts), chaque
 *   feuille générée est réécrite cellule par cellule PAR RÉFÉRENCE au XML
 *   original du modèle — pour chaque cellule générée, on repart du XML de la
 *   cellule canonique du modèle (mêmes attributs s=, t=, f= : mêmes styles,
 *   mêmes formats, mêmes formules) et on substitue uniquement la VALEUR
 *   dynamique. Rien d'autre n'est touché : couleurs, bordures, polices,
 *   alignements, fusions (titre E2:I3 + fusions périodes), largeurs de
 *   colonnes, hauteurs, zoom, pageSetup A4 portrait, marges : conservés.
 *
 * GABARITS PAR SERVICE (règle projet : chaque service garde SON modèle) :
 *   le classeur modèle contient une feuille PAR SERVICE (CUISINE SNACK,
 *   RECEPTION, SECURITE, ADMINISTRATION, ...). L'export utilise la feuille du
 *   service correspondant (nom normalisé), ou en repli la feuille SECURITE.
 *   La structure du gabarit (nombre de lignes employés par jour, positions
 *   jour/périodes/en-têtes/totaux/récapitulatif, espacements) est DÉDUITE du
 *   XML de la feuille : chaque feuille a son propre rythme (12 lignes/entreprise
 *   pour SECURITE, 8 pour ADMINISTRATION, etc.), respecté à l'identique.
 *
 * EXPORT SIMPLE : 1 planning sélectionné -> la feuille 1 du modèle reçoit ses
 *   données (comportement historique, inchangé).
 * EXPORT MULTI : N plannings sélectionnés -> un CLASSEUR UNIQUE contenant
 *   UNIQUEMENT les feuilles des plannings (une feuille par planning, ordre
 *   demandé) : le modèle ne fournit QUE la structure et la mise en forme —
 *   les feuilles d'exemple du modèle ne sont JAMAIS copiées dans l'export
 *   (règle projet : zéro donnée d'exemple dans le fichier généré).
 *
 * CELLULES FIXES (jamais modifiées, valeurs originales du modèle) :
 *   en-têtes (Personne/entrée/sortie/durée/durée total), libellés périodes
 *   (matin/après-midi/soir), lignes d'espacement, fusions, largeurs de
 *   colonnes, pageSetup.
 *
 * CELLULES DYNAMIQUES (substituées avec les données du planning VALIDÉ) :
 *   E2 (titre = service + semaine), C jour (nom du service), H (dates série
 *   Excel du lundi au dimanche), A/B (matricule + nom employés), C..K
 *   (heures entrée/sortie en fraction de jour, format h:mm du modèle :
 *   0.25 = 06:00 ; Repos/Congé/Absence en état dans la colonne nom), SUM des
 *   totaux par période (formules du modèle, plages ajustées), RECAP (totaux
 *   hebdo réels).
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

/* Gabarit de REPLI (structure standard, 12 lignes employés par jour) :
 * feuille SECURITE du modèle. Utilisé pour tout service qui n'a pas de
 * feuille dédiée dans le classeur modèle (structure dérivée de façon fiée). */
const GABARIT_DEFUT_SERVICE = 'SECURITE';
const GABARIT_SECURITE = 'xl/worksheets/sheet23.xml';

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
 * Le gabarit ne contient pas toutes les lignes générées : rowXml peut être
 * undefined -> aucun attribut à reprendre (ligne à hauteur par défaut). */
function attributsLigne(rowXml) {
  if (!rowXml) return '';
  const m = rowXml.match(/^<row r="\d+"([^>]*)>/);
  let a = m ? m[1] : '';
  a = a.replace(/\s*r="\d+"/, '');
  a = a.replace(/\s*spans="[^"]*"/, ''); // recalculé selon les cellules
  return a.trim();
}

/* ---------------- Modèles PAR SERVICE -------------------------------------- */
/* Normalisation des noms de service (app ET modèle) pour retrouver la feuille
 * correspondante : majuscules, accents et ponctuation neutralisés
 * (« CUISINE RESTO » == « Cuisine Resto », « PATISS-PIZZA » == « PATISS PIZZA »). */
function normaliserNomService(nom) {
  return String(nom || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/* Index du classeur modèle : nom normalisé -> XML de la feuille. */
function indexerFeuillesModele() {
  const zip = new AdmZip(MODELE);
  const workbookXml = zip.getEntry('xl/workbook.xml').getData().toString('utf8');
  const relsXml = zip.getEntry('xl/_rels/workbook.xml.rels').getData().toString('utf8');
  const ridToTarget = {};
  for (const m of relsXml.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
    ridToTarget[m[1]] = m[2];
  }
  const feuilles = [];
  for (const m of workbookXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const entree = zip.getEntry('xl/' + (ridToTarget[m[2]] || '').replace(/^\//, ''));
    if (!entree) continue;
    feuilles.push({ nom: m[1], xml: entree.getData().toString('utf8') });
  }
  const index = new Map(feuilles.map((f) => [normaliserNomService(f.nom), f.xml]));
  const defaut = index.get(normaliserNomService(GABARIT_DEFUT_SERVICE)) || null;
  return { feuilles, index, defaut };
}

/* Résolution du GABARIT d'un service : sa feuille si elle existe dans le
 * classeur modèle, sinon la feuille SECURITE (comportement historique). */
function xmlGabaritDeService(nomService, { index, defaut }) {
  const normalise = normaliserNomService(nomService);
  // 1) nom complet normalisé exact
  if (index.has(normalise)) return index.get(normalise);
  // 2) correspondance partielle : le nom du service CONTIENT le nom de la
  //    feuille (ou l'inverse), non ambiguë (une seule feuille candidate).
  let candidates = [];
  for (const [nom, xml] of index) {
    if (nom && normalise && (normalise.includes(nom) || nom.includes(normalise))) candidates.push(xml);
  }
  const uniques = [...new Set(candidates)];
  if (uniques.length === 1) return uniques[0];
  return defaut; // repli : feuille SECURITE du modèle
}

/* ---------------- Dérivation de la structure du gabarit --------------------
 * Le modèle varie par feuille (12 lignes employés/jour pour SECURITE, 8 pour
 * ADMINISTRATION, 2 pour CUISINE CANTINE, espacements différents...).
 * La structure est LUE dans le XML :
 *   - blocs jour   : repérés par les formules SUM(E..:E..) des totaux ;
 *       jour = empDebut-3, périodes = empDebut-2, en-têtes = empDebut-1,
 *       employés = [empDebut..empFin], totaux = row SUM, fantôme = SUM+1 ;
 *   - espacements  : les lignes entre le fantôme et le jour suivant sont
 *       reproduites (hauteur/largeur du modèle) ;
 *   - récapitulatif: lignes A+B+C après le dernier fantôme (modèle C s21). */
function analyserGabarit(xmlGabarit) {
  const { lignes, cellules } = parserFeuille(xmlGabarit);

  const blocs = [];
  for (const m of xmlGabarit.matchAll(/<c r="E(\d+)"[^>]*><f>SUM\(E(\d+):E(\d+)\)<\/f>/g)) {
    const numLigne = Number(m[1]);
    const empDebut = Number(m[2]);
    const empFin = Number(m[3]);
    blocs.push({
      ligneJour: empDebut - 3,
      lignePeriodes: empDebut - 2,
      ligneEntetes: empDebut - 1,
      empDebut,
      empFin,
      ligneTotaux: numLigne,
      ligneFantome: numLigne + 1,
    });
  }
  // Exactement 7 blocs jour valides ET superposés (chaque SUM doit porter sa
  // ligne d'en-tete employés: l'en-tete = empDebut - 1 doit être > ligne jour).
  if (blocs.length !== 7) return null;
  for (const b of blocs) {
    if (b.empDebut <= b.empFin && b.ligneJour >= 5 && b.empDebut === b.ligneEntetes + 1) continue;
    return null;
  }

  // Récapitulatif : après le dernier fantôme, lignes A+B+C (styles du modèle),
  // consécutives, avec la colonne C portant le style durée du modèle (s21) ou
  // une formule "+L..". (les sous-totaux SUM ne sont pas récapitulatifs).
  const dernierFantome = Math.max(...blocs.map((b) => b.ligneFantome));
  const recapStart = (() => {
    let r = dernierFantome + 1;
    while (r < dernierFantome + 40) {
      // Ligne récapitulative du modèle : B (libellé) + C (durée hebdo,
      // formule "+L.." ou format d'aspect du modèle) — la colonne A est
      // facultative (absente sur certaines feuilles, ex. RECEPTION).
      const estRecap = cellules[`B${r}`]
        && cellules[`C${r}`]
        && /t="s"/.test(cellules[`B${r}`])          // libellé du modèle (sharedString)
        && !/<f>SUM\(/.test(cellules[`C${r}`]);     // pas un sous-total SUM
      if (estRecap) return r;
      r += 1;
    }
    return null;
  })();
  const nbRecap = (recapStart ? (() => {
    let n = 0;
    let r = recapStart;
    // Lignes récap consécutives : B+C présents, C sans formule SUM.
    while (cellules[`C${r}`] && cellules[`B${r}`] && !/<f>SUM\(/.test(cellules[`C${r}`])) { n += 1; r += 1; }
    return n;
  })() : 0);

  // Le récapitulatif est FACULTATIF (certaines feuilles du modèle n'en ont
  // pas, ex. SALLE SNACK) : les 7 blocs jour sont alors le seul gabarit.
  return { blocs, recapStart, nbRecap, lignes, cellules };
}

/* ---------------- Données d'un planning (partagé mono / multi) ------------- */
/* Lit le planning + sa grille (affectations + créneaux). RÈGLE MÉTIER :
 * erreur 403 si le statut n'est pas VALIDE (contrôle doublé par le HTTP). */
async function chargerPlanningComplet(pool, id_planning) {
  const [[planning]] = await pool.query(
    `SELECT p.id_planning, p.annee, p.numero_semaine, p.date_debut_semaine,
            p.statut, s.nom_service
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

/* ---------------- Construction d'une feuille (gabarit du service) ---------- */
function construireXmlFeuilleGabarit(xmlGabarit, meta, planning, employes, grille) {
  const { blocs, lignes, cellules: CEL } = meta;
  const EMPLOYES = blocs[0].empFin - blocs[0].empDebut + 1;
  const dernierBloc = blocs[blocs.length - 1];
  // Fin de la zone des données du gabarit : après le récapitulatif quand il
  // existe, sinon juste après le dernier fantôme (feuilles sans récap).
  const recapStart = meta.recapStart || (dernierBloc.ligneFantome + 1);
  const nbRecap = meta.nbRecap || 0;

  // Cellules canoniques par jour (XML originaux de la feuille du gabarit)
  const jours = blocs.map((b) => ({
    titre: CEL['E2'],
    titreVide: CEL['F2'] || CEL['F3'],
    espace: null,
    jour: CEL['C' + b.ligneJour] || CEL['C5'],
    jourLabel: CEL['G' + b.ligneJour] || CEL['G5'],
    jourDate: CEL['H' + b.ligneJour] || CEL['H5'],
    periodes: {}, entetes: {}, employe: [], totaux: {},
  }));
  for (let i = 0; i < 7; i++) {
    const b = blocs[i];
    const j = jours[i];
    for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      j.periodes[col] = CEL[col + b.lignePeriodes];
    }
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) {
      j.entetes[col] = CEL[col + b.ligneEntetes];
    }
    for (let rr = b.empDebut; rr <= b.empFin; rr++) {
      const ligne = { A: CEL['A' + rr], B: CEL['B' + rr], L: CEL['L' + rr] };
      for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
        if (CEL[col + rr]) ligne[col] = CEL[col + rr];
      }
      // fantôme en fin de bloc (comme N16..N19 du modèle SECURITE)
      for (const col of ['M', 'N']) if (CEL[col + rr]) ligne[col] = CEL[col + rr];
      j.employe.push(ligne);
    }
    for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) {
      j.totaux[col] = CEL[col + b.ligneTotaux];
    }
    j.fantomeN = CEL['N' + b.ligneFantome] || null;
  }
  // Récapitulatif hebdo (lignes A/B/C du gabarit)
  const recapLignes = [];
  for (let rr = recapStart; rr < recapStart + nbRecap; rr++) {
    recapLignes.push({ A: CEL['A' + rr], B: CEL['B' + rr], C: CEL['C' + rr] });
  }

  const lignesProduites = [];
  const merges = ['E2:I3'];

  const push = (r, cells) => {
    const attrs = attributsLigne(lignes[r]);
    lignesProduites.push(`<row r="${r}"${attrs ? ` ${attrs}` : ''} spans="1:14">${cells.join('')}</row>`);
  };

  // ---- Titre (E2:I3) + espace (l.4) — XML du modèle, seule la valeur change.
  // FIDÉLITÉ : une cellule ABSENTE du gabarit n'est JAMAIS écrite (aucune
  // colonne ni style ajoutés au modèle).
  push(2, [
    // Zone 1 : titre au FORMAT DU MODÈLE « EMPLOI DU TEMPS <service> WEEK n »
    clonerCellule(jours[0].titre, 'E2', `EMPLOI DU TEMPS ${planning.nom_service} WEEK ${planning.numero_semaine}`),
    ...['F2', 'G2', 'H2', 'I2'].filter((c) => CEL[c]).map((c) => clonerCellule(jours[0].titreVide, c, '')),
  ]);
  push(3, ['E3', 'F3', 'G3', 'H3', 'I3'].filter((c) => CEL[c]).map((c) => clonerCellule(jours[0].titreVide, c, '')));
  push(4, ['E4', 'F4', 'G4', 'H4', 'I4'].filter((c) => CEL[c]).map((c) => clonerCellule(CEL[c], c, '')));
  // lignes 5..(1er bloc) hors structure (gabarits avec décalage)
  for (let r = 5; r < blocs[0].ligneJour; r++) push(r, []);

  // 7 dates réelles du planning (date_debut_semaine = lundi ; DB dateStrings)
  const base = String(planning.date_debut_semaine).slice(0, 10);
  const datesJours = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Date(new Date(base + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10));

  // ---- 7 blocs jour (structure exactement celle du gabarit) -----------------
  for (let i = 0; i < 7; i++) {
    const b = blocs[i];
    const j = jours[i];
    const serie = dateExcel(datesJours[i]);

    // Ligne jour : C=service, G=libellé jour, H=date (H5 littéral, puis +Hprec+1)
    // FIDÉLITÉ : cellules absentes du gabarit jamais écrites.
    push(b.ligneJour, [
      ...([
        ['C', clonerCellule(j.jour, 'C' + b.ligneJour, planning.nom_service)],
        ['G', clonerCellule(j.jourLabel, 'G' + b.ligneJour, JOURS_SEMAINE[i])],
        ['H', i === 0
          ? clonerCellule(j.jourDate, 'H' + b.ligneJour, serie)
          : clonerCellule(j.jourDate, 'H' + b.ligneJour, { f: `+H${blocs[i - 1].ligneJour}+1`, v: serie })],
      ]).filter(([col]) => CEL[col + b.ligneJour]).map(([, cell]) => cell),
    ]);

    // Ligne périodes (3 fusions C:E F:H I:K, cellules du modèle clonées)
    push(b.lignePeriodes, ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].filter((col) => j.periodes[col]).map((col) =>
      clonerCellule(j.periodes[col], col + b.lignePeriodes, { C: 'matin', F: 'après-midi', I: 'soir' }[col] || '')));
    merges.push(`C${b.lignePeriodes}:E${b.lignePeriodes}`, `F${b.lignePeriodes}:H${b.lignePeriodes}`, `I${b.lignePeriodes}:K${b.lignePeriodes}`);

    // En-têtes (cellules FIXES du modèle)
    const libelles = { B: 'Personne', C: 'entrée', D: 'sortie', E: 'durée', F: 'entrée', G: 'sortie', H: 'durée', I: 'entrée', J: 'sortie', K: 'durée', L: 'durée total' };
    push(b.ligneEntetes, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].filter((col) => j.entetes[col]).map((col) =>
      clonerCellule(j.entetes[col], col + b.ligneEntetes, libelles[col])));

    // Lignes employés (données réelles) — chaque position k garde le style de
    // la ligne homologue du modèle (rythme d'ombrage/ bords du gabarit conservé)
    for (let k = 0; k < EMPLOYES; k++) {
      const r = b.empDebut + k;
      const emp = employes[k] || null;
      const canon = j.employe[k] || j.employe[EMPLOYES - 1];
      let totalMinutes = 0;
      const parPeriode = { MATIN: null, APRES_MIDI: null, SOIR: null };
      let nonTravaille = false;
      if (emp) {
        const jourData = (grille[emp.id_employe] || {})[datesJours[i]] || null;
        const statut = jourData && jourData.statut_jour && jourData.statut_jour !== 'TRAVAIL' ? jourData.statut_jour : '';
        nonTravaille = statut !== '';
        // Convention de l'application : un statut non-travail (REPOS/CONGE/
        // ABSENCE) est AFFICHE en colonne B et les horaires du jour sont
        // masqués — aucune valeur inventée : les cellules restent propres.
        if (nonTravaille) {
          const nomFonction = emp.fonction ? `${emp.nom || ''} (${emp.fonction})` : (emp.nom || '');
          const valeurs = { A: emp.matricule || '', B: `${nomFonction} (${statut})` };
          const cells = [];
          for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']) {
            const src = canon[col];
            if (!src) continue;
            cells.push(clonerCellule(src, col + r, valeurs[col] !== undefined ? valeurs[col] : ''));
          }
          push(r, cells);
          continue;
        }
        for (const c of (jourData && jourData.creneaux) || []) {
          const rep = repartirDansCreneaux(c.heure_entree, c.heure_sortie);
          for (const p of PERIODES) {
            if (rep.parPeriode[p]) parPeriode[p] = rep.parPeriode[p];
          }
          totalMinutes += rep.total;
        }
      }
      const nomFonction = emp ? (emp.fonction ? `${emp.nom || ''} (${emp.fonction})` : (emp.nom || '')) : '';
      const valeurs = {
        A: emp ? (emp.matricule || '') : '',
        B: nomFonction,
        L: fractionJour(totalMinutes),
      };
      for (const p of PERIODES) {
        const c = parPeriode[p];
        const [ce, cs, cd] = POSITIONS[p];
        valeurs[ce] = c ? c.entree : '';
        valeurs[cs] = c ? c.sortie : '';
        valeurs[cd] = c ? fractionJour(c.minutes) : 0;
      }
      const cells = [];
      for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']) {
        const src = canon[col];
        if (!src) continue;
        cells.push(clonerCellule(src, col + r, valeurs[col] !== undefined ? valeurs[col] : ''));
      }
      push(r, cells);
    }

    // COMPLÉMENT du modèle : les lignes employés NON UTILISÉES restent dans
    // la feuille, avec leur style du modèle (cellules stylées vides).
    // (fait ci-dessus via employes[k] null -> cellules stylées vides.)

    // Totaux par période (formules SUM, plages réelles) — style du modèle
    const minutesParCol = { E: 0, H: 0, K: 0, L: 0 };
    for (const emp of employes.slice(0, EMPLOYES)) {
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
      E: { f: `SUM(E${b.empDebut}:E${b.empFin})`, v: fractionJour(minutesParCol.E) },
      H : { f: `SUM(H${b.empDebut}:H${b.empFin})`, v: fractionJour(minutesParCol.H) },
      K: { f: `SUM(K${b.empDebut}:K${b.empFin})`, v: fractionJour(minutesParCol.K) },
      L: { f: `SUM(L${b.empDebut}:L${b.empFin})`, v: fractionJour(minutesParCol.L) },
    };
    push(b.ligneTotaux, ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].filter((col) => j.totaux[col]).map((col) =>
      clonerCellule(j.totaux[col], col + b.ligneTotaux, formulesTotaux[col] || '')));

    // Fantôme (comme le modèle, ligne suivante du bloc)
    if (j.fantomeN) push(b.ligneFantome, [clonerCellule(j.fantomeN, 'N' + b.ligneFantome, '')]);

    // Espacements du modèle entre le bloc courant et le suivant (les lignes
    // intermédiaires du gabarit, avec hauteur d'origine)
    const prochainDeb = i < 6 ? blocs[i + 1].ligneJour : recapStart;
    for (let r = b.ligneFantome + 1; r < prochainDeb; r++) push(r, []);
  }

  // ---- RECAP hebdomadaire (réels) — chaque ligne garde le style du modèle
  // (A s3 / B s24,s26,s27... / C s21 format durée [h]:mm).
  for (let k = 0; k < nbRecap; k++) {
    const canon = recapLignes[k] || recapLignes[recapLignes.length - 1];
    if (!canon || (!canon.B && !canon.C)) continue;
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
    push(recapStart + k, [
      ...([
        ['A', clonerCellule(canon.A, 'A' + (recapStart + k), emp ? (emp.matricule || '') : '')],
        ['B', clonerCellule(canon.B, 'B' + (recapStart + k), emp ? (emp.nom || '') : '')],
        ['C', clonerCellule(canon.C, 'C' + (recapStart + k), emp ? fractionJour(t) : '')],
      ]).filter(([col]) => canon[col]).map(([, cell]) => cell),
    ]);
  }

  /* ---------------- Assemblage de la feuille (head/tail du gabarit) ------- */
  const iD = xmlGabarit.indexOf('<sheetData>');
  const iF = xmlGabarit.indexOf('</sheetData>');
  const head = xmlGabarit.slice(0, iD);
  const finModele = xmlGabarit.slice(iF + '</sheetData>'.length);
  const mergeXml = merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('');
  const mergeCellsXml = `<mergeCells count="${merges.length}">${mergeXml}</mergeCells>`;
  const derniereLigne = Math.max(recapStart + nbRecap - 1, ...blocs.map((b) => b.ligneFantome));
  const tailFinal = finModele
    // Annotations d'exemple du modèle (dessins, encres, images) : jamais
    // exportées (règles projet) ; aucune feuille d'exemple n'est copiée.
    .replace(/<mergeCells[\s\S]*?<\/mergeCells>/, mergeCellsXml)
    .replace(/<sortState[\s\S]*?<\/sortState>/, '') // plage du modèle obsolète
    .replace(/<dimension ref="[^"]*"\/>/, '')
    .replace(/<legacyDrawing[^>/]*\/>/, '')
    .replace(/<drawing[^>/]*\/>/, '')
    .replace(/<picture[^>/]*\/>/, '');
  const headFinal = head
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A2:N${derniereLigne}"/>`)
    .replace(/<legacyDrawing[^>/]*\/>/, '')
    .replace(/<drawing[^>/]*\/>/, '')
    .replace(/<picture[^>/]*\/>/, '');
  const sheetXml = headFinal + '<sheetData>' + lignesProduites.join('') + '</sheetData>' + tailFinal;

  const nomFeuille = String(planning.nom_service).slice(0, 31).replace(/[[\]*?/\\:]/g, ' ');
  return { sheetXml, nomFeuille };
}

/* ---------------- Génération du XML d'UNE feuille -------------------------- */
/* RÈGLE MULTI-MODÈLES : chaque service est exporté selon SON gabarit
 * (feuille du service dans le classeur modèle ; SECURITE en repli). Si
 * l'équipe dépasse la capacité du gabarit (nombre de lignes employés par
 * jour), les effectifs supplémentaires continuent sur un LOT identique
 * (contrepartie : une feuille supplémentaire, comme avant).
 * Toujours un TABLEAU de feuilles (un lot par capacité du gabarit). */
function construireXmlFeuilleRepli(xmlGabarit, metaRef, planning, employes, grille) {
  const EMPLOYES = metaRef.blocs[0].empFin - metaRef.blocs[0].empDebut + 1;
  const lots = [];
  for (let debut = 0; debut < Math.max(employes.length, 1); debut += EMPLOYES) {
    const lot = employes.slice(debut, debut + EMPLOYES);
    lots.push(construireXmlFeuilleGabarit(xmlGabarit, metaRef, planning, lot, grille));
  }
  return lots;
}

function construireXmlFeuille(xmlGabarit, planning, employes, grille) {
  const meta = analyserGabarit(xmlGabarit);
  if (!meta) {
    // Gabarit de la feuille du service illisible (feuille modifiée
    // manuellement ?) : repli sur la structure de référence SECURITE,
    // jamais de fichier invalide.
    const gabDefaut = xmlGabaritDeService(GABARIT_DEFUT_SERVICE, indexerFeuillesModele());
    const metaRef = analyserGabarit(gabDefaut);
    if (!metaRef) {
      const err = new Error('Gabarit Excel ne correspondant pas (feuille SECURITE introuvable ou corrompue dans le modèle).');
      err.status = 500;
      throw err;
    }
    return construireXmlFeuilleRepli(gabDefaut, metaRef, planning, employes, grille);
  }
  const EMPLOYES = meta.blocs[0].empFin - meta.blocs[0].empDebut + 1;
  const lots = [];
  for (let debut = 0; debut < Math.max(employes.length, 1); debut += EMPLOYES) {
    const lot = employes.slice(debut, debut + EMPLOYES);
    lots.push(construireXmlFeuilleGabarit(xmlGabarit, meta, planning, lot, grille));
  }
  return lots;
}

/* ---------------- Assemblage du CLASSEUR (1..n feuilles générées) ---------- */
/* Le modèle ne fournit que la STRUCTURE et la MISE EN FORME : le classeur
 * exporté ne contient QUE les feuilles des plannings générées (clonage XML),
 * JAMAIS les 24 autres feuilles d'exemple du modèle. Repart TOUJOURS du zip
 * du modèle (jamais modifié) :
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
/* Gabarit source : la feuille du SERVICE (nom du service = nom de feuille) ;
 * repli : feuille SECURITE du modèle. Tous les services exportés reproduisent
 * LEUR tableau du modèle, rempli des données réelles — jamais les données
 * d'exemple du modèle. */
function chargerIndexGabarits() {
  if (!fs.existsSync(MODELE)) {
    const err = new Error(`Modèle Excel introuvable sur le serveur : ${MODELE}.`);
    err.status = 500;
    throw err;
  }
  const idx = indexerFeuillesModele();
  if (!idx.defaut) {
    const err = new Error('Gabarit de repli (feuille SECURITE) absent du modèle Excel.');
    err.status = 500;
    throw err;
  }
  return idx;
}

/* Export SIMPLE : 1 planning sélectionné par son ID -> 1 fichier (historique). */
async function genererEmploiDuTempsExcel({ id_planning, sortie }) {
  const pool = require('../config/db');
  const { planning, employes, grille } = await chargerPlanningComplet(pool, id_planning);

  const idx = chargerIndexGabarits();
  const xmlGabarit = xmlGabaritDeService(planning.nom_service, idx);
  const lots = construireXmlFeuille(xmlGabarit, planning, employes, grille);

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
 *   EMPLOI_DU_TEMPS_WEEK_39.xlsx = tous les services de la semaine 39
 *   (une feuille par service, chaque feuille garde le MODÈLE de son service ;
 *    les données des services ne sont jamais mélangées). Renvoie la liste
 * des fichiers produits. */
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
  const idx = chargerIndexGabarits();

  // Construction de la feuille de CHAQUE planning (données réelles uniquement).
  // construireXmlFeuille renvoie UN LOT PAR CAPACITÉ du gabarit (tableau de
  // feuilles { sheetXml, nomFeuille }) : chaque lot devient une feuille.
  const feuilles = [];
  for (const id of ids) {
    const { planning, employes, grille } = await chargerPlanningComplet(pool, id);
    const xmlGabarit = xmlGabaritDeService(planning.nom_service, idx);
    const lots = construireXmlFeuille(xmlGabarit, planning, employes, grille);
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
  // Collision (deux années pour le même numéro de semaine) : l'année est
  // ajoutée pour distinguer les fichiers.
  const nomsDejaPris = new Set();
  for (const g of groupes) {
    // Convention de nommage : « EMPLOI_DU_TEMPS_WEEK_<n>.xlsx » — le numéro
    // de semaine est dynamique (celui des données, jamais une valeur en dur).
    let nomFichier = `EMPLOI_DU_TEMPS_WEEK_${g.numero_semaine}.xlsx`;
    if (nomsDejaPris.has(nomFichier)) nomFichier = `EMPLOI_DU_TEMPS_WEEK_${g.numero_semaine}_${g.annee}.xlsx`;
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

module.exports = { genererEmploiDuTempsExcel, genererClasseursParSemaine, grouperParSemaine,
  // Exportés aussi pour les tests (lecture seule du XML du modèle) :
  analyserGabarit, xmlGabaritDeService, chargerIndexGabarits };
