'use client';

/* BASCULE MODE CLAIR / SOMBRE — composant partage (topbar + page Login).
 * - Preference conservee dans localStorage ('zomatel:theme' = 'clair' | 'sombre').
 * - Appliquee via data-theme sur <html> (cf. [data-theme='sombre'] dans globals.css).
 * - Lu APRES montage uniquement (pattern anti-hydratation du projet) : le
 *   premier rendu est neutre, l'icone apparait ensuite sans mismatch.
 * - Sun/Moon : lucide-react uniquement (aucun emoji).
 */

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export const CLE_THEME = 'zomatel:theme';

// Applique le theme au document (utilise aussi par la page Login au montage).
export function appliquerTheme(theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'sombre') document.documentElement.dataset.theme = 'sombre';
  else delete document.documentElement.dataset.theme;
}

// Lit la preference stockee (cote client uniquement).
export function lireTheme() {
  if (typeof window === 'undefined') return 'clair';
  try {
    return localStorage.getItem(CLE_THEME) === 'sombre' ? 'sombre' : 'clair';
  } catch (_) {
    return 'clair';
  }
}

export default function ThemeToggle({ variante = 'topbar' }) {
  const [theme, setTheme] = useState(null); // null = pas encore monte (anti-hydratation)

  useEffect(() => {
    const t = lireTheme();
    appliquerTheme(t);
    setTheme(t);
  }, []);

  function basculer() {
    const nouveau = theme === 'sombre' ? 'clair' : 'sombre';
    setTheme(nouveau);
    appliquerTheme(nouveau);
    try {
      localStorage.setItem(CLE_THEME, nouveau);
    } catch (_) {
      /* stockage indisponible : le choix reste pour la session */
    }
  }

  // Premier rendu : bouton neutre (evite tout mismatch d'hydratation).
  if (theme === null) {
    return <span className={`theme-toggle theme-toggle-${variante}`} aria-hidden="true" />;
  }

  const sombre = theme === 'sombre';
  return (
    <button
      type="button"
      className={`theme-toggle theme-toggle-${variante}`}
      onClick={basculer}
      title={sombre ? 'Passer en mode clair' : 'Passer en mode sombre'}
      aria-label={sombre ? 'Passer en mode clair' : 'Passer en mode sombre'}
      aria-pressed={sombre}
    >
      {sombre ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
}
