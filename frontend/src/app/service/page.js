'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hotel, Trash2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import Modal from '@/components/Modal';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import { useI18n } from '@/lib/i18n';

export default function ServicesPage() {
  const { t } = useI18n();
  const { autorise } = usePermissions();
  const peutGerer = autorise('service.manage');
  const [services, setServices] = useState([]);
  const [nom, setNom] = useState('');
  const [typeAffichage, setTypeAffichage] = useState('PERIODES_FIXES');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalAjout, setModalAjout] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setToken(t);
    charger(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function charger(tokenActuel) {
    try {
      const data = await api.get('/services', tokenActuel);
      setServices(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function ajouter(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/services', { nom, type_affichage: typeAffichage }, token);
      setNom('');
      setTypeAffichage('PERIODES_FIXES');
      await charger(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function supprimer(id_service) {
    if (!confirm('Supprimer ce service ? Cette action est irreversible.')) return;
    setError('');
    try {
      await api.delete(`/services/${id_service}`, token);
      await charger(token);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <PageShell><p className="muted">{t('common.loading')}</p></PageShell>;

  return (
    <PageShell>
      {/* Bouton Ajouter a cote du titre */}
      <div className="tete-page">
        <h1>{t('services.title')}</h1>
        {peutGerer && (
          <button className="btn btn-ajout" onClick={() => { setError(''); setModalAjout(true); }}>
            <Hotel size={15} aria-hidden="true" /> {t('services.add')}
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      {peutGerer && modalAjout && (
        <Modal titre={t('services.add')} onClose={() => setModalAjout(false)} largeur={480}>
          <form onSubmit={ajouter}>
            <div className="form-row">
              <label>{t('services.name')}</label>
              <input value={nom} onChange={(e) => setNom(e.target.value)} required />
            </div>
            <div className="form-row">
              <label>{t('services.displayType')}</label>
              <select value={typeAffichage} onChange={(e) => setTypeAffichage(e.target.value)}>
                <option value="PERIODES_FIXES">{t('services.fixedPeriods')}</option>
                <option value="HORAIRE_LIBRE">{t('services.flexibleHours')}</option>
                <option value="SHIFT_POSTE">{t('services.shiftsPosts')}</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn secondary" type="button" onClick={() => setModalAjout(false)}>{t('common.cancel')}</button>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? t('common.adding') : t('common.add')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t('services.name')}</th>
              <th>{t('services.displayType')}</th>
              {peutGerer && <th></th>}
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id_service}>
                <td>{s.nom}</td>
                <td>
                  {s.type_affichage === 'HORAIRE_LIBRE'
                    ? t('services.flexibleHoursShort')
                    : s.type_affichage === 'SHIFT_POSTE'
                      ? t('services.shiftsPostsShort')
                      : t('services.fixedPeriodsShort')}
                </td>
                {peutGerer && (
                  <td>
                    <button className="btn-icone danger" title={t('common.delete')} onClick={() => supprimer(s.id_service)}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <AppShell>
      <div className="container">{children}</div>
    </AppShell>
  );
}