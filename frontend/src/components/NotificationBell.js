'use client';

// CLOCHE DE NOTIFICATIONS 🔔
// - Badge = nombre de non-lues (GET /notifications/non-lues/count)
// - Clic -> panneau listant les notifications (GET /notifications)
// - Chaque item : titre, message, date/heure, etat lu/non-lu
// - Clic sur un item -> marque comme lue (PATCH /:id/lu) + navigue vers le planning
// - Bouton "Tout marquer comme lu" (PATCH /marquer-tout-lu)
// - Etat vide "Aucune notification"
// Le backend filtre deja par utilisateur connecte : le contenu est donc
// automatiquement adapte au role (RH = soumissions, Chef = decisions, etc.).
// Rafraichissement automatique du badge toutes les 30 s.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function formatDateHeure(str) {
  if (!str) return '';
  // mysql2 (dateStrings) renvoie "YYYY-MM-DD HH:MM:SS"
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(str);
  return d.toLocaleString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function NotificationBell() {
  const [ouvert, setOuvert] = useState(false);
  const [nonLues, setNonLues] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [chargement, setChargement] = useState(false);
  const wrapRef = useRef(null);
  const router = useRouter();

  // Compteur du badge + polling leger
  useEffect(() => {
    let actif = true;
    async function majCompteur() {
      const token = getToken();
      if (!token) return;
      try {
        const { non_lues } = await api.get('/notifications/non-lues/count', token);
        if (actif) setNonLues(Number(non_lues) || 0);
      } catch {
        /* silencieux : le badge ne doit pas casser la page */
      }
    }
    majCompteur();
    const id = setInterval(majCompteur, 30000);
    return () => { actif = false; clearInterval(id); };
  }, []);

  // Fermeture au clic exterieur
  useEffect(() => {
    function auClic(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOuvert(false);
    }
    document.addEventListener('mousedown', auClic);
    return () => document.removeEventListener('mousedown', auClic);
  }, []);

  async function chargerListe() {
    const token = getToken();
    if (!token) return;
    setChargement(true);
    try {
      const liste = await api.get('/notifications?limit=30', token);
      setNotifications(liste);
    } catch {
      setNotifications([]);
    } finally {
      setChargement(false);
    }
  }

  async function basculer() {
    if (!ouvert) await chargerListe();
    setOuvert((o) => !o);
  }

  async function marquerLue(n, naviguer = true) {
    const token = getToken();
    if (!n.lu && token) {
      try {
        await api.patch(`/notifications/${n.id_notification}/lu`, {}, token);
        setNotifications((liste) => liste.map((x) => (x.id_notification === n.id_notification ? { ...x, lu: 1 } : x)));
        setNonLues((c) => Math.max(0, c - 1));
      } catch {
        /* le marquage ne bloque pas la navigation */
      }
    }
    if (naviguer && n.id_planning) {
      setOuvert(false);
      router.push(`/planning/${n.id_planning}`);
    }
  }

  async function toutMarquerLu() {
    const token = getToken();
    if (!token) return;
    try {
      await api.patch('/notifications/marquer-tout-lu', {}, token);
      setNotifications((liste) => liste.map((x) => ({ ...x, lu: 1 })));
      setNonLues(0);
    } catch {
      /* silencieux */
    }
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button className="notif-btn" onClick={basculer} aria-label="Notifications" title="Notifications">
        <span role="img" aria-hidden="true">🔔</span>
        {nonLues > 0 && <span className="notif-badge">{nonLues > 99 ? '99+' : nonLues}</span>}
      </button>

      {ouvert && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <strong>Notifications</strong>
            {nonLues > 0 && (
              <button className="notif-tout-lu" onClick={toutMarquerLu}>
                Tout marquer comme lu
              </button>
            )}
          </div>

          <div className="notif-liste">
            {chargement && <p className="notif-empty">Chargement...</p>}

            {!chargement && notifications.length === 0 && (
              <p className="notif-empty">Aucune notification</p>
            )}

            {!chargement && notifications.map((n) => (
              <button
                key={n.id_notification}
                className={`notif-item ${n.lu ? '' : 'notif-non-lue'}`}
                onClick={() => marquerLue(n)}
                title={n.id_planning ? 'Ouvrir le planning' : undefined}
              >
                <div className="notif-item-haut">
                  {!n.lu && <span className="notif-dot" aria-hidden="true" />}
                  <span className="notif-titre">{n.titre}</span>
                </div>
                {n.message && <div className="notif-message">{n.message}</div>}
                <div className="notif-date">
                  {formatDateHeure(n.date_creation)}
                  {n.id_planning && <span className="notif-lien">Ouvrir →</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
