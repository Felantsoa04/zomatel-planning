'use client';

// PAGE HISTORIQUE — événements réels du compte connecté.
// Source unique : l'API notifications EXISTANTE (GET /notifications), qui
// trace déjà les décisions et soumissions de plannings (date, titre, message).
// Aucune nouvelle table, aucun nouvel endpoint, aucune donnée inventée :
// les colonnes demandées (date, utilisateur, action, élément) correspondent
// aux champs déjà retournés par le backend.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, Bell } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

// "2026-09-27 14:03:00" -> "27/09/2026 14:03"
function formatDateHeure(str) {
  if (!str) return '—';
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(str);
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function HistoriquePage() {
  const [evenements, setEvenements] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    (async () => {
      try {
        const liste = await api.get('/notifications', t);
        setEvenements(Array.isArray(liste) ? liste : []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <div className="container">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={20} aria-hidden="true" /> Historique
        </h1>
        <p className="muted">
          Événements de votre compte : décisions et messages liés aux plannings.
        </p>
        {error && <div className="error">{error}</div>}

        <div className="card">
          {loading ? (
            <p className="muted">Chargement...</p>
          ) : evenements.length === 0 ? (
            <p className="muted" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={15} aria-hidden="true" /> Aucun événement enregistré.
            </p>
          ) : (
            <div>
              {evenements.map((ev) => (
                <div key={ev.id_notification ?? `${ev.date_envoi}-${ev.titre}`} className="hist-item">
                  <span className="hist-date">{formatDateHeure(ev.date_envoi || ev.date_creation)}</span>
                  <span>
                    <strong>{ev.titre || 'Notification'}</strong>
                    {ev.message && (
                      <div className="muted" style={{ fontSize: 13 }}>{ev.message}</div>
                    )}
                    {ev.nom_planning && (
                      <div className="muted" style={{ fontSize: 12 }}>Élément : {ev.nom_planning}</div>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
