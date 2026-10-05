'use client';

// BOUTON RETOUR (icone seule)
// - Revient a la page d'ou l'utilisateur vient (router.back()), ce qui evite
//   de renvoyer systematiquement au dashboard quand il venait d'une autre liste.
// - Si la page a ete ouverte directement (bookmark, nouvel onglet : pas
//   d'historique applicatif), on retombe sur `fallback` (la liste logique).
// - `hasUnsaved` : si un formulaire contient des donnees non enregistrees,
//   une confirmation est demandee avant de quitter (aucune perte silencieuse).
//   NB : le bouton Back du navigateur n'est pas affecte (on n'ecrase pas
//   l'historique, on utilise router.back()).
// - Apparence : icone ArrowLeft seule dans un carre discret (title="Retour"
//   pour l'aide au survol, aria-label pour les lecteurs d'ecran). La logique
//   de navigation est strictement inchangee ; voir .btn-retour dans globals.css.

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

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
    <button
      type="button"
      className="btn-retour"
      onClick={handleClick}
      title="Retour"
      aria-label="Retour"
    >
      <ArrowLeft size={16} aria-hidden="true" />
    </button>
  );
}
