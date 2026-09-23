'use client';

// GESTION DU PLANNING - saisie directe en grille hebdomadaire (facon Excel).
// Le chef de service remplit la grille de SON service : clic sur une cellule
// (employe x jour) -> horaire debut/fin ou REPOS/CONGE/ABSENCE, controles
// automatiques (8h/jour, chevauchement, conges/indisponibilites/recuperations RH),
// totaux automatiques par employe, puis Enregistrer brouillon / Verifier / Soumettre.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RetourButton from '@/components/RetourButton';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

const JOURS_LABEL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const STATUTS_CELLULE = ['TRAVAIL', 'REPOS', 'CONGE', 'ABSENCE'];
const PERIODES = ['MATIN', 'APRES_MIDI', 'SOIR'];
const LIBELLE_PERIODE = { MATIN: 'Matin', APRES_MIDI: 'Apres-midi', SOIR: 'Soir' };
const MAX_MINUTES_JOUR = 480; // regle 8h/jour

// ---- Utilitaires dates/heures ----------------------------------------------

// Liste les 7 jours d'une semaine ISO (lundi -> dimanche) depuis annee + numero
function joursDeSemaine(annee, semaine) {
  const janvier = new Date(Date.UTC(annee, 0, 4));
  const jourSemaineJanvier = janvier.getUTCDay() || 7;
  const lundi = new Date(janvier);
  lundi.setUTCDate(janvier.getUTCDate() - jourSemaineJanvier + 1 + (semaine - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundi);
    d.setUTCDate(lundi.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// Nombre de semaines ISO d'une annee (52 ou 53 selon l'annee) — calcule,
// aucune limite : fonctionne pour toute annee passee ou future.
function nbSemainesISO(annee) {
  // Le 28 decembre est toujours dans la derniere semaine ISO de l'annee :
  // son numero de semaine = nombre de semaines de l'annee.
  const janvier = new Date(Date.UTC(annee, 0, 4));
  const js = janvier.getUTCDay() || 7;
  const lundi1 = new Date(janvier);
  lundi1.setUTCDate(janvier.getUTCDate() - js + 1);
  const dec28 = new Date(Date.UTC(annee, 11, 28));
  return Math.round((dec28 - lundi1) / (7 * 24 * 3600 * 1000)) + 1;
}

function enMinutes(h) {
  if (!h) return 0;
  const [hh, mm] = h.slice(0, 5).split(':').map(Number);
  return hh * 60 + mm;
}

function formatDuree(minutes) {
  if (!minutes) return '';
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}

function libelleJour(jour) {
  const j = new Date(`${jour}T12:00:00`).getDay();
  return JOURS_LABEL[(j + 6) % 7];
}

// ---- Page ------------------------------------------------------------------

export default function GestionPlanningPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [services, setServices] = useState([]);
  const [serviceChoisi, setServiceChoisi] = useState(''); // id_service en chaine
  const [semaine, setSemaine] = useState(() => {
    const d = new Date();
    const janvier = new Date(Date.UTC(d.getFullYear(), 0, 4));
    const js = janvier.getUTCDay() || 7;
    const lundi = new Date(janvier);
    lundi.setUTCDate(janvier.getUTCDate() - js + 1);
    const num = Math.min(52, Math.max(1, 1 + Math.round((d - lundi) / (7 * 24 * 3600 * 1000))));
    return `${d.getFullYear()}-W${String(num).padStart(2, '0')}`;
  });
  // Annee + numero de semaine derives de l'etat `semaine` ("YYYY-Www") :
  // l'annee est librement saisissable (aucune limite), la liste des semaines
  // est calculee pour l'annee choisie (52 ou 53 selon l'annee ISO).
  const [anneeSemaine, numSemaine] = semaine.split('-W').map(Number);

  const [grille, setGrille] = useState(null); // reponse GET /plannings/:id/grille
  const [planningId, setPlanningId] = useState(null);
  const [cellules, setCellules] = useState({}); // "employe|jour" -> { statut_jour, entree, sortie }
  const [celluleActive, setCelluleActive] = useState(null); // { id_employe, nom, jour }
  const [form, setForm] = useState({ statut_jour: 'TRAVAIL', entree: '', sortie: '' });
  const [enregistrement, setEnregistrement] = useState(false);
  const [messagesCellules, setMessagesCellules] = useState({}); // "employe|jour" -> erreur API
  const [message, setMessage] = useState('');

  // --- Chargement session ----------------------------------------------------
  useEffect(() => {
    const t = getToken();
    const u = getUser();
    if (!t) {
      router.replace('/login');
      return;
    }
    setUser(u);
    setToken(t);
    // Pre-selection depuis l'URL (bouton "Modifier" du dashboard) :
    // /planning/gestion?service=2&semaine=2026-W38
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('service');
    const sem = params.get('semaine');
    if (sid) setServiceChoisi(String(sid));
    if (sem && /^(\d+)-W(\d{1,2})$/.test(sem)) setSemaine(`${Number(sem.split('-W')[0])}-W${String(Number(sem.split('-W')[1])).padStart(2, '0')}`);
  }, [router]);

  // Services accessibles (RH : tous ; chef : le sien via /plannings ou /services)
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const liste = await api.get('/services', token);
        const disponibles =
          user?.role === 'CHEF_SERVICE' && user?.id_service
            ? liste.filter((s) => String(s.id_service) === String(user.id_service))
            : liste;
        setServices(disponibles);
        // Ne ecrase pas une pre-selection venue de l'URL (?service=...)
        if (disponibles.length > 0 && !serviceChoisi) setServiceChoisi(String(disponibles[0].id_service));
      } catch (err) {
        setErreur(err.message);
      }
    })();
  }, [token, user]);

  const chargerGrille = useCallback(async () => {
    if (!token || !serviceChoisi) return;
    setChargement(true);
    setErreur('');
    setMessage('');
    setMessagesCellules({});
    try {
      const [annee, num] = semaine.split('-W');
      // Planning existant pour (service, semaine) ?
      const existants = await api.get(`/plannings?id_service=${serviceChoisi}&annee=${annee}`, token);
      const existant = (existants || []).find((p) => Number(p.numero_semaine) === Number(num));
      let id = existant?.id_planning || null;
      if (!id) {
        // La CREATION d'un planning est reservee au chef de service (route POST
        // protegee par requireRole('CHEF_SERVICE')). RH/ADMIN : consultation
        // uniquement -> message clair, jamais de POST automatique (ce POST
        // automatique etait la cause du 403 « Acces refuse pour ce role »).
        if (user?.role !== 'CHEF_SERVICE') {
          setErreur('Aucun planning existe pour ce service sur cette semaine. Seul le chef de service peut le créer.');
          setGrille(null);
          return;
        }
        const jours = joursDeSemaine(Number(annee), Number(num));
        const cr = await api.post(
          '/plannings',
          { annee: Number(annee), numero_semaine: Number(num), date_debut: jours[0], date_fin: jours[6] },
          token
        );
        id = cr.id_planning;
      }
      setPlanningId(id);
      const data = await api.get(`/plannings/${id}/grille`, token);
      setGrille(data);

      // Initialise l'etat local avec les donnees existantes
      const etat = {};
      for (const a of data.affectations) {
        const cle = `${a.id_employe}|${a.jour}`;
        const creneau = (data.creneaux || []).find((c) => c.id_affectation === a.id_affectation);
        etat[cle] = {
          statut_jour: a.statut_jour,
          entree: creneau ? creneau.heure_entree.slice(0, 5) : '',
          sortie: creneau ? creneau.heure_sortie.slice(0, 5) : '',
        };
      }
      setCellules(etat);
    } catch (err) {
      setErreur(err.message);
      setGrille(null);
    } finally {
      setChargement(false);
    }
  }, [token, serviceChoisi, semaine, user]);

  useEffect(() => {
    chargerGrille();
  }, [chargerGrille]);

  // --- Contraintes RH par employe/jour ---------------------------------------
  const contraintesParCle = useMemo(() => {
    const map = {};
    if (!grille) return map;
    const jours = grille.planning ? joursDeSemaine(grille.planning.annee, grille.planning.numero_semaine) : [];
    const ajoute = (idEmploye, jour, texte) => {
      const cle = `${idEmploye}|${jour}`;
      (map[cle] = map[cle] || []).push(texte);
    };
    for (const c of grille.contraintes?.conges || []) {
      for (const j of jours) {
        if (j >= c.date_debut && j <= c.date_fin) ajoute(c.id_employe, j, `Conge ${c.type_conge.toLowerCase()} valide par la RH`);
      }
    }
    for (const i of grille.contraintes?.indisponibilites || []) {
      for (const j of jours) {
        if (j >= i.date_debut && j <= i.date_fin) ajoute(i.id_employe, j, `Indisponible (${i.type_indispo.toLowerCase()}) : ${i.motif || 'voir RH'}`);
      }
    }
    for (const r of grille.contraintes?.recuperations || []) {
      ajoute(r.id_employe, r.jour, `Recuperation communiquee par la RH : ${Number(r.nombre_heures)} h${r.motif ? ` (${r.motif})` : ''}`);
    }
    return map;
  }, [grille]);

  // --- Calculs locaux (durees, doublons, chevauchements, alertes) ------------
  const calculs = useMemo(() => {
    const joursSem = grille?.planning
      ? joursDeSemaine(grille.planning.annee, grille.planning.numero_semaine)
      : [];
    const dureeCellule = (cel) => (cel?.statut_jour === 'TRAVAIL' ? Math.max(0, enMinutes(cel.sortie) - enMinutes(cel.entree)) : 0);
    const parEmploye = {};
    for (const emp of grille?.employes || []) {
      const heuresParJour = {};
      let total = 0;
      for (const j of joursSem) {
        const m = dureeCellule(cellules[`${emp.id_employe}|${j}`]);
        heuresParJour[j] = m;
        total += m;
      }
      const reference = Number(emp.reference_hebdo || 44) * 60;
      parEmploye[emp.id_employe] = {
        heuresParJour,
        total,
        reference,
        difference: total - reference,
        depassement: total > reference,
      };
    }
    // Controles croises par employe/jour
    const anomalies = {};
    for (const emp of grille?.employes || []) {
      const parJour = {};
      for (const j of joursSem) {
        const cel = cellules[`${emp.id_employe}|${j}`];
        const msgs = [];
        if (cel?.statut_jour === 'TRAVAIL') {
          if (!cel.entree || !cel.sortie) msgs.push('Horaire incomplet.');
          else if (enMinutes(cel.sortie) <= enMinutes(cel.entree)) msgs.push('Fin <= debut.');
          else if (dureeCellule(cel) > MAX_MINUTES_JOUR) msgs.push('8h/jour maximum.');
        }
        parJour[j] = { minutes: dureeCellule(cel), msgs, horaire: msgs.length === 0 ? cel : null };
      }
      // Doublon / chevauchement entre jours (ex. 22:00-06:00 mal saisi sur 2 jours)
      // Chevauchement intra-cellule impossible (1 horaire/cellule) : on verifie
      // uniquement les cellules dupliquees (2 saisies identiques meme jour = meme cle).
      for (const j of joursSem) {
        const info = parJour[j];
        if (info.msgs.length > 0) anomalies[`${emp.id_employe}|${j}`] = info.msgs;
      }
    }
    return { parEmploye, anomalies };
  }, [grille, cellules]);

  // --- Interactions ----------------------------------------------------------
  function ouvrirCellule(idEmploye, nom, jour) {
    if (grille?.planning?.statut !== 'BROUILLON' && grille?.planning?.statut !== 'REJETE') return;
    const cel = cellules[`${idEmploye}|${jour}`] || { statut_jour: 'TRAVAIL', entree: '', sortie: '' };
    setCelluleActive({ id_employe: idEmploye, nom, jour });
    setForm({ statut_jour: cel.statut_jour || 'TRAVAIL', entree: cel.entree || '', sortie: cel.sortie || '' });
  }

  function validerSaisie() {
    if (form.statut_jour === 'TRAVAIL') {
      if (!form.entree || !form.sortie) return 'Horaire incomplet : saisir debut et fin.';
      if (enMinutes(form.sortie) <= enMinutes(form.entree)) return 'Heure de fin anterieure ou egale a l\'heure de debut.';
      if (enMinutes(form.sortie) - enMinutes(form.entree) > MAX_MINUTES_JOUR) return '8h/jour maximum par employe.';
    }
    return null;
  }

  function appliquerCellule() {
    const err = validerSaisie();
    if (err) {
      setMessagesCellules((m) => ({ ...m, [`${celluleActive.id_employe}|${celluleActive.jour}`]: err }));
      return;
    }
    const cle = `${celluleActive.id_employe}|${celluleActive.jour}`;
    setMessagesCellules((m) => ({ ...m, [cle]: undefined }));
    setCellules((c) => ({
      ...c,
      [cle]: form.statut_jour === 'TRAVAIL' ? { ...form } : { statut_jour: form.statut_jour, entree: '', sortie: '' },
    }));
    setCelluleActive(null);
  }

  function viderCellule(idEmploye, jour) {
    const cle = `${idEmploye}|${jour}`;
    setCellules((c) => {
      const copie = { ...c };
      delete copie[cle];
      return copie;
    });
    setMessagesCellules((m) => ({ ...m, [cle]: undefined }));
  }

  function cellulesModifiees() {
    const liste = [];
    if (!grille) return liste;
    for (const [cle, cel] of Object.entries(cellules)) {
      const [id_employe, jour] = cle.split('|');
      liste.push({
        id_employe: Number(id_employe),
        jour,
        statut_jour: cel.statut_jour,
        creneau:
          cel.statut_jour === 'TRAVAIL' && cel.entree && cel.sortie
            ? { periode: periodeDe(cel.entree), heure_entree: cel.entree, heure_sortie: cel.sortie }
            : null,
      });
    }
    // Cellules existantes en base qui ont ete vides a l'ecran -> suppression
    for (const a of grille.affectations) {
      const cle = `${a.id_employe}|${a.jour}`;
      if (!cellules[cle]) {
        liste.push({ id_employe: a.id_employe, jour: a.jour, statut_jour: 'VIDE', creneau: null });
      }
    }
    return liste;
  }

  // Periode deduite de l'heure de debut (matin / apres-midi / soir)
  function periodeDe(entree) {
    const m = enMinutes(entree);
    if (m < 12 * 60) return 'MATIN';
    if (m < 18 * 60) return 'APRES_MIDI';
    return 'SOIR';
  }

  async function enregistrer() {
    setEnregistrement(true);
    setMessage('');
    try {
      const reponse = await api.put(`/plannings/${planningId}/grille`, { cellules: cellulesModifiees() }, token);
      const echecs = (reponse.resultats || []).filter((r) => !r.ok);
      if (echecs.length > 0) {
        const nouveaux = {};
        for (const e of echecs) nouveaux[`${e.id_employe}|${e.jour}`] = e.erreur;
        setMessagesCellules((m) => ({ ...m, ...nouveaux }));
        setMessage(`${reponse.modifiees} cellule(s) enregistree(s), ${echecs.length} refusee(s) par les controles.`);
      } else {
        setMessagesCellules({});
        setMessage('Grille enregistree (brouillon).');
      }
      await chargerGrille();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  function verifier() {
    const problemes = [];
    for (const [cle, err] of Object.entries(messagesCellules)) {
      if (err) problemes.push(`${cle.replace('|', ' / ')} : ${err}`);
    }
    for (const [cle, err] of Object.entries(calculs.anomalies || {})) {
      problemes.push(`${cle.replace('|', ' / ')} : ${err.join(' ')}`);
    }
    for (const emp of grille?.employes || []) {
      const c = calculs.parEmploye[emp.id_employe];
      if (c?.depassement) {
        problemes.push(`${emp.nom} : ${formatDuree(c.total)} prevues > reference ${Math.round(c.reference / 60)} h`);
      }
    }
    if (problemes.length === 0) {
      setMessage('Aucun probleme detecte : horaires coherents, pas de depassement.');
    } else {
      setMessage(`Points a corriger (${problemes.length}) :\n- ${problemes.join('\n- ')}`);
    }
  }

  async function soumettre() {
    if (!confirm('Soumettre ce planning a la RH pour validation ?')) return;
    setEnregistrement(true);
    try {
      await enregistrerSansMessage();
      await api.patch(`/plannings/${planningId}/soumettre`, {}, token);
      setMessage('Planning soumis a la RH.');
      await chargerGrille();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  // Sauvegarde silencieuse utilisee avant la soumission
  async function enregistrerSansMessage() {
    const reponse = await api.put(`/plannings/${planningId}/grille`, { cellules: cellulesModifiees() }, token);
    const echecs = (reponse.resultats || []).filter((r) => !r.ok);
    if (echecs.length > 0) {
      const nouveaux = {};
      for (const e of echecs) nouveaux[`${e.id_employe}|${e.jour}`] = e.erreur;
      setMessagesCellules((m) => ({ ...m, ...nouveaux }));
      throw new Error(`${echecs.length} cellule(s) refusee(s) : corrigez avant de soumettre.`);
    }
  }

  // --- Rendu -----------------------------------------------------------------
  const jours = grille?.planning ? joursDeSemaine(grille.planning.annee, grille.planning.numero_semaine) : [];
  const modifiable = grille?.planning?.statut === 'BROUILLON' || grille?.planning?.statut === 'REJETE';

  return (
    <div>
      <Navbar />
      <div className="container">
        <RetourButton fallback="/dashboard" hasUnsaved={!!celluleActive} />
        <h1>Gestion du planning</h1>
        <p className="muted">
          Saisie directe : cliquez sur une cellule (employe x jour) pour saisir un horaire
          ou poser REPOS / CONGE / ABSENCE.
        </p>
        {erreur && <div className="error">{erreur}</div>}
        {message && <div className="card" style={{ whiteSpace: 'pre-line' }}>{message}</div>}

        <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-row">
            <label>Service</label>
            <select value={serviceChoisi} onChange={(e) => setServiceChoisi(e.target.value)} disabled={user?.role === 'CHEF_SERVICE'}>
              {services.map((s) => (
                <option key={s.id_service} value={s.id_service}>{s.nom_service || s.nom}</option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ maxWidth: 130 }}>
            <label>Année</label>
            <input
              type="number"
              value={anneeSemaine}
              min={1}
              onChange={(e) => {
                const an = Number(e.target.value);
                if (!Number.isFinite(an) || an < 1) return;
                // Clamp la semaine si l'annee choisie en compte moins
                const nb = nbSemainesISO(an);
                const num = Math.min(numSemaine || 1, nb);
                setSemaine(`${an}-W${String(num).padStart(2, '0')}`);
              }}
            />
          </div>
          <div className="form-row">
            <label>Semaine</label>
            <select value={semaine} onChange={(e) => setSemaine(e.target.value)}>
              {Array.from({ length: nbSemainesISO(anneeSemaine) }, (_, i) => i + 1).map((num) => (
                <option key={num} value={`${anneeSemaine}-W${String(num).padStart(2, '0')}`}>
                  Semaine {num} / {anneeSemaine}
                </option>
              ))}
            </select>
          </div>
          {grille?.planning && (
            <span className={`badge ${grille.planning.statut}`}>
              {grille.planning.statut}
              {grille.planning.statut === 'REJETE' ? ' (modifiable)' : ''}
            </span>
          )}
        </div>

        {chargement && <p className="muted">Chargement de la grille...</p>}

        {grille && !chargement && (
          <>
            <div className="card" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Employe</th>
                    {jours.map((j) => (
                      <th key={j}>{libelleJour(j)} {j.slice(8, 10)}/{j.slice(5, 7)}</th>
                    ))}
                    <th>Total</th>
                    <th>Prevu</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {(grille.employes || []).map((emp) => {
                    const c = calculs.parEmploye[emp.id_employe];
                    return (
                      <tr key={emp.id_employe} className={c?.depassement ? 'edt-depassement' : ''}>
                        <td>
                          <strong>{emp.nom}</strong>
                          {emp.matricule ? <span className="muted"> ({emp.matricule})</span> : null}
                          {emp.statut === 'STAGIAIRE' && <span className="muted"> (stagiaire)</span>}
                        </td>
                        {jours.map((j) => {
                          const cle = `${emp.id_employe}|${j}`;
                          const cel = cellules[cle];
                          const contraintes = contraintesParCle[cle] || [];
                          const errLocale = messagesCellules[cle] || (calculs.anomalies[cle] || []).join(' ');
                          return (
                            <td
                              key={j}
                              onClick={() => modifiable && ouvrirCellule(emp.id_employe, emp.nom, j)}
                              style={{ cursor: modifiable ? 'pointer' : 'default', minWidth: 120 }}
                            >
                              {!cel && <span className="muted">—</span>}
                              {cel && cel.statut_jour === 'TRAVAIL' && (
                                <span>{cel.entree && cel.sortie ? `${cel.entree} - ${cel.sortie}` : 'Incomplet'}</span>
                              )}
                              {cel && cel.statut_jour !== 'TRAVAIL' && (
                                <span className={`badge ${cel.statut_jour}`}>{cel.statut_jour}</span>
                              )}
                              {cel?.statut_jour === 'TRAVAIL' && cel.entree && cel.sortie && (
                                <div className="muted" style={{ fontSize: 11 }}>
                                  {formatDuree(enMinutes(cel.sortie) - enMinutes(cel.entree))}
                                </div>
                              )}
                              {contraintes.length > 0 && (
                                <div title={contraintes.join(' ; ')} style={{ fontSize: 11, color: '#b58900' }}>
                                  {contraintes[0]}
                                </div>
                              )}
                              {errLocale && (
                                <div className="badge REJETE" style={{ fontSize: 11, whiteSpace: 'normal' }}>
                                  {errLocale}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td><strong>{formatDuree(c?.total || 0)}</strong></td>
                        <td className="muted">{Math.round((c?.reference || 0) / 60)} h</td>
                        <td>
                          {c ? (
                            c.difference === 0 ? <span className="badge VALIDE">OK</span> :
                            c.difference > 0 ? <span className="badge REJETE">+{formatDuree(c.difference)}</span> :
                            <span className="badge SOUMIS">-{formatDuree(-c.difference)}</span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {modifiable ? (
              <div style={{ display: 'flex', gap: 10, margin: '12px 0' }}>
                <button className="btn" onClick={enregistrer} disabled={enregistrement}>Enregistrer brouillon</button>
                <button className="btn secondary" onClick={verifier} disabled={enregistrement}>Verifier le planning</button>
                <button className="btn success" onClick={soumettre} disabled={enregistrement}>Soumettre a la RH</button>
              </div>
            ) : (
              <p className="muted">
                Planning {grille.planning.statut} : saisie verrouillee.
                {grille.planning.statut === 'SOUMIS' ? ' En attente de decision RH.' : ''}
              </p>
            )}
          </>
        )}

        {celluleActive && (
          <div className="card" style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0 }}>
              {celluleActive.nom} — {libelleJour(celluleActive.jour)} {celluleActive.jour}
            </h3>
            <div className="form-row">
              <label>Statut du jour</label>
              <select value={form.statut_jour} onChange={(e) => setForm((f) => ({ ...f, statut_jour: e.target.value }))}>
                {STATUTS_CELLULE.map((s) => (
                  <option key={s} value={s}>{s === 'TRAVAIL' ? 'Travail (horaire)' : s}</option>
                ))}
              </select>
            </div>
            {form.statut_jour === 'TRAVAIL' && (
              <div className="form-row">
                <label>Horaire (debut - fin)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="time" value={form.entree} onChange={(e) => setForm((f) => ({ ...f, entree: e.target.value }))} />
                  <span>-</span>
                  <input type="time" value={form.sortie} onChange={(e) => setForm((f) => ({ ...f, sortie: e.target.value }))} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={appliquerCellule}>Appliquer</button>
              <button
                className="btn danger"
                onClick={() => { viderCellule(celluleActive.id_employe, celluleActive.jour); setCelluleActive(null); }}
              >
                Supprimer la cellule
              </button>
              <button className="btn secondary" onClick={() => setCelluleActive(null)}>Annuler</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
