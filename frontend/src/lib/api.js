// Petit wrapper fetch : ajoute automatiquement l'URL de base de l'API
// et le token JWT (si present) dans l'en-tete Authorization.

import { logout, getToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function tokenDeSession(token) {
  const valeur = token || getToken();
  if (typeof valeur !== 'string') return null;
  const normalise = valeur.trim();
  return normalise && normalise !== 'null' && normalise !== 'undefined' ? normalise : null;
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const jeton = tokenDeSession(token);
  if (jeton) headers.Authorization = `Bearer ${jeton}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 401 hors endpoint de login = token absent, expiré ou invalide (le JWT dure 8 h).
  // On termine proprement la session perimee et on renvoie au login au lieu de
  // laisser la page bloquee avec des erreurs 401 en console.
  if (res.status === 401 && path.split('?')[0] !== '/auth/login') {
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

// Extrait { blob, nomFichier } d'une réponse de téléchargement : le nom est
// lu dans l'en-tête Content-Disposition renvoyé par le backend.
async function reponseFichier(res) {
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^";]+)"?/i);
  let nomFichier = 'emploi-du-temps.xlsx';
  if (m) {
    try { nomFichier = decodeURIComponent(m[1]); } catch { nomFichier = m[1]; }
  }
  return { blob: await res.blob(), nomFichier };
}

// Téléchargement binaire authentifié (ex. export Excel de l'emploi du temps).
// Même authentification que request() : JWT dans l'en-tête Authorization
// (token explicite, sinon token stocké par l'application).
// Retourne { blob, nomFichier }.
async function telecharger(path, token) {
  const t = tokenDeSession(token);
  const headers = {};
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_URL}${path}`, { headers });

  // Même traitement de session expirée que request()
  if (res.status === 401 && path.split('?')[0] !== '/auth/login') {
    logout();
    if (typeof window !== 'undefined') window.location.replace('/login');
    throw new Error('Session expiree, veuillez vous reconnecter.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Erreur ${res.status}`);
  }

  return reponseFichier(res);
}

// Téléchargement binaire d'un POST avec body JSON (ex. export groupé :
// plusieurs plannings sélectionnés -> un seul classeur Excel). Même
// authentification et même retour { blob, nomFichier } que telecharger().
async function telechargerPost(path, body, token) {
  const t = tokenDeSession(token);
  const headers = { 'Content-Type': 'application/json' };
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });

  if (res.status === 401 && path.split('?')[0] !== '/auth/login') {
    logout();
    if (typeof window !== 'undefined') window.location.replace('/login');
    throw new Error('Session expiree, veuillez vous reconnecter.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Erreur ${res.status}`);
  }

  return reponseFichier(res);
}

// Envoi de FICHIER (multipart/form-data) : meme authentification JWT que
// request(), mais sans Content-Type JSON (le navigateur fixe la frontiere
// multipart). Utilise pour la photo de profil (champ "photo", PUT) et pour
// les pieces jointes du Messenger (champ parametrable, POST).
async function envoyerFichier(path, fichier, token, { champ = 'photo', methode = 'PUT', champsSup = null } = {}) {
  const t = tokenDeSession(token);
  const body = new FormData();
  body.append(champ, fichier, fichier.name);
  // Champs textuels additionnels (ex. legende d'une piece jointe Messenger).
  if (champsSup) {
    for (const [cle, valeur] of Object.entries(champsSup)) {
      if (valeur !== undefined && valeur !== null) body.append(cle, String(valeur));
    }
  }

  const headers = {};
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_URL}${path}`, { method: methode, headers, body });

  if (res.status === 401 && path.split('?')[0] !== '/auth/login') {
    logout();
    if (typeof window !== 'undefined') window.location.replace('/login');
    throw new Error('Session expiree, veuillez vous reconnecter.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Erreur ${res.status}`);
  }
  return data;
}

export const api = {
  get: (path, token) => request(path, { token }),
  getBrut: (path, token) => telecharger(path, token),
  post: (path, body, token) => request(path, { method: 'POST', body, token }),
  postBrut: (path, body, token) => telechargerPost(path, body, token),
  put: (path, body, token) => request(path, { method: 'PUT', body, token }),
  patch: (path, body, token) => request(path, { method: 'PATCH', body, token }),
  delete: (path, token) => request(path, { method: 'DELETE', token }),
  uploadPhoto: (path, fichier, token) => envoyerFichier(path, fichier, token),
  // Piece jointe Messenger : POST multipart, champ "fichier", + champs textuels.
  envoyerPieceJointe: (path, fichier, token, champsSup) =>
    envoyerFichier(path, fichier, token, { champ: 'fichier', methode: 'POST', champsSup }),
};