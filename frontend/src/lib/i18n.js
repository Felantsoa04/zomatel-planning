'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import fr from '@/locales/fr/common.json';
import mg from '@/locales/mg/common.json';
import en from '@/locales/en/common.json';

export const LANGUE_PAR_DEFAUT = 'fr';
export const CLE_LANGUE = 'zomatel:langue';
export const LANGUES = [
  { code: 'fr', nom: 'Français' },
  { code: 'mg', nom: 'Malagasy' },
  { code: 'en', nom: 'English' },
];

const CATALOGUES = { fr, mg, en };
const I18nContext = createContext(null);

function langueValide(langue) {
  return Object.prototype.hasOwnProperty.call(CATALOGUES, langue) ? langue : LANGUE_PAR_DEFAUT;
}

function traduire(catalogue, cle, valeurs) {
  let texte = catalogue[cle] || fr[cle] || cle;
  if (valeurs) {
    for (const [nom, valeur] of Object.entries(valeurs)) {
      texte = texte.replaceAll(`{${nom}}`, String(valeur));
    }
  }
  return texte;
}

export function I18nProvider({ children }) {
  const [langue, setLangueEtat] = useState(LANGUE_PAR_DEFAUT);

  useEffect(() => {
    let sauvegardee = LANGUE_PAR_DEFAUT;
    try {
      sauvegardee = langueValide(localStorage.getItem(CLE_LANGUE));
    } catch {
      // La langue par défaut reste disponible sans stockage navigateur.
    }
    setLangueEtat(sauvegardee);
  }, []);

  useEffect(() => {
    document.documentElement.lang = langue;
  }, [langue]);

  function setLangue(nouvelleLangue) {
    const validee = langueValide(nouvelleLangue);
    setLangueEtat(validee);
    try {
      localStorage.setItem(CLE_LANGUE, validee);
    } catch {
      // Le changement reste actif pour cette session.
    }
  }

  const valeur = useMemo(() => ({
    langue,
    setLangue,
    t: (cle, variables) => traduire(CATALOGUES[langue], cle, variables),
  }), [langue]);

  return <I18nContext.Provider value={valeur}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const contexte = useContext(I18nContext);
  if (!contexte) throw new Error('useI18n doit être utilisé dans I18nProvider.');
  return contexte;
}
