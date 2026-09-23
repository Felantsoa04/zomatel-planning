'use client';

// LEGENDE DES STATUTS de l'emploi du temps (affichage uniquement).
// Les memes teintes claires sont appliquees aux cellules via les classes
// .edt-statut-* (globals.css) et restent visibles a l'impression.

const ITEMS = [
  { emoji: '🟢', label: 'Repos' },
  { emoji: '🔴', label: 'Absent' },
  { emoji: '🟠', label: 'Congé' },
  { emoji: '🔵', label: 'Récupération' },
  { emoji: '🟣', label: 'Formation' },
  { emoji: '⚪', label: 'Non planifié' },
];

export default function LegendeStatuts() {
  return (
    <div className="legende-statuts" aria-label="Légende des statuts">
      {ITEMS.map((it) => (
        <span key={it.label} className="legende-item">
          <span role="img" aria-hidden="true">{it.emoji}</span> {it.label}
        </span>
      ))}
    </div>
  );
}
