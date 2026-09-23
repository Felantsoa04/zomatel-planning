// Petit wrapper fetch : ajoute automatiquement l'URL de base de l'API
// et le token JWT (si present) dans l'en-tete Authorization.

import { logout } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 401 hors endpoint de login = token absent, expiré ou invalide (le JWT dure 8 h).
  // On termine proprement la session perimee et on renvoie au login au lieu de
  // laisser la page bloquee avec des erreurs 401 en console.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    logout();
    if (typeof window !== 'undefined') window.location.replace('/login');
    throw new Error('Session expiree, veuillez vous reconnecter.');
  }

  // 403 « employe » = session residueuse d'un role qui n'utilise pas
  // l'application (rejet specifique du serveur) : on purge la session.
  // Les autres 403 (ex. chef hors de son service) restent des erreurs affichees.
  // Hors /auth/ : une erreur de login doit s'afficher sur la page, pas purger.
  const dataPre = await res.clone().json().catch(() => ({}));
  if (res.status === 403 && !path.startsWith('/auth/') && typeof dataPre.message === 'string' && dataPre.message.includes("Les employés n'ont pas d'accès")) {
    logout();
    if (typeof window !== 'undefined') window.location.replace('/login');
    throw new Error(dataPre.message);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || `Erreur ${res.status}`);
  }
  return data;
}

export const api = {
  get: (path, token) => request(path, { token }),
  post: (path, body, token) => request(path, { method: 'POST', body, token }),
  put: (path, body, token) => request(path, { method: 'PUT', body, token }),
  patch: (path, body, token) => request(path, { method: 'PATCH', body, token }),
  delete: (path, token) => request(path, { method: 'DELETE', token }),
};