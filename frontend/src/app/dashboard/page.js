'use client';

// DASHBOARD ZOMATEL — une vue par role connecte, donnees reelles via les API
// existantes (aucune statistique fictive, aucune annee en dur) :
//   - RH           : vue globale de l'etablissement + graphiques + acces rapides
//   - ADMIN        : statistiques administratives (utilisateurs, services...)
//   - CHEF_SERVICE : uniquement SON service (filtrage garanti par le backend)
// L'EMPLOYE n'a pas d'espace dans l'application : redirection vers le login
// (l'employe n'est qu'une donnee affectee aux plannings).
// Regles heures reutilisees : Administration 44 h min, autres 48 h min,
// depassement important = nb_exces calcule par l'API (seuil + 8 h).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DashShell from '@/components/DashShell';
import { DashBars, DashDonut } from '@/components/DashCharts';
import Navbar from '@/components/Navbar';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { LABELS_STATUT, COULEURS_STATUT, periodeCourte } from '@/lib/dash';

const LIENS = {
  RH: [
    { href: '/dashboard', label: 'Tableau de bord', icone: '📊' },
    { href: '/employees', label: 'Employés', icone: '👥' },
    { href: '/utilisateurs', label: 'Utilisateurs', icone: '🔑' },
    { href: '/service', label: 'Services', icone: '🏨' },
    { href: '/planning/gestion', label: 'Gestion du planning', icone: '🗓️' },
  ],
  ADMIN: [
    { href: '/dashboard', label: 'Tableau de bord', icone: '📊' },
    { href: '/utilisateurs', label: 'Utilisateurs', icone: '🔑' },
    { href: '/service', label: 'Services', icone: '🏨' },
    { href: '/employees', label: 'Employés', icone: '👥' },
  ],
  CHEF_SERVICE: [
    { href: '/dashboard', label: 'Tableau de bord', icone: '📊' },
    { href: '/employees', label: 'Employés', icone: '👥' },
    { href: '/planning/gestion', label: 'Gestion du planning', icone: '🗓️' },
    { href: '/planning/new', label: 'Nouveau planning', icone: '➕' },
  ],
};

const ACCES_RAPIDES = {
  RH: [
    { href: '/employees', label: 'Gestion des employés', icone: '👥' },
    { href: '/utilisateurs', label: 'Gestion des utilisateurs', icone: '🔑' },
    { href: '/service', label: 'Gestion des services', icone: '🏨' },
    { href: '/dashboard?statut=SOUMIS', label: 'Validations en attente', icone: '✅' },
    { href: '/dashboard', label: 'Consultation des plannings', icone: '👁️' },
  ],
  ADMIN: [
    { href: '/utilisateurs', label: 'Gestion des utilisateurs', icone: '🔑' },
    { href: '/service', label: 'Gestion des services', icone: '🏨' },
    { href: '/employees', label: 'Employés', icone: '👥' },
  ],
  CHEF_SERVICE: [
    { href: '/planning/new', label: 'Créer un planning', icone: '➕' },
    { href: '/planning/gestion', label: 'Modifier la grille', icone: '✏️' },
    { href: '/dashboard?statut=BROUILLON', label: 'À soumettre', icone: '📤' },
    { href: '/employees', label: 'Employés du service', icone: '👥' },
  ],
};

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [plannings, setPlannings] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [services, setServices] = useState([]);
  const [nbUtilisateurs, setNbUtilisateurs] = useState(null);
  const [nbChefs, setNbChefs] = useState(null);
  const [nonLues, setNonLues] = useState(0);
  const [anneeFiltre, setAnneeFiltre] = useState('');
  const [statutFiltre, setStatutFiltre] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    // Session lue APRES montage (pattern anti-hydratation du projet).
    const u = getUser();
    const token = getToken();
    if (!token || !u) {
      router.replace('/login');
      return;
    }
    // L'EMPLOYE n'a pas d'espace dans l'application : ni dashboard, ni menu.
    // On purge aussi la session residueuse (sinon le token reste et produit
    // des 403 sur les appels API).
    if (u.role === 'EMPLOYE') {
      logout();
      router.replace('/login');
      return;
    }
    setUser(u);

    // Filtre statut depuis l'URL (acces rapides "A valider" / "A soumettre")
    const s = new URLSearchParams(window.location.search).get('statut');
    if (s) setStatutFiltre(s);

    (async () => {
      try {
        // Plannings (backend : chef -> son service uniquement, EMPLOYE -> 403)
        const liste = await api.get('/plannings', token);
        setPlannings(Array.isArray(liste) ? liste : []);

        // Employes (chef -> son service, filtre serveur ; autres -> tous)
        const emps = await api.get('/employes', token);
        setEmployes(Array.isArray(emps) ? emps : []);

        // Services (labels du graphique)
        const srv = await api.get('/services', token);
        setServices(Array.isArray(srv) ? srv : []);

        // Specifique ADMIN : comptes utilisateurs
        if (u.role === 'ADMIN') {
          const users = await api.get('/auth/users', token);
          const usersList = Array.isArray(users) ? users : [];
          setNbUtilisateurs(usersList.length);
          setNbChefs(usersList.filter((x) => x.role === 'CHEF_SERVICE').length);
        }

        // Notifications non lues (badge cloche)
        const cnt = await api.get('/notifications/non-lues/count', token);
        setNonLues(Number(cnt?.non_lues) || 0);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [router]);

  // ---- Statistiques derivees des donnees reelles --------------------------
  const stats = useMemo(() => {
    const parStatut = { BROUILLON: 0, SOUMIS: 0, VALIDE: 0, REJETE: 0 };
    let nbManques = 0;
    let nbExces = 0;
    for (const p of plannings) {
      if (parStatut[p.statut] !== undefined) parStatut[p.statut] += 1;
      nbManques += Number(p.nb_manques) || 0;
      nbExces += Number(p.nb_exces) || 0;
    }
    const employesParService = services.map((s) => ({
      label: s.nom_service,
      valeur: employes.filter((e) => Number(e.id_service) === Number(s.id_service)).length,
    }));
    // Annees disponibles : depuis les donnees + annee courante (aucune en dur)
    const annees = [...new Set([...plannings.map((p) => p.annee), new Date().getFullYear()])]
      .sort((a, b) => b - a);
    return { parStatut, nbManques, nbExces, employesParService, annees };
  }, [plannings, services, employes]);

  // ---- Actions sur un planning (conservees de l'ancien dashboard) ---------
  async function supprimerPlanning(p) {
    if (!confirm(`Supprimer le planning ${p.service_nom} S${p.numero_semaine}/${p.annee} ? Cette action est definitive.`)) return;
    setError('');
    try {
      await api.delete(`/plannings/${p.id_planning}`, getToken());
      setPlannings((liste) => liste.filter((x) => x.id_planning !== p.id_planning));
    } catch (err) {
      setError(err.message);
    }
  }

  async function soumettrePlanning(p) {
    if (!confirm('Soumettre ce planning a la RH pour validation ?')) return;
    setError('');
    try {
      await api.patch(`/plannings/${p.id_planning}/soumettre`, {}, getToken());
      setPlannings((liste) => liste.map((x) => (x.id_planning === p.id_planning ? { ...x, statut: 'SOUMIS' } : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function rouvrirPlanning(p) {
    if (!confirm('Rouvrir ce planning valide ? Il repassera en BROUILLON et devra etre soumis a nouveau a la RH.')) return;
    setError('');
    try {
      await api.patch(`/plannings/${p.id_planning}/rouvrir`, {}, getToken());
      setPlannings((liste) => liste.map((x) => (x.id_planning === p.id_planning ? { ...x, statut: 'BROUILLON' } : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) {
    return (
      <>
        <Navbar />
        <div className="container">
          <p className="muted">Chargement...</p>
        </div>
      </>
    );
  }

  const liens = LIENS[user.role] || LIENS.RH;
  const accesRapides = ACCES_RAPIDES[user.role] || [];
  const estChef = user.role === 'CHEF_SERVICE';
  // Nom du service du chef deduit de la liste (le JWT ne contient que id_service)
  const nomService = user.id_service
    ? services.find((s) => Number(s.id_service) === Number(user.id_service))?.nom_service
    : null;

  const planningsFiltres = plannings.filter((p) => {
    if (anneeFiltre && String(p.annee) !== String(anneeFiltre)) return false;
    if (statutFiltre && p.statut !== statutFiltre) return false;
    return true;
  });

  return (
    <DashShell user={{ ...user, service_nom: nomService }} liens={liens}>
      <h1 className="dash-titre">
        Bonjour, {[user.prenom, user.nom].filter(Boolean).join(' ') || user.nom_utilisateur || user.login}
      </h1>
      <p className="dash-soustitre">
        {estChef
          ? `Vue de votre service${nomService ? ` : ${nomService}` : ''}`
          : "Vue globale de l'établissement"}
      </p>

      {error && <div className="error">{error}</div>}

      {/* ===== Cartes statistiques ===== */}
      <div className="dash-stats">
        {user.role === 'ADMIN' && (
          <>
            <Stat valeur={nbUtilisateurs ?? '…'} libelle="Utilisateurs" classe="dash-stat-bleu" />
            <Stat valeur={nbChefs ?? '…'} libelle="Chefs de service" classe="dash-stat-violet" />
          </>
        )}
        <Stat
          valeur={employes.length}
          libelle={estChef ? 'Employés du service' : 'Employés'}
          classe="dash-stat-bleu"
        />
        <Stat valeur={services.length} libelle="Services" classe="dash-stat-bleu" />
        <Stat valeur={stats.parStatut.BROUILLON} libelle="Brouillons" classe="dash-stat-gris" />
        <Stat valeur={stats.parStatut['SOUMIS'] || 0} libelle="Soumis" classe="dash-stat-orange" />
        <Stat valeur={stats.parStatut.VALIDE} libelle="Validés" classe="dash-stat-vert" />
        <Stat valeur={stats.parStatut.REJETE} libelle="Rejetés" classe="dash-stat-rouge" />
        <Stat valeur={stats.nbManques} libelle="Heures insuffisantes" classe="dash-stat-orange" />
        <Stat valeur={stats.nbExces} libelle="Dépassements importants" classe="dash-stat-rouge" />
        {nonLues > 0 && (
          <Stat valeur={nonLues} libelle="Notifications non lues" classe="dash-stat-violet" />
        )}
      </div>

      {/* ===== Graphiques ===== */}
      <div className="dash-grille">
        <div className="dash-carte">
          <h3>Répartition des plannings par statut</h3>
          <DashDonut
            data={[
              { label: 'Brouillon', valeur: stats.parStatut.BROUILLON, couleur: COULEURS_STATUT.BROUILLON },
              { label: 'Soumis', valeur: stats.parStatut['SOUMIS'] || 0, couleur: COULEURS_STATUT['SOUMIS'] },
              { label: 'Validé', valeur: stats.parStatut.VALIDE, couleur: COULEURS_STATUT.VALIDE },
              { label: 'Rejeté', valeur: stats.parStatut.REJETE, couleur: COULEURS_STATUT.REJETE },
            ]}
            centreHaut={plannings.length}
            centreBas="plannings"
          />
        </div>
        {!estChef && (
          <div className="dash-carte">
            <h3>Employés par service</h3>
            <DashBars data={stats.employesParService} />
          </div>
        )}
        <div className="dash-carte">
          <h3>Contrôle des heures hebdomadaires</h3>
          <DashBars
            data={[
              { label: 'Conformes', valeur: plannings.filter((p) => p.total_heures != null && !Number(p.nb_manques) && !Number(p.nb_exces)).length, couleur: '#16a34a' },
              { label: 'Heures insuff.', valeur: plannings.filter((p) => Number(p.nb_manques) > 0).length, couleur: '#f59e0b' },
              { label: 'Dépassements', valeur: plannings.filter((p) => Number(p.nb_exces) > 0).length, couleur: '#dc2626' },
            ]}
            unite=" plannings"
          />
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Règle : Administration 44 h min · autres services 48 h min.
          </p>
        </div>
      </div>

      {/* ===== Derniers plannings ===== */}
      <div className="dash-carte">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{estChef ? 'Mes derniers plannings' : 'Derniers plannings'}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={anneeFiltre} onChange={(e) => setAnneeFiltre(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Toutes les années</option>
              {stats.annees.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            {estChef && (
              <Link href="/planning/new" className="btn">+ Nouveau planning</Link>
            )}
          </div>
        </div>

        {statutFiltre && (
          <p style={{ marginTop: 0 }}>
            <span className="alerte-heures alerte-manque">
              Filtre : {LABELS_STATUT[statutFiltre] || statutFiltre}{' '}
              <button
                onClick={() => setStatutFiltre('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                title="Retirer le filtre"
              >
                ✕
              </button>
            </span>
          </p>
        )}

        {plannings.length === 0 ? (
          <p className="muted">Aucun planning pour le moment.</p>
        ) : planningsFiltres.length === 0 ? (
          <p className="muted">Aucun planning ne correspond au filtre.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dash-table">
              <thead>
                <tr>
                  {!estChef && <th>Service</th>}
                  <th>Semaine</th>
                  <th>Période</th>
                  <th>Heures</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {planningsFiltres.slice(0, 10).map((p) => (
                  <tr key={p.id_planning}>
                    {!estChef && <td>{p.service_nom}</td>}
                    <td>S{p.numero_semaine} / {p.annee}</td>
                    <td>{periodeCourte(p).split(' · ')[1] || periodeCourte(p)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {p.total_heures != null ? (
                        <>
                          {Number(p.total_heures).toFixed(1)} h
                          {Number(p.nb_manques) > 0 && (
                            <span className="alerte-heures alerte-manque" title="Heures insuffisantes">🟠 {p.nb_manques}</span>
                          )}
                          {Number(p.nb_exces) > 0 && (
                            <span className="alerte-heures alerte-exces" title="Dépassement important">🔴 {p.nb_exces}</span>
                          )}
                          {Number(p.nb_manques) === 0 && Number(p.nb_exces) === 0 && (
                            <span className="alerte-heures alerte-ok" title="Conforme">🟢</span>
                          )}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td><span className={`badge ${p.statut}`}>{LABELS_STATUT[p.statut] || p.statut}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link href={`/planning/${p.id_planning}`} className="btn secondary" title="Consulter" style={{ padding: '5px 12px', fontSize: 13 }}>
                        👁️
                      </Link>
                      {estChef && ['BROUILLON', 'REJETE'].includes(p.statut) && (
                        <>
                          {' '}
                          <Link
                            href={`/planning/gestion?service=${p.id_service ?? ''}&semaine=${p.annee}-W${String(p.numero_semaine).padStart(2, '0')}`}
                            className="btn secondary"
                            title="Modifier la grille"
                            style={{ padding: '5px 12px', fontSize: 13 }}
                          >
                            ✏️
                          </Link>{' '}
                          <button className="btn danger" onClick={() => supprimerPlanning(p)} title="Supprimer" style={{ padding: '5px 12px', fontSize: 13 }}>🗑️</button>
                          <button className="btn success" onClick={() => soumettrePlanning(p)} title="Soumettre a la RH" style={{ padding: '5px 12px', fontSize: 13, marginLeft: 4 }}>📤</button>
                        </>
                      )}
                      {!estChef && p.statut === 'VALIDE' && (
                        <>
                          {' '}
                          <button className="btn secondary" onClick={() => rouvrirPlanning(p)} title="Rouvrir : nouvelle validation requise" style={{ padding: '5px 12px', fontSize: 13 }}>🔓</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== Acces rapides ===== */}
      <div className="dash-carte">
        <h3>Accès rapides</h3>
        <div className="dash-acces">
          {accesRapides.map((a) => (
            <Link key={a.label} href={a.href} className="dash-acces-lien">
              <span className="dash-acces-icone">{a.icone}</span>
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    </DashShell>
  );
}

function Stat({ valeur, libelle, classe = '' }) {
  return (
    <div className={`dash-stat ${classe}`}>
      <div className="valeur">{valeur}</div>
      <div className="libelle">{libelle}</div>
    </div>
  );
}
