'use client';

// PAGE HISTORIQUE — événements réels du compte connecté.
// Sources (API existantes) :
//   1. GET /notifications : décisions et soumissions de plannings
//      (date, titre, message), comportement historique conservé ;
//   2. GET /historique/exports : plannings EXPORTÉS (fichier Excel),
//      tracés côté serveur à chaque export réussi (date, heure, utilisateur,
//      fichier, semaine, services, type simple ou multi-services).
// Aucune table réinventée, aucun événement existant supprimé.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, Bell, FileSpreadsheet } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

// "2026-09-27 14:03:00" -> "27/09/2026 14:03"
function formatDateHeure(str) {
  if (!str) return '—';
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(str);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Liste des services d'un tracé d'export ("réception, Sécurité")
function servicesExportes(details) {
  const noms = [...new Set((details || []).map((d) => d.service).filter(Boolean))];
  if (noms.length === 0) return '—';
  return noms.join(', ');
}

// Semaine exportée ("S49 · 2026")
function semaineExporte(e) {
  if (!e.numero_semaine) return '—';
  return `S${e.numero_semaine} · ${e.annee || ''}`;
}

export default function HistoriquePage() {
  const [evenements, setEvenements] = useState([]);
  const [exports, setExports] = useState([]);
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
      // Les deux sources sont indépendantes : une panne ne masque pas l'autre.
      const [vEvenements, vExports] = await Promise.allSettled([
        api.get('/notifications', t),
        api.get('/historique/exports', t),
      ]);
      if (vEvenements.status === 'fulfilled') setEvenements(Array.isArray(vEvenements.value) ? vEvenements.value : []);
      if (vExports.status === 'fulfilled') setExports(Array.isArray(vExports.value) ? vExports.value : []);
      if (vEvenements.status === 'rejected' || vExports.status === 'rejected') {
        setError(
          [
            vEvenements.status === 'rejected' ? vEvenements.reason.message : null,
            vExports.status === 'rejected' ? vExports.reason.message : null,
          ].filter(Boolean).join(' / ')
        );
      }
      setLoading(false);
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
          Événements de votre compte : décisions de validation, messages et plannings exportés.
        </p>
        {error && <div className="error">{error}</div>}

        {/* PLANNINGS EXPORTÉS (fichiers Excel depuis la rubrique Planning) */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSpreadsheet size={16} aria-hidden="true" /> Plannings exportés
          </h3>
          {loading ? (
            <p className="muted">Chargement…</p>
          ) : exports.length === 0 ? (
            <p className="muted" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              Aucun export de planning enregistré pour votre compte.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date et heure</th>
                    <th>Fichier</th>
                    <th>Semaine</th>
                    <th>Services</th>
                    <th>Plannings</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((e) => (
                    <tr key={e.id_export}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateHeure(e.date_export)}</td>
                      <td>{e.nom_fichier}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{semaineExporte(e)}</td>
                      <td>{servicesExportes(e.details)}</td>
                      <td>
                        <span className="badge" title="Type d'export">
                          {e.type_export === 'MULTI'
                            ? `Multi-services (${e.nb_plannings})`
                            : `Simple (${e.nb_plannings})`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ÉVÉNEMENTS DU COMPTE (décisions, messages — source existante) */}
        <div className="card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={16} aria-hidden="true" /> Événements du compte
          </h3>
          {loading ? (
            <p className="muted">Chargement…</p>
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
