'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, LockKeyhole, LoaderCircle, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { saveSession, getUser } from '@/lib/auth';
import { dashboardDe } from '@/lib/dash';
import ThemeToggle, { appliquerTheme, lireTheme } from '@/components/ThemeToggle';
import { useI18n } from '@/lib/i18n';

export default function LoginPage() {
  const { t } = useI18n();
  const [login, setLogin] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);
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
      if (err.message === 'Identifiants incorrects.') {
        setError(t('login.invalidCredentials'));
      } else if (err.message.includes("Les employés n'ont pas d'accès")) {
        setError(t('login.noAccess'));
      } else {
        setError(t('login.unavailable'));
      }
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
        <section className="login-marque" aria-label="Présentation de Zomatel Planning">
          <div className="login-identite">
            <img src="/logo-zomatel-embleme.svg" alt="Zomatel" className="login-embleme" />
          </div>
          <div className="login-presentation">
            <h1>{t('app.name')}</h1>
            <p>{t('login.tagline')}</p>
          </div>
        </section>

        <section className="login-formulaire">
          <div className="login-formulaire-entete">
            <p className="login-soustitre">{t('login.title')}</p>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="login-champ">
              <label htmlFor="login-identifiant">{t('login.username')}</label>
              <div className="login-champ-controle">
                <UserRound size={18} aria-hidden="true" />
                <input
                  id="login-identifiant"
                  name="username"
                  type="text"
                  placeholder={t('login.username')}
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                  disabled={loading}
                />
              </div>
            </div>
            <div className="login-champ">
              <label htmlFor="login-mot-de-passe">{t('login.password')}</label>
              <div className="login-champ-controle">
                <LockKeyhole size={18} aria-hidden="true" />
                <input
                  id="login-mot-de-passe"
                  name="password"
                  type={motDePasseVisible ? 'text' : 'password'}
                  placeholder={t('login.password')}
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
                <button
                  className="login-visibilite"
                  type="button"
                  onClick={() => setMotDePasseVisible((visible) => !visible)}
                  aria-label={motDePasseVisible ? t('login.hidePassword') : t('login.showPassword')}
                  aria-pressed={motDePasseVisible}
                  disabled={loading}
                >
                  {motDePasseVisible
                    ? <EyeOff size={18} aria-hidden="true" />
                    : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>
            <button className="login-submit" type="submit" disabled={loading || !login || !motDePasse}>
              {loading
                ? <><LoaderCircle size={18} className="login-spinner" aria-hidden="true" /> {t('login.loading')}</>
                : t('login.submit')}
            </button>
            {error && <div className="login-erreur" role="alert">{error}</div>}
          </form>
          <p className="login-acces-note">{t('login.accessNote')}</p>
        </section>
      </div>
    </div>
  );
}