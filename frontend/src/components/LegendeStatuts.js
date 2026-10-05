'use client';

// LEGENDE DES STATUTS de l'emploi du temps (affichage uniquement).
// Les memes teintes claires sont appliquees aux cellules via les classes
// .edt-statut-* (globals.css) et restent visibles a l'impression.

const ITEMS = [
  { couleur: '#16a34a', label: 'Repos' },
  { couleur: '#dc2626', label: 'Absent' },
  { couleur: '#d97706', label: 'Congé' },
  { couleur: '#1d4ed8', label: 'Récupération' },
  { couleur: '#6b21a8', label: 'Formation' },
  { couleur: '#d6d3d1', label: 'Non planifié' },
];

export default function LegendeStatuts() {
  return (
    <div className="legende-statuts" aria-label="Légende des statuts">
      {ITEMS.map((it) => (
        <span key={it.label} className="legende-item">
          <span
            aria-hidden="true"
            style={{ width: 9, height: 9, borderRadius: '50%', background: it.couleur, display: 'inline-block' }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
