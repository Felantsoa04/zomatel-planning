'use client';

/* ROUTEUR D'ÉDITEURS PAR MODÈLE — un seul point d'entrée : les pages
 * (gestion, consultation) demandent un éditeur pour un modèle donné et ce
 * composant délègue. AJOUTER UN MODÈLE = ajouter une entrée dans
 * lib/planningModels.js + un éditeur ici. Aucun if dispersé ailleurs.
 * Le modèle STANDARD conserve l'éditeur de grille existant (aucune régression).
 */
import PlanningEditorShiftPoste from '@/components/PlanningEditorShiftPoste';
import PlanningEditorHoraireLibre from '@/components/PlanningEditorHoraireLibre';

export default function PlanningModelEditor({ modele, ...props }) {
  if (!modele || modele.saisie === 'CELLULE_EMPLOYE_JOUR') {
    // Modèle STANDARD : la page appelante rend sa grille existante
    // (composant parent) — on ne rend rien ici.
    return null;
  }
  switch (modele.saisie) {
    case 'SHIFT_POSTE':
      return <PlanningEditorShiftPoste {...props} />;
    case 'JOUR_COLONNE_HORAIRE':
      return <PlanningEditorHoraireLibre {...props} />;
    default:
      return null;
  }
}
