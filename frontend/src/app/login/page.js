'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { saveSession, getUser } from '@/lib/auth';
import { dashboardDe } from '@/lib/dash';
import ThemeToggle, { appliquerTheme, lireTheme } from '@/components/ThemeToggle';

export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Theme persiste : applique des le montage de la page Login (meme bascule
  // que la topbar, cf. ThemeToggle). Le script inline du layout evite le flash.
  useEffect(() => {
    appliquerTheme(lireTheme());
  }, []);

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
      // Redirection automatique vers le dashboard du role (verifie cote
      // serveur : le role vient de MariaDB via le JWT, jamais du frontend).
      const cible = dashboardDe(data.user?.role || getUser()?.role);
      router.push(cible || '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-ecran">
      {/* Bascule clair/sombre : coin haut droit, avant le formulaire. */}
      <div className="login-theme">
        <ThemeToggle variante="login" />
      </div>
      <div className="login-carte">
        <img src="/logo-zomatel.svg" alt="Zomatel — L'évasion au naturel" className="login-logo" />
        <p className="login-soustitre">Gestion des plannings — Espace Chef de service / RH</p>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>Email</label>
            <input value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
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
          <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </div>
  );
}