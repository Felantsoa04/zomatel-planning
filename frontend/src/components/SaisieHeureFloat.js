'use client';

// Champ d'heure en LISTE DEROULANTE SCROLLABLE (pas de saisie libre).
// Clic sur le champ -> dropdown limite en hauteur (scroll vertical molette/
// tactile/barre), positionne automatiquement sur l'heure deja selectionnee.
// Clic sur une heure -> selection + fermeture. La valeur remontee au parent
// reste en HH:mm : API, base MariaDB (TIME) et emploi du temps inchanges.
// Options : 00:00 -> 24:00, pas de 30 min (24:00 = fin de plage jusqu'a
// minuit ; une valeur existante hors grille, ex. 07:15, est ajoutee en tete
// pour ne jamais la perdre).

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

const pad = (n) => String(n).padStart(2, '0');

// Grille complete 00:00 -> 24:00 (pas de 30 minutes) ; 24:00 sert
// d'heure de fin pour les plages allant jusqu'a minuit.
const OPTIONS_BASE = (() => {
  const out = [];
  for (let h = 0; h <= 23; h++) {
    out.push(`${pad(h)}:00`, `${pad(h)}:30`);
  }
  out.push('24:00');
  return out;
})();

export default function SaisieHeureFloat({ label, valeurHHmm, onChange }) {
  const [ouvert, setOuvert] = useState(false);
  const wrapperRef = useRef(null);
  const listeRef = useRef(null);
  const actifRef = useRef(null);

  const valeur = valeurHHmm ? valeurHHmm.slice(0, 5) : '';

  // Options : grille de base + valeur existante hors grille (ex. 04:30, 24:00)
  const options = OPTIONS_BASE.includes(valeur) || !valeur
    ? OPTIONS_BASE
    : [valeur, ...OPTIONS_BASE];

  // Fermeture au clic exterieur ou via Echap
  useEffect(() => {
    if (!ouvert) return undefined;
    const horsClic = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOuvert(false);
    };
    const echap = (e) => {
      if (e.key === 'Escape') setOuvert(false);
    };
    document.addEventListener('mousedown', horsClic);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', horsClic);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  // A l'ouverture : defiler automatiquement jusqu'a l'heure selectionnee
  // (centree dans la liste) — pas besoin de scroller depuis 06:00.
  useEffect(() => {
    if (!ouvert || !listeRef.current) return;
    const liste = listeRef.current;
    const actif = actifRef.current;
    if (actif) {
      liste.scrollTop =
        actif.offsetTop - liste.clientHeight / 2 + actif.offsetHeight / 2;
    } else {
      liste.scrollTop = 0;
    }
  }, [ouvert, valeur]);

  function choisir(hhmm) {
    onChange(hhmm);
    setOuvert(false);
  }

  return (
    <div className="card-float-heure shf" ref={wrapperRef}>
      <label>{label}</label>
      <button
        type="button"
        className="shf-champ"
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
      >
        {valeur || '—'}
        <span className="shf-fleche" aria-hidden="true"><ChevronDown size={14} /></span>
      </button>

      {ouvert && (
        <ul className="shf-liste" role="listbox" ref={listeRef}>
          {options.map((h) => {
            const actif = h === valeur;
            return (
              <li key={h} role="option" aria-selected={actif}>
                <button
                  type="button"
                  ref={actif ? actifRef : null}
                  className={`shf-option${actif ? ' shf-option-active' : ''}`}
                  onClick={() => choisir(h)}
                >
                  <span>{h}</span>
                  {actif && <span className="shf-check" aria-hidden="true"><Check size={13} /></span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
