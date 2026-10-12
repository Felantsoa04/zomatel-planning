'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser, saveSession } from '@/lib/auth';

export function usePermissions() {
  const [permissions, setPermissions] = useState([]);
  const [chargees, setChargees] = useState(false);

  useEffect(() => {
    const token = getToken();
    const utilisateur = getUser();
    if (!token || !utilisateur) {
      setChargees(true);
      return;
    }
    api.get('/auth/me', token).then((reponse) => {
      const compte = reponse?.user;
      if (!compte || !Array.isArray(compte.permissions)) {
        throw new Error('Les autorisations du compte ne sont pas disponibles.');
      }
      setPermissions(compte.permissions);
      saveSession(token, { ...utilisateur, ...compte });
    }).catch(() => {
      setPermissions([]);
    }).finally(() => setChargees(true));
  }, []);

  const autorise = (...codes) => codes.every((code) => permissions.includes(code));
  return { permissions, chargees, autorise };
}

export function permissionRequisePourPage(pathname) {
  if (pathname === '/validations') return [['planning.validate']];
  if (pathname === '/planning/gestion') return [['planning.view', 'planning.create']];
  if (pathname.startsWith('/planning/')) return [['planning.view', 'planning.validate']];
  if (pathname === '/employees') return [['employe.view']];
  if (pathname === '/service') return [['service.manage']];
  if (pathname === '/utilisateurs') return [['user.view']];
  if (pathname === '/messagerie') return [['messenger.use']];
  if (pathname === '/statistiques') return [['planning.view'], ['employe.view']];
  if (pathname === '/archives') return [['planning.view']];
  return [];
}
