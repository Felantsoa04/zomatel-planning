'use client';

/* MESSENGER BADGE — écoute globale des événements de la messagerie.
 * Le composant MessengerPage diffuse l'événement window
 * "zomatel:messenger" (nombre de non-lus calculé côté données réelles) ;
 * ce pont évite d'ouvrir un socket dans DashShell (une seule connexion par
 * onglet, ouverte par la page Messagerie). Le badge reste donc à jour dès
 * qu'un message arrive pendant que la page /messagerie est ouverte, et au
 * retour sur une autre page (le composant relit aussi le compteur REST au
 * montage pour les cas hors page messagerie).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function MessengerBadge() {
  const [nonLus, setNonLus] = useState(0);

  useEffect(() => {
    let actif = true;
    async function maj() {
      const token = getToken();
      if (!token) return;
      try {
        const { non_lus } = await api.get('/messenger/unread-count', token);
        if (actif) setNonLus(Number(non_lus) || 0);
      } catch { /* silencieux : le badge ne doit pas casser la page */ }
    }
    maj();
    function surEvenement(ev) {
      if (ev.detail && typeof ev.detail.non_lus === 'number') setNonLus(ev.detail.non_lus);
      else maj(); // { type: 'recu' } : on relit le compteur réel
    }
    window.addEventListener('zomatel:messenger', surEvenement);
    const id = setInterval(maj, 30000); // filet de sécurité (hors page messagerie)
    return () => {
      actif = false;
      window.removeEventListener('zomatel:messenger', surEvenement);
      clearInterval(id);
    };
  }, []);

  return nonLus > 0 ? <span className="msg-badge-menu">{nonLus > 99 ? '99+' : nonLus}</span> : null;
}
