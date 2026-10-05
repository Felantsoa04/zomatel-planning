/* SOCKET.IO — temps réel du Messenger interne.
 * Branche un serveur Socket.IO sur le serveur HTTP d'Express (même port que
 * l'API : aucun port supplémentaire, même origine que le CORS de l'application).
 * Sécurité :
 *   - le JWT est vérifié au handshake (io.use) ; l'identité ne vient JAMAIS
 *     du client, la permission messenger.use est relue en base ;
 *   - les salles "conv-<id>" ne sont rejointes que si l'utilisateur est membre
 *     EN BASE (estMembre), jamais sur la seule parole du client.
 * Gère : réception instantanée d'un message, accusés de lecture, indicateur
 * "est en train d'écrire" (volatile, jamais en base), statut en ligne / hors
 * ligne (état mémoire multi-onglets, diffusion aux salles de l'utilisateur).
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const ctrl = require('../controllers/messengerController');
const { permissionsDe } = require('../utils/permissions');
const { definirIo } = require('./emetteur');

const enLigne = new Map(); // id_utilisateur -> Set(socket.id) (multi-onglets)

async function permissionMessengerOk(idUtilisateur) {
  try {
    return (await permissionsDe(idUtilisateur)).includes('messenger.use');
  } catch {
    return false;
  }
}

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      // Mêmes origines que app.js : 3000/3001 (historiques) + 3002 (frontend actuel).
      origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  });

  // --- Handshake : JWT obligatoire + permission messenger.use -------------
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('Authentification requise.'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (!(await permissionMessengerOk(payload.id_utilisateur))) {
        return next(new Error('Permission messenger.use requise.'));
      }
      socket.data.utilisateur = {
        id_utilisateur: payload.id_utilisateur,
        role: payload.role,
      };
      return next();
    } catch {
      return next(new Error('Session invalide ou expiree.'));
    }
  });

  io.on('connection', (socket) => {
    const moi = socket.data.utilisateur.id_utilisateur;
    if (!enLigne.has(moi)) enLigne.set(moi, new Set());
    enLigne.get(moi).add(socket.id);
    const salleDe = (id) => `conv-${id}`;
    const membreDe = (id) => [...socket.rooms].some((r) => r === salleDe(id));

    // Rejoint les salles de MES conversations (vérifiées en base) + présence.
    socket.on('messenger:join', async () => {
      const [rows] = await pool.query(
        'SELECT conversation_id FROM conversation_membres WHERE utilisateur_id = ?',
        [moi]
      );
      for (const r of rows) socket.join(salleDe(r.conversation_id));
      socket.to([...socket.rooms]).emit('messenger:presence', { id_utilisateur: moi, en_ligne: true });
    });

    // Conversation ouverte à l'écran : marquage lu immédiat + accusés.
    socket.on('messenger:conversation-ouverte', async (data) => {
      const id = Number(data && data.conversation_id);
      if (!Number.isInteger(id) || !(await ctrl.estMembre(id, moi))) return;
      socket.join(salleDe(id));
      await ctrl.marquerConversationLue(id, moi);
      const [nonLus] = await pool.query(
        `SELECT m.id FROM messages m
         WHERE m.conversation_id = ? AND m.expediteur_id != ? AND m.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM message_lectures l
                           WHERE l.message_id = m.id AND l.utilisateur_id = ?)`,
        [id, moi, moi]
      );
      for (const m of nonLus) {
        io.to(salleDe(id)).emit('messenger:lu', { conversation_id: id, message_id: m.id, utilisateur_id: moi });
      }
    });

    // Envoi instantané (alternative au POST HTTP, même contrôleur, mêmes règles).
    socket.on('messenger:envoi', async (data, accuser) => {
      try {
        const conversationId = Number(data && data.conversation_id);
        if (!Number.isInteger(conversationId)) throw new Error('Identifiant invalide.');
        const { message } = await ctrl.creerMessage({
          expediteurId: moi,
          conversationId,
          contenu: data && data.contenu,
          repondreA: data && data.repondre_a != null ? Number(data.repondre_a) : null,
          planningId: data && data.planning_id != null ? Number(data.planning_id) : null,
        });
        socket.join(salleDe(conversationId));
        socket.to(salleDe(conversationId)).emit('messenger:message', { message });
        if (typeof accuser === 'function') accuser({ ok: true, message });
      } catch (e) {
        if (typeof accuser === 'function') accuser({ ok: false, erreur: e.message });
      }
    });

    // "Est en train d'écrire" : volatile, jamais en base.
    socket.on('messenger:typing', (data) => {
      const id = Number(data && data.conversation_id);
      if (!Number.isInteger(id) || !membreDe(id)) return;
      socket.to(salleDe(id)).emit('messenger:typing', {
        conversation_id: id,
        utilisateur_id: moi,
        ecrit: Boolean(data && data.ecrit),
      });
    });

    // Diffusion d'une modification / suppression (l'auteur a déjà persisté via
    // le REST ; on relaie aux autres membres de la salle).
    socket.on('messenger:message-modifie', (data) => {
      const id = Number(data && data.conversation_id);
      if (!Number.isInteger(id) || !membreDe(id) || !data.message) return;
      socket.to(salleDe(id)).emit('messenger:message-modifie', { message: data.message });
    });
    socket.on('messenger:message-supprime', (data) => {
      const id = Number(data && data.conversation_id);
      if (!Number.isInteger(id) || !membreDe(id) || !data.message) return;
      socket.to(salleDe(id)).emit('messenger:message-supprime', { message: data.message });
    });

    // --- Déconnexion : présence hors ligne si plus aucun onglet ------------
    socket.on('disconnecting', () => {
      const salles = [...socket.rooms].filter((r) => r.startsWith('conv-'));
      const autresOnglets = (enLigne.get(moi) || new Set()).size > 1;
      if (salles.length > 0 && !autresOnglets) {
        socket.to(salles).emit('messenger:presence', { id_utilisateur: moi, en_ligne: false });
      }
    });
    socket.on('disconnect', () => {
      const ensemble = enLigne.get(moi);
      if (ensemble) {
        ensemble.delete(socket.id);
        if (ensemble.size === 0) enLigne.delete(moi);
      }
    });
  });

  // Expose la liste des ids en ligne (utile pour un futur endpoint REST).
  io.utilisateursEnLigne = () => [...enLigne.keys()];
  // Pont partagé : les contrôleurs diffusent via emetteur.js (sans cycle).
  definirIo(io);
  return io;
}

module.exports = { initSocket, enLigne };
