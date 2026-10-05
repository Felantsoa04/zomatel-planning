/* CLIENT SOCKET.IO du Messenger — singleton partagé (un seul socket par
 * onglet navigateur, quelle que soit la page). L'authentification utilise le
 * MÊME JWT que l'API (handshake.auth.token), aucune nouvelle session n'est
 * créée. La connexion est paresseuse : le socket n'est ouvert que si un token
 * existe, et se reconnecte seul après une reconnexion de session.
 */
import { io } from 'socket.io-client';
import { getToken } from './auth';

// URL de base de l'API sans le suffixe /api (le socket écoute à la racine).
const BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');

let socket = null;

export function socketMessenger() {
  if (typeof window === 'undefined') return null;
  const token = getToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (socket) { try { socket.disconnect(); } catch { /* ignore */ } }
  socket = io(BASE, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
    reconnectionDelay: 1500,
  });
  return socket;
}

export function fermerSocketMessenger() {
  if (socket) { try { socket.disconnect(); } catch { /* ignore */ } socket = null; }
}
