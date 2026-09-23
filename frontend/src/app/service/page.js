'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RetourButton from '@/components/RetourButton';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

export default function ServicesPage() {
  const [services, setServices] = useState([]);
  const [nom, setNom] = useState('');
  const [typeAffichage, setTypeAffichage] = useState('PERIODES_FIXES');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  if (loading) return <PageShell><p className="muted">Chargement...</p></PageShell>;

  return (
    <PageShell>
      <RetourButton fallback="/dashboard" hasUnsaved={nom !== ''} />
      <h1>Services</h1>
      {error && <div className="error">{error}</div>}

      {user?.role === 'RH' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Ajouter un service</h3>
          <form onSubmit={ajouter} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-row">
              <label>Nom du service</label>
              <input value={nom} onChange={(e) => setNom(e.target.value)} required />
            </div>
            <div className="form-row">
              <label>Type d&apos;affichage</label>
              <select value={typeAffichage} onChange={(e) => setTypeAffichage(e.target.value)}>
                <option value="PERIODES_FIXES">Périodes fixes (matin/après-midi/soir)</option>
                <option value="HORAIRE_LIBRE">Horaire libre (jours × horaires)</option>
              </select>
            </div>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Ajout...' : 'Ajouter'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Type d&apos;affichage</th>
              {user?.role === 'RH' && <th></th>}
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id_service}>
                <td>{s.nom}</td>
                <td>{s.type_affichage === 'HORAIRE_LIBRE' ? 'Horaire libre' : 'Périodes fixes'}</td>
                {user?.role === 'RH' && (
                  <td>
                    <button className="btn danger" onClick={() => supprimer(s.id_service)}>
                      Supprimer
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
    <div>
      <Navbar />
      <div className="container">{children}</div>
    </div>
  );
}