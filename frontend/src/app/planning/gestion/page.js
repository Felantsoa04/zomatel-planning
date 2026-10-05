'use client';

// GESTION DU PLANNING - saisie directe en grille hebdomadaire (facon Excel).
// Le chef de service remplit la grille de SON service : clic sur une cellule
// (employe x jour) -> horaire debut/fin ou REPOS/CONGE/ABSENCE, controles
// (chevauchement, conges/indisponibilites/recuperations RH),
// totaux automatiques par employe, puis Enregistrer brouillon / Verifier / Soumettre.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Pencil, XCircle } from 'lucide-react';
import AppShell from '@/components/AppShell';
import RetourButton from '@/components/RetourButton';
import { api } from '@/lib/api';
import SaisieHeureFloat from '@/components/SaisieHeureFloat';
import Modal from '@/components/Modal';
import PlanningModelEditor from '@/components/PlanningModelEditor';
import { LABELS_STATUT, numeroSemaineISO } from '@/lib/dash';
import { getToken, getUser } from '@/lib/auth';
import { resoudreModele, MODELE_STANDARD_PAR_DEFAUT } from '@/lib/planningModels';
import { versInterne, depuisInterne } from '@/lib/planningData';

const JOURS_LABEL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const STATUTS_CELLULE = ['TRAVAIL', 'REPOS', 'CONGE', 'ABSENCE'];
const PERIODES = ['MATIN', 'APRES_MIDI', 'SOIR'];
const LIBELLE_PERIODE = { MATIN: 'Matin', APRES_MIDI: 'Apres-midi', SOIR: 'Soir' };

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
  // Liste des plannings DU SERVICE AFFICHÉ (toutes semaines) : chaque ligne
  // porte l'action « Modifier » qui ouvre la grille de CE planning (workflow
  // Modifier -> Enregistrer -> Resoumettre -> Validation RH).
  const [listePlannings, setListePlannings] = useState([]);
  // Modèle de planning du service courant (multi-modèles) : STANDARD = grille
  // employé × jour historique ; SECURITE / HORAIRE_LIBRE = éditeurs dédiés.
  const [modele, setModele] = useState(MODELE_STANDARD_PAR_DEFAUT);
  const [donneesModele, setDonneesModele] = useState(null); // état interne du modèle
  const [planningId, setPlanningId] = useState(null);
  const [cellules, setCellules] = useState({}); // "employe|jour" -> { statut_jour, entree, sortie }
  const [celluleActive, setCelluleActive] = useState(null); // { id_employe, nom, jour }
  const [form, setForm] = useState({ statut_jour: 'TRAVAIL', entree: '', sortie: '' });
  const [enregistrement, setEnregistrement] = useState(false);
  const [messagesCellules, setMessagesCellules] = useState({}); // "employe|jour" -> erreur API
  const [message, setMessage] = useState('');
  // Création EXPLICITE d'un planning (modale de confirmation) : la page ne
  // crée JAMAIS un planning automatiquement (plus de POST silencieux au
  // changement de semaine) — le chef clique « Créer le planning ».
  const [modalCreation, setModalCreation] = useState(false);
  const [creationEnCours, setCreationEnCours] = useState(false);
  // Champs de la modale de création : Semaine, Service, Date début, Date fin
  // (préremplis avec les sélecteurs de la page, éditables dans la modale).
  const [formCreation, setFormCreation] = useState(null);

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
      // Modèle du service (résolveur central — aucun if(service===...) ici)
      const svc = (services || []).find((s) => String(s.id_service) === String(serviceChoisi));
      const modeleResolu = resoudreModele(svc);
      setModele(modeleResolu);
      // Planning existant pour (service, semaine) ?
      const existants = await api.get(`/plannings?id_service=${serviceChoisi}&annee=${annee}`, token);
      const existant = (existants || []).find((p) => Number(p.numero_semaine) === Number(num));
      if (!existant) {
        // AUCUNE création automatique : la grille reste vide et la page
        // propose le bouton « Créer le planning » (chef uniquement). RH/ADMIN
        // voient un message clair, sans POST voué à un 403.
        setPlanningId(null);
        setGrille(null);
        setCellules({});
        setDonneesModele(modeleResolu.code === 'STANDARD' ? null : modeleResolu.code === 'SECURITE' ? { config: modeleResolu, donnees: {} } : { config: modeleResolu, donnees: { horaires: modeleResolu.horairesDefaut ? JSON.parse(JSON.stringify(modeleResolu.horairesDefaut)) : [], matrice: {}, statutsJour: {}, observations: {} } });
        setChargement(false);
        return;
      }
      const id = existant.id_planning;
      setPlanningId(id);
      const data = await api.get(`/plannings/${id}/grille`, token);
      setGrille(data);

      // Initialise l'état local selon le MODÈLE du service (conversion centralisée)
      const etatInterne = versInterne(modeleResolu, data.affectations, data.creneaux);
      if (modeleResolu.code === 'STANDARD') {
        // MULTI-PÉRIODES : regroupe les créneaux réels par cellule (employé|jour).
        // Une affectation peut avoir 1..3 créneaux (matin/après-midi/soir).
        const parCellule = {};
        for (const a of data.affectations) {
          const cle = `${a.id_employe}|${a.jour}`;
          const crenDuJour = (data.creneaux || []).filter((c) => c.id_affectation === a.id_affectation)
            .sort((x, y) => String(x.heure_entree).localeCompare(String(y.heure_entree)));
          parCellule[cle] = {
            statut_jour: a.statut_jour,
            periodes: crenDuJour.map((c) => ({ entree: String(c.heure_entree).slice(0, 5), sortie: String(c.heure_sortie).slice(0, 5) })),
          };
        }
        setCellules(parCellule);
        setDonneesModele(null);
      } else {
        // HORAIRE_LIBRE : si aucune configuration sauvegardée, part des
        // colonnes par défaut du modèle (jamais de valeur en dur ailleurs).
        if (modeleResolu.code === 'HORAIRE_LIBRE' && (!etatInterne.horaires || etatInterne.horaires.length === 0)) {
          etatInterne.horaires = JSON.parse(JSON.stringify(modeleResolu.horairesDefaut || []));
        }
        setCellules({});
        setDonneesModele({ config: modeleResolu, donnees: etatInterne });
      }
    } catch (err) {
      setErreur(err.message);
      setGrille(null);
    } finally {
      setChargement(false);
    }
  }, [token, serviceChoisi, semaine, user, services]);

  useEffect(() => {
    chargerGrille();
  }, [chargerGrille]);

  // Liste des plannings du service choisi (endpoint existant GET /plannings,
  // périmètre déjà appliqué côté serveur : le chef ne voit que son service).
  // TOUTES semaines confondues : le clic « Modifier » repositionne année +
  // semaine ensemble. Sert UNIQUEMENT à l'action « Modifier » : aucune
  // logique dupliquée.
  useEffect(() => {
    if (!token || !serviceChoisi) return;
    (async () => {
      try {
        const liste = await api.get(`/plannings?id_service=${serviceChoisi}`, token);
        setListePlannings(Array.isArray(liste) ? liste : []);
      } catch {
        setListePlannings([]);
      }
    })();
  }, [token, serviceChoisi, grille]);

  // --- Création explicite (modale) -------------------------------------------
  // Période exacte de la semaine sélectionnée, affichée dans la modale avant
  // confirmation (calcul, aucune valeur en dur).
  const joursCreation = useMemo(
    () => joursDeSemaine(anneeSemaine, numSemaine),
    [anneeSemaine, numSemaine]
  );

  const serviceCreation = services.find((s) => String(s.id_service) === String(serviceChoisi));

  // Ouvre la modale PREREMPLIE avec les sélecteurs courants de la page.
  function ouvrirModalCreation() {
    setErreur('');
    setFormCreation({
      id_service: serviceChoisi,
      annee: String(anneeSemaine),
      semaine: String(numSemaine),
      date_debut: joursCreation[0],
      date_fin: joursCreation[6],
    });
    setModalCreation(true);
  }

  // Synchronisation des champs de la modale :
  //   Année/Semaine modifiées  -> dates recalculées (lundi -> dimanche) ;
  //   Date début modifiée      -> semaine ISO + année recalculées, date fin = dimanche ;
  //   Date fin modifiée        -> conservée telle quelle (envoyée au serveur).
  function majFormCreation(changes) {
    setFormCreation((f) => {
      const nf = { ...f, ...changes };
      if (changes.annee !== undefined || changes.semaine !== undefined) {
        const an = Number(nf.annee);
        let se = Number(nf.semaine);
        if (Number.isFinite(an) && an >= 1 && Number.isFinite(se) && se >= 1) {
          // Borne la semaine au nombre de semaines de l'année (52 ou 53)
          se = Math.min(se, nbSemainesISO(an));
          nf.semaine = String(se);
          const j = joursDeSemaine(an, se);
          nf.date_debut = j[0];
          nf.date_fin = j[6];
        }
      }
      if (changes.date_debut !== undefined && nf.date_debut) {
        const d = new Date(nf.date_debut + 'T12:00:00Z');
        if (!Number.isNaN(d.getTime())) {
          nf.semaine = String(numeroSemaineISO(d));
          const jeudi = new Date(d.getTime());
          jeudi.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)));
          nf.annee = String(jeudi.getUTCFullYear());
          nf.date_fin = joursDeSemaine(Number(nf.annee), Number(nf.semaine))[6];
        }
      }
      return nf;
    });
  }

  async function creerPlanning() {
    const f = formCreation;
    if (!f || !f.id_service || !f.annee || !f.semaine || !f.date_debut || !f.date_fin) {
      setErreur('Tous les champs sont requis.');
      return;
    }
    if (new Date(f.date_fin) <= new Date(f.date_debut)) {
      setErreur('La date de fin doit être postérieure à la date de début.');
      return;
    }
    setCreationEnCours(true);
    setMessage('');
    setErreur('');
    try {
      // API/logique existante : POST /plannings (permission planning.create,
      // service rattaché au compte côté serveur). Aucun autre changement.
      const cr = await api.post(
        '/plannings',
        {
          annee: Number(f.annee),
          numero_semaine: Number(f.semaine),
          date_debut: f.date_debut,
          date_fin: f.date_fin,
        },
        token
      );
      // Succès : ferme la modale, ACTUALISE et AFFICHE le nouveau planning
      // immédiatement — les sélecteurs sont synchronisés (le useEffect
      // recharge aussi si ils ont changé) et la grille est rechargée
      // explicitement (indispensable si ils n'ont pas changé).
      setModalCreation(false);
      setServiceChoisi(String(f.id_service));
      setSemaine(`${Number(f.annee)}-W${String(Number(f.semaine)).padStart(2, '0')}`);
      await chargerGrille();
      setMessage(`Planning #${cr.id_planning} créé (Brouillon) : saisissez les horaires puis enregistrez.`);
    } catch (err) {
      // La modale RESTE OUVERTE : l'erreur (doublon 409, rôle, serveur...)
      // s'affiche à l'intérieur, l'utilisateur peut corriger.
      setErreur(err.message);
    } finally {
      setCreationEnCours(false);
    }
  }

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
      : [];      // MULTI-PÉRIODES : la durée d'une cellule = somme des périodes du jour.
      const dureeCellule = (cel) => {
        if (cel?.statut_jour !== 'TRAVAIL') return 0;
        if (cel.periodes?.length) {
          return cel.periodes.reduce((s, p) => s + Math.max(0, enMinutes(p.sortie) - enMinutes(p.entree)), 0);
        }
        return Math.max(0, enMinutes(cel.sortie) - enMinutes(cel.entree));
      };
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
    // MULTI-PÉRIODES : la cellule porte une LISTE de périodes (ex. 07:00-12:00
    // + 14:00-18:00). L'ancien format (entree/sortie uniques) est converti.
    const cel = cellules[`${idEmploye}|${jour}`];
    const periodesInitiales = cel?.periodes?.length
      ? cel.periodes.map((p) => ({ ...p }))
      : (cel?.entree ? [{ entree: cel.entree, sortie: cel.sortie }] : []);
    setCelluleActive({ id_employe: idEmploye, nom, jour });
    setForm({ statut_jour: cel?.statut_jour || 'TRAVAIL', periodes: periodesInitiales });
  }

  // Ajout d'une période vide (aucune limite artificielle dans l'UI ; la base
  // rejette au-delà de 3 créneaux/jour, règle métier matin/après-midi/soir).
  function ajouterPeriode() {
    setForm((f) => ({ ...f, periodes: [...f.periodes, { entree: '', sortie: '' }] }));
  }
  function modifierPeriode(index, champ, valeur) {
    setForm((f) => ({
      ...f,
      periodes: f.periodes.map((p, i) => (i === index ? { ...p, [champ]: valeur } : p)),
    }));
  }
  function supprimerPeriode(index) {
    setForm((f) => ({ ...f, periodes: f.periodes.filter((_, i) => i !== index) }));
  }

  // Erreur de validation affichee DANS le modal (cellule active uniquement)
  const messageCelluleActive = celluleActive
    ? messagesCellules[`${celluleActive.id_employe}|${celluleActive.jour}`]
    : undefined;

  function validerSaisie() {
    if (form.statut_jour === 'TRAVAIL') {
      const periodes = form.periodes || [];
      if (periodes.length === 0) return 'Au moins une période est requise (ajoutez-en une).';
      for (let i = 0; i < periodes.length; i++) {
        const p = periodes[i];
        if (!p.entree || !p.sortie) return `Période ${i + 1} incomplète : saisir début et fin.`;
        if (enMinutes(p.sortie) <= enMinutes(p.entree)) return `Période ${i + 1} : fin antérieure ou égale au début.`;
      }
      // Chevauchements entre les périodes du même jour (contrôle local,
      // la base rejoue la règle côté serveur)
      const tri = [...periodes].sort((a, b) => enMinutes(a.entree) - enMinutes(b.entree));
      for (let i = 1; i < tri.length; i++) {
        if (enMinutes(tri[i].entree) < enMinutes(tri[i - 1].sortie)) {
          return 'Chevauchement entre deux périodes de la journée.';
        }
      }
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
      [cle]: form.statut_jour === 'TRAVAIL'
        ? { statut_jour: 'TRAVAIL', periodes: form.periodes.filter((p) => p.entree && p.sortie) }
        : { statut_jour: form.statut_jour, periodes: [] },
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
    // MULTI-MODÈLES : la conversion état interne -> cellules API est déléguée
    // au convertisseur du modèle (un seul endroit, aucun if dispersé).
    if (modele.code !== 'STANDARD' && donneesModele) {
      return depuisInterne(modele, donneesModele.donnees, {
        affectationsExistantes: grille?.affectations || [],
        idService: serviceChoisi,
      });
    }
    const liste = [];
    if (!grille) return liste;
    for (const [cle, cel] of Object.entries(cellules)) {
      const [id_employe, jour] = cle.split('|');
      // MULTI-PÉRIODES : chaque période devient un créneau de la liste.
      // L'ancien format (entree/sortie) reste accepté pour compatibilité.
      const periodes = cel.periodes?.length
        ? cel.periodes
        : (cel.entree ? [{ entree: cel.entree, sortie: cel.sortie }] : []);
      liste.push({
        id_employe: Number(id_employe),
        jour,
        statut_jour: cel.statut_jour,
        creneaux:
          cel.statut_jour === 'TRAVAIL'
            ? periodes.map((p) => ({ periode: periodeDe(p.entree), heure_entree: p.entree, heure_sortie: p.sortie }))
            : [],
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
<AppShell>
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

        {/* LISTE DES PLANNINGS DU SERVICE (tous modèles) : ligne = planning.
            Le bouton Modifier (Pencil) positionne les sélecteurs Service +
            Semaine sur CE planning : la grille ci-dessous se recharge alors
            via le useEffect existant (aucune logique dupliquée). Le chef ne
            peut modifier que SON service : périmètre déjà appliqué par l'API
            et par le filtre service de la page. */}
        {!chargement && listePlannings.length > 0 && (
          <div className="card" style={{ overflowX: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Plannings du service — cliquez sur Modifier pour éditer la grille</h3>
            <table>
              <thead>
                <tr>
                  <th>Semaine</th>
                  <th>Période</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listePlannings.map((p) => (
                  <tr key={p.id_planning} style={
                    grille?.planning?.id_planning === p.id_planning ? { background: 'var(--zom-creme, #FFF4C5)' } : undefined
                  }>
                    <td><strong>S{p.numero_semaine} / {p.annee}</strong></td>
                    <td>{String(p.date_debut || '').slice(0, 10)} → {String(p.date_fin || '').slice(0, 10)}</td>
                    <td><span className={`badge ${p.statut}`}>{LABELS_STATUT[p.statut] || p.statut}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {/* MODIFIER : BROUILLON / REJETE uniquement (grille
                            éditable). SOUMIS/VALIDE ne sont jamais modifiables
                            directement (règle serveur : rouverture par RH). */}
                        {['BROUILLON', 'REJETE'].includes(p.statut) ? (
                          <button
                            className="btn-icone"
                            onClick={() => setSemaine(`${p.annee}-W${String(p.numero_semaine).padStart(2, '0')}`)}
                            disabled={chargement}
                            title={`Modifier le planning S${p.numero_semaine} — la grille ci-dessous s'ouvre sur ce planning`}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                        ) : (
                          <span
                            className="btn-icone rh-export-indispo"
                            title={p.statut === 'SOUMIS'
                              ? 'En attente de décision RH : non modifiable.'
                              : 'Planning validé : demandez sa rouverture à la RH pour le modifier.'}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {chargement && <p className="muted">Chargement de la grille...</p>}

        {/* MOTIF DE REJET (visible pendant la correction) : même source que la
            page consultation (dernier_rejet de validation_rh). Le chef corrige
            en sachant POURQUOI, puis resoumet. */}
        {grille?.planning?.statut === 'REJETE' && grille.dernier_rejet && (
          <div className="motif-rejet-box" role="alert">
            <div className="motif-rejet-titre"><XCircle size={15} aria-hidden="true" /> Planning rejeté par la RH</div>
            <div><strong>Motif :</strong> {grille.dernier_rejet.commentaire || <span className="muted">(motif non renseigné)</span>}</div>
          </div>
        )}

        {/* Nom du modèle actif (information professionnelle, aucune action) */}
        {grille && !chargement && modele.code !== 'STANDARD' && (
          <p className="muted" style={{ marginTop: -6 }}>
            Modèle de planning : <strong>{modele.nom}</strong>
          </p>
        )}

        {/* Aucun planning pour ce service/semaine : création EXPLICITE —
            le bouton ouvre une MODALE de confirmation (chef uniquement). */}
        {!chargement && !grille && planningId === null && (
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <CalendarPlus size={18} aria-hidden="true" style={{ color: 'var(--zom-rouge, #b91c1c)' }} />
            <span>
              Aucun planning pour <strong>{serviceCreation ? (serviceCreation.nom_service || serviceCreation.nom) : 'ce service'}</strong>{' '}
              — semaine {numSemaine}/{anneeSemaine}.
              {user?.role !== 'CHEF_SERVICE' && ' Seul le chef de service peut le créer.'}
            </span>
            {user?.role === 'CHEF_SERVICE' && (
              <button
                className="btn"
                onClick={ouvrirModalCreation}
                title="Ouvrir la fenêtre de création du planning"
              >
                <CalendarPlus size={15} aria-hidden="true" /> Créer le planning
              </button>
            )}
          </div>
        )}

        {grille && !chargement && modele.code === 'STANDARD' && (
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
                              {cel && cel.statut_jour === 'TRAVAIL' && (cel.periodes?.length > 0 || cel.entree) && (
                                <div>
                                  {(cel.periodes?.length
                                    ? cel.periodes
                                    : [{ entree: cel.entree, sortie: cel.sortie }]
                                  ).map((p, i) => (
                                    <div key={i} style={{ whiteSpace: 'nowrap' }}>
                                      {p.entree && p.sortie ? `${p.entree} - ${p.sortie}` : 'Incomplet'}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {cel && cel.statut_jour !== 'TRAVAIL' && (
                                <span className={`badge ${cel.statut_jour}`}>{cel.statut_jour}</span>
                              )}
                              {cel?.statut_jour === 'TRAVAIL' && (
                                <div className="muted" style={{ fontSize: 11 }}>
                                  {formatDuree((cel.periodes?.length
                                    ? cel.periodes.reduce((s, p) => s + Math.max(0, enMinutes(p.sortie) - enMinutes(p.entree)), 0)
                                    : Math.max(0, enMinutes(cel.sortie) - enMinutes(cel.entree))))}
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
              <div style={{ display: 'flex', gap: 10, margin: '12px 0', flexWrap: 'wrap' }}>
                <button className="btn" onClick={enregistrer} disabled={enregistrement}>Enregistrer le brouillon</button>
                <button className="btn secondary" onClick={verifier} disabled={enregistrement}>Vérifier le planning</button>
                <button className="btn success" onClick={soumettre} disabled={enregistrement}>Soumettre à la RH</button>
              </div>
            ) : (
              <p className="muted">
                Planning {LABELS_STATUT[grille.planning.statut] || grille.planning.statut} : saisie verrouillée.
                {grille.planning.statut === 'SOUMIS' ? ' En attente de décision RH.' : ''}
                {grille.planning.statut === 'VALIDE'
                  ? ' Planning officiel : demandez à la RH de le rouvrir pour le modifier (il repassera en Brouillon et devra être revalidé).'
                  : ''}
              </p>
            )}
          </>
        )}

        {/* MULTI-MODÈLES : grille spécifique au service (SECURITE = shifts ×
            postes ; HORAIRE_LIBRE = colonnes horaires + REPOS/CONGE/OBS).
            L'éditeur est choisi par le modèle, pas par un if(service===...). */}
        {grille && !chargement && modele.code !== 'STANDARD' && donneesModele && (
          <>
            <div className="card" style={{ overflowX: 'auto' }}>
              <PlanningModelEditor
                modele={modele}
                jours={jours}
                employes={grille.employes || []}
                valeur={donneesModele}
                lectureSeule={!modifiable}
                onChange={(valeur) => setDonneesModele(valeur)}
              />
            </div>
            {modifiable ? (
              <div style={{ display: 'flex', gap: 10, margin: '12px 0', flexWrap: 'wrap' }}>
                <button className="btn" onClick={enregistrer} disabled={enregistrement}>Enregistrer le brouillon</button>
                <button className="btn success" onClick={soumettre} disabled={enregistrement}>Soumettre à la RH</button>
              </div>
            ) : (
              <p className="muted">
                Planning {LABELS_STATUT[grille.planning.statut] || grille.planning.statut} : saisie verrouillée.
                {grille.planning.statut === 'SOUMIS' ? ' En attente de décision RH.' : ''}
              </p>
            )}
          </>
        )}

        {/* MODALE de création : champs Semaine / Service / Date début /
            Date fin (préremplis, synchronisés), boutons Annuler / Créer.
            Utilise l'API existante POST /plannings (permission planning.create,
            service rattaché au compte côté serveur) — rien d'autre ne change. */}
        {modalCreation && formCreation && (
          <Modal
            titre="Créer un planning"
            onClose={() => { if (!creationEnCours) setModalCreation(false); }}
            largeur={480}
          >
            <div className="form-row">
              <label>Service</label>
              <select
                value={formCreation.id_service}
                disabled
                title="Le planning est créé pour votre service (règle serveur existante)"
              >
                {services.map((s) => (
                  <option key={s.id_service} value={s.id_service}>{s.nom_service || s.nom}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="form-row" style={{ flex: 1 }}>
                <label>Année</label>
                <input
                  type="number"
                  min={1}
                  value={formCreation.annee}
                  onChange={(e) => majFormCreation({ annee: e.target.value })}
                />
              </div>
              <div className="form-row" style={{ flex: 1 }}>
                <label>Semaine</label>
                <select
                  value={`${formCreation.annee}-W${String(Number(formCreation.semaine)).padStart(2, '0')}`}
                  onChange={(e) => majFormCreation({ semaine: String(Number(e.target.value.split('-W')[1])) })}
                >
                  {Array.from({ length: nbSemainesISO(Number(formCreation.annee) || 1) }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={`${formCreation.annee}-W${String(n).padStart(2, '0')}`}>
                      Semaine {n} / {formCreation.annee}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="form-row" style={{ flex: 1 }}>
                <label>Date de début (lundi)</label>
                <input
                  type="date"
                  value={formCreation.date_debut}
                  onChange={(e) => majFormCreation({ date_debut: e.target.value })}
                />
              </div>
              <div className="form-row" style={{ flex: 1 }}>
                <label>Date de fin (dimanche)</label>
                <input
                  type="date"
                  value={formCreation.date_fin}
                  onChange={(e) => majFormCreation({ date_fin: e.target.value })}
                />
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Le planning naît au statut Brouillon : les horaires se saisissent ensuite
              directement dans la grille.
            </p>
            {erreur && <div className="error" style={{ marginBottom: 10 }}>{erreur}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn secondary" onClick={() => setModalCreation(false)} disabled={creationEnCours}>Annuler</button>
              <button className="btn" onClick={creerPlanning} disabled={creationEnCours}>
                <CalendarPlus size={15} aria-hidden="true" /> {creationEnCours ? 'Création...' : 'Créer'}
              </button>
            </div>
          </Modal>
        )}

        {/* MODAL de saisie d'horaire (cellule employé × jour) : employé et
            jour PREREMPLIS en lecture seule ; heures en dropdown scrollable
            00:00 → 24:00 (pas 30 min) ; enregistrement = logique existante
            (appliquerCellule -> etat local, puis PUT /plannings/:id/grille) */}
        {celluleActive && (
          <Modal
            titre={`Ajouter un horaire — ${celluleActive.nom}`}
            onClose={() => setCelluleActive(null)}
            largeur={480}
          >
            <p style={{ marginTop: 0 }}>
              <strong>Employé :</strong> {celluleActive.nom}
              <span style={{ marginLeft: 18 }} />
              <strong>Jour :</strong> {libelleJour(celluleActive.jour)} {celluleActive.jour}
            </p>
            <div className="form-row">
              <label>Type</label>
              <select value={form.statut_jour} onChange={(e) => setForm((f) => ({ ...f, statut_jour: e.target.value }))}>
                {STATUTS_CELLULE.map((s) => (
                  <option key={s} value={s}>{s === 'TRAVAIL' ? 'Travail (horaire)' : s}</option>
                ))}
              </select>
            </div>
            {form.statut_jour === 'TRAVAIL' && (
              <div className="form-row">
                <label>Périodes de travail (ex. 07:00–12:00 + 14:00–18:00)</label>
                {(form.periodes || []).map((p, i) => (
                  <div key={i} className="saisie-float-groupe" style={{ marginBottom: 6, alignItems: 'center' }}>
                    <span className="muted" style={{ fontSize: 12, minWidth: 58 }}>Période {i + 1}</span>
                    <SaisieHeureFloat
                      label="Début"
                      valeurHHmm={p.entree}
                      onChange={(hhmm) => modifierPeriode(i, 'entree', hhmm)}
                    />
                    <SaisieHeureFloat
                      label="Fin"
                      valeurHHmm={p.sortie}
                      onChange={(hhmm) => modifierPeriode(i, 'sortie', hhmm)}
                      autreValeurHHmm={p.entree}
                    />
                    <button
                      type="button"
                      className="btn-icone danger"
                      onClick={() => supprimerPeriode(i)}
                      title="Supprimer cette période"
                      aria-label={`Supprimer la période ${i + 1}`}
                    >×</button>
                  </div>
                ))}
                <button type="button" className="btn secondary" onClick={ajouterPeriode}>
                  + Ajouter une période
                </button>
                <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
                  Maximum 3 périodes par jour (matin / après-midi / soir), sans chevauchement.
                </p>
              </div>
            )}
            {messageCelluleActive && <div className="error" style={{ marginBottom: 10 }}>{messageCelluleActive}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn danger"
                onClick={() => { viderCellule(celluleActive.id_employe, celluleActive.jour); setCelluleActive(null); }}
              >
                Vider la cellule
              </button>
              <button className="btn secondary" onClick={() => setCelluleActive(null)}>Annuler</button>
              <button className="btn" onClick={appliquerCellule}>Enregistrer</button>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  );
}
