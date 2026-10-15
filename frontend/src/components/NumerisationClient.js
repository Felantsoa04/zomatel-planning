'use client';

// Numérisation des plannings papier — interaction RH complète.
// RÈGLES PROJET :
//   - aucune donnée inventée : les valeurs incertaines restent des ALERTES ;
//   - association employé par select (employe_id) : aucun employé créé
//     automatiquement, aucune double saisie ;
//   - confirmation -> planning BROUILLON (circuit existant) ; l'export Excel
//     subséquent reste celui existant (regroupement par semaine déjà en place) ;
//   - le composant de saisie (LigneCreneau/CelluleJour/LigneEmploye/
//     PanneauVerification) est DÉFINI HORS du composant parent pour ne JAMAIS
//     démonter les champs pendant la frappe (bug historique de perte de focus).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Upload, Trash2, CheckCircle2, Loader2, RefreshCw, Plus,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { seuilMinHeures, etatHeures } from '@/lib/dash';

const STATUTS_JOUR = ['TRAVAIL', 'REPOS', 'CONGE', 'ABSENCE'];
const NOM_STATUT = { TRAVAIL: 'Travail', REPOS: 'Repos', CONGE: 'Congé', ABSENCE: 'Absence' };
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/* Aperçu du document original : image servie UNIQUEMENT via l'API
 * authentifiée (GET /numerisation/:id/fichier) -> blob -> objectURL. */
function ApercuDocument({ idScan }) {
  const [url, setUrl] = useState(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    let vivant = true;
    let objetUrl = null;
    const jeton = getToken();
    setUrl(null);
    setErreur('');
    fetch(`${API_URL}/numerisation/${idScan}/fichier`, {
      headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Document indisponible (${r.status}).`);
        return r.blob();
      })
      .then((blob) => {
        if (!vivant) return;
        objetUrl = URL.createObjectURL(blob);
        setUrl(objetUrl);
      })
      .catch((e) => { if (vivant) setErreur(e.message); });
    return () => {
      vivant = false;
      if (objetUrl) URL.revokeObjectURL(objetUrl);
    };
  }, [idScan]);
  if (erreur) return <p className="muted" style={{ fontSize: 12.5 }}>{erreur}</p>;
  if (!url) return <Loader2 size={16} className="tourne" aria-label="Document en cours de chargement" />;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt="Document original importé"
      style={{ maxWidth: '100%', height: 'auto', border: '1px solid rgba(150,150,150,.35)', borderRadius: 8 }}
    />
  );
}

/* Barre de progression du traitement OCR d'un document (polling serveur). */
function BarreProgression({ progression, statut }) {
  if (statut === 'CONFIRME') return <span style={{ color: '#4e9a61', fontSize: 12.5 }}>Confirmé ✔</span>;
  if (statut === 'ERREUR') return <span style={{ color: '#c0564f', fontSize: 12.5 }}>Échec du traitement</span>;
  if (statut === 'OCR_FAITE') return <span style={{ color: '#4e9a61', fontSize: 12.5 }}>OCR terminée — à vérifier</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 120, height: 6, borderRadius: 4, background: 'rgba(150,150,150,.25)', overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', height: '100%', width: `${Number(progression) || 0}%`, background: 'var(--accent, #6f61d9)', transition: 'width .4s' }} />
      </span>
      <span className="muted" style={{ fontSize: 12 }}>{Number(progression) || 0} %</span>
    </span>
  );
}

/* Une plage horaire (entrée → sortie) d'une cellule jour ; une SORTIE vide
 * (ex. « FS ») est autorisée à l'affichage mais FAIT REFUSER la confirmation
 * par le serveur : rien n'est inventé à la place du RH. */
function LigneCreneau({ creneau, onChange, supprimer }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input
        type="time"
        value={creneau.heure_entree || ''}
        required
        aria-label="Heure d'entrée"
        onChange={(e) => onChange({ ...creneau, heure_entree: e.target.value })}
        style={{ width: 96 }}
      />
      <span>–</span>
      <input
        type="time"
        value={creneau.heure_sortie || ''}
        aria-label="Heure de sortie"
        onChange={(e) => onChange({ ...creneau, heure_sortie: e.target.value || null })}
        style={{ width: 96 }}
      />
      <button type="button" className="btn-icone" onClick={supprimer} title="Retirer cette plage horaire">✕</button>
    </span>
  );
}

/* Cellule jour : statut + plage(s) horaire. */
function CelluleJour({ info, onChangerCellule }) {
  return (
    <td style={{ verticalAlign: 'top', minWidth: 230 }}>
      <select
        value={info.statut}
        onChange={(e) => onChangerCellule({ ...info, statut: e.target.value })}
        style={{ marginBottom: 2 }}
      >
        {STATUTS_JOUR.map((s) => <option key={s} value={s}>{NOM_STATUT[s]}</option>)}
      </select>
      {info.statut === 'TRAVAIL' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {(info.creneaux || []).map((c, i) => (
            <LigneCreneau
              key={i}
              creneau={c}
              onChange={(nx) => onChangerCellule({ ...info, creneaux: info.creneaux.map((cc, k) => (k === i ? nx : cc)) })}
              supprimer={() => onChangerCellule({ ...info, creneaux: info.creneaux.filter((_, k) => k !== i) })}
            />
          ))}
          <button
            type="button"
            className="btn-icone"
            title="Ajouter une plage horaire"
            onClick={() => onChangerCellule({ ...info, creneaux: [...(info.creneaux || []), { heure_entree: '', heure_sortie: null }] })}
          >
            <Plus size={13} aria-hidden="true" /> plage
          </button>
        </div>
      ) : null}
    </td>
  );
}

/* Ligne employée de l'écran de vérification : association à un employé RÉEL,
 * statut/horaires par jour, total hebdo vs référence (44 h Admin / 48 h). */
function LigneEmploye({ employe, datesJours, employesService, onChangerLigne }) {
  const totalMinutes = useMemo(() => {
    let total = 0;
    for (const j of datesJours) {
      const info = (employe.jours || {})[j];
      if (!info || info.statut !== 'TRAVAIL') continue;
      for (const c of info.creneaux || []) {
        if (!c.heure_entree || !c.heure_sortie) continue;
        const [h1, m1] = c.heure_entree.split(':').map(Number);
        const [h2, m2] = c.heure_sortie.split(':').map(Number);
        const duree = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (duree > 0) total += duree;
      }
    }
    return total;
  }, [employe, datesJours]);

  const associe = employe.employe_id != null;
  const ref = Number(employe.reference_hebdo || 44);
  const etat = etatHeures(totalMinutes / 60, ref);

  return (
    <tr>
      <td style={{ minWidth: 180 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>
          OCR : « {employe.nom_ocr} » {employe.confiance != null && <em>({Math.round(employe.confiance * 100)} %)</em>}
        </div>
        <select
          value={employe.employe_id ?? ''}
          onChange={(e) => onChangerLigne({ ...employe, employe_id: e.target.value ? Number(e.target.value) : null })}
          title="Associer le nom reconnu à un employé de la base (aucun employé n'est créé automatiquement)"
        >
          <option value="">— Choisir un employé —</option>
          {(employesService || []).map((e) => (
            <option key={e.id_employe} value={e.id_employe}>{e.nom}{e.matricule ? ` (${e.matricule})` : ''}</option>
          ))}
        </select>
        {!associe && <div style={{ color: '#c0564f', fontSize: 12 }}>Association obligatoire avant confirmation.</div>}
      </td>
      {datesJours.map((j) => {
        const info = (employe.jours || {})[j] || { statut: 'TRAVAIL', creneaux: [] };
        return (
          <CelluleJour
            key={j}
            info={info}
            onChangerCellule={(nx) => onChangerLigne({ ...employe, jours: { ...employe.jours, [j]: nx } })}
          />
        );
      })}
      <td style={{ whiteSpace: 'nowrap' }}>
        {(totalMinutes / 60).toFixed(1)} h / {ref} h{' '}
        {etat === 'MANQUE'
          ? <span title="Sous la référence hebdomadaire" style={{ color: '#d9a441' }}>▼</span>
          : etat === 'EXCES'
            ? <span title="Au-dessus de la référence + 8 h" style={{ color: '#c0564f' }}>▲</span>
            : <CheckCircle2 size={13} style={{ color: '#4e9a61' }} aria-label="Conforme" />}
      </td>
    </tr>
  );
}

/* Écran de vérification d'un scan : document à gauche, données OCR
 * modifiables à droite (comparaison visuelle côte à côte). */
function PanneauVerification({ scan, services, employes, onFerme }) {
  const donnees = useMemo(() => {
    const brut = scan.donnees_corrigees || scan.donnees_ocr;
    if (!brut) return null;
    try { return JSON.parse(brut); } catch { return null; }
  }, [scan.donnees_ocr, scan.donnees_corrigees]);

  const [serviceId, setServiceId] = useState(scan.service_id ?? '');
  const [semaine, setSemaine] = useState(scan.numero_semaine ?? '');
  const [annee, setAnnee] = useState(scan.annee ?? '');
  const [corrections, setCorrections] = useState(() => (donnees ? { ...donnees, employes: [...(donnees.employes || [])] } : { employes: [] }));
  const [message, setMessage] = useState('');
  const [erreurs, setErreurs] = useState('');
  const [apercu, setApercu] = useState(true);
  const [enCours, setEnCours] = useState(false);
  const [idPlanningCree, setIdPlanningCree] = useState(scan.id_planning || null);

  // Dates ISO du lundi au dimanche de la semaine saisie (règle projet :
  // lundi = 1er jour ; calcul ISO dynamique, aucune année en dur)
  const datesJours = useMemo(() => {
    const n = Number(semaine); const a = Number(annee);
    if (!(n >= 1 && n <= 53 && a >= 2000 && a <= 2100)) return [];
    const jan4 = new Date(Date.UTC(a, 0, 4));
    const jourJan = jan4.getUTCDay() || 7;
    const lundi = new Date(jan4.getTime() - (jourJan - 1) * 86400000 + (n - 1) * 7 * 86400000);
    return Array.from({ length: 7 }, (_, i) => new Date(lundi.getTime() + i * 86400000).toISOString().slice(0, 10));
  }, [semaine, annee]);

  const employesDuService = useMemo(
    () => (employes || []).filter((e) => e.service_id == null || Number(e.service_id) === Number(serviceId) || !serviceId),
    [employes, serviceId]
  );

  const changerLigne = useCallback((index, ligne) => {
    setCorrections((prec) => {
      const apres = { ...prec, employes: [...prec.employes] };
      apres.employes[index] = ligne;
      return apres;
    });
  }, []);

  const indexesNonDates = [];
  corrections.employes.forEach((e, i) => { if (!i || !indexesNonDates.includes(i)) indexesNonDates.push(i); });

  async function enregistrerCorrections() {
    setEnCours(true);
    setErreurs('');
    try {
      await api.patch(`/numerisation/${scan.id_scan}/metadata`, {
        service_id: serviceId || null, numero_semaine: semaine || null, annee: annee || null,
      });
      await api.patch(`/numerisation/${scan.id_scan}/donnees`, corrections);
      setMessage('Corrections enregistrées — le document reste modifiable tant que la confirmation n\'a pas été faite.');
    } catch (e) {
      setErreurs(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function confierPlanning() {
    setEnCours(true);
    setErreurs('');
    setMessage('');
    try {
      await api.patch(`/numerisation/${scan.id_scan}/metadata`, {
        service_id: serviceId || null, numero_semaine: semaine || null, annee: annee || null,
      });
      await api.patch(`/numerisation/${scan.id_scan}/donnees`, corrections);
      const r = await api.post(`/numerisation/${scan.id_scan}/confirmer`);
      // dedans : le serveur peut répondre au RH avec id_planning (nouveau ou existant)
      setIdPlanningCree(r.id_planning || null);
      setMessage(r.message || 'Planning BROUILLON créé.');
      onAccuse?.(r);
    } catch (e) {
      setErreurs(e.message);
    } finally {
      setEnCours(false);
    }
  }

  const alertes = corrections.alertes || [];
  const scanNonOcr = !donnees;

  return (
    <div style={{ border: '1px solid rgba(150,150,150,.3)', borderRadius: 10, padding: 12, marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h4 style={{ margin: 0 }}>Vérification — « {scan.nom_fichier} »</h4>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button type="button" className="btn secondary" onClick={() => setApercu((a) => !a)}>
            {apercu ? 'Masquer le document' : 'Afficher le document'}
          </button>
          <button type="button" className="btn secondary" onClick={onFerme}>Fermer</button>
        </div>
      </div>

      {scanNonOcr && (
        <p style={{ color: '#c0564f' }}>
          Aucune donnée OCR disponible pour ce document (traitement en cours ou en échec). Les statuts : OCR écicités sous le nom du fichier.
        </p>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
        {apercu && (
          <div style={{ flex: '1 1 320px', maxWidth: 520 }}>
            <ApercuDocument idScan={scan.id_scan} />
            <p className="muted" style={{ fontSize: 12 }}>Comparez ce document d'origine avec les données reconnues ci-contre et corrigez avant confirmation.</p>
          </div>
        )}

        <div style={{ flex: '1 1 420px', overflowX: 'auto' }}>
          {/* Métadonnées : service + semaine (confirmées par la RH) */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
              Service
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={{ minWidth: 190 }}>
                <option value="">— Confirmer le service —</option>
                {(services || []).map((s) => <option key={s.id_service} value={s.id_service}>{s.nom_service || s.nom}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
              Semaine (1-53)
              <input type="number" min={1} max={53} value={semaine} onChange={(e) => setSemaine(e.target.value)} style={{ width: 110 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
              Année
              <input type="number" min={2000} max={2100} value={annee} onChange={(e) => setAnnee(e.target.value)} style={{ width: 110 }} />
            </label>
            {datesJours.length === 7 && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                {datesJours[0].slice(0, 10).split('-').reverse().join('/')} → {datesJours[6].slice(0, 10).split('-').reverse().join('/')} (lundi → dimanche)
              </span>
            )}
          </div>

          {alertes.length > 0 && (
            <div style={{ border: '1px solid rgba(217,164,65,.5)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b78828', fontWeight: 600, fontSize: 13.5 }}>
                Alertes de reconnaissance — à vérifier manuellement
              </div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 12.5 }}>
                {alertes.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          {datesJours.length === 7 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="dash-table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>Employé (OCR → base)</th>
                    {datesJours.map((j, i) => (
                      <th key={j} style={{ minWidth: 210 }}>
                        {['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'][i]}
                        <span className="muted" style={{ display: 'block', fontWeight: 400 }}>{j.slice(8, 10)}/{j.slice(5, 7)}</span>
                      </th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {corrections.employes.map((e, i) => (
                    <LigneEmploye
                      key={`${e.nom_ocr}-${i}-${e.employe_id ?? 'x'}`}
                      employe={e}
                      datesJours={datesJours}
                      employesService={employesDuService}
                      onChangerLigne={(ligne) => changerLigne(i, ligne)}
                    />
                  ))}
                </tbody>
              </table>
              {corrections.employes.length === 0 && (
                <p className="muted">Aucun employé reconnu sur ce document.</p>
              )}
            </div>
          )}

          {message && <p style={{ color: '#4e9a61', marginTop: 8 }}>{message}</p>}
          {erreurs && <div style={{ color: '#c0564f', marginTop: 8 }} role="alert">{erreurs}</div>}
          {idPlanningCree && (
            <p style={{ marginTop: 8 }}>
              <Link className="btn" href={`/planning/${idPlanningCree}`}>Ouvrir le planning BROUILLON n°{idPlanningCree}</Link>
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary" onClick={enregistrerCorrections} disabled={enCours || scanNonOcr}>
          Enregistrer les corrections
        </button>
        <button type="button" className="btn" onClick={confierPlanning} disabled={enCours || scanNonOcr}>
          Confirmer → créer le planning BROUILLON
        </button>
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          La confirmation n'est possible que si le service, la semaine et tous les employés sont identifiés, sans créneau incomplet (ex. « 18:00 – FS »).
        </span>
      </div>
    </div>
  );
}

export default function NumerisationClient() {
  // NOTE : useI18n existe dans le shell ; fallback silencieux si absent.
  const [scans, setScans] = useState([]);
  const [services, setServices] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [importEnCours, setImportEnCours] = useState(false);
  const [messageImport, setMessageImport] = useState('');
  const [erreur, setErreur] = useState('');
  const [scanOuvert, setScanOuvert] = useState(null);
  const inputFichiers = useRef(null);

  const rafraichir = useCallback(async (silencieux = true) => {
    try {
      if (!silencieux) setChargement(true);
      const [rScans, rServices, rEmps] = await Promise.all([
        api.get('/numerisation/fichiers'),
        api.get('/services'),
        api.get('/employes'),
      ]);
      setScans(rScans.scans || []);
      setServices(rServices.services || rServices || []);
      setEmployes(rEmps.employes || rEmps || []);
      setErreur('');
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { rafraichir(false); }, [rafraichir]);

  // Polling de progression : uniquement quand des traitements sont acteurs.
  const quelqueChoseCours = useMemo(
    () => scans.some((s) => ['RECUE', 'OCR_EN_COURS'].includes(s.statut)),
    [scans]
  );
  useEffect(() => {
    if (!quelqueChoseCours) return undefined;
    const h = setInterval(() => rafraichir(true), 2500);
    return () => clearInterval(h);
  }, [quelqueChoseCours, rafraichir]);

  async function importerFichiers(event) {
    const fichiers = Array.from(event.target.files || []);
    if (!fichiers.length) return;
    setImportEnCours(true);
    setMessageImport('');
    setErreur('');
    try {
      const fd = new FormData();
      for (const f of fichiers) fd.append('fichiers', f, f.name);
      const jeton = getToken();
      const res = await fetch(`${API_URL}/numerisation/fichiers`, {
        method: 'POST',
        headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Erreur ${res.status}`);
      const refuses = (data.scans || []).filter((s) => s.refuse);
      setMessageImport(
        refuses.length
          ? `${(data.scans || []).length - refuses.length} document(s) en traitement ; refus : ${refuses.map((r) => `${r.nom_fichier} — ${r.message}`).join(' ; ')}`
          : `${data.scans.length} document(s) importé(s) : reconnaissance en cours.`
      );
      await rafraichir(true);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setImportEnCours(false);
      if (inputFichiers.current) inputFichiers.current.value = '';
    }
  }

  async function retirer(scan) {
    if (!window.confirm(`Retirer le document « ${scan.nom_fichier} » (aucun fichier du projet ni planning existant n'est supprimé).`)) return;
    try {
      await api.delete(`/numerisation/${scan.id_scan}`);
      await rafraichir(true);
    } catch (e) {
      setErreur(e.message);
    }
  }

  const enTraitement = useMemo(
    () => scans.filter((s) => ['RECUE', 'OCR_EN_COURS'].includes(s.statut)).length,
    [scans]
  );

  return (
    <div className="dash-carte">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Numérisation des plannings papier</h3>
        <button type="button" className="btn secondary" onClick={() => rafraichir(true)} disabled={chargement}>
          <RefreshCw size={14} aria-hidden="true" /> Actualiser
        </button>
      </div>

      {/* Zone d'import multi-fichiers */}
      <div style={{ border: '2px dashed rgba(130,130,130,.4)', borderRadius: 12, padding: 16, marginBottom: 14, textAlign: 'center' }}>
        <input
          ref={inputFichiers}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          onChange={importerFichiers}
          style={{ display: 'none' }}
          id="import-scans"
        />
        <label htmlFor="import-scans" className="btn" style={{ display: 'inline-flex', gap: 8, cursor: 'pointer', pointerEvents: importEnCours ? 'none' : undefined }}>
          {importEnCours ? <Loader2 size={15} className="tourne" /> : <Upload size={15} aria-hidden="true" />}
          {importEnCours ? 'Import en cours…' : 'Importer les plannings'}
        </label>
        <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
          JPG, JPEG ou PNG — plusieurs fichiers à la fois, 12 Mo max chacun. Chaque document est traité individuellement :
          une erreur sur l'un n'empêche jamais les autres. (PDF : bientôt pris en charge.)
        </p>
        {messageImport && <p style={{ color: '#4e9a61', fontSize: 13 }}>{messageImport}</p>}
        {erreur && <div style={{ color: '#c0564f', fontSize: 13 }} role="alert">{erreur}</div>}
        {enTraitement > 0 && (
          <p className="muted" style={{ fontSize: 12.5 }}>{enTraitement} document(s) en reconnaissance, progression mise à jour automatiquement.</p>
        )}
      </div>

      {/* Liste des documents importés */}
      {chargement ? (
        <p className="muted">Chargement…</p>
      ) : scans.length === 0 ? (
        <p className="muted">Aucun document importé pour l'instant.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {scans.map((s) => {
            const p = JSON.parse(s.donnees_ocr || 'null');
            const alertes = p?.alertes || [];
            return (
              <div key={s.id_scan} style={{ border: '1px solid rgba(150,150,150,.25)', borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    {s.nom_fichier}
                  </span>
                  <BarreProgression progression={s.progression} statut={s.statut} />
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {s.nom_service || 'Service à confirmer'}
                    {s.numero_semaine ? ` · S${s.numero_semaine}/${s.annee || '?'}` : ''}
                  </span>
                  <span style={{ flex: 1 }} />
                  {['OCR_FAITE', 'CONFIRME'].includes(s.statut) && (
                    <button type="button" className="btn" onClick={() => setScanOuvert(scanOuvert === s.id_scan ? null : s.id_scan)}>
                      {scanOuvert === s.id_scan ? 'Refermer' : 'Vérifier / Corriger'}
                    </button>
                  )}
                  {s.statut !== 'CONFIRME' && (
                    <button type="button" className="btn-icone" title="Retirer le document" onClick={() => retirer(s)}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                  {s.id_planning && (
                    <Link className="btn secondary" href={`/planning/${s.id_planning}`} title="Planning créé à partir de ce document">
                      Planning nº{s.id_planning}
                    </Link>
                  )}
                </div>
                {s.message_erreur && <div style={{ color: '#c0564f', fontSize: 12.5, marginTop: 4 }}>{s.message_erreur}</div>}
                {alertes.length > 0 && scanOuvert !== s.id_scan && (
                  <div style={{ color: '#b78828', fontSize: 12.5, marginTop: 4 }}>
                    {alertes.length} alerte(s) de reconnaissance — ouvrir la vérification pour les corriger.
                  </div>
                )}
                {scanOuvert === s.id_scan && (
                  <PanneauVerification
                    scan={s}
                    services={services}
                    employes={employes}
                    onFerme={() => setScanOuvert(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
        Après confirmation, les plannings passent par le circuit existant (grille → soumission → validation RH).
        L'export Excel multi-services par semaine se fait depuis la page <Link href="/planning/gestion">Plannings</Link> —
        regroupement par semaine déjà en place, un classeur = une semaine, une feuille par service.
      </div>
    </div>
  );
}
