'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RetourButton from '@/components/RetourButton';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

// Calcule le numero de semaine ISO a partir d'une date
function numeroSemaineISO(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export default function NewPlanningPage() {
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!dateDebut || !dateFin) return;

    const debut = new Date(dateDebut);
    const annee = debut.getFullYear();
    const numero_semaine = numeroSemaineISO(debut);

    setLoading(true);
    try {
      const token = getToken();
      // La CREATION est reservee au chef de service (POST /plannings protege par
      // requireRole('CHEF_SERVICE')) : on evite le POST voue a un 403.
      if (getUser()?.role !== 'CHEF_SERVICE') {
        setError("Seul le chef de service peut créer un planning.");
        setLoading(false);
        return;
      }
      const { id_planning } = await api.post(
        '/plannings',
        { annee, numero_semaine, date_debut: dateDebut, date_fin: dateFin },
        token
      );
      router.push(`/planning/${id_planning}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div className="container" style={{ maxWidth: 480 }}>
        <RetourButton fallback="/dashboard" hasUnsaved={!!dateDebut || !!dateFin} />
        <h1>Nouveau planning</h1>
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <label>Date de debut (lundi)</label>
              <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} required />
            </div>
            <div className="form-row">
              <label>Date de fin (dimanche)</label>
              <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} required />
            </div>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Creation...' : 'Creer le planning'}
            </button>
            {error && <div className="error">{error}</div>}
          </form>
        </div>
      </div>
    </div>
  );
}