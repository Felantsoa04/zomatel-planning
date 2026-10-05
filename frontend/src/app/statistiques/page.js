'use client';

// PAGE STATISTIQUES — tableau de bord analytique, donnees 100 % reelles
// (API existantes : /plannings, /employes, /services ; memes regles que le
// dashboard). Graphiques = composants DashBars / DashDonut deja presents dans
// le projet (100 % CSS, aucune dependance ajoutee). Aucun chiffre fictif.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Users, Hotel, CalendarDays, CircleCheck, Clock, FileText } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { DashBars, DashDonut } from '@/components/DashCharts';
import BarChart from '@/components/BarChart';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { LABELS_STATUT } from '@/lib/dash';

// Palette mate coherent avec le theme (pastilles graphiques)
const COULEURS_STATUT = {
  BROUILLON: '#9c958c',
  SOUMIS: '#d9a441',
  VALIDE: '#4e9a61',
  REJETE: '#c0564f',
};

export default function StatistiquesPage() {
  const [plannings, setPlannings] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [services, setServices] = useState([]);
  const [serviceFiltre, setServiceFiltre] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        const [p, e, s] = await Promise.all([
          api.get('/plannings', t),
          api.get('/employes', t),
          api.get('/services', t),
        ]);
        setPlannings(Array.isArray(p) ? p : []);
        setEmployes(Array.isArray(e) ? e : []);
        setServices(Array.isArray(s) ? s : []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le filtrage par service est fait cote client sur la liste deja chargee
  // (les API n'exposent pas d'endpoint d'agregation ; aucune logique serveur
  // n'est ajoutee). Pour un chef, le backend ne renvoie deja que son service.
  const planningsFiltres = useMemo(
    () => (serviceFiltre
      ? plannings.filter((p) => String(p.id_service) === String(serviceFiltre))
      : plannings),
    [plannings, serviceFiltre]
  );

  const stats = useMemo(() => {
    const parStatut = { BROUILLON: 0, SOUMIS: 0, VALIDE: 0, REJETE: 0 };
    for (const p of planningsFiltres) {
      if (parStatut[p.statut] !== undefined) parStatut[p.statut] += 1;
    }
    const parService = {};
    for (const e of employes) {
      if (serviceFiltre && String(e.id_service) !== String(serviceFiltre)) continue;
      const nom = e.service_nom || '—';
      parService[nom] = (parService[nom] || 0) + 1;
    }
    const heures = planningsFiltres.reduce((s, p) => s + (Number(p.total_heures) || 0), 0);
    return { parStatut, parService, heures };
  }, [planningsFiltres, employes, serviceFiltre]);

  const nbEmployes = serviceFiltre
    ? employes.filter((e) => String(e.id_service) === String(serviceFiltre)).length
    : employes.length;

  const cartes = [
    { libelle: 'Employés', valeur: nbEmployes, icone: Users, classe: 'dash-stat-gris', href: '/employees' },
    { libelle: 'Services', valeur: serviceFiltre ? 1 : services.length, icone: Hotel, classe: 'dash-stat', href: '/service' },
    { libelle: 'Plannings', valeur: planningsFiltres.length, icone: CalendarDays, classe: 'dash-stat', href: '/planning/gestion' },
    { libelle: 'Validés', valeur: stats.parStatut.VALIDE, icone: CircleCheck, classe: 'dash-stat-vert', href: '/planning/gestion?statut=VALIDE' },
    { libelle: 'En attente', valeur: stats.parStatut.SOUMIS, icone: Clock, classe: 'dash-stat-orange', href: '/planning/gestion?statut=SOUMIS' },
    { libelle: 'Brouillons', valeur: stats.parStatut.BROUILLON, icone: FileText, classe: 'dash-stat-gris', href: '/planning/gestion?statut=BROUILLON' },
  ];

  const donneesStatuts = Object.entries(stats.parStatut).map(([statut, nb]) => ({
    label: LABELS_STATUT[statut] || statut,
    valeur: nb,
    couleur: COULEURS_STATUT[statut],
  }));

  const donneesServices = Object.entries(stats.parService)
    .map(([nom, nb]) => ({ label: nom, valeur: nb }))
    .sort((a, b) => b.valeur - a.valeur)
    .slice(0, 8);

  // Serie temporelle REELLE : heures planifiees par semaine (somme des
  // total_heures de /plannings) + nombre de plannings par semaine (serie
  // secondaire pointillee). Aucune semaine inventee : seules les semaines
  // ayant au moins un planning apparaissent. Tri chronologique par date_debut.
  const donneesCourbe = useMemo(() => {
    const parSemaine = new Map();
    for (const p of planningsFiltres) {
      const debut = String(p.date_debut || '').slice(0, 10);
      if (!debut) continue;
      const cle = `${p.annee}-${String(p.numero_semaine).padStart(2, '0')}`;
      const entree = parSemaine.get(cle) || {
        label: `S${p.numero_semaine}`,
        valeur: 0,
        secondaire: 0,
        debut,
      };
      entree.valeur += Number(p.total_heures) || 0;
      entree.secondaire += 1;
      parSemaine.set(cle, entree);
    }
    return [...parSemaine.values()]
      .sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0))
      .map(({ label, valeur, secondaire }) => ({ label, valeur, secondaire }));
  }, [planningsFiltres]);

  return (
    <AppShell>
      <div className="container">
        <div className="tete-page">
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <BarChart3 size={20} aria-hidden="true" /> Statistiques
            </h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Vue d&apos;ensemble des données de l&apos;application.
            </p>
          </div>
          {services.length > 1 && (
            <select
              value={serviceFiltre}
              onChange={(e) => setServiceFiltre(e.target.value)}
              style={{ width: 'auto' }}
              aria-label="Filtrer par service"
            >
              <option value="">Tous les services</option>
              {services.map((s) => (
                <option key={s.id_service} value={s.id_service}>{s.nom || s.nom_service}</option>
              ))}
            </select>
          )}
        </div>
        {error && <div className="error">{error}</div>}

        {loading ? (
          <p className="muted">Chargement...</p>
        ) : (
          <>
            {/* ===== Cartes statistiques ===== */}
            <div className="dash-stats">
              {cartes.map((c) => {
                const Icone = c.icone;
                return (
                  <div key={c.libelle} className={`dash-stat ${c.classe}`}>
                    <div className="stat-icone"><Icone size={18} aria-hidden="true" /></div>
                    <div className="valeur">{c.valeur}</div>
                    <div className="libelle">{c.libelle}</div>
                  </div>
                );
              })}
            </div>

            {/* ===== Graphiques : barres (plus de courbe), chaque graphique
                dans SA carte compacte — jamais pleine largeur inutilement.
                « Employés par service » reste en barres HORIZONTALES (composant
                DashBars existant) pour comparer facilement plusieurs services. */}
            <div className="stat-grille-graphiques">
              <div className="card stat-carte-graphique">
                <h3>Évolution des heures planifiées</h3>
                <BarChart data={donneesCourbe} unite="h" />
              </div>
              <div className="card stat-carte-graphique">
                <h3>Répartition des plannings par statut</h3>
                <DashDonut data={donneesStatuts} centreHaut={planningsFiltres.length} centreBas="planning(s)" />
              </div>
              <div className="card stat-carte-graphique">
                <h3>Employés par service</h3>
                <DashBars data={donneesServices} />
              </div>
            </div>

            {/* ===== Heures planifiees (indicateur reel) ===== */}
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Indicateurs</h3>
              <div className="param-ligne">
                <span>Heures planifiées (total des plannings affichés)</span>
                <strong>{Math.round(stats.heures * 10) / 10} h</strong>
              </div>
              <div className="param-ligne">
                <span>Plannings rejetés à corriger</span>
                <strong>{stats.parStatut.REJETE}</strong>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
