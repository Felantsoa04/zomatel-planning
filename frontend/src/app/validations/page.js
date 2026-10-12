'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Eye, RefreshCw } from 'lucide-react';
import AppShell from '@/components/AppShell';
import BadgeStatutPlanning, { IconeStatutPlanning } from '@/components/BadgeStatutPlanning';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

function dateEtHeure(valeur, langue) {
  if (!valeur) return '—';
  const date = new Date(String(valeur).replace(' ', 'T'));
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString({ fr: 'fr-FR', mg: 'mg-MG', en: 'en-GB' }[langue], { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' });
}

function dateCourte(valeur, langue) {
  if (!valeur) return '—';
  const date = new Date(`${String(valeur).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString({ fr: 'fr-FR', mg: 'mg-MG', en: 'en-GB' }[langue]);
}

export default function ValidationsPage() {
  const { langue, t } = useI18n();
  const [plannings, setPlannings] = useState([]);
  const [filtre, setFiltre] = useState('');
  const [loading, setLoading] = useState(true);
  const [actualisation, setActualisation] = useState(0);
  const [error, setError] = useState('');
  const router = useRouter();
  const filtres = [
    { valeur: '', cle: 'validation.all' },
    { valeur: 'SOUMIS', cle: 'validation.pending' },
    { valeur: 'VALIDE', cle: 'validation.approved' },
    { valeur: 'REJETE', cle: 'validation.rejected' },
  ];

  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      router.replace('/login');
      return;
    }
    let annule = false;
    setLoading(true);
    setError('');
    const query = filtre ? `?statut=${encodeURIComponent(filtre)}` : '';
    api.get(`/plannings/validations${query}`, token)
      .then((rows) => {
        if (!annule) setPlannings(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (!annule) setError(err.message);
      })
      .finally(() => {
        if (!annule) setLoading(false);
      });
    return () => { annule = true; };
  }, [filtre, actualisation, router]);

  return (
    <AppShell>
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <ClipboardCheck size={20} aria-hidden="true" /> {t('validation.title')}
          </h1>
          <button className="btn secondary" onClick={() => setActualisation((n) => n + 1)} disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" /> {t('common.refresh')}
          </button>
        </div>

        <section className="dash-carte">
          <div role="group" aria-label={t('validation.filterByStatus')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {filtres.map((item) => (
              <button
                key={item.valeur || 'tous'}
                type="button"
                className={filtre === item.valeur ? 'btn' : 'btn secondary'}
                aria-pressed={filtre === item.valeur}
                aria-label={t(item.cle)}
                title={t(item.cle)}
                onClick={() => setFiltre(item.valeur)}
              >
                {item.valeur
                  ? <span className={`badge ${item.valeur}`} aria-hidden="true"><IconeStatutPlanning statut={item.valeur} /></span>
                  : t(item.cle)}
              </button>
            ))}
          </div>

          {error && <div className="error" role="alert">{error}</div>}
          {loading ? (
            <p className="muted">{t('planning.loading')}</p>
          ) : plannings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{t('validation.noPlans')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>{t('common.service')}</th>
                    <th>{t('common.week')}</th>
                    <th>{t('common.startDate')}</th>
                    <th>{t('common.endDate')}</th>
                    <th>{t('validation.chef')}</th>
                    <th>{t('validation.submittedAt')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plannings.map((planning) => (
                    <tr key={planning.id_planning}>
                      <td style={{ fontWeight: 600 }}>{planning.service_nom}</td>
                      <td>S{planning.numero_semaine} / {planning.annee}</td>
                      <td>{dateCourte(planning.date_debut, langue)}</td>
                      <td>{dateCourte(planning.date_fin, langue)}</td>
                      <td>{planning.chef_service || planning.cree_par_nom || '—'}</td>
                      <td>{dateEtHeure(planning.date_soumission, langue)}</td>
                      <td><BadgeStatutPlanning statut={planning.statut} /></td>
                      <td>
                        <Link
                          href={`/planning/${planning.id_planning}`}
                          className="btn-icone"
                          title={t('validation.review')}
                          aria-label={t('validation.reviewLabel', { service: planning.service_nom, week: planning.numero_semaine })}
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
        </section>
      </div>
    </AppShell>
  );
}
