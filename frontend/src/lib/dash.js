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
  BROUILLON: 'status.BROUILLON',
  SOUMIS: 'status.SOUMIS',
  VALIDE: 'status.VALIDE',
  REJETE: 'status.REJETE',
};

export function libelleStatut(statut, t) {
  const cle = LABELS_STATUT[statut] || statut;
  if (typeof t === 'function') {
    return t(cle) || cle;
  }
  return cle;
}

export const COULEURS_STATUT = {
  BROUILLON: '#9c958c',
  SOUMIS: '#d9a441',
  VALIDE: '#4e9a61',
  REJETE: '#c0564f',
};

// "S37 · 07/09 → 13/09" (annees dynamiques, aucune valeur en dur)
export function periodeCourte(p) {
  if (!p) return '';
  const d = String(p.date_debut || '').slice(0, 10);
  const f = String(p.date_fin || '').slice(0, 10);
  const fmt = (s) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '?');
  return `S${p.numero_semaine} · ${fmt(d)} → ${fmt(f)}`;
}

// ---------------------------------------------------------------------------
// ROUTAGE PAR ROLE — un dashboard par profil, garde sur l'URL ET sur le rendu.
// /dashboard/admin -> ADMIN · /dashboard/rh -> RH · /dashboard/chef -> CHEF_SERVICE
// (l'Employe n'a pas d'espace : son login est refuse par le serveur)
// ---------------------------------------------------------------------------
export const DASHBOARD_PAR_ROLE = {
  ADMIN: '/dashboard/admin',
  RH: '/dashboard/rh',
  CHEF_SERVICE: '/dashboard/chef',
  // REGLE PROJET : l'Employe n'a ni compte ni espace ; pas de dashboard.
};

// Page autorisee pour un role donne, sinon null (route inconnue -> 404 Next.js)
export function dashboardDe(role) {
  return DASHBOARD_PAR_ROLE[role] || null;
}

// ---------------------------------------------------------------------------
// Catalogue unique de navigation. Les permissions filtrent les liens ;
// le service ne modifie jamais la structure du menu.
// ---------------------------------------------------------------------------
export const MENU_PRINCIPAL = [
  { href: '/dashboard', label: 'Tableau de bord', icone: 'LayoutDashboard' },
  { href: '/validations', label: 'Gestion des validations', icone: 'ClipboardCheck', permission: 'planning.validate' },
  { href: '/planning/gestion', label: 'Planning', icone: 'CalendarDays', permissionsAny: ['planning.view', 'planning.create'] },
  { href: '/employees', label: 'Employés', icone: 'Users', permission: 'employe.view' },
  { href: '/service', label: 'Services', icone: 'Hotel', permission: 'service.manage' },
  { href: '/messagerie', label: 'Messagerie', icone: 'MessageCircle', permission: 'messenger.use' },
  { href: '/statistiques', label: 'Statistiques', icone: 'BarChart3', permissions: ['planning.view', 'employe.view'] },
  { href: '/archives', label: 'Archives', icone: 'Archive', permission: 'planning.view' },
  { href: '/historique', label: 'Historique', icone: 'History' },
  { href: '/utilisateurs', label: 'Gestion utilisateurs', icone: 'KeyRound', permission: 'user.view' },
  { href: '/parametres', label: 'Paramètres', icone: 'Settings' },
];

// ---------------------------------------------------------------------------
// SEMAINES ISO — calcul dynamique (aucune date/annee en dur) pour le widget
// « Prochaines semaines » du dashboard.
// ---------------------------------------------------------------------------

// Lundi de la semaine contenant `d` (00:00 local).
export function lundiSemaine(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const jour = (date.getDay() + 6) % 7; // lundi = 0
  date.setDate(date.getDate() - jour);
  return date;
}

// Numéro de semaine ISO-8601 de `d`.
export function numeroSemaineISO(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const jour = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - jour + 3); // jeudi de la semaine
  const premierJeudi = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const jourPJ = (premierJeudi.getUTCDay() + 6) % 7;
  premierJeudi.setUTCDate(premierJeudi.getUTCDate() - jourPJ + 3);
  return 1 + Math.round((date - premierJeudi) / (7 * 86400000));
}

// ===== Conversion FLOAT <-> HH:mm =====
// Saisie utilisateur en nombre décimal (7, 7.5, 22.5), stockage en HH:mm.
// 0.25 = 15 min ; au-delà de 0.75 on arrondit au quart d'heure le plus proche.
export function floatVersHHmm(valeur) {
  const n = Number(String(valeur).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 24) return '';
  if (n === 24) return '24:00';
  const totalMin = Math.round((n * 60) / 15) * 15; // pas de 15 min
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "07:30" -> 7.5 ; retourne null si invalide/hors bornes 0-24
export function hhmmVersFloat(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const v = h + m / 60;
  return v < 0 || v > 24 ? null : v;
}

// Valide une saisie float (accepte virgule ou point) : 0 <= v <= 24
export function floatValide(valeur) {
  const n = Number(String(valeur).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 24;
}

// Les `nb` prochaines semaines (incluant la semaine courante) :
// [{ annee (année ISO), numero, debut (Date), fin (Date) }].
export function semainesAVenir(nb = 6) {
  const lundi = lundiSemaine(new Date());
  const out = [];
  for (let i = 0; i < nb; i++) {
    const debut = new Date(lundi);
    debut.setDate(lundi.getDate() + i * 7);
    const fin = new Date(debut);
    fin.setDate(debut.getDate() + 6);
    // Année ISO = année du jeudi de la semaine (convention ISO-8601).
    const jeudi = new Date(debut);
    jeudi.setDate(debut.getDate() + 3);
    out.push({ annee: jeudi.getFullYear(), numero: numeroSemaineISO(debut), debut, fin });
  }
  return out;
}
