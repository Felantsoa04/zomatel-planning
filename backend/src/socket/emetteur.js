/* PONT SOCKET.IO <-> CONTRÔLEURS (sans dépendance circulaire).
 * socket/index.js enregistre l'instance io ici au démarrage ; les contrôleurs
 * (ex. messengerController) émettent via emettreConversation(). Ainsi UN
 * message créé par REST ou par socket est TOUJOURS diffusé en temps réel aux
 * membres connectés de la conversation. */
let ioInstance = null;

function definirIo(io) {
  ioInstance = io;
}

// Diffuse un événement à la salle d'une conversation (membres vérifiés).
function emettreConversation(conversationId, evenement, payload) {
  if (ioInstance) ioInstance.to(`conv-${conversationId}`).emit(evenement, payload);
}

module.exports = { definirIo, emettreConversation };
