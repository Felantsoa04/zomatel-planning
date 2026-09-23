// Gestion tres simple du token/session cote client (localStorage).
// Suffisant pour un projet de presentation ; a durcir (cookies httpOnly)
// pour une mise en production reelle.

const TOKEN_KEY = 'zomatel_token';
const USER_KEY = 'zomatel_user';

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}