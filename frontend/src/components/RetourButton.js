'use client';

// BOUTON RETOUR ←
// - Revient a la page d'ou l'utilisateur vient (router.back()), ce qui evite
//   de renvoyer systematiquement au dashboard quand il venait d'une autre liste.
// - Si la page a ete ouverte directement (bookmark, nouvel onglet : pas
//   d'historique applicatif), on retombe sur `fallback` (la liste logique).
// - `hasUnsaved` : si un formulaire contient des donnees non enregistrees,
//   une confirmation est demandee avant de quitter (aucune perte silencieuse).
//   NB : le bouton Back du navigateur n'est pas affecte (on n'ecrase pas
//   l'historique, on utilise router.back()).

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function RetourButton({
  fallback = '/dashboard',
  hasUnsaved = false,
  message = 'Des modifications non enregistrees seront perdues. Quitter quand meme ?',
}) {
  const router = useRouter();

  const handleClick = useCallback(() => {
    if (hasUnsaved && !window.confirm(message)) return;
    // Heuristique standard : s'il existe un historique, on revient d'ou l'on
    // vient ; sinon (entree directe) on va a la liste logique `fallback`.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  }, [router, hasUnsaved, message, fallback]);

  return (
    <button type="button" className="btn-retour" onClick={handleClick} title="Retour">
      <span aria-hidden="true">←</span> Retour
    </button>
  );
}
