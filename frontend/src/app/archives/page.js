'use client';

// PAGE ARCHIVES — consultation des anciens plannings.
// REGLE PROJET : aucun systeme d'archivage dedie n'existe en base (aucune
// colonne/etiquette ARCHIVE). Les archives sont donc les plannings VALIDES
// dont la semaine est PASSEE (date_fin < aujourd'hui) — donnees 100 % reelles
// via l'API existante GET /plannings?statut=VALIDE (filtrage serveur par role :
// un chef ne recoit que son service). Consultation via la page planning/[id]
// existante (bouton Consulter, actions selon permissions).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Archive, Eye, Search } from 'lucide-react';
import AppShell from '@/components/AppShell';
import BadgeStatutPlanning from '@/components/BadgeStatutPlanning';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

function finSemainePassee(dateFin) {
  const d = new Date(String(dateFin).slice(0, 10));
  return d.getTime() < new Date().setHours(0, 0, 0, 0);
}

function periode(p) {
  const fmt = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '?');
  return `${fmt(p.date_debut)} → ${fmt(p.date_fin)}`;
}

// "2026-09-27 14:03:00" -> "27/09/2026 à 14:03" (date de validation)
function formatDateHeure(str) {
  if (!str) return '—';
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(str);
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ArchivesPage() {
  const { t } = useI18n();
  const [plannings, setPlannings] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [anneeFiltre, setAnneeFiltre] = useState('');
  const router = useRouter();

  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        // API existante : statut VALIDE seulement, tri annee/semaine DESC.
        const liste = await api.get('/plannings?statut=VALIDE', t);
        setPlannings(Array.isArray(liste) ? liste : []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Archives = valides ET semaine passee. Les valides a venir restent dans
  // l'espace « Plannings » (pas d'historique futur).
  const archives = useMemo(
    () => plannings.filter((p) => finSemainePassee(p.date_fin)),
    [plannings]
  );

  const annees = useMemo(
    () => [...new Set(archives.map((p) => p.annee))].sort((a, b) => b - a),
    [archives]
  );

  const archivesFiltrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return archives.filter((p) => {
      if (anneeFiltre && String(p.annee) !== String(anneeFiltre)) return false;
      if (!q) return true;
      return (
        String(p.service_nom || '').toLowerCase().includes(q) ||
        `s${p.numero_semaine}`.includes(q) ||
        String(p.annee).includes(q)
      );
    });
  }, [archives, recherche, anneeFiltre]);

  return (
    <AppShell>
      <div className="container">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Archive size={20} aria-hidden="true" /> {t('archives.title')}
        </h1>
        <p className="muted">
          {t('archives.description')}
        </p>
        {error && <div className="error">{error}</div>}

        <div className="card">
          <div className="arch-filtres">
            <div className="form-row" style={{ flex: 1, minWidth: 220 }}>
              <input
                placeholder={t('archives.searchPlaceholder')}
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
            </div>
            <div className="form-row" style={{ width: 'auto' }}>
              <select value={anneeFiltre} onChange={(e) => setAnneeFiltre(e.target.value)}>
                <option value="">{t('dashboard.allYears')}</option>
                {annees.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <span className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
              {archivesFiltrees.length} {t('archives.count')}
            </span>
          </div>

          {loading ? (
            <p className="muted">{t('common.loading')}</p>
          ) : archivesFiltrees.length === 0 ? (
            <p className="muted" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search size={15} aria-hidden="true" />
              {archives.length === 0 ? t('archives.emptyNone') : t('archives.emptySearch')}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('common.service')}</th>
                    <th>{t('common.week')}</th>
                    <th>{t('dashboard.period')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('planning.totalHours')}</th>
                    <th>Validé le</th>
                    <th>Validé par</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {archivesFiltrees.map((p) => (
                    <tr key={p.id_planning}>
                      <td>{p.service_nom}</td>
                      <td>S{p.numero_semaine} · {p.annee}</td>
                      <td>{periode(p)}</td>
                      <td><BadgeStatutPlanning statut={p.statut} /></td>
                      <td>
                        {p.total_heures != null ? `${Number(p.total_heures).toFixed(1)} h` : <span className="muted">—</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {p.date_validation
                          ? formatDateHeure(p.date_validation)
                          : <span className="muted">—</span>}
                      </td>
                      <td>
                        {p.valide_par || <span className="muted">—</span>}
                      </td>
                      <td>
                        <Link
                          href={`/planning/${p.id_planning}`}
                          className="btn-icone"
                          title={t('archives.viewArchive')}
                        >
                          <Eye size={15} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
