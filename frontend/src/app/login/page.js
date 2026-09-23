'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { saveSession } from '@/lib/auth';

export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post('/auth/login', { login, mot_de_passe: motDePasse });
      // L'Employe n'utilise pas l'application (aucun espace personnel, aucune
      // page) : sa connexion est refusee ici, avant la creation de session.
      if (data.user?.role === 'EMPLOYE') {
        setError("Les employés n'ont pas d'accès à l'application. Seuls l'Administrateur, la RH et les Chefs de service se connectent.");
        setLoading(false);
        return;
      }
      saveSession(data.token, data.user);
      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: 80 }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Connexion</h1>
        <p className="muted">Espace Chef de service / RH</p>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>Identifiant</label>
            <input value={login} onChange={(e) => setLogin(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Mot de passe</label>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </div>
  );
}