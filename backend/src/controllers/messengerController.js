/* MESSENGER INTERNE — contrôleur.
 * Règles de sécurité (toutes vérifiées côté serveur, JAMAIS via le body) :
 *   - l'identité vient du JWT (req.user.id_utilisateur, posé par authRequired) ;
 *   - la permission messenger.use est requise sur TOUTES les routes
 *     (requirePermission, cf. messengerRoutes.js) ;
 *   - toute lecture/écriture dans une conversation exige d'EN ETRE MEMBRE
 *     (appartenance vérifiée en base à chaque requête) ;
 *   - modifier / supprimer un message est réservé à son AUTEUR ;
 *   - un EMPLOYE (pas d'espace applicatif) ne peut jamais être ajouté.
 * La suppression est LOGIQUE (deleted_at), la modification garde modified_at :
 * l'historique n'est jamais détruit.
 * Les notifications REUTILISENT l'util existant utils/notifier.js (table
 * notification, planning_id NULL) : aucun deuxième système créé.
 */
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/db');
const { notifierUtilisateur } = require('../utils/notifier');
const { emettreConversation } = require('../socket/emetteur');

const ROLES_AUTORISES = ['ADMIN', 'RH', 'CHEF_SERVICE'];
const LIMITE_MESSAGES = 50; // pagination (chargement progressif)
const TAILLE_MAX_CONTENU = 5000;

/* ---------------- Pieces jointes (Messenger) ------------------------------
 * Image / video / audio / fichier. Meme modele de securite que la photo de
 * profil (photoProfilController) : stockage memoire multer, type MIME reel
 * verifie, nom de fichier genere cote serveur, chemin RELATIF en base et
 * servi par express.static (/uploads/messenger/...).
 */
const DOSSIER_PJ = path.join(__dirname, '..', '..', 'uploads', 'messenger');
const TAILLE_MAX_PJ = 15 * 1024 * 1024; // 15 Mo (photo, video courte, vocal)

// Types MIME acceptes (liste BLANCHE stricte) par categorie affichee.
const MIMES_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MIMES_VIDEOS = ['video/mp4', 'video/webm', 'video/quicktime'];
const MIMES_AUDIO = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'];
const MIMES_FICHIERS = [
  'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
];
const MIMES_ACCEPTES = [...MIMES_IMAGES, ...MIMES_VIDEOS, ...MIMES_AUDIO, ...MIMES_FICHIERS];

const EXTENSIONS_PJ = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
};

// Libelle court d'un message media (liste des discussions + notifications).
function libelleTypeMessage(m) {
  if (!m || !m.type_message || m.type_message === 'texte') return null;
  switch (m.type_message) {
    case 'image': return 'Photo';
    case 'video': return 'Vidéo';
    case 'audio': return 'Message vocal';
    default: return m.nom_fichier ? `Fichier : ${m.nom_fichier}` : 'Fichier';
  }
}

// Stockage en memoire : le fichier n'est ecrit sur le disque qu'APRES validation.
const uploadPJ = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX_PJ, files: 1 },
});

// Middleware multer (champ attendu du formulaire : "fichier").
function recevoirPieceJointe(req, res) {
  const middleware = uploadPJ.single('fichier');
  return new Promise((resolve, reject) => {
    middleware(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return reject(Object.assign(new Error('Fichier trop volumineux (maximum 15 Mo).'), { status: 413 }));
        }
        return reject(Object.assign(new Error('Fichier non accepté.'), { status: 400 }));
      }
      resolve();
    });
  });
}

/* ---------------- Aides internes ------------------------------------------ */

// Vérifie que l'utilisateur est MEMBRE de la conversation. Retourne true/false.
async function estMembre(conversationId, utilisateurId) {
  const [[ligne]] = await pool.query(
    'SELECT 1 AS ok FROM conversation_membres WHERE conversation_id = ? AND utilisateur_id = ?',
    [conversationId, utilisateurId]
  );
  return Boolean(ligne);
}

// Les autres membres d'une conversation (hors l'utilisateur courant).
async function autresMembres(conversationId, utilisateurId) {
  const [rows] = await pool.query(
    `SELECT u.id_utilisateur, u.nom_utilisateur, u.prenom, u.role,
            u.photo_profil, u.actif, s.nom_service
     FROM conversation_membres cm
     JOIN utilisateur u ON u.id_utilisateur = cm.utilisateur_id
     LEFT JOIN service s ON s.id_service = u.service_id
     WHERE cm.conversation_id = ? AND cm.utilisateur_id != ?`,
    [conversationId, utilisateurId]
  );
  return rows;
}

// Marque comme lus les messages des AUTRES de la conversation (idempotent).
async function marquerConversationLue(conversationId, utilisateurId) {
  await pool.query(
    `INSERT IGNORE INTO message_lectures (message_id, utilisateur_id)
     SELECT m.id, ? FROM messages m
     WHERE m.conversation_id = ? AND m.expediteur_id != ? AND m.deleted_at IS NULL`,
    [utilisateurId, conversationId, utilisateurId]
  );
}

/* Chargement complet d'un message (payload riche pour le chat). */
async function chargerMessage(id) {
  const [[m]] = await pool.query(
    `SELECT m.id, m.conversation_id, m.contenu, m.repondre_a, m.planning_id,
            m.type_message, m.fichier_chemin, m.nom_fichier, m.mime_type,
            m.modified_at, m.deleted_at, m.created_at,
            u.id_utilisateur AS expediteur_id, u.nom_utilisateur, u.prenom,
            u.role, u.photo_profil,
            p.numero_semaine, p.annee, s.nom_service AS planning_service
     FROM messages m
     JOIN utilisateur u ON u.id_utilisateur = m.expediteur_id
     LEFT JOIN planning p ON p.id_planning = m.planning_id
     LEFT JOIN service s ON s.id_service = p.service_id
     WHERE m.id = ?`,
    [id]
  );
  if (!m) return null;
  // Message auquel celui-ci répond (aperçu).
  let reponse = null;
  if (m.repondre_a) {
    const [[r]] = await pool.query(
      `SELECT r.id, r.contenu, r.deleted_at, ru.nom_utilisateur, ru.prenom
       FROM messages r JOIN utilisateur ru ON ru.id_utilisateur = r.expediteur_id
       WHERE r.id = ?`,
      [m.repondre_a]
    );
    if (r) {
      reponse = {
        id: r.id,
        nom_expediteur: [r.prenom, r.nom_utilisateur].filter(Boolean).join(' '),
        contenu: r.deleted_at ? null : r.contenu,
        supprime: Boolean(r.deleted_at),
      };
    }
  }
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    contenu: m.deleted_at ? null : m.contenu,
    supprime: Boolean(m.deleted_at),
    modifie: Boolean(m.modified_at),
    modified_at: m.modified_at,
    deleted_at: m.deleted_at,
    created_at: m.created_at,
    type_message: m.type_message || 'texte',
    fichier_chemin: m.deleted_at ? null : m.fichier_chemin,
    nom_fichier: m.deleted_at ? null : m.nom_fichier,
    mime_type: m.mime_type || null,
    planning: m.planning_id
      ? { id_planning: m.planning_id, numero_semaine: m.numero_semaine, annee: m.annee, service: m.planning_service }
      : null,
    reponse,
    expediteur: {
      id_utilisateur: m.expediteur_id,
      nom: m.nom_utilisateur,
      prenom: m.prenom,
      role: m.role,
      photo_profil: m.photo_profil,
    },
  };
}

/* ---------------- Utilisateurs autorisés (nouvelle conversation) ---------- */
// GET /api/messenger/utilisateurs
async function utilisateursAutorises(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT u.id_utilisateur, u.nom_utilisateur, u.prenom, u.role,
              u.photo_profil, u.actif, s.nom_service
       FROM utilisateur u
       LEFT JOIN service s ON s.id_service = u.service_id
       WHERE u.actif = 1 AND u.role IN (?, ?, ?) AND u.id_utilisateur != ?
       ORDER BY u.role, u.nom_utilisateur`,
      [...ROLES_AUTORISES, req.user.id_utilisateur]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

/* ---------------- Liste des conversations --------------------------------- */
// GET /api/messenger/conversations
// Chaque item : membres (avec l'autre utilisateur), dernier message,
// nombre de non-lus de l'utilisateur courant, activité triée décroissante.
// Etat PAR MEMBRE inclus : epinglee (en haut), archivee (section dédiée) —
// les discussions « supprimee » du membre ne sont PAS listées.
async function listerConversations(req, res, next) {
  try {
    const moi = req.user.id_utilisateur;
    const [convs] = await pool.query(
      `SELECT c.id, c.derniere_activite, cm.epinglee, cm.archivee
       FROM conversations c
       JOIN conversation_membres cm ON cm.conversation_id = c.id
       WHERE cm.utilisateur_id = ? AND cm.supprimee = 0
       ORDER BY cm.epinglee DESC, c.derniere_activite DESC, c.id DESC`,
      [moi]
    );
    if (convs.length === 0) return res.json([]);

    const ids = convs.map((c) => c.id);
    const joker = ids.map(() => '?').join(',');

    // Membres de chaque conversation (une seule requête)
    const [membres] = await pool.query(
      `SELECT cm.conversation_id, u.id_utilisateur, u.nom_utilisateur, u.prenom,
              u.role, u.photo_profil, u.actif, s.nom_service
       FROM conversation_membres cm
       JOIN utilisateur u ON u.id_utilisateur = cm.utilisateur_id
       LEFT JOIN service s ON s.id_service = u.service_id
       WHERE cm.conversation_id IN (${joker})`,
      ids
    );
    const membresParConv = {};
    for (const m of membres) (membresParConv[m.conversation_id] = membresParConv[m.conversation_id] || []).push(m);

    // Dernier message de chaque conversation (une seule requête)
    const [derniers] = await pool.query(
      `SELECT m.id, m.conversation_id, m.contenu, m.deleted_at, m.created_at,
              m.expediteur_id, m.type_message, m.nom_fichier
       FROM messages m
       JOIN (SELECT conversation_id, MAX(id) AS max_id FROM messages
             WHERE conversation_id IN (${joker}) GROUP BY conversation_id) x
         ON x.max_id = m.id`,
      ids
    );
    const dernierParConv = {};
    for (const d of derniers) dernierParConv[d.conversation_id] = d;

    // Non-lus de l'utilisateur courant par conversation (une seule requête)
    const [nonLus] = await pool.query(
      `SELECT m.conversation_id, COUNT(*) AS n
       FROM messages m
       LEFT JOIN message_lectures l ON l.message_id = m.id AND l.utilisateur_id = ?
       WHERE m.conversation_id IN (${joker})
         AND m.expediteur_id != ? AND m.deleted_at IS NULL AND l.message_id IS NULL
       GROUP BY m.conversation_id`,
      [moi, ...ids, moi]
    );
    const nonLusParConv = {};
    for (const n of nonLus) nonLusParConv[n.conversation_id] = Number(n.n);

    res.json(convs.map((c) => {
      const dernier = dernierParConv[c.id];
      return {
        id: c.id,
        derniere_activite: c.derniere_activite,
        membres: (membresParConv[c.id] || []).map((m) => ({
          id_utilisateur: m.id_utilisateur,
          nom: m.nom_utilisateur,
          prenom: m.prenom,
          role: m.role,
          photo_profil: m.photo_profil,
          actif: m.actif,
          nom_service: m.nom_service,
        })),
        dernier_message: dernier
          ? {
              id: dernier.id,
              expediteur_id: dernier.expediteur_id,
              contenu: dernier.deleted_at ? null : dernier.contenu,
              supprime: Boolean(dernier.deleted_at),
              created_at: dernier.created_at,
              type_message: dernier.type_message || 'texte',
              nom_fichier: dernier.nom_fichier || null,
            }
          : null,
        non_lus: nonLusParConv[c.id] || 0,
        epinglee: Boolean(c.epinglee),
        archivee: Boolean(c.archivee),
      };
    }));
  } catch (err) { next(err); }
}

/* ---------------- Création / ouverture d'une conversation privée ---------- */
// POST /api/messenger/conversations { utilisateur_id }
// Retrouve la conversation privée existante entre les deux utilisateurs ou la
// crée (jamais de doublon). L'utilisateur cible doit être actif et autorisé.
async function creerConversation(req, res, next) {
  try {
    const moi = req.user.id_utilisateur;
    const cible = Number(req.body && req.body.utilisateur_id);
    if (!Number.isInteger(cible) || cible <= 0) {
      return res.status(400).json({ message: 'utilisateur_id requis.' });
    }
    if (cible === moi) {
      return res.status(400).json({ message: 'Impossible de créer une conversation avec soi-même.' });
    }
    const [[cibleUser]] = await pool.query(
      `SELECT id_utilisateur, role, actif FROM utilisateur WHERE id_utilisateur = ?`,
      [cible]
    );
    if (!cibleUser) return res.status(404).json({ message: 'Utilisateur introuvable.' });
    if (!cibleUser.actif || !ROLES_AUTORISES.includes(cibleUser.role)) {
      return res.status(403).json({ message: 'Cet utilisateur ne peut pas utiliser la messagerie.' });
    }

    // Conversation privée 1-1 déjà existante ? (exactement 2 membres = nous 2)
    const [[existante]] = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_membres a ON a.conversation_id = c.id AND a.utilisateur_id = ?
       JOIN conversation_membres b ON b.conversation_id = c.id AND b.utilisateur_id = ?
       WHERE (SELECT COUNT(*) FROM conversation_membres x WHERE x.conversation_id = c.id) = 2
       LIMIT 1`,
      [moi, cible]
    );
    if (existante) {
      // La discussion avait été supprimée de ma liste ? Réouverture : elle
      // reapparait (les messages précédents restent conservés).
      await pool.query(
        'UPDATE conversation_membres SET supprimee = 0 WHERE conversation_id = ? AND utilisateur_id = ?',
        [existante.id, moi]
      );
      return res.json({ id: existante.id, creee: false });
    }

    const [creee] = await pool.query('INSERT INTO conversations () VALUES ()');
    const id = creee.insertId;
    await pool.query(
      'INSERT INTO conversation_membres (conversation_id, utilisateur_id) VALUES (?, ?), (?, ?)',
      [id, moi, id, cible]
    );
    res.status(201).json({ id, creee: true });
  } catch (err) { next(err); }
}

/* ---------------- Etat d'une discussion (par membre) ---------------------- */
// PATCH /api/messenger/conversations/:id/epingle { epinglee: true|false }
// Epingler = discussion placee en haut de SA liste (l'autre membre n'est pas
// affecte). Deseingler remet l'ordre chronologique normal.
async function definirEpingle(req, res, next) {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ message: 'Identifiant invalide.' });
    if (!(await estMembre(conversationId, req.user.id_utilisateur))) {
      return res.status(403).json({ message: 'Vous n\'êtes pas membre de cette conversation.' });
    }
    const epinglee = Boolean(req.body && req.body.epinglee);
    await pool.query(
      'UPDATE conversation_membres SET epinglee = ? WHERE conversation_id = ? AND utilisateur_id = ?',
      [epinglee ? 1 : 0, conversationId, req.user.id_utilisateur]
    );
    res.json({ id: conversationId, epinglee });
  } catch (err) { next(err); }
}

// PATCH /api/messenger/conversations/:id/archive { archivee: true|false }
// Archiver = retirer de la liste principale, conserver dans la section
// « Archivees ». Les messages ne sont JAMAIS supprimés.
async function definirArchive(req, res, next) {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ message: 'Identifiant invalide.' });
    if (!(await estMembre(conversationId, req.user.id_utilisateur))) {
      return res.status(403).json({ message: 'Vous n\'êtes pas membre de cette conversation.' });
    }
    const archivee = Boolean(req.body && req.body.archivee);
    await pool.query(
      'UPDATE conversation_membres SET archivee = ? WHERE conversation_id = ? AND utilisateur_id = ?',
      [archivee ? 1 : 0, conversationId, req.user.id_utilisateur]
    );
    res.json({ id: conversationId, archivee });
  } catch (err) { next(err); }
}

// DELETE /api/messenger/conversations/:id — supprime la discussion POUR LE
// MEMBRE courant uniquement (apres confirmation côté interface). Les messages
// restent en base : si l'autre membre ecrit a nouveau, la discussion reaparait.
// Si PLUS AUCUN membre ne la conserve, la conversation (et ses messages, en
// CASCADE) est physiquement supprimée.
async function supprimerConversation(req, res, next) {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ message: 'Identifiant invalide.' });
    if (!(await estMembre(conversationId, req.user.id_utilisateur))) {
      return res.status(403).json({ message: 'Vous n\'êtes pas membre de cette conversation.' });
    }
    await pool.query(
      'UPDATE conversation_membres SET supprimee = 1 WHERE conversation_id = ? AND utilisateur_id = ?',
      [conversationId, req.user.id_utilisateur]
    );
    const [[{ restants }]] = await pool.query(
      'SELECT COUNT(*) AS restants FROM conversation_membres WHERE conversation_id = ? AND supprimee = 0',
      [conversationId]
    );
    if (Number(restants) === 0) {
      await pool.query('DELETE FROM conversations WHERE id = ?', [conversationId]);
    }
    res.json({ id: conversationId, supprimee: true });
  } catch (err) { next(err); }
}

/* ---------------- Messages d'une conversation (paginés) ------------------- */
// GET /api/messenger/conversations/:id/messages?avant=<id>&limite=50
// Pagination par identifiant décroissant (chargement progressif, jamais toute
// l'historique d'un coup). Réponse en ordre chronologique.
async function listerMessages(req, res, next) {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ message: 'Identifiant invalide.' });
    if (!(await estMembre(conversationId, req.user.id_utilisateur))) {
      return res.status(403).json({ message: 'Vous n\'êtes pas membre de cette conversation.' });
    }
    const limite = Math.min(LIMITE_MESSAGES, Math.max(1, Number(req.query.limite) || LIMITE_MESSAGES));
    const avant = Number(req.query.avant);
    const params = [conversationId];
    let filtre = '';
    if (Number.isInteger(avant) && avant > 0) { filtre = 'AND m.id < ?'; params.push(avant); }

    const [rows] = await pool.query(
      `SELECT m.id, m.contenu, m.repondre_a, m.planning_id, m.modified_at,
              m.deleted_at, m.created_at,
              m.type_message, m.fichier_chemin, m.nom_fichier, m.mime_type,
              u.id_utilisateur AS expediteur_id, u.nom_utilisateur, u.prenom,
              u.role, u.photo_profil,
              p.numero_semaine, p.annee, s.nom_service AS planning_service,
              (SELECT COUNT(*) FROM message_lectures l2
                WHERE l2.message_id = m.id AND l2.utilisateur_id != m.expediteur_id) AS nb_lectures
       FROM messages m
       JOIN utilisateur u ON u.id_utilisateur = m.expediteur_id
       LEFT JOIN planning p ON p.id_planning = m.planning_id
       LEFT JOIN service s ON s.id_service = p.service_id
       WHERE m.conversation_id = ? ${filtre}
       ORDER BY m.id DESC LIMIT ${limite}`,
      params
    );

    // Aperçu du message de réponse pour chaque message concerné
    const idsReponse = [...new Set(rows.map((r) => r.repondre_a).filter(Boolean))];
    const reponses = {};
    if (idsReponse.length > 0) {
      const joker = idsReponse.map(() => '?').join(',');
      const [rs] = await pool.query(
        `SELECT r.id, r.contenu, r.deleted_at, ru.nom_utilisateur, ru.prenom
         FROM messages r JOIN utilisateur ru ON ru.id_utilisateur = r.expediteur_id
         WHERE r.id IN (${joker})`, idsReponse);
      for (const r of rs) {
        reponses[r.id] = {
          id: r.id,
          nom_expediteur: [r.prenom, r.nom_utilisateur].filter(Boolean).join(' '),
          contenu: r.deleted_at ? null : r.contenu,
          supprime: Boolean(r.deleted_at),
        };
      }
    }

    const messages = rows.map((m) => ({
      id: m.id,
      conversation_id: m.conversation_id,
      contenu: m.deleted_at ? null : m.contenu,
      supprime: Boolean(m.deleted_at),
      modifie: Boolean(m.modified_at),
      modified_at: m.modified_at,
      deleted_at: m.deleted_at,
      created_at: m.created_at,
      lu: Number(m.nb_lectures) > 0, // lu par au moins un autre membre
      type_message: m.type_message || 'texte',
      fichier_chemin: m.deleted_at ? null : m.fichier_chemin,
      nom_fichier: m.deleted_at ? null : m.nom_fichier,
      mime_type: m.mime_type || null,
      planning: m.planning_id
        ? { id_planning: m.planning_id, numero_semaine: m.numero_semaine, annee: m.annee, service: m.planning_service }
        : null,
      reponse: m.repondre_a ? reponses[m.repondre_a] || null : null,
      expediteur: {
        id_utilisateur: m.expediteur_id,
        nom: m.nom_utilisateur,
        prenom: m.prenom,
        role: m.role,
        photo_profil: m.photo_profil,
      },
    })).reverse(); // ordre chronologique pour l'affichage

    res.json({ messages, a_plus: rows.length === limite });
  } catch (err) { next(err); }
}

/* ---------------- Envoi d'un message (HTTP et Socket.IO) ------------------ */
// Création réelle + notification aux autres membres (util existant) +
// mise à jour de l'activité. Utilisé par la route POST et par le socket.
async function creerMessage({ expediteurId, conversationId, contenu, repondreA = null, planningId = null, typeMessage = 'texte', fichier = null }) {
  const texte = String(contenu || '').trim();
  // Un message media (image/video/audio/fichier) peut n'avoir qu'une legende
  // vide : seul le TEXTE seul est refuse (message vide).
  if (!texte && typeMessage === 'texte') { const e = new Error('Le message ne peut pas être vide.'); e.status = 400; throw e; }
  if (texte.length > TAILLE_MAX_CONTENU) {
    const e = new Error(`Message trop long (${TAILLE_MAX_CONTENU} caractères maximum).`); e.status = 400; throw e;
  }
  if (!(await estMembre(conversationId, expediteurId))) {
    const e = new Error('Vous n\'êtes pas membre de cette conversation.'); e.status = 403; throw e;
  }
  // La réponse cible un message de la MÊME conversation.
  if (repondreA != null) {
    const [[cible]] = await pool.query(
      'SELECT id FROM messages WHERE id = ? AND conversation_id = ?',
      [repondreA, conversationId]
    );
    if (!cible) { const e = new Error('Message de réponse introuvable dans cette conversation.'); e.status = 400; throw e; }
  }
  // Le planning contextualisé doit exister (facultatif).
  if (planningId != null) {
    const [[p]] = await pool.query('SELECT id_planning FROM planning WHERE id_planning = ?', [planningId]);
    if (!p) { const e = new Error('Planning introuvable.'); e.status = 400; throw e; }
  }

  const [result] = await pool.query(
    `INSERT INTO messages (conversation_id, expediteur_id, contenu, repondre_a, planning_id,
                           type_message, fichier_chemin, nom_fichier, mime_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [conversationId, expediteurId, texte, repondreA, planningId,
     typeMessage || 'texte', fichier ? fichier.chemin : null, fichier ? fichier.nom : null, fichier ? fichier.mime : null]
  );
  await pool.query('UPDATE conversations SET derniere_activite = NOW() WHERE id = ?', [conversationId]);
  // Un nouveau message fait REAPPARAITRE la discussion chez les membres qui
  // l'avaient supprimée de leur liste (supprimee remis a 0 pour tous).
  await pool.query('UPDATE conversation_membres SET supprimee = 0 WHERE conversation_id = ? AND supprimee = 1', [conversationId]);

  const message = await chargerMessage(result.insertId);
  // Temps réel : diffusion aux membres connectés (REST et socket émettent
  // tous les deux ici, donc rien n'est jamais perdu côté réception).
  emettreConversation(conversationId, 'messenger:message', { message });

  // Notifications (util EXISTANT, tolerant aux pannes) pour les autres membres.
  const destinataires = await autresMembres(conversationId, expediteurId);
  const auteur = [message.expediteur.prenom, message.expediteur.nom].filter(Boolean).join(' ');
  const libellePJ = libelleTypeMessage(message);
  const extrait = libellePJ || (texte.length > 80 ? texte.slice(0, 80) + '…' : texte);
  for (const d of destinataires) {
    await notifierUtilisateur(
      d.id_utilisateur, null,
      `Nouveau message — ${auteur}`,
      extrait
    );
  }
  return { message, destinataires };
}

// POST /api/messenger/conversations/:id/messages { contenu, repondre_a?, planning_id? }
async function envoyerMessage(req, res, next) {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ message: 'Identifiant invalide.' });
    const { message } = await creerMessage({
      expediteurId: req.user.id_utilisateur,
      conversationId,
      contenu: req.body && req.body.contenu,
      repondreA: req.body && req.body.repondre_a != null ? Number(req.body.repondre_a) : null,
      planningId: req.body && req.body.planning_id != null ? Number(req.body.planning_id) : null,
    });
    res.status(201).json({ message });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

/* ---------------- Marquer comme lu ---------------------------------------- */
// POST /api/messenger/conversations/:id/fichiers (multipart, champ "fichier")
// Piece jointe : image, video, audio (vocal) ou fichier — avec legende
// facultative (req.body.contenu). Meme securite que les messages texte :
// membre obligatoire, identite issue du JWT. Le fichier est valide (type MIME
// de la liste blanche) AVANT toute ecriture disque ; nom genere cote serveur.
async function envoyerPieceJointe(req, res, next) {
  try {
    await recevoirPieceJointe(req, res);

    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ message: 'Identifiant invalide.' });
    if (!(await estMembre(conversationId, req.user.id_utilisateur))) {
      return res.status(403).json({ message: "Vous n'êtes pas membre de cette conversation." });
    }
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu (champ "fichier").' });
    if (!MIMES_ACCEPTES.includes(req.file.mimetype)) {
      return res.status(415).json({ message: 'Type de fichier non accepté (image, vidéo, audio ou document).', mime: req.file.mimetype });
    }
    const extension = EXTENSIONS_PJ[req.file.mimetype];
    if (!extension) return res.status(415).json({ message: 'Type de fichier non accepté.' });

    // Categorie affichee derivee du MIME reel (image/, video/, audio/, sinon fichier).
    const typeMessage = req.file.mimetype.startsWith('image/') ? 'image'
      : req.file.mimetype.startsWith('video/') ? 'video'
      : req.file.mimetype.startsWith('audio/') ? 'audio'
      : 'fichier';

    // Nom sur disque UNIQUEMENT genere : msg_<conv>_<timestamp>.<ext>
    if (!fs.existsSync(DOSSIER_PJ)) fs.mkdirSync(DOSSIER_PJ, { recursive: true });
    const nomDisque = `msg_${conversationId}_${Date.now()}.${extension}`;
    fs.writeFileSync(path.join(DOSSIER_PJ, nomDisque), req.file.buffer);
    const cheminRelatif = `/uploads/messenger/${nomDisque}`;

    const { message } = await creerMessage({
      expediteurId: req.user.id_utilisateur,
      conversationId,
      contenu: req.body && req.body.contenu ? String(req.body.contenu) : '',
      repondreA: req.body && req.body.repondre_a != null ? Number(req.body.repondre_a) : null,
      planningId: req.body && req.body.planning_id != null ? Number(req.body.planning_id) : null,
      typeMessage,
      fichier: {
        chemin: cheminRelatif,
        nom: String(req.file.originalname || `fichier.${extension}`).slice(0, 255),
        mime: req.file.mimetype,
      },
    });
    res.status(201).json({ message });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

// POST /api/messenger/conversations/:id/read
async function marquerLu(req, res, next) {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ message: 'Identifiant invalide.' });
    if (!(await estMembre(conversationId, req.user.id_utilisateur))) {
      return res.status(403).json({ message: 'Vous n\'êtes pas membre de cette conversation.' });
    }
    await marquerConversationLue(conversationId, req.user.id_utilisateur);
    res.json({ message: 'Conversation marquée comme lue.' });
  } catch (err) { next(err); }
}

// GET /api/messenger/unread-count -> badge global de la sidebar
async function compteurNonLus(req, res, next) {
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS non_lus
       FROM messages m
       JOIN conversation_membres cm ON cm.conversation_id = m.conversation_id
            AND cm.utilisateur_id = ? AND cm.supprimee = 0
       LEFT JOIN message_lectures l ON l.message_id = m.id AND l.utilisateur_id = ?
       WHERE m.expediteur_id != ? AND m.deleted_at IS NULL AND l.message_id IS NULL`,
      [req.user.id_utilisateur, req.user.id_utilisateur, req.user.id_utilisateur]
    );
    res.json({ non_lus: Number(row.non_lus) });
  } catch (err) { next(err); }
}

/* ---------------- Modification / suppression ------------------------------ */
// PATCH /api/messenger/messages/:id { contenu } — AUTEUR UNIQUEMENT
async function modifierMessage(req, res, next) {
  try {
    const id = Number(req.params.id);
    const texte = String((req.body && req.body.contenu) || '').trim();
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Identifiant invalide.' });
    if (!texte) return res.status(400).json({ message: 'Le message ne peut pas être vide.' });
    if (texte.length > TAILLE_MAX_CONTENU) return res.status(400).json({ message: 'Message trop long.' });

    const [[m]] = await pool.query('SELECT id, expediteur_id, deleted_at FROM messages WHERE id = ?', [id]);
    if (!m) return res.status(404).json({ message: 'Message introuvable.' });
    if (m.deleted_at) return res.status(409).json({ message: 'Ce message est supprimé.' });
    if (Number(m.expediteur_id) !== Number(req.user.id_utilisateur)) {
      return res.status(403).json({ message: 'Seul l\'auteur peut modifier ce message.' });
    }
    await pool.query('UPDATE messages SET contenu = ?, modified_at = NOW() WHERE id = ?', [texte, id]);
    const message = await chargerMessage(id);
    emettreConversation(message.conversation_id, 'messenger:message-modifie', { message });
    res.json({ message });
  } catch (err) { next(err); }
}

// DELETE /api/messenger/messages/:id — AUTEUR UNIQUEMENT (suppression logique)
async function supprimerMessage(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Identifiant invalide.' });
    const [[m]] = await pool.query('SELECT id, expediteur_id, deleted_at FROM messages WHERE id = ?', [id]);
    if (!m) return res.status(404).json({ message: 'Message introuvable.' });
    if (m.deleted_at) return res.json({ message: 'Message déjà supprimé.' });
    if (Number(m.expediteur_id) !== Number(req.user.id_utilisateur)) {
      return res.status(403).json({ message: 'Seul l\'auteur peut supprimer ce message.' });
    }
    await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = ?', [id]);
    const message = await chargerMessage(id);
    emettreConversation(message.conversation_id, 'messenger:message-supprime', { message });
    res.json({ message });
  } catch (err) { next(err); }
}

module.exports = {
  utilisateursAutorises,
  listerConversations,
  creerConversation,
  listerMessages,
  envoyerMessage,
  envoyerPieceJointe,
  marquerLu,
  compteurNonLus,
  modifierMessage,
  supprimerMessage,
  definirEpingle,
  definirArchive,
  supprimerConversation,
  // exportés pour Socket.IO
  creerMessage,
  estMembre,
  marquerConversationLue,
  autresMembres,
  chargerMessage,
};
