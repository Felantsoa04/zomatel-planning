#!/usr/bin/env node
'use strict';

/* ============================================================================
 * ZOMATEL PLANNING — Import Excel → MariaDB (services + employés)
 * ----------------------------------------------------------------------------
 * Usage :
 *   npm run import:excel                 → import réel (transaction : tout ou rien)
 *   npm run import:excel -- --dry-run    → simulation : aucune écriture
 *
 * Format attendu (emploi du temps hebdomadaire Zomatel) :
 *   - 1 feuille PAR SERVICE : le nom de la feuille = nom du service ;
 *   - chaque feuille contient des blocs journaliers (LUNDI..DIMANCHE) répétés ;
 *   - 1 ligne par employé : [matricule ou libellé (Stagiaire/Extra) | Nom | horaires…].
 *   (Un format "table" à en-têtes Nom/Matricule/Service/Statut est aussi reconnu.)
 *
 * Garanties :
 *   - Aucune donnée existante n'est supprimée ni réinitialisée ;
 *   - Employé existant → conservé (aucun doublon), matricule provisoire
 *     "démo" éventuellement enrichi (CONFIG.mettreAJourMatriculeDemo) ;
 *   - Service existant → réutilisé (comparaison sans casse ni accents) ;
 *   - Conflit de matricule DANS le fichier → matricule rejeté (signalé),
 *     la personne reste importée sans matricule (colonne nullable) ;
 *   - Lignes RECAP/TOTAL et doublons journaliers ignorés ;
 *   - Les employés importés NE reçoivent AUCUN compte utilisateur
 *     (la table `utilisateur` n'est jamais touchée) ;
 *   - Connexion : variables d'environnement du backend (backend/.env),
 *     via la configuration existante src/config/db.js — aucun mot de passe ici.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

/* --------------------------------------------------------------- CONFIG -- */
const CONFIG = {
  // Dossiers parcourus pour trouver le(s) fichier(s) Excel (par ordre).
  dossiersRecherche: [
    path.resolve(__dirname, '..', '..'),                       // racine du projet
    path.resolve(__dirname, '..', '..', 'document utiliise'),  // dossier des documents
    path.resolve(__dirname, '..'),                             // dossier backend
  ],
  // Fichier Excel configuré : si plusieurs .xlsx sont trouvés, celui-ci est
  // sélectionné (jamais de fichier pris au hasard).
  fichierExcel: 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx',

  // Feuilles ignorées (feuilles vides / génériques générées par Excel).
  feuillesIgnorees: [/^feuille\s*\d*$/i],

  // Format "grille" (emploi du temps) : colonnes positionnelles.
  colMatricule: 0, // colonne A : matricule ou libellé de statut (Stagiaire/Extra)
  colNom: 1,       // colonne B : nom de la personne (en-tête "Personne")
  libelleColonneNom: 'personne',

  // Lignes qui ne sont PAS des employés (sections de totaux, etc.).
  labelsNonEmploye: ['recap', 'total', 'total general', 'cumul', 'controle'],

  // Correspondance libellés Excel → valeurs ENUM réelles de `employe.statut`
  // ('TITULAIRE','STAGIAIRE'). Toute autre valeur est signalée en erreur.
  correspondanceStatut: {
    stagiaire: 'STAGIAIRE',
    stag: 'STAGIAIRE',
    stage: 'STAGIAIRE',
    titulaire: 'TITULAIRE',
    titul: 'TITULAIRE',
    extra: 'TITULAIRE',
    extras: 'TITULAIRE',
  },
  statutParDefaut: 'TITULAIRE',

  // Contenus de la colonne matricule qui ne sont PAS des matricules.
  libellesNonMatricule: ['-', 'x'],

  // Matricules "démo" déjà en base (données de test EMP### / TEST…).
  motifMatriculeDemo: /^(EMP\d+|TEST\w*)$/i,
  // Enrichir le matricule provisoire d'un employé existant avec le matricule
  // réel trouvé dans Excel ? (seul champ de mise à jour autorisé)
  mettreAJourMatriculeDemo: true,
  // Retrouver un employé existant par son NOM quand le matricule en base est
  // provisoire (démo) ou absent — évite les doublons de personnes.
  matcherParNom: true,

  // Heures de référence des NOUVEAUX employés (règle métier du projet :
  // Administration 44 h/semaine, autres services 48 h/semaine).
  referenceHebdo: {
    defaut: 48,
    regles: [{ motif: /admin/i, valeur: 44 }],
  },
};

/* ------------------------------------------------------------- UTILITAIRES */
function normaliser(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function referenceHebdoPour(nomService) {
  for (const r of CONFIG.referenceHebdo.regles) {
    if (r.motif.test(nomService)) return r.valeur;
  }
  return CONFIG.referenceHebdo.defaut;
}

function estFeuilleIgnoree(nom) {
  return CONFIG.feuillesIgnorees.some((re) => re.test(nom));
}

function estLabelNonEmploye(nom) {
  const n = normaliser(nom);
  if (!n) return true;
  // Lignes de totaux numériques ("12:00", "40:00"…) : pas un nom.
  if (!/[a-z]/.test(n)) return true;
  return CONFIG.labelsNonEmploye.some((l) => n === l || n.startsWith(l + ' ') || n.startsWith(l + ':'));
}

/* ------------------------- SIMILARITE DE NOMS ------------------------- *
 * Deux noms sont "similaires" s'ils désignent probablement la même
 * personne : troncature (AUGUST ⊂ AUGUSTE), faute de frappe (VANULIE /
 * VANILIE — distance d'édition ≤ 2) ou accentuation/espaces différents.
 * --------------------------------------------------------------------- */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

function nomsSimilaires(nomA, nomB) {
  const a = normaliser(nomA);
  const b = normaliser(nomB);
  if (!a || !b) return false;
  if (a === b) return true;
  // Troncature (récapitulatifs Excel) : le plus court est préfixe du plus long.
  const court = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (court.length >= 4 && long.startsWith(court)) return true;
  // Faute de frappe : distance faible pour des noms de longueur proche.
  if (Math.abs(a.length - b.length) <= 2) {
    const seuil = Math.min(a.length, b.length) >= 6 ? 2 : 1;
    if (levenshtein(a, b) <= seuil) return true;
  }
  return false;
}

/* -------------------------------------------------- 1. TROUVER LE FICHIER */
function trouverFichierExcel() {
  const trouves = new Map(); // nom → chemin
  for (const dir of CONFIG.dossiersRecherche) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.(xlsx|xls)$/i.test(f) && !f.startsWith('~$')) {
        if (!trouves.has(f)) trouves.set(f, path.join(dir, f));
      }
    }
  }
  const noms = [...trouves.keys()];
  if (noms.length === 0) {
    console.error('\nERREUR : aucun fichier Excel (.xlsx/.xls) trouve dans :');
    CONFIG.dossiersRecherche.forEach((d) => console.error('  - ' + d));
    process.exit(1);
  }
  if (noms.length === 1) {
    return { fichier: trouves.get(noms[0]), liste: noms };
  }
  // Plusieurs fichiers : sélectionner le fichier CONFIGURÉ (jamais au hasard).
  const cible = noms.find((n) => normaliser(n) === normaliser(CONFIG.fichierExcel));
  console.log('\nPlusieurs fichiers Excel trouves :');
  noms.forEach((n) =>
    console.log('  - ' + n + (n === cible ? '   <-- selectionne (fichier configure)' : ''))
  );
  if (!cible) {
    console.error(
      `\nERREUR : le fichier configure dans CONFIG.fichierExcel ("${CONFIG.fichierExcel}") ` +
        'ne figure pas parmi les fichiers trouves. Corrigez la configuration.'
    );
    process.exit(1);
  }
  return { fichier: trouves.get(cible), liste: noms };
}

/* ------------------------------------- 2. LECTURE + ANALYSE DU CLASSEUR */
function lireFeuille(wb, nom) {
  return XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: false, defval: '' });
}

// Format "table" : une ligne d'en-têtes Nom/Matricule/Service/Statut.
function detecterEntetesTable(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(normaliser);
    const iNom = cells.findIndex((c) => c === 'nom' || c === 'nom et prenom' || c === 'employe');
    const iMat = cells.findIndex((c) => c === 'matricule');
    const iServ = cells.findIndex((c) => c === 'service');
    const iStat = cells.findIndex((c) => c === 'statut' || c === 'status');
    if (iNom >= 0 && (iMat >= 0 || iServ >= 0)) {
      return { ligne: i, colNom: iNom, colMat: iMat, colServ: iServ, colStat: iStat };
    }
  }
  return null;
}

// Nom du service d'une feuille : nom de la feuille ; si générique (FeuilleNN),
// retomber sur le titre interne "EMPLOI DU TEMPS ... WEEK NN".
function nomServiceDeFeuille(nomFeuille, rows) {
  if (!/^feuille/i.test(nomFeuille.trim())) return nomFeuille.trim();
  for (const r of rows.slice(0, 6)) {
    for (const c of r) {
      const s = String(c).trim();
      if (/^emploi du temps/i.test(s)) {
        return s
          .replace(/^emploi du temps\s*/i, '')
          .replace(/\s*week\s*\d+.*$/i, '')
          .trim();
      }
    }
  }
  return nomFeuille.trim();
}

function analyserClasseur(fichier) {
  const wb = XLSX.readFile(fichier);
  console.log('\n' + '='.repeat(60));
  console.log('ANALYSE DU FICHIER EXCEL');
  console.log('='.repeat(60));
  console.log('Fichier : ' + fichier);
  console.log('Feuilles : ' + wb.SheetNames.length);

  const servicesExcel = new Map(); // nomNormalise → { nom, feuille }
  const employes = []; // { feuille, ligne, matricule, nom, statutLabel, serviceNom }
  const infosFeuilles = [];

  for (const nomFeuille of wb.SheetNames) {
    const rows = lireFeuille(wb, nomFeuille);
    const nonVides = rows.filter((r) => r.some((c) => String(c).trim() !== '')).length;
    infosFeuilles.push({ nom: nomFeuille, lignes: nonVides });

    if (estFeuilleIgnoree(nomFeuille) || nonVides === 0) continue;

    const serviceNom = nomServiceDeFeuille(nomFeuille, rows);
    const cleService = normaliser(serviceNom);
    if (!servicesExcel.has(cleService)) {
      servicesExcel.set(cleService, { nom: serviceNom, feuille: nomFeuille });
    }

    const entetes = detecterEntetesTable(rows);
    if (entetes) {
      // ----- FORMAT TABLE -----
      if (nonVides <= 1) continue;
      const colonnes = rows[entetes.ligne]
        .map((c) => String(c).trim())
        .filter(Boolean)
        .join(', ');
      infosFeuilles[infosFeuilles.length - 1].colonnes = colonnes;
      for (let i = entetes.ligne + 1; i < rows.length; i++) {
        const r = rows[i];
        const nom = String(r[entetes.colNom] || '').trim();
        if (!nom || estLabelNonEmploye(nom)) continue;
        employes.push({
          feuille: nomFeuille,
          ligne: i + 1,
          matricule: entetes.colMat >= 0 ? String(r[entetes.colMat] || '').trim() : '',
          nom,
          statutLabel: entetes.colStat >= 0 ? String(r[entetes.colStat] || '').trim() : '',
          serviceNom: entetes.colServ >= 0 ? String(r[entetes.colServ] || '').trim() : serviceNom,
        });
      }
    } else {
      // ----- FORMAT GRILLE (emploi du temps Zomatel) -----
      infosFeuilles[infosFeuilles.length - 1].colonnes =
        `grille positionnelle : col ${CONFIG.colMatricule} = matricule/statut, col ${CONFIG.colNom} = personne`;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let c0 = String(r[CONFIG.colMatricule] || '').trim();
        let c1 = String(r[CONFIG.colNom] || '').trim();
        const c2 = String(r[(CONFIG.colNom || 1) + 1] || '').trim();
        // Lignes de récapitulatif décalées d'une colonne (matricule en col 1,
        // nom en col 2, total horaire en col 3) : on les lit correctement au
        // lieu de créer des employés fantômes nommés "P482".
        const nonVides = r.filter((c) => String(c).trim() !== '').length;
        if (
          !c0 &&
          c1 &&
          c2 &&
          nonVides <= 5 &&
          (/^[pf]\d{2,4}$/i.test(c1) || c1 === '-') &&
          /[a-z]{2,}/i.test(c2) &&
          !/^\d{1,3}:\d{2}$/.test(c2)
        ) {
          c0 = c1 === '-' ? '' : c1;
          c1 = c2;
        }
        const nom = c1;
        if (!nom || normaliser(nom) === CONFIG.libelleColonneNom) continue; // vides + en-têtes
        if (estLabelNonEmploye(nom)) continue; // RECAP / TOTAL / lignes d'heures
        employes.push({
          feuille: nomFeuille,
          ligne: i + 1,
          matricule: c0,
          nom,
          statutLabel: '',
          serviceNom,
        });
      }
    }
  }

  console.log('\nFeuilles analysees :');
  infosFeuilles.forEach((f) => {
    console.log(
      `  - ${f.nom.padEnd(30)} ${String(f.lignes).padStart(3)} ligne(s)   colonnes : ${f.colonnes || '-'}`
    );
  });

  return { servicesExcel, employes };
}

/* --------------------------------- 3. NETTOYAGE + VALIDATION DES DONNEES */
function validerEmployes(brutes) {
  const valides = [];
  const erreurs = []; // { feuille, ligne, nom, champ, valeur, raison }

  for (const e of brutes) {
    const base = { feuille: e.feuille, ligne: e.ligne, nom: e.nom };

    // --- Matricule : libellé de statut, marqueur ou vrai matricule ?
    let matricule = e.matricule;
    let statutLabel = e.statutLabel;
    const matNorm = normaliser(matricule);
    if (matNorm && CONFIG.libellesNonMatricule.includes(matNorm)) {
      matricule = '';
    } else if (matNorm && Object.keys(CONFIG.correspondanceStatut).includes(matNorm)) {
      // "Stagiaire"/"Extra"/"Stag"… dans la colonne matricule = statut.
      statutLabel = statutLabel || matNorm;
      matricule = '';
    }

    // --- Nom obligatoire
    if (!normaliser(e.nom)) {
      erreurs.push({ ...base, champ: 'Nom', valeur: e.nom, raison: 'champ obligatoire vide' });
      continue;
    }

    // --- Statut → ENUM MariaDB
    let statut = CONFIG.statutParDefaut;
    if (statutLabel) {
      const cle = normaliser(statutLabel);
      if (Object.keys(CONFIG.correspondanceStatut).includes(cle)) {
        statut = CONFIG.correspondanceStatut[cle];
      } else {
        erreurs.push({
          ...base,
          champ: 'Statut',
          valeur: statutLabel,
          raison: `statut inconnu (valeurs autorisees : ${Object.values(CONFIG.correspondanceStatut).join(', ')})`,
        });
        continue;
      }
    }

    if (!e.serviceNom || !normaliser(e.serviceNom)) {
      erreurs.push({ ...base, champ: 'Service', valeur: e.serviceNom, raison: 'service inexistant ou vide' });
      continue;
    }

    valides.push({
      feuille: e.feuille,
      ligne: e.ligne,
      matricule: matricule.trim(),
      nom: e.nom.replace(/\s+/g, ' ').trim(),
      statut,
      serviceNom: e.serviceNom.replace(/\s+/g, ' ').trim(),
    });
  }
  return { valides, erreurs };
}

/* ------------------------------------------- 4. DEDOUBLONNAGE FICHIER -- *
 * Règles (chaque jour de la semaine répète les mêmes employés) :
 *  - 1 matricule = 1 personne. Conflit de matricule entre 2 noms
 *    (erreur du fichier) → le matricule est rejeté et SIGNALÉ, la personne
 *    reste importée sans matricule (colonne nullable en base) ;
 *  - même nom + même service = même personne (matricule enrichi si trouvé après coup) ;
 *  - même nom + services différents = polyvalence : le PREMIER service gagne,
 *    les autres occurrences sont signalées en avertissement ;
 *  - 2 matricules différents pour un même nom = 2 personnes homonymes distinctes.
 * ----------------------------------------------------------------------- */
function dedupliquerEmployes(liste) {
  const parMatricule = new Map();  // matNorm → rec
  const parNomService = new Map(); // nomNorm|servNorm → rec
  const parNom = new Map();        // nomNorm → rec (première personne vue avec ce nom)
  const finales = [];
  const avertissements = [];
  const erreurs = [];

  for (const e of liste) {
    const nomNorm = normaliser(e.nom);
    const servNorm = normaliser(e.serviceNom);
    const matNorm0 = normaliser(e.matricule);

    // 1) Conflit de matricule (2 noms différents pour le même matricule).
    let matricule = e.matricule;
    if (matNorm0) {
      const occupant = parMatricule.get(matNorm0);
      if (occupant) {
        if (nomsSimilaires(occupant.nom, e.nom)) {
          // Même personne (RECAP tronqué / faute de frappe) : on fusionne.
          const recPrec = parNomService.get(normaliser(occupant.nom) + '|' + normaliser(occupant.serviceNom));
          if (recPrec) {
            recPrec.occurrences++;
            if (normaliser(occupant.nom) !== normaliser(e.nom)) {
              avertissements.push(
                `"${e.nom}" (feuille ${e.feuille}, ligne ${e.ligne}) fusionne avec "${occupant.nom}" (${e.matricule}) : nom similaire pour le même matricule`
              );
            }
            continue;
          }
        }
        // Vraie erreur du fichier : matricule rejeté, personne conservée.
        erreurs.push({
          feuille: e.feuille,
          ligne: e.ligne,
          nom: e.nom,
          champ: 'Matricule',
          valeur: e.matricule,
          raison: `matricule deja utilise par "${occupant.nom}" (feuille ${occupant.feuille}) — ligne importee SANS matricule`,
        });
        matricule = '';
      }
    }
    const matNorm = normaliser(matricule);

    // 2) Même nom + même service → déjà vu.
    const cleNS = nomNorm + '|' + servNorm;
    const rec = parNomService.get(cleNS);
    if (rec) {
      if (!rec.matricule && matNorm) {
        // Le matricule n'apparaissait que dans certains blocs journaliers.
        rec.matricule = matricule;
        parMatricule.set(matNorm, rec);
        avertissements.push(
          `"${e.nom}" (${e.serviceNom}) : matricule ${matricule} affecte depuis la feuille ${e.feuille} ligne ${e.ligne}`
        );
      } else if (rec.matricule && matNorm && normaliser(rec.matricule) !== matNorm) {
        erreurs.push({
          feuille: e.feuille,
          ligne: e.ligne,
          nom: e.nom,
          champ: 'Matricule',
          valeur: e.matricule,
          raison: `deux matricules differents pour la meme personne (${rec.matricule} conserve)`,
        });
      }
      rec.occurrences++;
      continue;
    }

    // 3) Même nom, autre service → polyvalence : premier service gagne.
    const autre = parNom.get(nomNorm);
    if (autre) {
      const memeMat = !matNorm || !normaliser(autre.matricule) || normaliser(autre.matricule) === matNorm;
      if (memeMat) {
        avertissements.push(
          `"${e.nom}" apparait dans 2 services : "${autre.serviceNom}" (conserve) et "${e.serviceNom}" (feuille ${e.feuille})`
        );
        continue;
      }
      // Matricules différents → 2 personnes homonymes distinctes : on importe.
    }

    // 4) Nouvelle personne.
    const nouveau = { ...e, matricule, occurrences: 1 };
    parNomService.set(cleNS, nouveau);
    if (!parNom.has(nomNorm)) parNom.set(nomNorm, nouveau);
    if (matNorm) parMatricule.set(matNorm, nouveau);
    finales.push(nouveau);
  }
  return { finales, avertissements, erreurs };
}

/* -------------------------------------------------- 5. ACCES MARIADB */
async function chargerReferentiels(conn) {
  const [services] = await conn.query('SELECT id_service, nom_service FROM service');
  const [employes] = await conn.query(
    'SELECT id_employe, matricule, nom, service_id FROM employe'
  );
  const servicesParNom = new Map();
  for (const s of services) servicesParNom.set(normaliser(s.nom_service), s);

  const employesParMatricule = new Map();
  const employesParNom = new Map();
  for (const emp of employes) {
    if (emp.matricule) employesParMatricule.set(normaliser(emp.matricule), emp);
    const cle = normaliser(emp.nom);
    if (!employesParNom.has(cle)) employesParNom.set(cle, []);
    employesParNom.get(cle).push(emp);
  }
  return { servicesParNom, employesParMatricule, employesParNom };
}

function estMatriculeDemo(m) {
  return !m || CONFIG.motifMatriculeDemo.test(m);
}

/* ------------------------------------------------------- 6. IMPORT */
async function importer(dryRun) {
  const { fichier, liste } = trouverFichierExcel();
  if (liste.length > 1) {
    console.log(`(${liste.length} fichiers Excel presents, fichier configure selectionne)`);
  }

  const { servicesExcel, employes } = analyserClasseur(fichier);
  const { valides, erreurs: erreursValidation } = validerEmployes(employes);
  const { finales, avertissements, erreurs: erreursDedup } = dedupliquerEmployes(valides);
  const erreurs = [...erreursValidation, ...erreursDedup];

  // Connexion : réutilise la configuration existante du backend (pool db.js).
  const pool = require('../src/config/db');
  const conn = await pool.getConnection();
  const stats = {
    critique: false,
    services: { trouves: servicesExcel.size, existants: 0, nouveaux: 0, erreurs: 0 },
    employes: {
      lignes: finales.reduce((a, e) => a + e.occurrences, 0),
      uniques: finales.length,
      existants: 0,
      nouveaux: 0,
      misAJour: 0,
      ignores: 0,
      erreurs: 0,
    },
  };

  try {
    if (!dryRun) await conn.beginTransaction();
    const ref = await chargerReferentiels(conn);
    const resServices = []; // [cleNormalisee, id_service|null]

    // ---------- SERVICES ----------
    for (const [cle, srv] of servicesExcel) {
      const existant = ref.servicesParNom.get(cle);
      if (existant) {
        resServices.push([cle, existant.id_service]);
        stats.services.existants++;
        console.log(`  SERVICE existant  : ${srv.nom}  (id ${existant.id_service})`);
      } else if (dryRun) {
        resServices.push([cle, null]);
        stats.services.nouveaux++;
        console.log(`  SERVICE a creer   : ${srv.nom}   [dry-run : non cree]`);
      } else {
        try {
          const [r] = await conn.query(
            'INSERT INTO service (nom_service, description) VALUES (?, ?)',
            [srv.nom, `Importe depuis Excel — feuille "${srv.feuille}"`]
          );
          resServices.push([cle, r.insertId]);
          ref.servicesParNom.set(cle, { id_service: r.insertId, nom_service: srv.nom });
          stats.services.nouveaux++;
          console.log(`  SERVICE cree      : ${srv.nom}  (id ${r.insertId})`);
        } catch (err) {
          stats.services.erreurs++;
          erreurs.push({
            feuille: srv.feuille,
            ligne: '-',
            nom: srv.nom,
            champ: 'Service',
            valeur: srv.nom,
            raison: err.message,
          });
          console.error(`  SERVICE EN ERREUR : ${srv.nom} → ${err.message}`);
        }
      }
    }

    // ---------- EMPLOYES ----------
    for (const e of finales) {
      const trouve = resServices.find(([cle]) => cle === normaliser(e.serviceNom));
      const idService = trouve ? trouve[1] : undefined;

      if (idService === undefined) {
        stats.employes.ignores++;
        erreurs.push({
          feuille: e.feuille,
          ligne: e.ligne,
          nom: e.nom,
          champ: 'Service',
          valeur: e.serviceNom,
          raison: 'service inexistant (feuille non reconnue)',
        });
        continue;
      }
      if (idService == null) {
        // Dry-run : service pas encore créé — on affiche l'intention.
        afficherEmploye(e, '(nouveau service)', true);
        stats.employes.nouveaux++;
        continue;
      }

      const matNorm = normaliser(e.matricule);
      let existant = matNorm ? ref.employesParMatricule.get(matNorm) : null;
      let mode = existant ? 'matricule' : null;

      if (!existant && CONFIG.matcherParNom) {
        const cands = ref.employesParNom.get(normaliser(e.nom)) || [];
        if (!matNorm) {
          // Sans matricule : nom + service.
          existant = cands.find((x) => x.service_id === idService) || null;
          if (existant) mode = 'nom+service';
        } else {
          // Matricule Excel ≠ base : fusion SI le matricule en base est provisoire (démo).
          existant = cands.find((x) => estMatriculeDemo(x.matricule)) || null;
          if (existant) mode = 'nom (matricule demo)';
        }
      }

      if (existant) {
        stats.employes.existants++;
        // Seule mise à jour autorisée : matricule provisoire → matricule réel.
        if (
          mode !== 'matricule' &&
          CONFIG.mettreAJourMatriculeDemo &&
          estMatriculeDemo(existant.matricule) &&
          matNorm &&
          !ref.employesParMatricule.has(matNorm)
        ) {
          stats.employes.misAJour++;
          if (!dryRun) {
            await conn.query('UPDATE employe SET matricule = ? WHERE id_employe = ?', [
              e.matricule,
              existant.id_employe,
            ]);
          }
          console.log(
            `  EMPLOYE existant  : ${existant.nom} — matricule mis a jour ${existant.matricule || '(vide)'} → ${e.matricule}${dryRun ? '  [dry-run]' : ''}`
          );
        } else {
          console.log(
            `  EMPLOYE existant  : ${existant.nom} (id ${existant.id_employe}, ${mode}) — conserve sans modification`
          );
        }
        if (matNorm) ref.employesParMatricule.set(matNorm, existant);
        continue;
      }

      // Nouvel employé.
      stats.employes.nouveaux++;
      afficherEmploye(e, idService, dryRun);
      if (!dryRun) {
        try {
          const rh = referenceHebdoPour(e.serviceNom);
          const [r] = await conn.query(
            'INSERT INTO employe (matricule, nom, statut, service_id, reference_hebdo, actif) VALUES (?, ?, ?, ?, ?, 1)',
            [e.matricule || null, e.nom, e.statut, idService, rh]
          );
          const rec = {
            id_employe: r.insertId,
            matricule: e.matricule || null,
            nom: e.nom,
            service_id: idService,
          };
          if (matNorm) ref.employesParMatricule.set(matNorm, rec);
          const cle = normaliser(e.nom);
          if (!ref.employesParNom.has(cle)) ref.employesParNom.set(cle, []);
          ref.employesParNom.get(cle).push(rec);
        } catch (err) {
          // Erreur isolée (ex. contrainte) : signalée, l'import continue.
          stats.employes.erreurs++;
          stats.employes.nouveaux--;
          erreurs.push({
            feuille: e.feuille,
            ligne: e.ligne,
            nom: e.nom,
            champ: 'Employe',
            valeur: e.matricule || e.nom,
            raison: err.message,
          });
          console.error(`  EMPLOYE EN ERREUR : ${e.nom} → ${err.message}`);
        }
      }
    }

    // ---------- VALIDATION FINALE + COMMIT ----------
    if (!dryRun) {
      const [orph] = await conn.query(
        'SELECT COUNT(*) c FROM employe e LEFT JOIN service s ON e.service_id = s.id_service WHERE s.id_service IS NULL'
      );
      if (orph[0].c > 0) {
        throw new Error('Intégrité référentielle compromise (employé sans service) — annulation.');
      }
      await conn.commit();
    }
  } catch (err) {
    if (!dryRun) {
      try {
        await conn.rollback();
      } catch (_) {
        /* connexion déjà perdue */
      }
    }
    console.error('\nERREUR CRITIQUE — import annule (ROLLBACK) : ' + err.message);
    stats.critique = true;
  } finally {
    conn.release();
    await pool.end();
  }

  afficherRapport(fichier, servicesExcel, stats, avertissements, erreurs, dryRun);
  process.exit(stats.critique ? 1 : 0);
}

function afficherEmploye(e, idService, dryRun) {
  console.log(
    `  EMPLOYE a creer   : ${e.nom.padEnd(16)} ${e.matricule || '(sans matricule)'}  ${e.statut.padEnd(10)} service ${idService}  (feuille ${e.feuille}, ligne ${e.ligne})${dryRun ? '  [dry-run]' : ''}`
  );
}

/* ------------------------------------------------------- 7. RAPPORT */
function grouperTextes(liste) {
  const m = new Map();
  for (const t of liste) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()];
}

function grouperErreurs(liste) {
  const m = new Map();
  for (const er of liste) {
    const cle = `${er.feuille}|${er.nom}|${er.champ}|${er.valeur}|${er.raison}`;
    if (!m.has(cle)) m.set(cle, { ...er, fois: 0 });
    m.get(cle).fois++;
  }
  return [...m.values()];
}

function afficherRapport(fichier, servicesExcel, stats, avertissements, erreurs, dryRun) {
  const s = stats.services;
  const e = stats.employes;
  console.log('\n' + '='.repeat(60));
  console.log('IMPORT EXCEL → MARIADB' + (dryRun ? "   (MODE DRY-RUN — RIEN N'A ETE MODIFIE)" : ''));
  console.log('='.repeat(60));
  console.log('Fichier : ' + fichier);
  console.log('Feuilles analysees : ' + servicesExcel.size + ' feuille(s) service');

  console.log('\nSERVICES');
  console.log('  * trouves         : ' + s.trouves);
  console.log('  * deja existants  : ' + s.existants);
  console.log('  * nouveaux        : ' + s.nouveaux);
  console.log('  * erreurs         : ' + s.erreurs);

  console.log('\nEMPLOYES');
  console.log('  * lignes Excel    : ' + e.lignes);
  console.log('  * uniques         : ' + e.uniques);
  console.log('  * deja existants  : ' + e.existants);
  console.log('  * nouveaux        : ' + e.nouveaux);
  console.log('  * mis a jour      : ' + e.misAJour);
  console.log('  * ignores         : ' + e.ignores);
  console.log('  * erreurs         : ' + e.erreurs);

  const avertGroupes = grouperTextes(avertissements);
  console.log(`\nDUPLICATIONS / AVERTISSEMENTS (${avertGroupes.length} types) :`);
  avertGroupes.forEach(([t, n]) => console.log(`  ! ${t}${n > 1 ? `   (x${n})` : ''}`));

  const errGroupes = grouperErreurs(erreurs);
  console.log(`\nERREURS (${erreurs.length} occurrences, ${errGroupes.length} distinctes) :`);
  errGroupes.slice(0, 60).forEach((er) => {
    console.log(
      `  x feuille "${er.feuille}" ligne ${er.ligne} — ${er.nom || '(sans nom)'} — champ ${er.champ} = "${er.valeur}" : ${er.raison}${er.fois > 1 ? `   (x${er.fois})` : ''}`
    );
  });
  if (errGroupes.length > 60) console.log(`  x ... +${errGroupes.length - 60} autres types`);

  console.log('\n' + '='.repeat(60));
  console.log(dryRun ? 'DRY-RUN TERMINE — base MariaDB intacte' : 'IMPORT TERMINE');
  console.log('='.repeat(60));
}

/* ---------------------------------------------------------- MAIN */
const dryRun = process.argv.includes('--dry-run');
importer(dryRun).catch((err) => {
  console.error('ERREUR FATALE : ' + err.message);
  process.exit(1);
});
