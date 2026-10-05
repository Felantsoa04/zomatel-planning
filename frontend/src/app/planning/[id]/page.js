'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Printer, XCircle, Check, TriangleAlert, CircleAlert, CircleCheck } from 'lucide-react';
import AppShell from '@/components/AppShell';
import RetourButton from '@/components/RetourButton';
import LegendeStatuts from '@/components/LegendeStatuts';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import SaisieHeureFloat from '@/components/SaisieHeureFloat';
import PlanningModelEditor from '@/components/PlanningModelEditor';
import { resoudreModele, MODELE_STANDARD_PAR_DEFAUT } from '@/lib/planningModels';
import { versInterne } from '@/lib/planningData';

const PERIODES = ['MATIN', 'APRES_MIDI', 'SOIR'];
const PERIODE_LABEL = { MATIN: 'Matin', APRES_MIDI: 'Apres-midi', SOIR: 'Soir' };

function listeJours(dateDebut, dateFin) {
  const jours = [];
  let d = new Date(dateDebut);
  const fin = new Date(dateFin);
  while (d <= fin) {
    jours.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return jours;
}

function enMinutes(h) {
  if (!h) return 0;
  const [hh, mm] = h.slice(0, 5).split(':').map(Number);
  return hh * 60 + mm;
}

function dureeMinutes(entree, sortie) {
  if (!entree || !sortie) return 0;
  return Math.abs(enMinutes(sortie) - enMinutes(entree));
}

// Regle de repartition issue du fichier Excel de reference du projet :
// une plage horaire est rangee dans la periode de son HEURE DE DEBUT —
// < 12:00 = matin, 12:00-17:59 = apres-midi, >= 18:00 = soir.
function periodeDe(entree) {
  const m = enMinutes(entree);
  if (m < 12 * 60) return 'MATIN';
  if (m < 18 * 60) return 'APRES_MIDI';
  return 'SOIR';
}

function formatDuree(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

// REGLE METIER — controle des heures hebdomadaires (affichage uniquement) :
// Administration -> minimum 44 h/semaine ; tous les autres services -> 48 h.
// Depassement important : +8 h au-dessus du seuil du service (alerte rouge).
// Un depassement normal reste conforme (aucune alerte genante : badges only).
const SEUIL_ADMIN_HEURES = 44;
const SEUIL_AUTRES_HEURES = 48;
const EXCES_AU_DESSUS_DU_MIN = 8;

function seuilMinHeures(nomService) {
  const nom = (nomService || '').toLowerCase();
  return nom.includes('admin') ? SEUIL_ADMIN_HEURES : SEUIL_AUTRES_HEURES;
}

function seuilExcesHeures(seuilMin) {
  return seuilMin + EXCES_AU_DESSUS_DU_MIN;
}

// -> { statut: 'MANQUE', manque } | { statut: 'EXCES', exces } | { statut: 'OK' }
function alerteHeures(total, seuilMin) {
  const t = Number(total) || 0;
  if (t < seuilMin) return { statut: 'MANQUE', manque: Number((seuilMin - t).toFixed(2)) };
  if (t > seuilExcesHeures(seuilMin)) return { statut: 'EXCES', exces: Number((t - seuilMin).toFixed(2)) };
  return { statut: 'OK' };
}

export default function PlanningDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [employes, setEmployes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editCell, setEditCell] = useState(null);
  const [form, setForm] = useState({ statut_jour: 'TRAVAIL', creneaux: {} });
  const [saving, setSaving] = useState(false);
  const [vueEmploiDuTemps, setVueEmploiDuTemps] = useState(false);
  const [modalRejet, setModalRejet] = useState(false);
  const [motif, setMotif] = useState('');
  const [motifErreur, setMotifErreur] = useState('');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  // MULTI-MODÈLES : modèle du service + données converties (null = STANDARD)
  const [modele, setModele] = useState(MODELE_STANDARD_PAR_DEFAUT);
  const [donneesModele, setDonneesModele] = useState(null);

  // Session lue APRES montage uniquement : lire getUser()/getToken() pendant le
  // rendu donnait une UI client differente du HTML serveur (erreur d'hydratation).
  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setToken(t);
  }, [router]);

  const charger = useCallback(async () => {
    if (!token) return; // attend la lecture de la session au montage
    try {
      const planningData = await api.get(`/plannings/${id}`, token);
      setData(planningData);
      // Fallback : selon la version du backend, la cle peut etre id_service
      // ou service_id (getById renvoie p.service_id sans alias).
      const idService = planningData.planning.id_service ?? planningData.planning.service_id;
      const emps = await api.get(`/employes?id_service=${idService}`, token);
      setEmployes(emps);
      // Modèle du service du planning + conversion des données réelles
      const m = resoudreModele({ nom_service: planningData.planning.service_nom });
      setModele(m);
      if (m.code !== 'STANDARD') {
        const interne = versInterne(m, planningData.affectations || [],
          (planningData.affectations || []).flatMap((a) => (a.creneaux || []).map((c) => ({ ...c, id_affectation: a.id_affectation }))));
        if (m.code === 'HORAIRE_LIBRE' && (!interne.horaires || interne.horaires.length === 0)) {
          interne.horaires = JSON.parse(JSON.stringify(m.horairesDefaut || []));
        }
        setDonneesModele({ config: m, donnees: interne });
      } else {
        setDonneesModele(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, token, router]);

  useEffect(() => {
    if (token) charger();
  }, [charger]);

  if (loading) return <PageShell><p className="muted">Chargement...</p></PageShell>;
  if (error) return <PageShell><div className="error">{error}</div></PageShell>;
  if (!data) return null;

  const { planning, affectations, totaux, couverture } = data;
  const jours = listeJours(planning.date_debut, planning.date_fin);
  // Seuil du service (regle metier) : Administration 44 h, autres services 48 h
  const seuilMin = seuilMinHeures(planning.service_nom);
  // Dernier rejet RH (fourni par l'API) : motif affiche au chef tant qu'il n'a pas resoumis
  const motifRejet = data.dernier_rejet || null;

  function trouverAffectation(id_employe, jour) {
    return affectations.find((a) => a.id_employe === id_employe && a.jour === jour);
  }

  function ouvrirEdition(id_employe, jour) {
    const existante = trouverAffectation(id_employe, jour);
    const creneaux = {};
    if (existante) {
      for (const c of existante.creneaux) {
        creneaux[c.periode] = { heure_entree: c.heure_entree, heure_sortie: c.heure_sortie };
      }
    }
    setForm({ statut_jour: existante?.statut_jour || 'TRAVAIL', creneaux });
    setEditCell({ id_employe, jour });
  }

  function majCreneau(periode, champ, valeur) {
    setForm((f) => {
      // Regle Excel : des que l'heure de debut est saisie, le creneau se
      // place automatiquement dans la bonne periode (matin/apres-midi/soir).
      if (champ === 'heure_entree' && valeur) {
        const cible = periodeDe(valeur);
        if (cible !== periode) {
          return {
            ...f,
            creneaux: {
              ...f.creneaux,
              [periode]: { ...f.creneaux[periode], heure_entree: '', heure_sortie: '' },
              [cible]: {
                ...(f.creneaux[cible] || { heure_entree: '', heure_sortie: '' }),
                heure_entree: valeur,
                heure_sortie: f.creneaux[periode]?.heure_sortie || '',
              },
            },
          };
        }
      }
      return {
        ...f,
        creneaux: {
          ...f.creneaux,
          [periode]: { ...f.creneaux[periode], [champ]: valeur },
        },
      };
    });
  }

  async function enregistrer() {
    setSaving(true);
    setError('');
    try {
      const { id_affectation } = await api.post(
        `/plannings/${id}/affectations`,
        { id_employe: editCell.id_employe, jour: editCell.jour, statut_jour: form.statut_jour },
        token
      );

      if (form.statut_jour === 'TRAVAIL') {
        for (const periode of PERIODES) {
          const c = form.creneaux[periode];
          if (c && c.heure_entree && c.heure_sortie) {
            await api.post(
              `/affectations/${id_affectation}/creneaux`,
              {
                // Regle Excel : periode deduite de l'heure de debut.
                periode: periodeDe(c.heure_entree),
                heure_entree: c.heure_entree,
                heure_sortie: c.heure_sortie,
              },
              token
            );
          }
        }
      }

      setEditCell(null);
      await charger();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function soumettre() {
    if (!confirm('Soumettre ce planning a la RH pour validation ?')) return;
    try {
      await api.patch(`/plannings/${id}/soumettre`, {}, token);
      await charger();
    } catch (err) {
      setError(err.message);
    }
  }

  // Validation RH : VALIDE direct ; REJETE -> ouvre la modal exigeant un motif.
  async function validerRH(decision, commentaire = '') {
    try {
      await api.post(`/plannings/${id}/validation`, { decision, commentaire }, token);
      setModalRejet(false);
      setMotif('');
      setMotifErreur('');
      await charger();
    } catch (err) {
      setError(err.message);
    }
  }

  function demanderRejet() {
    setMotif('');
    setMotifErreur('');
    setModalRejet(true);
  }

  function confirmerRejet() {
    // Le motif est obligatoire : aucun rejet sans texte.
    if (!motif.trim()) {
      setMotifErreur('Le motif du rejet est obligatoire.');
      return;
    }
    validerRH('REJETE', motif.trim());
  }

  // BROUILLON ou REJETE : le chef peut corriger (cellules) et resoumettre
  const peutModifier = ['BROUILLON', 'REJETE'].includes(planning.statut) && user?.role === 'CHEF_SERVICE';
  const estRH = user?.role === 'RH';

  return (
    <PageShell bloquerImpression={planning.statut !== 'VALIDE'}>
      {/* Bandeau + pied d'impression : apparaissent UNIQUEMENT sur papier
          (@media print) — titre, service, semaine réels, aucun texte technique. */}
      {planning.statut === 'VALIDE' && (
        <div className="pied-impression">
          <span className="pied-gauche">Zomatel Planning — {planning.service_nom}</span>
          <span>Semaine {planning.numero_semaine} / {planning.annee}</span>
          <span className="pied-droite">Édité le {new Date().toLocaleDateString('fr-FR')}</span>
        </div>
      )}
      {/* Retour : vers la liste d'ou l'utilisateur vient (dashboard, notification,
          grille...). Avertissement si une cellule est en cours d'edition. */}
      <RetourButton fallback="/dashboard" hasUnsaved={!!editCell} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>
            {planning.service_nom} — Semaine {planning.numero_semaine} / {planning.annee}
          </h1>
          <p className="muted">{planning.date_debut} au {planning.date_fin}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {estRH && (
            <button className="btn secondary" onClick={() => setVueEmploiDuTemps((v) => !v)}>
              {vueEmploiDuTemps ? 'Retour au tableau' : 'Automatiser en emploi du temps'}
            </button>
          )}
          {/* REGLE : impression reservee aux plannings VALIDES par le RH.
              BROUILLON / SOUMIS / REJETE : ni bouton, ni impression possible
              (l'impression navigateur est bloquee par la classe impression-bloquee). */}
          {planning.statut === 'VALIDE' && (
            <button className="btn secondary" onClick={() => window.print()} title="Imprimer le planning valide">
              <Printer size={14} aria-hidden="true" /> Imprimer / PDF
            </button>
          )}
          <span className={`badge ${planning.statut}`}>{planning.statut}</span>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Bloc REJETE : le motif reste visible jusqu'a correction + resoumission.
          Reservé au service concerne (chef du service et RH). */}
      {planning.statut === 'REJETE' && (
        <div className="motif-rejet-box" role="alert">
          <div className="motif-rejet-titre"><XCircle size={15} aria-hidden="true" /> Planning rejeté</div>
          <div>
            <strong>Motif du rejet :</strong>{' '}
            {motifRejet?.commentaire || <span className="muted">(motif non renseigné)</span>}
          </div>
          {user?.role === 'CHEF_SERVICE' && (
            <div className="muted" style={{ marginTop: 6 }}>
              Corrigez le planning (grille de gestion), puis soumettez-le à nouveau à la RH.
            </div>
          )}
        </div>
      )}

      {/* MULTI-MODÈLES : affichage par le modèle du service (lecture seule ici,
          la saisie se fait dans Gestion du planning). Le modèle STANDARD garde
          les vues existantes ci-dessous (aucune régression). */}
      {modele.code !== 'STANDARD' && donneesModele && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <PlanningModelEditor
            modele={modele}
            jours={jours}
            employes={employes}
            valeur={donneesModele}
            lectureSeule
          />
        </div>
      )}

      <div style={{ margin: '12px 0', display: modele.code !== 'STANDARD' ? 'none' : undefined }}>
        {peutModifier && (
          <button className="btn success" onClick={soumettre}>Soumettre a la RH</button>
        )}
        {planning.statut === 'SOUMIS' && user?.role === 'RH' && (
          <>
            <button className="btn success" onClick={() => validerRH('VALIDE')} style={{ marginRight: 8 }}>
              <Check size={14} aria-hidden="true" /> Valider
            </button>
            <button className="btn danger" onClick={demanderRejet}><XCircle size={14} aria-hidden="true" /> Rejeter</button>
          </>
        )}
      </div>

      {estRH && vueEmploiDuTemps ? (
        <VueEmploiDuTemps jours={jours} employes={employes} trouverAffectation={trouverAffectation} totaux={totaux} seuilMin={seuilMin} idPlanning={Number(id)} imprimable={planning.statut === 'VALIDE'} />
      ) : modele.code === 'STANDARD' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Employe</th>
                {jours.map((j) => (
                  <th key={j}>{new Date(j).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employes.map((emp) => (
                <tr key={emp.id_employe}>
                  <td>{emp.nom}{emp.matricule ? ` (${emp.matricule})` : ''} {emp.statut === 'STAGIAIRE' && <span className="muted">(stagiaire)</span>}</td>
                  {jours.map((jour) => {
                    const aff = trouverAffectation(emp.id_employe, jour);
                    return (
                      <td
                        key={jour}
                        onClick={() => peutModifier && ouvrirEdition(emp.id_employe, jour)}
                        style={{ cursor: peutModifier ? 'pointer' : 'default', minWidth: 110 }}
                      >
                        {aff ? (
                          <>
                            <span className={`badge ${aff.statut_jour}`}>{aff.statut_jour}</span>
                            {aff.creneaux.map((c) => (
                              <div key={c.id_creneau} className="muted" style={{ fontSize: 12 }}>
                                {PERIODE_LABEL[c.periode]}: {c.heure_entree.slice(0, 5)}-{c.heure_sortie.slice(0, 5)}
                              </div>
                            ))}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!vueEmploiDuTemps && editCell && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>
            Modifier : employe #{editCell.id_employe} — {editCell.jour}
          </h3>
          <div className="form-row">
            <label>Statut du jour</label>
            <select
              value={form.statut_jour}
              onChange={(e) => setForm((f) => ({ ...f, statut_jour: e.target.value }))}
            >
              <option value="TRAVAIL">Travail</option>
              <option value="REPOS">Repos</option>
              <option value="ABSENCE">Absence</option>
            </select>
          </div>

          {form.statut_jour === 'TRAVAIL' && (
            <div className="form-row">
              <label>
                Creneaux — saisie décimale (8.5 = 8 h 30) — la période est déduite
                automatiquement de l&apos;heure de début, comme dans l&apos;Excel
              </label>
              {PERIODES.map((periode) => (
                <div key={periode} className="saisie-float-groupe" style={{ marginBottom: 8 }}>
                  <SaisieHeureFloat
                    label="Heure début"
                    valeurHHmm={form.creneaux[periode]?.heure_entree || ''}
                    onChange={(hhmm) => majCreneau(periode, 'heure_entree', hhmm)}
                  />
                  <SaisieHeureFloat
                    label="Heure fin"
                    valeurHHmm={form.creneaux[periode]?.heure_sortie || ''}
                    onChange={(hhmm) => majCreneau(periode, 'heure_sortie', hhmm)}
                  />
                </div>
              ))}
            </div>
          )}

          <button className="btn" onClick={enregistrer} disabled={saving}>
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          <button className="btn secondary" onClick={() => setEditCell(null)} style={{ marginLeft: 8 }}>
            Annuler
          </button>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          Total hebdomadaire par employe{' '}
          <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
            (minimum : {seuilMin} h — Administration : 44 h, autres services : 48 h)
          </span>
        </h3>
        <table>
          <thead>
            <tr><th>Employe</th><th>Reference</th><th>Total realise</th><th>Controle des heures</th></tr>
          </thead>
          <tbody>
            {totaux.map((t) => (
              <tr key={t.id_employe}>
                <td>{t.nom}</td>
                <td>{t.reference_hebdo} h</td>
                <td>{Number(t.total_heures_semaine).toFixed(1)} h</td>
                <td><AlerteHeures total={t.total_heures_semaine} seuilMin={seuilMin} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal de rejet : motif OBLIGATOIRE (bouton Confirmer inactif sinon) */}
      {modalRejet && (
        <div className="modal-overlay" onClick={() => setModalRejet(false)}>
          <div className="motif-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Rejeter le planning</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Le planning sera renvoyé au chef de service pour correction.
            </p>
            <label htmlFor="motif-rejet">Motif du rejet *</label>
            <textarea
              id="motif-rejet"
              rows={4}
              value={motif}
              onChange={(e) => {
                setMotif(e.target.value);
                if (e.target.value.trim()) setMotifErreur('');
              }}
              placeholder="Ex : Le nombre d'heures prévu pour certains employés doit être corrigé."
              autoFocus
            />
            {motifErreur && <div className="error">{motifErreur}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn danger" onClick={confirmerRejet}>Confirmer le rejet</button>
              <button className="btn secondary" onClick={() => setModalRejet(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {couverture.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Controle de couverture</h3>
          <table>
            <thead>
              <tr><th>Jour</th><th>Periode</th><th>Requis</th><th>Reel</th><th>Statut</th></tr>
            </thead>
            <tbody>
              {couverture.map((c) => (
                <tr key={c.id_controle}>
                  <td>{c.jour}</td>
                  <td>{PERIODE_LABEL[c.periode]}</td>
                  <td>{c.effectif_requis}</td>
                  <td>{c.effectif_reel}</td>
                  <td>{c.statut}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

function VueEmploiDuTemps({ jours, employes, trouverAffectation, totaux, seuilMin = SEUIL_AUTRES_HEURES, idPlanning = null, imprimable = false }) {
  function totalDe(id_employe) {
    return totaux.find((t) => t.id_employe === id_employe);
  }

  // Export Excel (fichier généré depuis le modèle de référence du projet,
  // endpoint existant GET /plannings/:id/emploi-du-temps.xlsx, JWT requis)
  async function exporterExcel() {
    try {
      const flux = await api.getBrut(`/plannings/${idPlanning}/emploi-du-temps.xlsx`);
      const url = URL.createObjectURL(flux.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = flux.nomFichier;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export impossible : ' + e.message);
    }
  }

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <LegendeStatuts />
        {imprimable && (
          <button className="btn secondary" onClick={exporterExcel}>Export Excel</button>
        )}
      </div>
      <table className="edt-table">
        <thead>
          <tr>
            <th rowSpan={2}>Employe</th>
            {jours.map((j) => (
              <th key={j} colSpan={4}>
                {new Date(j).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
              </th>
            ))}
            <th rowSpan={2}>Total hebdo</th>
          </tr>
          <tr>
            {jours.map((j) => (
              <Fragment key={j}>
                <th>Matin</th>
                <th>Apres-midi</th>
                <th>Soir</th>
                <th>Total</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {employes.map((emp) => {
            const total = totalDe(emp.id_employe);
            return (
              <tr key={emp.id_employe} className={total?.depassement ? 'edt-depassement' : ''}>
                <td>
                  {emp.nom} {emp.statut === 'STAGIAIRE' && <span className="muted">(stagiaire)</span>}
                </td>

                {jours.map((jour) => {
                  const aff = trouverAffectation(emp.id_employe, jour);

                  if (!aff || aff.statut_jour !== 'TRAVAIL') {
                    // Affichage uniquement : sans affectation -> NON PLANIFIE (gris),
                    // sinon le statut du jour (REPOS vert, ABSENCE rouge, CONGE orange...).
                    const statutAffiche = aff?.statut_jour || 'NON_PLANIFIE';
                    return (
                      <td key={jour} colSpan={4} className={`edt-statut-${statutAffiche}`}>
                        <span className={`badge-edt badge-edt-${statutAffiche.toLowerCase()}`}>
                          {statutAffiche}
                        </span>
                      </td>
                    );
                  }

                  const parPeriode = {};
                  PERIODES.forEach((p) => {
                    parPeriode[p] = aff.creneaux.find((c) => c.periode === p);
                  });

                  const totalJourMinutes = PERIODES.reduce(
                    (s, p) => s + dureeMinutes(parPeriode[p]?.heure_entree, parPeriode[p]?.heure_sortie),
                    0
                  );

                  return (
                    <Fragment key={jour}>
                      {PERIODES.map((p) => (
                        <td key={`${jour}-${p}`} className="edt-cellule-periode">
                          {parPeriode[p] ? (
                            <>
                              {parPeriode[p].heure_entree.slice(0, 5)}-{parPeriode[p].heure_sortie.slice(0, 5)}
                              <div className="muted" style={{ fontSize: 11 }}>
                                {formatDuree(dureeMinutes(parPeriode[p].heure_entree, parPeriode[p].heure_sortie))}
                              </div>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      ))}
                      <td className="edt-total-jour">{formatDuree(totalJourMinutes)}</td>
                    </Fragment>
                  );
                })}

                <td className={`edt-total-hebdo ${total?.depassement ? 'edt-total-depassement' : ''}`}>
                  {total ? `${Number(total.total_heures_semaine).toFixed(1)} h / ${total.reference_hebdo} h` : '—'}
                  {total && <AlerteHeures total={total.total_heures_semaine} seuilMin={seuilMin} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Indicateur discret (badge, jamais de popup) du controle des heures hebdo :
// manque -> orange, conforme -> vert, depassement important -> rouge.
function AlerteHeures({ total, seuilMin }) {
  const alerte = alerteHeures(total, seuilMin);
  if (alerte.statut === 'MANQUE') {
    return (
      <span className="alerte-heures alerte-manque" title="Heures insuffisantes">
        <TriangleAlert size={11} aria-hidden="true" /> Heures insuffisantes — manque {alerte.manque} h
      </span>
    );
  }
  if (alerte.statut === 'EXCES') {
    return (
      <span className="alerte-heures alerte-exces" title="Dépassement important">
        <CircleAlert size={11} aria-hidden="true" /> Dépassement important — +{alerte.exces} h
      </span>
    );
  }
  return <span className="alerte-heures alerte-ok" title="Conforme"><CircleCheck size={11} aria-hidden="true" /> Conforme</span>;
}

function PageShell({ children, bloquerImpression = false }) {
  // Classe impression-bloquee : en @media print, tout est masque et remplace
  // par un message — Ctrl+P ne produit aucune copie d'un planning non valide.
  return (
    <div className={bloquerImpression ? 'impression-bloquee' : ''}>
      <AppShell>
        <div className="container">{children}</div>
      </AppShell>
    </div>
  );
}