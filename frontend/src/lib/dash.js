// Helpers partages des dashboards Zomatel.
// Regle metier heures hebdo : Administration min 44 h, autres services min 48 h.
// Depassement important : regle existante du projet (seuil + 8 h).

export const SEUIL_ADMIN_HEURES = 44;
export const SEUIL_AUTRES_HEURES = 48;
export const EXCES_AU_DESSUS_DU_MIN = 8;

export function seuilMinHeures(nomService) {
  return String(nomService || '').toLowerCase().includes('admin')
    ? SEUIL_ADMIN_HEURES
    : SEUIL_AUTRES_HEURES;
}

// Etat d'un total hebdo : 'MANQUE' | 'OK' | 'EXCES'
export function etatHeures(total, seuilMin) {
  const t = Number(total) || 0;
  if (t < seuilMin) return 'MANQUE';
  if (t > seuilMin + EXCES_AU_DESSUS_DU_MIN) return 'EXCES';
  return 'OK';
}

export const LABELS_STATUT = {
  BROUILLON: 'Brouillon',
  SOUMIS: 'Soumis',
  VALIDE: 'Validé',
  REJETE: 'Rejeté',
};

export const COULEURS_STATUT = {
  BROUILLON: '#9ca3af',
  SOUMIS: '#f59e0b',
  VALIDE: '#16a34a',
  REJETE: '#dc2626',
};

// "S37 · 07/09 → 13/09" (annees dynamiques, aucune valeur en dur)
export function periodeCourte(p) {
  if (!p) return '';
  const d = String(p.date_debut || '').slice(0, 10);
  const f = String(p.date_fin || '').slice(0, 10);
  const fmt = (s) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '?');
  return `S${p.numero_semaine} · ${fmt(d)} → ${fmt(f)}`;
}
