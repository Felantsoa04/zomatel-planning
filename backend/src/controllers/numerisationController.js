/* Numérisation des plannings papier — contrôleur.
 * Parcours demandé : import multi-fichiers (JPG/JPEG/PNG ; PDF refusé
 * proprement tant que la rasterisation n'est pas activée) -> OCR en tâche de
 * fond PAR FICHIER (une erreur sur un document n'empêche jamais les autres)
 * -> vérification/correction par la RH -> confirmation en planning
 * BROUILLON (circuit existant : BROUILLON -> SOUMIS -> VALIDE -> export).
 *
 * SÉCURITÉ :
 *   - routes réservées au rôle RH + permission numerisation.use ;
 *   - fichiers stockés sous backend/uploads/numerisation (NON servis en
 *     statique : app.js bloque "/uploads/numerisation" avant express.static ;
 *     l'accès passe par GET /:id/fichier, authentifié) ;
 *   - chaque RH ne voit que SES documents (les admins revoient tout) ;
 *   - requêtes SQL paramétrées exclusivement (aucune concaténation).
 *
 * RÈGLES MÉTIER (identiques au reste du projet) :
 *   - rien n'est inventé par l'OCR : les données douteuses sont des alertes ;
 *   - aucun employé n'est créé automatiquement ;
 *   - pas de doublon : un planning déjà existant (service + semaine) est
 *     refusé avec 409, jamais écrasé ;
 *   - un créneau incomplete (ex. "18:00 - FS" sans fin) bloque la
 *     confirmation avec un message précis — la RH complète à la main ;
 *   - les règles de calcul des heures restent celles de la base
 *     (employe.reference_hebdo : 44 h Administration, 48 h ailleurs).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../config/db');
const { analyserPlanning, lundiDeSemaineIso } = require('../services/ocrPlannings');

/* ---------------- Stockage + validation des fichiers ---------------- */
const DOSSIER_SCANS = path.resolve(__dirname, '..', '..', 'uploads', 'numerisation');
const EXTENSIONS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const TAILLE_MAX = 12 * 1024 * 1024; // 12 Mo par document
const FICHIERS_MAX = 20;

if (!fs.existsSync(DOSSIER_SCANS)) fs.mkdirSync(DOSSIER_SCANS, { recursive: true });

const stockage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOSSIER_SCANS),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `scan-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

/* Multer : filtre par EXTENSION réelle (le mime déclaré par le navigateur
 * n'est pas une preuve) + contrôles de taille/nombre faits par multer. */
const relayerFichier = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!EXTENSIONS[ext]) {
    return cb(null, false); // accepté côté HTTP, rejeté fichier par fichier plus bas
  }
  cb(null, true);
};
const upload = multer({
  storage: stockage,
  fileFilter: relayerFichier,
  limits: { fileSize: TAILLE_MAX, files: FICHIERS_MAX },
});

/* ---------------- File d'attente OCR (1 document à la fois) ---------------- */
/* Les scans papier sont lourds : traiter séquentiellement évite les pics de
 * mémoire (worker tesseract + sharp) et garde la progression lisible. */
let fileAttente = Promise.resolve();
function enFileAttente(tache) {
  fileAttente = fileAttente.then(tache).catch((err) => {
    console.error('[numerisation] Erreur OCR non gérée :', err.message);
  });
  return fileAttente;
}

/* Traitement OCR d'un scan : progression en base (polling front) puis
 * analyse du tableau. AUCUNE écriture de planning ici. */
async function traiterScan(id_scan, chemin, onProgress) {
  await pool.query(
    `UPDATE planning_scan SET statut = 'OCR_EN_COURS', progression = 0, message_erreur = NULL WHERE id_scan = ?`,
    [id_scan]
  );
  const progres = (f) => {
    const p = Math.min(99, Math.round(f * 99));
    pool.query('UPDATE planning_scan SET progression = ? WHERE id_scan = ?', [p, id_scan]).catch(() => {});
  };

  // Type non encore pris en charge (PDF) : message explicite, jamais "erreur"
  const ext = path.extname(chemin).toLowerCase();
  if (!EXTENSIONS[ext]) {
    await pool.query(
      `UPDATE planning_scan SET statut = 'ERREUR', progression = 100, message_erreur = ?,
       date_ocr = CURRENT_TIMESTAMP WHERE id_scan = ?`,
      ['Format non pris en charge pour le moment : convertissez le PDF en JPG/PNG, ou importez directement la photo du planning.', id_scan]
    );
    return;
  }

  try {
    const [services] = await pool.query('SELECT id_service, nom_service FROM service');
    const [employes] = await pool.query(
      `SELECT id_employe, nom, matricule, fonction, service_id, reference_hebdo
       FROM employe WHERE actif = 1`
    );
    const donnees = await analyserPlanning(chemin, services, employes, progres);
    await pool.query(
      `UPDATE planning_scan
       SET statut = 'OCR_FAITE', progression = 100, donnees_ocr = ?, date_ocr = CURRENT_TIMESTAMP,
           service_id = COALESCE(?, service_id),
           numero_semaine = COALESCE(?, numero_semaine),
           annee = COALESCE(?, annee),
           date_debut_semaine = COALESCE(?, date_debut_semaine)
       WHERE id_scan = ?`,
      [
        JSON.stringify(donnees),
        donnees.service.id || null,
        donnees.semaine.numero || null,
        donnees.semaine.annee || null,
        donnees.semaine.date_debut || null,
        id_scan,
      ]
    );
  } catch (err) {
    await pool.query(
      `UPDATE planning_scan SET statut = 'ERREUR', progression = 100, message_erreur = ?, date_ocr = CURRENT_TIMESTAMP
       WHERE id_scan = ?`,
      [(err.message || 'Erreur OCR').slice(0, 490), id_scan]
    );
  }
}

/* ---------------- POST /api/numerisation/fichiers ---------------- */
/* Import multi-fichiers. Réponse IMMÉDIATE (liste des scans créés) ; l'OCR
 * tourne en tâche de fond, progression consultable via GET /fichiers. */
async function importer(req, res, next) {
  try {
    const fichiers = Array.isArray(req.files) ? req.files : [];
    if (!fichiers.length) {
      return res.status(400).json({
        message: 'Aucun fichier reçu ou tous refusés (formats acceptés : JPG, JPEG, PNG ; maximum 12 Mo chacun).',
      });
    }

    const crees = [];
    for (const f of fichiers) {
      const ext = path.extname(f.originalname || '').toLowerCase();
      const tailleOk = f.size <= TAILLE_MAX;
      const accepte = !!EXTENSIONS[ext] && tailleOk && f.path && fs.existsSync(f.path);
      // Fichiers refusés : supprimés du disque immédiatement, message par fichier
      if (!accepte) {
        try { fs.unlinkSync(f.path); } catch { /* déjà absent */ }
        crees.push({
          nom_fichier: f.originalname,
          refuse: true,
          message: !EXTENSIONS[ext]
            ? 'Format non pris en charge (formats acceptés : JPG, JPEG, PNG ; PDF bientôt disponible).'
            : `Fichier trop volumineux (maximum ${(TAILLE_MAX / (1024 * 1024)).toFixed(0)} Mo).`,
        });
        continue;
      }
      const [r] = await pool.query(
        `INSERT INTO planning_scan
           (utilisateur_id, nom_fichier, chemin_fichier, type_mime, taille_octets, statut, progression)
         VALUES (?, ?, ?, ?, ?, 'RECUE', 0)`,
        [req.user.id_utilisateur, f.originalname.slice(0, 250), f.path, EXTENSIONS[ext], f.size]
      );
      const id = r.insertId;
      enFileAttente(() => traiterScan(id, f.path));
      crees.push({ id_scan: id, nom_fichier: f.originalname, refuse: false });
    }
    res.status(201).json({ scans: crees });
  } catch (err) {
    next(err);
  }
}

/* ---------------- GET /api/numerisation/fichiers ---------------- */
/* Liste des scans (progression incluse) du RH connecté. */
async function lister(req, res, next) {
  try {
    const filtre = req.user.role === 'RH' ? '' : '';
    const scope = req.user.role === 'RH'
      ? 'WHERE s.utilisateur_id = ?'
      : 'WHERE 1=1';
    const [rows] = await pool.query(
      `SELECT s.id_scan, s.utilisateur_id, s.nom_fichier, s.type_mime, s.taille_octets,
              s.statut, s.progression, s.message_erreur,
              s.service_id, sv.nom_service, s.numero_semaine, s.annee, s.date_debut_semaine,
              s.donnees_ocr, s.donnees_corrigees, s.id_planning,
              s.date_reception, s.date_ocr, s.date_confirmation
       FROM planning_scan s
       LEFT JOIN service sv ON sv.id_service = s.service_id
       ${scope}
       ORDER BY s.date_reception DESC, s.id_scan DESC`,
      req.user.role === 'RH' ? [req.user.id_utilisateur] : []
    );
    res.json({ scans: rows });
  } catch (err) {
    next(err);
  }
}

/* Garde-fou commun : scan existant + périmètre du demandeur. */
async function scanAutorise(req, res) {
  const [[scan]] = await pool.query(
    `SELECT id_scan, utilisateur_id, chemin_fichier, statut, service_id, numero_semaine, annee,
            donnees_ocr, donnees_corrigees, id_planning
     FROM planning_scan WHERE id_scan = ?`,
    [req.params.id]
  );
  if (!scan) {
    res.status(404).json({ message: 'Document introuvable.' });
    return null;
  }
  if (req.user.role !== 'ADMIN' && Number(scan.utilisateur_id) !== Number(req.user.id_utilisateur)) {
    res.status(403).json({ message: 'Ce document ne vous appartient pas.' });
    return null;
  }
  return scan;
}

/* ---------------- GET /api/numerisation/:id/fichier ---------------- */
/* Document original (jamais servi en statique public). */
async function fichier(req, res, next) {
  try {
    const scan = await scanAutorise(req, res);
    if (!scan) return;
    if (!fs.existsSync(scan.chemin_fichier)) {
      return res.status(410).json({ message: 'Le fichier original n\'est plus disponible sur le serveur.' });
    }
    res.setHeader('Content-Type', scan.type_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `inline; filename="${encodeURIComponent(scan.nom_fichier || 'scan')}"`);
    fs.createReadStream(scan.chemin_fichier).pipe(res);
  } catch (err) {
    next(err);
  }
}

/* ---------------- DELETE /api/numerisation/:id ---------------- */
/* Retrait avant confirmation (jamais après : la trace CONFIRME est gardée). */
async function supprimer(req, res, next) {
  try {
    const scan = await scanAutorise(req, res);
    if (!scan) return;
    if (scan.statut === 'CONFIRME') {
      return res.status(409).json({
        message: 'Document déjà confirmé en planning : il ne peut pas être retiré (trace conservée).',
      });
    }
    await pool.query('DELETE FROM planning_scan WHERE id_scan = ?', [scan.id_scan]);
    try { fs.unlinkSync(scan.chemin_fichier); } catch { /* fichier déjà absent */ }
    res.json({ message: 'Document retiré.' });
  } catch (err) {
    next(err);
  }
}

/* ---------------- PATCH /api/numerisation/:id/metadata ---------------- */
/* Confirmer/corriger service + semaine (lancement VXRverif RH). */
async function majMetadata(req, res, next) {
  try {
    const scan = await scanAutorise(req, res);
    if (!scan) return;
    const { service_id, numero_semaine, annee } = req.body || {};
    const semaine = numero_semaine != null ? Number(numero_semaine) : null;
    const an = annee != null ? Number(annee) : null;
    const svc = service_id != null ? Number(service_id) : null;
    if (svc && !(await serviceExiste(svc))) return res.status(400).json({ message: 'Service inconnu.' });
    if (semaine != null && !(semaine >= 1 && semaine <= 53)) {
      return res.status(400).json({ message: 'Numéro de semaine invalide (1 à 53).' });
    }
    if (an != null && !(an >= 2000 && an <= 2100)) {
      return res.status(400).json({ message: 'Année invalide.' });
    }
    let deb = null;
    if (svc && semaine && an) {
      try { deb = lundiDeSemaineIso(an, semaine); } catch { /* semaine hors bornes */ }
    }
    await pool.query(
      `UPDATE planning_scan
       SET service_id = ?, numero_semaine = ?, annee = ?, date_debut_semaine = COALESCE(?, date_debut_semaine)
       WHERE id_scan = ?`,
      [svc, semaine, an, deb, scan.id_scan]
    );
    res.json({ message: 'Service et semaine enregistrés.', date_debut_semaine: deb });
  } catch (err) {
    next(err);
  }
}

async function serviceExiste(id) {
  const [[s]] = await pool.query('SELECT id_service FROM service WHERE id_service = ?', [id]);
  return !!s;
}

/* ---------------- PATCH /api/numerisation/:id/donnees ---------------- */
/* Enregistre les CORRECTIONS de la RH (vérification avant confirmation).
 * Structure attendue (celle produite par l'OCR, éditable) :
 *   { employes: [ { employe_id, nom_ocr, jours: { "2026-12-01":
 *       { statut: "TRAVAIL|REPOS|CONGE|ABSENCE",
 *         creneaux: [{ heure_entree, heure_sortie }] } } } ], alertes: [] } */
const STATUTS_JOUR = ['TRAVAIL', 'REPOS', 'CONGE', 'ABSENCE'];

function validerDonnees(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.employes)) {
    return 'Structure « employes » absente.';
  }
  if (d.employes.length > 60) return 'Trop d\'employés (maximum 60).';
  for (const e of d.employes) {
    if (e.employe_id == null || !/^[A-Z0-9: -]{0,200}$/i.test(String(e.nom_ocr || ''))) {
      return `Employé invalide : « ${String(e.nom_ocr || '').slice(0, 40)} ».`;
    }
    if (typeof e.jours !== 'object' || !e.jours) return `Jours absents pour « ${e.nom_ocr} ».`;
    for (const [jour, info] of Object.entries(e.jours)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return `Date invalide : ${jour}.`;
      if (!STATUTS_JOUR.includes(info.statut)) return `Statut invalide (${e.nom_ocr}, ${jour}) : ${info.statut}.`;
      if (!Array.isArray(info.creneaux)) return `Créneaux absents (${e.nom_ocr}, ${jour}).`;
      if (info.creneaux.length > 3) return `Plus de 3 créneaux (${e.nom_ocr}, ${jour}) — règle de la base.`;
      for (const c of info.creneaux) {
        if (!/^\d{2}:\d{2}$/.test(c.heure_entree || '')) {
          return `Heure d'entrée invalide (${e.nom_ocr}, ${jour}) : ${c.heure_entree}.`;
        }
        if (c.heure_sortie != null && !/^\d{2}:\d{2}$/.test(c.heure_sortie)) {
          return `Heure de sortie invalide (${e.nom_ocr}, ${jour}) : ${c.heure_sortie}.`;
        }
        if (c.heure_sortie != null && c.heure_sortie <= c.heure_entree) {
          return `Fin <= début (${e.nom_ocr}, ${jour}) : ${c.heure_entree}-${c.heure_sortie}.`;
        }
      }
    }
  }
  return null;
}

async function majDonnees(req, res, next) {
  try {
    const scan = await scanAutorise(req, res);
    if (!scan) return;
    if (scan.statut === 'CONFIRME') {
      return res.status(409).json({ message: 'Document déjà confirmé : utilisez la grille du planning pour toute correction.' });
    }
    const erreur = validerDonnees(req.body);
    if (erreur) return res.status(400).json({ message: `Données de vérification invalides : ${erreur}` });
    await pool.query(
      'UPDATE planning_scan SET donnees_corrigees = ? WHERE id_scan = ?',
      [JSON.stringify(req.body), scan.id_scan]
    );
    res.json({ message: 'Corrections enregistrées.' });
  } catch (err) {
    next(err);
  }
}

/* ---------------- POST /api/numerisation/:id/confirmer ---------------- */
/* Crée le planning BROUILLON (circuit existant) : contrôle serveur complet,
 * refus des doublons (409) et des créneaux incomplets, transaction. */
async function confirmer(req, res, next) {
  try {
    const scan = await scanAutorise(req, res);
    if (!scan) return;
    if (scan.statut === 'CONFIRME' && scan.id_planning) {
      return res.status(409).json({ message: 'Document déjà confirmé.', id_planning: scan.id_planning });
    }
    if (!['OCR_FAITE', 'RECUE', 'ERREUR'].includes(scan.statut)) {
      return res.status(409).json({ message: `Statut inattendu (${scan.statut}) : terminez l'OCR d'abord.` });
    }

    const [[meta]] = await pool.query(
      `SELECT service_id, numero_semaine, annee, date_debut_semaine, nom_fichier FROM planning_scan WHERE id_scan = ?`,
      [scan.id_scan]
    );
    if (!meta.service_id || !meta.numero_semaine || !meta.annee) {
      return res.status(400).json({
        message: `Veuillez confirmer le service et la semaine du document « ${meta.nom_fichier || scan.id_scan} » avant de continuer.`,
      });
    }

    const donnees = scan.donnees_corrigees || scan.donnees_ocr;
    if (!donnees) return res.status(400).json({ message: 'Aucune donnée OCR/vérifiée disponible.' });
    /* Un JSON corrompu est un 400 EXPLICITE, jamais une erreur serveur. */
    let quete;
    try {
      quete = typeof donnees === 'string' ? JSON.parse(donnees) : donnees;
    } catch {
      return res.status(400).json({ message: 'Les données enregistrées sont illisibles (JSON corrompu) — réenregistrez vos corrections avant de confirmer.' });
    }
    const erreur = validerDonnees(quete);
    if (erreur) return res.status(400).json({ message: `Données invalides : ${erreur}` });

    /* Données vides (ex. : OCR du scan #3 : rien n'avait été reconnu et la
     * confirmation créait un planning BROUILLON VIDE silencieusement) :
     * refus explicite, jamais de planning sans affectation. */
    if (!Array.isArray(quete.employes) || !quete.employes.length) {
      return res.status(400).json({
        message: 'Aucun employé dans les données vérifiées — la confirmation est impossible avec un tableau vide. Vérifiez dabord la qualité du scan, puis faites la vérification manuelle.',
      });
    }

    // Employés : uniquement des employés RÉELS du service (aucune création)
    const [emps] = await pool.query(
      `SELECT id_employe, nom FROM employe WHERE service_id = ? AND actif = 1`,
      [meta.service_id]
    );
    const parId = new Set(emps.map((e) => e.id_employe));
    for (const e of quete.employes) {
      if (!parId.has(Number(e.employe_id))) {
        return res.status(400).json({
          message: `« ${e.nom_ocr} » n'est pas un employé actif de ce service — associez-le (ou retirez la ligne) avant la confirmation.`,
        });
      }
    }

    // Dates réelles de la semaine (lundi = 1er jour, règle existante)
    const deb = meta.date_debut_semaine || lundiDeSemaineIso(meta.annee, meta.numero_semaine);
    const dates = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      new Date(new Date(deb + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10));

    // Créneaux incomplets ("FS") : la RH doit compléter AVANT confirmation
    const incomplets = [];
    for (const e of quete.employes) {
      for (const [jour, info] of Object.entries(e.jours)) {
        for (const c of info.creneaux) {
          if (!c.heure_sortie) incomplets.push(`${e.nom_ocr} — ${jour} : ${c.heure_entree}-FS`);
        }
      }
    }
    if (incomplets.length) {
      return res.status(400).json({
        message: `Créneaux incomplets à compléter avant confirmation : ${incomplets.slice(0, 5).join('; ')}${incomplets.length > 5 ? '…' : ''}`,
      });
    }

    /* Cohérence semaine <-> données : le RH peut avoir corrigé la semaine
     * APRÈS l'OCR ; si aucune donnée ne correspond aux 7 dates confirmées,
     * on refuse AVANT de créer un planning vide (aucune donnée perdue : les
     * corrections restent en base, modifiables à la vérification). */
    const fenetre = new Set(dates);
    let utilisables = 0;
    let horsFenetre = 0;
    for (const e of quete.employes) {
      for (const jour of Object.keys(e.jours || {})) {
        if (fenetre.has(jour)) utilisables += 1;
        else horsFenetre += 1;
      }
    }
    if (!utilisables) {
      return res.status(400).json({
        message: `Aucune donnée reconnue ne correspond à la semaine confirmée (S${meta.numero_semaine}/${meta.annee}, du ${deb} au ${dates[6]})${horsFenetre ? ` — ${horsFenetre} journée(s) concernent d'autres dates` : ''}. Vérifiez le service/semaine ou complétez la grille de vérification.`,
      });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      /* 1) VERROU de la ligne du scan (FOR UPDATE) : deux confirmations du
       *    même document (double-clic, reprise réseau) sont SÉRIALISÉES —
       *    la 2e attend la fin de la 1re puis reçoit un 409 PROPRE avec
       *    l'id du planning (idempotent), au lieu de s'intercaler dans la
       *    transaction du 1er (cause du « Lock wait timeout » observé). */
      const [[scanVerrouille]] = await conn.query(
        `SELECT statut, id_planning FROM planning_scan WHERE id_scan = ? FOR UPDATE`,
        [scan.id_scan]
      );
      if (scanVerrouille.statut === 'CONFIRME' && scanVerrouille.id_planning) {
        await conn.rollback();
        return res.status(409).json({
          message: 'Document déjà confirmé.',
          id_planning: scanVerrouille.id_planning,
        });
      }

      /* 2) Doublon (service + semaine) vérifié DANS la transaction avec verrou
       *    (vérifier avant la transaction créait une course : le confirmé
       *    concurrent s'insérait et recevait une exception dup-entry en 500). */
      const [[deja]] = await conn.query(
        `SELECT id_planning, statut FROM planning
         WHERE service_id = ? AND annee = ? AND numero_semaine = ? FOR UPDATE`,
        [meta.service_id, meta.annee, meta.numero_semaine]
      );
      if (deja) {
        await conn.rollback();
        return res.status(409).json({
          message: `Un planning ${deja.statut} existe déjà pour ce service et la semaine ${meta.numero_semaine} — aucun doublon créé.`,
          id_planning: deja.id_planning,
        });
      }

      const [plan] = await conn.query(
        `INSERT INTO planning (service_id, annee, numero_semaine, date_debut_semaine, date_fin_semaine, statut, cree_par)
         VALUES (?, ?, ?, ?, ?, 'BROUILLON', ?)`,
        [meta.service_id, meta.annee, meta.numero_semaine, deb, dates[6], req.user.id_utilisateur]
      );
      const idPlanning = plan.insertId;
      for (const e of quete.employes) {
        for (let i = 0; i < 7; i++) {
          const jour = dates[i];
          const info = e.jours[jour];
          if (!info) continue;
          const [aff] = await conn.query(
            `INSERT INTO affectation (planning_id, employe_id, date_jour, statut, commentaire)
             VALUES (?, ?, ?, ?, ?)`,
            [idPlanning, Number(e.employe_id), jour, info.statut, `Scan #${scan.id_scan}`]
          );
          for (const c of info.creneaux) {
            await conn.query(
              `INSERT INTO creneau_travail (affectation_id, type_creneau, heure_entree, heure_sortie)
               VALUES (?, ?, ?, ?)`,
              [aff.insertId, typeCreneau(c.heure_entree), c.heure_entree, c.heure_sortie]
            );
          }
        }
      }
      /* 3) Mise à jour du scan SUR LA MÊME CONNEXION (plus d'appel pool.query
       *    pendant la transaction ouverte) : commit/rollback homogènes, une
       *    seule connexion sous les verrous, plus de mélange transaction/
       *    autocommit. */
      await conn.query(
        `UPDATE planning_scan SET statut = 'CONFIRME', id_planning = ?, date_confirmation = CURRENT_TIMESTAMP
         WHERE id_scan = ?`,
        [idPlanning, scan.id_scan]
      );
      await conn.commit();
      res.status(201).json({ message: 'Planning BROUILLON créé.', id_planning: idPlanning, id_scan: scan.id_scan });
    } catch (err) {
      /* ROLLBACK systématique : la connexion est relâchée dans finally,
       * quoi qu'il arrive (aucune transaction ne reste ouverte). */
      try { await conn.rollback(); } catch { /* déjà annulée */ }
      /* Filet de sécurité : un doublon qui aurait échappé aux vérifications
       * (ex. course restante) est un 409 métier, pas un 500. */
      if (err && err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          message: 'Un planning existe déjà pour ce service et cette semaine — aucun doublon créé.',
        });
      }
      throw err;
    } finally {
      conn.release(); // TOUJOURS relâchée, même en cas d'erreur
    }
  } catch (err) {
    next(err);
  }
}

/* Période selon l'heure d'entrée — MES MÊMES bornes que le contrôleur de
 * grille du projet (< 12:00 matin ; 12:00-17:59 après-midi ; >= 18:00 soir). */
function typeCreneau(heureEntree) {
  const h = Number(String(heureEntree).slice(0, 2));
  const m = Number(String(heureEntree).slice(3, 5));
  const minutes = h * 60 + m;
  if (minutes < 12 * 60) return 'MATIN';
  if (minutes < 18 * 60) return 'APRES_MIDI';
  return 'SOIR';
}

module.exports = { upload, importer, lister, fichier, supprimer, majMetadata, majDonnees, confirmer };
