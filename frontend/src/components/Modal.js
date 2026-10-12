'use client';

// Modal reutilisable du projet Zomatel.
// - overlay assombri, boite centree, responsive (desktop + mobile)
// - fermeture : croix (icone lucide X), touche Echap, clic sur l'overlay (hors boite)
// - seul le CONTENU defile si trop haut (pas de 2e barre de scroll page)
// - aucun changement de backend requis : pur UI.

import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ titre, sousTitre, onClose, children, largeur = 520, className = '' }) {
  // Echap ferme le modal ; le scroll de la page derriere est neutralise.
  useEffect(() => {
    function surEchap(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', surEchap);
    const avantOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // pas de double scrollbar
    return () => {
      document.removeEventListener('keydown', surEchap);
      document.body.style.overflow = avantOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        // Clic a l'exterieur de la boite -> fermeture (pas si on selectionne du texte dedans)
        if (e.target === e.currentTarget) onClose();
        e.stopPropagation();
      }}
    >
      <div className={`modal-boite${className ? ` ${className}` : ''}`} style={{ maxWidth: largeur }}>
        <div className="modal-entete">
          <div className="modal-entete-texte">
            <h3 style={{ margin: 0 }}>{titre}</h3>
            {sousTitre && <p className="modal-sous-titre">{sousTitre}</p>}
          </div>
          <button type="button" className="modal-fermer" aria-label="Fermer" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-contenu">{children}</div>
      </div>
    </div>
  );
}
