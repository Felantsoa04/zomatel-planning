/* OCR des plannings papier (Tesseract.js) + analyse du TABLEAU.
 * Objectif : reconnaître service, semaine, jours, employés, horaires,
 * REPOS/CONGÉ et observations — en gardant la structure d'origine.
 *
 * PRINCIPES (règles projet) :
 *   - RIEN n'est inventé : toute valeur illisible/ambigüe devient une
 *     alerte présentée au RH ; une heure de fin non déterminable (ex. "FS")
 *     est laissée vide, jamais devinée ;
 *   - les noms reconnus sont associés aux EMPLOYÉS de la base (score de
 *     correspondance) ; aucun employé n'est créé automatiquement ;
 *   - le résultat (donnéesOcr) est un JSON que la RH vérifie/corrige avant
 *     confirmation — la confirmation crée un planning BROUILLON via les
 *     règles métier existantes (aucun calcul d'heures arbitraire ici).
 *
 * Langues : français + anglais (fra+eng). traineddata est téléchargé une
 * seule fois puis mis en cache ; si un dossier backend/ocr-data existe, il
 * sert de source locale (installation hors ligne possible).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

/* Cache traineddata + dossier de données locales (optionnel, hors ligne). */
const CACHE_TESSERACT = path.resolve(__dirname, '..', '..', 'uploads', '.tesseract-cache');
const DONNEES_LOCALES = path.resolve(__dirname, '..', '..', 'ocr-data');
if (!fs.existsSync(CACHE_TESSERACT)) fs.mkdirSync(CACHE_TESSERACT, { recursive: true });

/* ---------------- Aides texte ---------------- */
const JOURS = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];
const ABR_JOURS = { LUN: 'LUNDI', MAR: 'MARDI', MER: 'MERCREDI', JEU: 'JEUDI', VEN: 'VENDREDI', SAM: 'SAMEDI', DIM: 'DIMANCHE' };

function normaliser(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9: -]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* Distance de Levenshtein bornée (pour l'association des noms). */
function levenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const mp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prec = mp[0];
    mp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = mp[j];
      mp[j] = Math.min(mp[j] + 1, mp[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1));
      prec = tmp;
    }
  }
  return mp[b.length];
}

/* Score 0..1 entre deux noms normalisés (inclusion partielle tolérée :
 * "KOUAME ADJOVI" vs "KOUAME" ; OCR qui mange une lettre, etc.). */
function scoreNom(ocr, bd) {
  if (!ocr || !bd) return 0;
  if (ocr === bd) return 1;
  const tolerance = Math.max(2, Math.floor(bd.length / 5));
  const d = levenshtein(ocr, bd, tolerance + 2);
  if (d <= tolerance) return 1 - d / (tolerance + 1);
  if (bd.includes(ocr) && ocr.length >= 4) return 0.75;
  if (ocr.includes(bd) && bd.length >= 4) return 0.75;
  // Comparaison mot à mot (prénoms abrégés, apostrophes OCR...)
  const mo = ocr.split(' ').filter(Boolean);
  const mb = bd.split(' ').filter(Boolean);
  if (mo.length && mb.length) {
    let pts = 0;
    for (const a of mo) {
      pts += mb.some((b) => b.startsWith(a.slice(0, 3)) && levenshtein(a, b, Math.max(1, Math.floor(b.length / 4))) <= Math.max(1, Math.floor(b.length / 4))) ? 1 : 0;
    }
    const s = pts / Math.max(mo.length, mb.length);
    return s >= 0.7 ? 0.7 : s * 0.5;
  }
  return 0;
}

/* ---------------- OCR (prétraitement + reconnaissance) ---------------- */
/* Prétraitement sharp : niveaux de gris, normalisation du contraste,
 * redimensionnement vers ~2200 px de large (le papier scanné est souvent
 * petit/gris : l'OCR gagne beaucoup en lisibilité). */
async function pretraiter(chemin) {
  return sharp(chemin)
    .rotate() // respecte l'orientation EXIF (photos de téléphone)
    .greyscale()
    .normalise()
    .sharpen()
    .resize({ width: 2200, withoutEnlargement: false })
    .png()
    .toBuffer();
}

/* Reconnaît l'image et renvoie les LIGNES géométriques :
 *   [{ y, mots: [{ t, x0, x1, y0, y1 }] }, ...]  triées de haut en bas.
 * (structure reconstructible en tableau, quelle que soit la mise en page). */
async function lignesOcr(chemin, onProgress) {
  const worker = await createWorker(['fra', 'eng'], 1, {
    cachePath: CACHE_TESSERACT,
    langPath: fs.existsSync(DONNEES_LOCALES) ? DONNEES_LOCALES : undefined,
    logger: (m) => {
      if (onProgress && m && typeof m.progress === 'number') onProgress(m.progress);
    },
  });
  try {
    const image = await pretraiter(chemin);
    const { data } = await worker.recognize(image, { blocks: true }, { blocks: true, text: true });
    const brut = [];
    const pousserLigne = (mots) => {
      const valides = mots.filter((w) => w && w.text && String(w.text).trim() && w.bbox);
      if (!valides.length) return;
      brut.push({
        y: valides.reduce((s, w) => s + (w.bbox.y0 + w.bbox.y1) / 2, 0) / valides.length,
        mots: valides.map((w) => ({
          t: String(w.text).trim(),
          x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1,
        })),
      });
    };
    if (Array.isArray(data.blocks)) {
      for (const b of data.blocks) {
        for (const p of b.paragraphs || []) {
          for (const l of p.lines || []) pousserLigne(l.words || []);
        }
      }
    }
    // Recouvrement : dendrogramme simple sur y (les lignes OCR peuvent être
    // légèrement décalées à l'intérieur d'une même ligne papier).
    brut.sort((a, b) => a.y - b.y);
    const lignes = [];
    for (const l of brut) {
      const prec = lignes[lignes.length - 1];
      if (prec && Math.abs(prec.y - l.y) < Math.max(10, prec.mots[0].y1 - prec.mots[0].y0) * 0.6) {
        prec.mots.push(...l.mots);
        prec.y = (prec.y + l.y) / 2;
        prec.mots.sort((a, b) => a.x0 - b.x0);
      } else lignes.push(l);
    }
    return lignes;
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/* ---------------- Analyse du tableau ---------------- */
const RE_HORAIRE = /^(\d{1,2})[.:hH](\d{2})?$/;
/* Plage colle sur un seul mot OCR : "07:00-15:00", "7h00-15h", "06:00-FS" */
/* Le segment final (séparateur + minutes) devient OPTIONNEL : "18:00-FS"
 * se reconnait bien comme créneau 18:00 -> sortie indéterminée (FS). */
const RE_PLAGE_COLLEE = /^(\d{1,2})[.:hH](\d{2})[-–—~:]?(\d{1,2}|FS)(?:[.:hH](\d{2}))?$/i;
const RE_PLAGE = /^(\d{1,2})[.:hH](\d{2})?[-–—~\s]*(\d{1,2})[.:hH](\d{2})?$/; // historique, garde pour les tests
const MOTS_STATUT = { REPOS: 'REPOS', CONGE: 'CONGE', CONGEZ: 'CONGE', ABS: 'ABSENCE', ABSENCE: 'ABSENCE', ABSENT: 'ABSENCE' };

function heureDe(mot) {
  // "7:30", "07h30", "7.30", "0730" quand isolé — jamais inventée si ambigu
  const m = RE_HORAIRE.exec(String(mot).replace(/[^\d.:hH]/g, ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/* Cherche la semaine (WEEK n / SEMAINE n) et l'année (4 chiffres). */
function trouverSemaine(texte) {
  const t = normaliser(texte);
  let numero = null;
  const m1 = /\bW(?:EE)?K\s*0?(\d{1,2})\b/.exec(t) || /\bSEMAINE\s*0?(\d{1,2})\b/.exec(t);
  if (m1) numero = Number(m1[1]);
  let annee = null;
  const m2 = /\b(20\d{2})\b/.exec(t);
  if (m2) annee = Number(m2[1]);
  return { numero, annee, confiance: numero ? 0.8 : 0 };
}

/* Lundi de la semaine ISO (regle existante du projet : lundi = 1er jour). */
function lundiDeSemaineIso(annee, numero) {
  const j4 = new Date(Date.UTC(annee, 0, 4));
  const jour = j4.getUTCDay() || 7;
  const lundi1 = new Date(j4.getTime() - (jour - 1) * 86400000);
  return new Date(lundi1.getTime() + (numero - 1) * 7 * 86400000).toISOString().slice(0, 10);
}

/* -------------------- ANALYSE PRINCIPALE -------------------- */
/* servicesDb : [{ id_service, nom_service }]
 * employesDb : [{ id_employe, nom, service_id, matricule, fonction, reference_hebdo }] */
/* Analyse une cellule horaire (mots d'une colonne de jour) :
 *   - statut REPOS/CONGE/ABSENCE si lexique ;
 *   - plage(s) horaire : "07:00-15:00", "7:00 15:00", "06:00-14:00 / 18:00-FS" ;
 *   - "FS" = fin de service indeterminable -> heure_sortie null + alerte
 *     (JAMAIS d'heure inventee) ;
 *   - contenu non interpretable -> alerte (aucune valeur devinee).
 * Retour : { statut, creneaux, alertesColonne: [] } */
function analyserCelluleHoraire(mots) {
  const alertes = [];
  const txt = normaliser(mots.map((m) => m.t).join(' '));
  const statutMot = Object.keys(MOTS_STATUT).find((k) => txt.split(/\s+|[/|]/).includes(k));
  if (statutMot) return { statut: MOTS_STATUT[statutMot], creneaux: [], alertes };

  // Nettoyage : supprime les tokens repetes du modele (totaux, croix...)
  const tokens = mots.map((m) => normaliser(m.t)).filter(Boolean);
  const creneaux = [];
  let i = 0;
  while (i < tokens.length && creneaux.length < 3) {
    const token = tokens[i];
    if (/^[.xX/|-]+$/.test(token)) { i += 1; continue; } // cases scorees/marquees

    // 1) Plage colle sur un SEUL mot : "07:00-15:00" (ou "07h00-15h00")
    let plage = RE_PLAGE_COLLEE.exec(token);
    if (plage) {
      const debut = `${plage[1].padStart(2, '0')}:${plage[2] || '00'}`;
      const fin = plage[3] !== 'FS'
        ? `${plage[3].padStart(2, '0')}:${plage[4] || '00'}`
        : null;
      if (fin && fin <= debut) {
        alertes.push(`Horaire ${debut}-${fin} incoherent (fin <= debut, passage minuit ?) — a corriger manuellement.`);
        i += 1;
        continue;
      }
      creneaux.push({ heure_entree: debut, heure_sortie: fin });
      if (!fin) alertes.push('Heure de fin "FS" non determinable — a completer manuellement (aucune heure inventee).');
      i += 1;
      continue;
    }

    // 2) Debut puis fin sur deux mots separes (ou "FS")
    const debut = /^\d{1,2}[.:hH]\d{2}$/.test(token) ? heureDe(token) : null;
    if (!debut) { i += 1; continue; }
    let fin = null;
    if (i + 1 < tokens.length) {
      const suivant = tokens[i + 1].replace(/^[-–—~:|]+/, '');
      plage = RE_PLAGE_COLLEE.exec(suivant);
      if (/^(FS|F\/S|F\.S\.?)$/.test(suivant)) {
        fin = null;
        alertes.push('Heure de fin "FS" non determinable — a completer manuellement (aucune heure inventee).');
        i += 2;
      } else if (plage) {
        // le mot suivant contient encore une plage (on la laisse pour le tour suivant)
        fin = null;
        i += 1;
        continue;
      } else if (/^\d{1,2}[.:hH]\d{2}$/.test(suivant)) {
        fin = heureDe(suivant);
        if (fin && fin <= debut) {
          alertes.push(`Horaire ${debut}-${fin} incoherent (fin <= debut, passage minuit ?) — a corriger manuellement.`);
          fin = null;
        }
        i += 2;
      } else {
        i += 1;
        continue; // debut sans fin : ignoré safi creneau incomplet non invente
      }
      creneaux.push({ heure_entree: debut, heure_sortie: fin });
    } else {
      alertes.push(`Heure de debut « ${debut} » sans heure de fin — a corriger manuellement (aucune heure inventee).`);
      i += 1;
    }
  }
  if (!creneaux.length && txt.replace(/[^A-Z0-9]/g, '').length >= 2) {
    alertes.push(`Contenu non interpretable « ${txt} » — a verifier manuellement.`);
  }
  return { statut: 'TRAVAIL', creneaux, alertes };
}

async function analyserPlanning(chemin, servicesDb, employesDb, onProgress) {
  const lignes = await lignesOcr(chemin, onProgress);
  const alertes = [];
  const toutTexte = lignes.map((l) => l.mots.map((m) => m.t).join(' ')).join('\n');
  const norm = normaliser(toutTexte);

  /* 1) Semaine */
  const semaine = trouverSemaine(toutTexte);
  if (!semaine.numero) alertes.push('Numéro de semaine non reconnu sur le document — à sélectionner manuellement.');

  /* 2) Service : chaque ligne courte est comparée aux noms de services réels */
  let service = { id: null, nom: null, confiance: 0 };
  for (const l of lignes) {
    const texteLigne = normaliser(l.mots.map((m) => m.t).join(' '));
    for (const s of servicesDb) {
      const nomS = normaliser(s.nom_service);
      if (!nomS) continue;
      const score = scoreNom(texteLigne, nomS);
      if (score > service.confiance) service = { id: s.id_service, nom: s.nom_service, confiance: score };
    }
  }
  if (service.confiance < 0.7) {
    service.id = null;
    alertes.push('Service non identifié avec certitude — à confirmer manuellement.');
  }

  /* 3) Colonnes des jours : lignes contenant au moins 2 libellés de jours ;
   *     abréviations acceptées (LUN, MAR...). Les x des libellés définissent
   *     les frontières des colonnes (milieu entre deux libellés consécutifs). */
  const colonnes = {}; // jour -> { xCentre }
  for (const l of lignes) {
    const trouves = [];
    for (const m of l.mots) {
      const n = normaliser(m.t);
      const jour = JOURS.find((j) => n === j)
        || Object.keys(ABR_JOURS).find((a) => n === a && ABR_JOURS[a]);
      if (jour || (ABR_JOURS[n] && null)) {
        const jrn = jour || ABR_JOURS[n];
        trouves.push({ jour: jrn, x: (m.x0 + m.x1) / 2 });
      }
    }
    if (trouves.length >= 2) {
      for (const t of trouves) colonnes[t.jour] = { x: t.x };
    }
  }
  const joursTrouves = JOURS.filter((j) => colonnes[j]);
  if (joursTrouves.length < 2) {
    alertes.push('Colonnes des jours non reconnues (LUNDI..DIMANCHE) — vérification manuelle nécessaire.');
  }
  // Bornes de colonne = point médian entre centrés voisins
  const bornes = {};
  for (let i = 0; i < joursTrouves.length; i++) {
    const j = joursTrouves[i];
    const avant = i > 0 ? (colonnes[joursTrouves[i - 1]].x + colonnes[j].x) / 2 : -Infinity;
    const apres = i < joursTrouves.length - 1 ? (colonnes[j].x + colonnes[joursTrouves[i + 1]].x) / 2 : Infinity;
    bornes[j] = { avant, apres };
  }
  const jourParX = (x) => joursTrouves.find((j) => x >= bornes[j].avant && x <= bornes[j].apres) || null;

  /* 4) Employes de la base : 1er passage = employés du service reconnu,
   *     2e passage (secours) = toute la base avec un seuil strict — évite de
   *     perdre une ligne si le service lu par l'OCR est moins fiable que le
   *     nom lui-même, sans associer n'importe qui. */
  const preparerCandidats = (liste) => liste.map((e) => ({ ...e, nomN: normaliser(e.nom) }));
  const candidats = [
    service.id ? preparerCandidats(employesDb.filter((e) => e.service_id === service.id)) : [],
    preparerCandidats(employesDb.filter((e) => !service.id || e.service_id !== service.id)),
  ];

  /* 5) Lignes de données : pour chaque ligne sous les en-têtes de jours,
   *     association employé + collecte des horaires par colonne de jour. */
  const indexLigneJours = lignes.findIndex((l) => {
    const n = normaliser(l.mots.map((m) => m.t).join(' '));
    return JOURS.filter((j) => n.includes(j)).length >= 2;
  });
  const employes = [];

  /* Collecte des horaires / statuts d'une ligne pour chaque colonne de jour.
   * `motsDejaPris` = nombre de mots de début appartenant au nom de l'employé :
   * après l'OCR, la colonne des noms chevauche souvent la 1re colonne de jour,
   * on l'exclut ici pour ne pas polluer les cellules (ni déclencher d'alerte
   * sur le nom lui-même). */
  const collecterJoursPour = (motsLigne, label, motsDejaPris) => {
    const joursCollectes = {};
    const cellules = motsDejaPris > 0 ? motsLigne.slice(motsDejaPris) : motsLigne.slice();
    for (const j of joursTrouves) {
      const bornesJour = { x0: bornes[j].avant === -Infinity ? 0 : bornes[j].avant, x1: bornes[j].apres === Infinity ? 9e9 : bornes[j].apres };
      const mots = cellules.filter((m) => {
        const cx = (m.x0 + m.x1) / 2;
        return cx >= bornesJour.x0 && cx <= bornesJour.x1;
      });
      if (!mots.length) continue;
      const txt = normaliser(mots.map((m) => m.t).join(' '));
      const statut = Object.keys(MOTS_STATUT).find((k) => txt.split(/\s+|[/|]/).includes(k));
      if (statut) {
        joursCollectes[j] = { statut: MOTS_STATUT[statut], creneaux: [] };
        continue;
      }
      // Plage("7:00-15:00", "7:00 15:00", "06:00-14:00 / 18:00-FS") :
      // « FS » -> heure de fin laissée VIDE + alerte, JAMAIS d'heure inventée.
      const res = analyserCelluleHoraire(mots);
      for (const a of res.alertes) alertes.push(`${label} (${j}) : ${a}`);
      if (res.statut !== 'TRAVAIL') {
        joursCollectes[j] = { statut: res.statut, creneaux: [] };
      } else if (res.creneaux.length) {
        joursCollectes[j] = { statut: 'TRAVAIL', creneaux: res.creneaux };
      }
    }
    return joursCollectes;
  };

  for (let i = indexLigneJours + 1; i < lignes.length; i++) {
    const l = lignes[i];
    const texteLigne = normaliser(l.mots.map((m) => m.t).join(' '));
    // Ignorer les lignes d'en-tête répétées, totaux ou marges
    if (JOURS.filter((j) => texteLigne.includes(j)).length >= 2) continue;
    if (/^(TOTAL|TOTAUX|PERSONNE|ENTE?REE?|SORTIE|DUREE|MATIN|APRES? MIDI|SOIR|ANDRO|SHIFT)\b/.test(texteLigne)) continue;
    if (texteLigne.replace(/[^A-Z ]/g, '').trim().length < 2 || l.mots.length < 2) continue;

    // Association employé : préfixe de la ligne (1 à 4 mots) comparé à la base.
    let meilleur = null;
    for (const listeCandidats of candidats) {
      for (const cand of listeCandidats) {
        for (const taille of [1, 2, 3, 4]) {
          const essai = normaliser(l.mots.slice(0, Math.min(taille, l.mots.length)).map((m) => m.t).join(' '));
          const s = scoreNom(essai, cand.nomN);
          const mieux = !meilleur || s > meilleur.score + 1e-9
            || (Math.abs(s - meilleur.score) <= 1e-9 && taille < meilleur.nbMotsNom); // égalité -> nom le plus court
          if (s >= 0.55 && mieux) {
            meilleur = { employe: cand, score: s, nbMotsNom: taille, essai };
          }
        }
      }
      if (meilleur) break; // priorité aux employés du service reconnu
    }

    if (!meilleur) {
      /* Ligne dont le nom n'existe pas dans la base (nom écrit à la main ou
       * OCR raté). RIEN n'est créé : la ligne est proposée avec employe_id
       * null et le RH associe un employé à l'étape de vérification. */
      const debut = normaliser(l.mots[0].t);
      if (debut.replace(/[^A-Z]/g, '').length < 2) continue; // chiffres/légendes : pas un nom
      const nomOcrLigne = l.mots.slice(0, Math.min(3, l.mots.length)).map((m) => m.t).join(' ');
      const joursProvisoires = collecterJoursPour(l.mots, `« ${nomOcrLigne} »`, 0);
      if (!Object.keys(joursProvisoires).length) continue; // rien d'exploitable -> ignoré
      employes.push({
        nom_ocr: nomOcrLigne,
        employe_id: null,
        nom_bd: null,
        matricule: '',
        fonction: '',
        reference_hebdo: 48,
        confiance: 0,
        jours: joursProvisoires,
      });
      alertes.push(`Nom « ${nomOcrLigne} » non trouvé dans la base — employé à associer manuellement (aucun employé n'est créé).`);
      continue;
    }

    const nomOcrBrut = l.mots.slice(0, meilleur.nbMotsNom).map((m) => m.t).join(' ');
    const ligne = {
      nom_ocr: nomOcrBrut,
      employe_id: meilleur.employe.id_employe,
      nom_bd: meilleur.employe.nom,
      matricule: meilleur.employe.matricule || '',
      fonction: meilleur.employe.fonction || '',
      reference_hebdo: Number(meilleur.employe.reference_hebdo || 44),
      confiance: Number(meilleur.score.toFixed(2)),
      jours: {},
    };
    ligne.jours = collecterJoursPour(l.mots, meilleur.employe.nom, meilleur.nbMotsNom);
    if (Object.keys(ligne.jours).length) employes.push(ligne);
  }

  if (!employes.length) alertes.push('Aucun employé reconnu — vérifiez la qualité du scan et les noms manuscrits.');

  /* Dates réelles si la semaine est connue (aide la vérification RH) */
  let date_debut = null;
  if (semaine.numero && semaine.annee) {
    try { date_debut = lundiDeSemaineIso(semaine.annee, semaine.numero); } catch { /* semaine hors bornes */ }
    if (date_debut) {
      for (const e of employes) {
        for (const j of Object.keys(e.jours)) {
          const i = JOURS.indexOf(j);
          if (i >= 0) {
            const d = new Date(new Date(date_debut + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10);
            e.jours[d] = e.jours[j];
            delete e.jours[j];
          }
        }
      }
    }
  }

  return {
    service,
    semaine: { ...semaine, date_debut },
    colonnes_jours: joursTrouves,
    employes,
    alertes: [...new Set(alertes)].slice(0, 40),
  };
}

module.exports = { analyserPlanning, lundiDeSemaineIso, scoreNom, normaliser, heureDe };
