'use client';

/* BOUTON MESSAGES (topbar) — element distinct de la cloche de notifications
 * (exigence 15). Icône MessageCircle (lucide-react, aucun emoji), badge
 * ROUGE du nombre de non-lus (données réelles de /messenger/unread-count),
 * synchronisé avec l'événement existant 'zomatel:messenger' émis par la page
 * Messagerie. Clic -> /messagerie.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function MessengerBouton() {
  const [nonLus, setNonLus] = useState(0);
  const router = useRouter();

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

  return (
    <button
      type="button"
      className="notif-btn"
      onClick={() => router.push('/messagerie')}
      aria-label={`Messages (${nonLus} non lus)`}
      title="Messages"
    >
      <MessageCircle size={18} aria-hidden="true" />
      {nonLus > 0 && <span className="notif-badge">{nonLus > 99 ? '99+' : nonLus}</span>}
    </button>
  );
}
