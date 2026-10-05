'use client';

// SECTION « EMPLOYES PAR SERVICE » du dashboard Zomatel.
// Donnees 100 % reelles (API /employes + /services — filtrage deja assure
// par le BACKEND : un chef ne recoit que les employes de son service).
// - Recherche instantanee cote client : nom, matricule, service ;
// - Filtre par service (liste issue de l'API reelle) ;
// - Badges statut TITULAIRE / STAGIAIRE (valeurs ENUM de la base, affichage seul) ;
// - Carte par service, service vide explicite, etats chargement/erreur+Retry ;
// - Responsive : auto-fill (multi-cartes desktop, 1 carte par ligne mobile) ;
// - Aucun bouton decoratif : les liens pointent vers des pages existantes.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Utensils, CookingPot, Croissant, UtensilsCrossed, ConciergeBell,
  ClipboardList, Shield, Wrench, Brush, Shirt, Leaf, Car, SprayCan,
  Package, Waves, KeyRound, BedDouble, Megaphone, Building2,
  CircleAlert, TriangleAlert,
} from 'lucide-react';

const TAILLE_PAGE = 8; // employés affichés par carte avant « Voir plus »

// Icone par service : mots-cles du nom reel (aucune liste codée en dur
// d'IDs — un nouveau service garde une icône générique).
// Icones lucide-react (les emojis sont interdits dans l'interface).
function iconeService(nom) {
  const n = String(nom || '').toLowerCase();
  if (n.includes('cuisine snack')) return Utensils;
  if (n.includes('cuisine')) return CookingPot;
  if (n.includes('patis') || n.includes('pizza')) return Croissant;
  if (n.includes('salle snack')) return UtensilsCrossed;
  if (n.includes('salle')) return Utensils;
  if (n.includes('reception')) return ConciergeBell;
  if (n.includes('admin')) return ClipboardList;
  if (n.includes('securite')) return Shield;
  if (n.includes('maintenance')) return Wrench;
  if (n.includes('nettoy')) return Brush;
  if (n.includes('lessive')) return Shirt;
  if (n.includes('jardin')) return Leaf;
  if (n.includes('chauff')) return Car;
  if (n.includes('plonge')) return SprayCan;
  if (n.includes('stock')) return Package;
  if (n.includes('piscine')) return Waves;
  if (n.includes('gouvernante')) return KeyRound;
  if (n.includes('etage')) return BedDouble;
  if (n.includes('communication')) return Megaphone;
  return Building2;
}

const SQUELETTES = [0, 1, 2, 3];

export default function EmployesParService({
  employes = [],
  services = [],
  loading = false,
  erreur = '',
  onRetry,
  // Vue chef : UN seul service (le backend n'a de toute façon renvoyé que lui)
  serviceChef = null, // { id_service, nom_service } | null
  peutGerer = false,
  // { [id_service]: { manques, exces, semaine, annee } } — dernier planning connu
  anomaliesParService = {},
}) {
  const [recherche, setRecherche] = useState('');
  const [serviceFiltre, setServiceFiltre] = useState('');
  const [cartesDepliees, setCartesDepliees] = useState({}); // id_service → true
  const router = useRouter();

  // Liste des services à afficher (chef → le sien uniquement).
  const servicesAffiches = useMemo(() => {
    if (serviceChef) {
      return services.filter((s) => Number(s.id_service) === Number(serviceChef.id_service));
    }
    return services;
  }, [services, serviceChef]);

  // Recherche + filtre, 100 % cote client (aucun rechargement).
  const employesFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return employes.filter((e) => {
      if (serviceFiltre && String(e.id_service) !== String(serviceFiltre)) return false;
      if (!q) return true;
      return (
        String(e.nom || '').toLowerCase().includes(q) ||
        String(e.matricule || '').toLowerCase().includes(q) ||
        String(e.service_nom || '').toLowerCase().includes(q)
      );
    });
  }, [employes, recherche, serviceFiltre]);

  // Groupement : services (de l'API) → employés filtrés.
  const groupes = useMemo(
    () =>
      servicesAffiches.map((s) => ({
        service: s,
        liste: employesFiltres
          .filter((e) => Number(e.id_service) === Number(s.id_service))
          .sort((a, b) => String(a.nom).localeCompare(String(b.nom))),
      })),
    [servicesAffiches, employesFiltres]
  );

  const rechercheActive = recherche.trim() !== '' || serviceFiltre !== '';
  const totalAffiche = employesFiltres.length;

  return (
    <section className="dash-carte" id="employes-par-service">
      <div className="eps-tete">
        <div>
          <h3 style={{ margin: 0 }}>
            {serviceChef ? 'Employés de mon service' : 'Employés par service'}
          </h3>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
            {serviceChef
              ? `Mon service : ${serviceChef.nom_service || '—'}`
              : `${employes.length} employé(s) · ${services.length} service(s)`}
          </p>
        </div>
        {(servicesAffiches.length > 1 || employes.length > 0) && (
          <div className="eps-barre-outils">
            <input
              type="search"
              className="eps-recherche"
              placeholder="Rechercher un employé…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              aria-label="Rechercher un employé par nom, matricule ou service"
            />
            {!serviceChef && servicesAffiches.length > 1 && (
              <select
                value={serviceFiltre}
                onChange={(e) => setServiceFiltre(e.target.value)}
                aria-label="Filtrer par service"
              >
                <option value="">Tous les services</option>
                {servicesAffiches.map((s) => (
                  <option key={s.id_service} value={s.id_service}>
                    {s.nom || s.nom_service}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* --- Etat d'erreur API : message clair + Réessayer --- */}
      {erreur && !loading && (
        <div className="eps-erreur">
          <p style={{ margin: '0 0 10px' }}>{erreur}</p>
          {onRetry && (
            <button className="btn" onClick={onRetry}>
              Réessayer
            </button>
          )}
        </div>
      )}

      {/* --- Etat de chargement : squelettes (jamais un dashboard vide) --- */}
      {loading && !erreur && (
        <div className="eps-grille">
          {SQUELETTES.map((i) => (
            <div key={i} className="eps-carte eps-squelette" aria-hidden="true">
              <div className="eps-sk-ligne eps-sk-titre" />
              <div className="eps-sk-ligne" style={{ width: '80%' }} />
              <div className="eps-sk-ligne" style={{ width: '65%' }} />
              <div className="eps-sk-ligne" style={{ width: '72%' }} />
            </div>
          ))}
          <p className="muted eps-chargement">Chargement des employés…</p>
        </div>
      )}

      {/* --- Données --- */}
      {!loading && !erreur && (
        <>
          {rechercheActive && (
            <p className="eps-compteur-recherche">
              {totalAffiche} employé(s) correspondant{totalAffiche === 1 ? '' : 's'}
              {recherche.trim() ? ` à « ${recherche.trim()} »` : ''}
              {' '}
              <button
                className="eps-lien-reset"
                onClick={() => {
                  setRecherche('');
                  setServiceFiltre('');
                }}
              >
                Réinitialiser
              </button>
            </p>
          )}

          {groupes.length === 0 ? (
            <p className="muted">Aucun service disponible.</p>
          ) : (
            <div className="eps-grille">
              {groupes.map(({ service, liste }) => {
                const nom = service.nom || service.nom_service;
                const vide = liste.length === 0;
                if (rechercheActive && vide) return null; // recherche : cartes sans résultat masquées
                const deplie = !!cartesDepliees[service.id_service];
                const visibles = deplie ? liste : liste.slice(0, TAILLE_PAGE);
                return (
                  <article
                    key={service.id_service}
                    className={`eps-carte ${!vide ? 'eps-carte-cliquable' : ''}`}
                    onClick={() => {
                      // Carte cliquable : ouvre la grille de planning du service
                      // (page existante, filtrée via ?service= déjà supportée).
                      if (!vide) router.push(`/planning/gestion?service=${service.id_service}`);
                    }}
                    role={!vide ? 'button' : undefined}
                    tabIndex={!vide ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!vide && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        router.push(`/planning/gestion?service=${service.id_service}`);
                      }
                    }}
                    title={!vide ? `Voir le planning de ${nom}` : undefined}
                  >
                    <header className="eps-carte-tete">
                      <span className="eps-icone" aria-hidden="true">
                        {(() => { const Ic = iconeService(nom); return Ic ? <Ic size={18} aria-hidden="true" /> : null; })()}
                      </span>
                      <h4 className="eps-nom" title={nom}>
                        {nom}
                      </h4>
                      {(() => {
                        const a = anomaliesParService[String(service.id_service)];
                        if (!a || (!a.manques && !a.exces)) return null;
                        return (
                          <span
                            className={`alerte-heures ${a.exces > 0 ? 'alerte-exces' : 'alerte-manque'}`}
                            title={`Semaine ${a.semaine}/${a.annee} — calculé sur le dernier planning du service`}
                          >
                            {a.exces > 0 ? (<><CircleAlert size={11} aria-hidden="true" /> {a.exces} dépassement{a.exces > 1 ? 's' : ''}</>) : (<><TriangleAlert size={11} aria-hidden="true" /> {a.manques} en manque</>)}
                          </span>
                        );
                      })()}
                      <span className="eps-compteur">
                        {liste.length} employé{liste.length === 1 ? '' : 's'}
                      </span>
                    </header>

                    {vide ? (
                      <p className="eps-vide">Aucun employé affecté à ce service</p>
                    ) : (
                      <>
                        <ul className="eps-liste">
                          {visibles.map((e) => (
                            <li key={e.id_employe} className="eps-employe">
                              <span className="eps-employe-nom" title={e.nom}>
                                {e.nom}
                              </span>
                              <span className="eps-employe-droite">
                                {e.matricule ? (
                                  <span className="eps-matricule">{e.matricule}</span>
                                ) : (
                                  <span className="eps-matricule eps-matricule-vide" title="Matricule non renseigné">
                                    —
                                  </span>
                                )}
                                <span className={`badge ${e.statut === 'STAGIAIRE' ? 'STAGIAIRE' : 'TITULAIRE'}`}>
                                  {e.statut === 'STAGIAIRE' ? 'STAGIAIRE' : 'TITULAIRE'}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                        {liste.length > TAILLE_PAGE && (
                          <button
                            type="button"
                            className="eps-voir-plus"
                            onClick={(e) => {
                              e.stopPropagation(); // ne déclenche pas le clic carte
                              setCartesDepliees((m) => ({ ...m, [service.id_service]: !deplie }));
                            }}
                          >
                            {deplie ? 'Voir moins' : `Voir les ${liste.length} employés`}
                          </button>
                        )}
                      </>
                    )}

                    <footer className="eps-carte-pied">
                      <Link href="/employees" className="eps-lien" onClick={(e) => e.stopPropagation()}>
                        Voir les employés
                        {peutGerer ? ' / gérer' : ''}
                        <span className="eps-note-service"> · service {nom}</span>
                      </Link>
                      {serviceChef && (
                        <Link href="/planning/gestion" className="eps-lien" onClick={(e) => e.stopPropagation()}>
                          Planning du service
                        </Link>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}

          {rechercheActive && totalAffiche === 0 && (
            <p className="eps-vide" style={{ textAlign: 'center' }}>
              Aucun employé ne correspond à la recherche.
            </p>
          )}
        </>
      )}
    </section>
  );
}
