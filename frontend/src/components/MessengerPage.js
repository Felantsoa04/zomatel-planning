'use client';

/* MESSENGER INTERNE ZOMATEL — interface professionnelle.
 *   Desktop : [ conversations | conversation ] + panneau profil en DRAWER
 *   (ouvert au clic sur la photo ou le nom — jamais affiché en permanence)
 *   Mobile  : liste -> chat -> bouton retour (responsive)
 * Fonctions : recherche, nouvelle discussion (icône MessageCirclePlus),
 * gestion par discussion (épingler/désépingler, archiver/désarchiver,
 * supprimer avec confirmation), temps réel Socket.IO (réception, typing,
 * présence, accusés de lecture), non-lus réels (badge sidebar synchronisé via
 * événement zomatel:messenger), réponse à un message, modification,
 * suppression logique, pagination, contextualisation planning FACULTATIVE.
 * ENVOI DE CONTENUS (nouveauté, même logique serveur) :
 *   - image / vidéo / fichier via pièce jointe (aperçu AVANT envoi) ;
 *   - message vocal (MediaRecorder, aperçu avec lecteur avant envoi) ;
 *   - emoji via sélecteur intégré (contenu utilisateur, jamais en icône) ;
 *   - état de chargement pendant l'envoi + erreurs affichées proprement ;
 *   - rendu propre des images/vidéos/audio/fichiers dans la conversation ;
 *   - historique existant conservé (aucune donnée recréée).
 * Icônes : lucide-react exclusivement (aucun emoji en icône).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  MessageCircle, Search, Send, ArrowLeft, X, Check, CheckCheck,
  Pencil, Trash2, Reply, Copy, Loader2, Users, ChevronLeft, ChevronRight,
  CalendarDays, Circle, MessageCirclePlus, Pin, PinOff, Archive, ArchiveRestore,
  MoreVertical, Paperclip, Smile, Mic, Square, ImagePlus, Film, FileText,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { socketMessenger } from '@/lib/socket';
import Modal from '@/components/Modal';

const LIMITE_MESSAGES = 50;
const TAILLE_MAX_PJ = 15 * 1024 * 1024; // 15 Mo (identique au serveur)

const LIBELLES_ROLE = {
  ADMIN: 'Administrateur',
  RH: 'RH',
  CHEF_SERVICE: 'Chef de service',
};

/* Sélecteur d'emoji : contenu utilisateur uniquement (jamais utilisé comme
 * icône d'interface — règle projet : lucide-react pour les icônes). */
const EMOJIS = [
  '😀', '😅', '😂', '😊', '🥰', '😍', '😉', '😎',
  '🤔', '😴', '😢', '😤', '👍', '👎', '🙏', '👏',
  '💪', '🤝', '✅', '❌', '⚠️', '🔥', '✨', '🎉',
  '❤️', '💙', '☀️', '🌙', '☕', '⏰', '📅', '📞',
  '🏨', '🛎️', '💼', '🧹', '🍳', '🛒', '📝', '💬',
];

function nomComplet(u) {
  if (!u) return '';
  return [u.prenom, u.nom].filter(Boolean).join(' ') || u.nom_utilisateur || `Utilisateur #${u.id_utilisateur}`;
}
function initiales(u) {
  const n = nomComplet(u).trim();
  return n.split(/\s+/).map((m) => m[0]).join('').slice(0, 2).toUpperCase() || '?';
}
function heureCourte(str) {
  if (!str) return '';
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const aujourdhui = new Date();
  const memeJour = d.toDateString() === aujourdhui.toDateString();
  return memeJour
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function urlPhoto(chemin) {
  if (!chemin) return null;
  if (chemin.startsWith('http')) return chemin;
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');
  return `${base}${chemin}`;
}
function dureeFormat(sec) {
  const s = Math.max(0, Number(sec) || 0);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function tailleLisible(octets) {
  const o = Number(octets) || 0;
  if (o >= 1024 * 1024) return `${(o / (1024 * 1024)).toFixed(1)} Mo`;
  if (o >= 1024) return `${Math.round(o / 1024)} Ko`;
  return `${o} o`;
}
/* Libellé d'un message média (aperçu de la liste des discussions). */
function libelleMedia(m) {
  if (!m || !m.type_message || m.type_message === 'texte') return null;
  switch (m.type_message) {
    case 'image': return 'Photo';
    case 'video': return 'Vidéo';
    case 'audio': return 'Message vocal';
    default: return m.nom_fichier ? `Fichier : ${m.nom_fichier}` : 'Fichier';
  }
}

/* Avatar : photo de profil existante sinon initiales (aucune casse du profil). */
function Avatar({ utilisateur, taille = 38, enLigne = null }) {
  const src = urlPhoto(utilisateur && utilisateur.photo_profil);
  return (
    <span className="msg-avatar" style={{ width: taille, height: taille }}>
      {src ? <img src={src} alt="" /> : <span>{initiales(utilisateur)}</span>}
      {enLigne !== null && (
        <span className={`msg-presence ${enLigne ? 'msg-presence-enligne' : ''}`} title={enLigne ? 'En ligne' : 'Hors ligne'}>
          <Circle size={9} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export default function MessengerPage() {
  const moi = typeof window !== 'undefined' ? getUser() : null;

  const [conversations, setConversations] = useState([]);
  const [chargementConvs, setChargementConvs] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [convOuverte, setConvOuverte] = useState(null); // objet conversation
  const [messages, setMessages] = useState([]);
  const [chargementMsgs, setChargementMsgs] = useState(false);
  const [aPlus, setAPlus] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [enEnvoi, setEnEnvoi] = useState(false);
  const [reponseA, setReponseA] = useState(null); // message auquel répondre
  const [editionId, setEditionId] = useState(null); // message en modification
  const [erreur, setErreur] = useState('');
  const [panneauInfo, setPanneauInfo] = useState(false); // mobile
  const [modalNouvelle, setModalNouvelle] = useState(false);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [rechercheUser, setRechercheUser] = useState('');
  const [nonLusTotal, setNonLusTotal] = useState(0);
  const [enLigneIds, setEnLigneIds] = useState(() => new Set());
  const [typingPar, setTypingPar] = useState({}); // conv id -> { utilisateur_id: bool }
  const [planningContexte, setPlanningContexte] = useState(''); // id planning facultatif
  // Gestion des discussions : vue « Archivees », menu ⋮ ouvert, suppression
  const [vueArchivees, setVueArchivees] = useState(false);
  const [menuOuvertId, setMenuOuvertId] = useState(null);
  const [convASupprimer, setConvASupprimer] = useState(null);

  /* ---- Pièces jointes / emoji / vocal ---- */
  const [pieceJointe, setPieceJointe] = useState(null); // { fichier, type, nom, taille, apercu }
  const [menuPieceJointe, setMenuPieceJointe] = useState(false);
  const [emojiOuvert, setEmojiOuvert] = useState(false);
  const [envoiPJ, setEnvoiPJ] = useState(false);
  const [enregistrementActif, setEnregistrementActif] = useState(false);
  const [dureeEnregistrement, setDureeEnregistrement] = useState(0);

  const finMessagesRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimerRef = useRef(null);
  const inputFichierRef = useRef(null);
  const recorderRef = useRef(null);
  const fluxRef = useRef(null);
  const chunksRef = useRef(null);
  const timerEnregistrementRef = useRef(null);

  /* ---- Chargement des conversations + badge ---- */
  const chargerConversations = useCallback(async () => {
    try {
      const liste = await api.get('/messenger/conversations', getToken());
      setConversations(Array.isArray(liste) ? liste : []);
      const total = (liste || []).reduce((s, c) => s + (Number(c.non_lus) || 0), 0);
      setNonLusTotal(total);
      // Synchronise le badge de la sidebar (composant MessengerBadge).
      window.dispatchEvent(new CustomEvent('zomatel:messenger', { detail: { non_lus: total } }));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargementConvs(false);
    }
  }, []);

  useEffect(() => { chargerConversations(); }, [chargerConversations]);

  /* ---- Socket.IO : temps réel (réception, lecture, typing, présence) ---- */
  useEffect(() => {
    const socket = socketMessenger();
    if (!socket) return;
    socketRef.current = socket;

    socket.emit('messenger:join');

    function surMessage({ message }) {
      // N'ajoute PAS mes propres messages (déjà ajoutés via l'accusé HTTP).
      const mien = Number(message.expediteur && message.expediteur.id_utilisateur) === Number(moi && moi.id_utilisateur);
      setMessages((prec) => {
        if (!convOuverte || message.conversation_id !== convOuverte.id) return prec;
        if (prec.some((m) => m.id === message.id) || mien) return prec;
        return [...prec, message];
      });
      if (mien) return;
      if (!convOuverte || message.conversation_id !== convOuverte.id) chargerConversations();
      else {
        // Reçu en conversation ouverte : accusé immédiat.
        socket.emit('messenger:conversation-ouverte', { conversation_id: message.conversation_id });
      }
      window.dispatchEvent(new CustomEvent('zomatel:messenger', { detail: { type: 'recu' } }));
    }
    function surEnvoiConfirme({ message }) {
      setMessages((prec) => (prec.some((m) => m.id === message.id) ? prec : [...prec, message]));
    }
    function surLu({ conversation_id, message_id }) {
      setMessages((prec) => prec.map((m) => (m.id === message_id ? { ...m, lu: true } : m)));
      if (!convOuverte || conversation_id === convOuverte.id) chargerConversations();
    }
    function surTyping({ conversation_id, utilisateur_id, ecrit }) {
      setTypingPar((prec) => {
        const pourConv = { ...(prec[conversation_id] || {}) };
        if (ecrit) pourConv[utilisateur_id] = true; else delete pourConv[utilisateur_id];
        return { ...prec, [conversation_id]: pourConv };
      });
    }
    function surPresence({ id_utilisateur, en_ligne }) {
      setEnLigneIds((prec) => {
        const s = new Set(prec);
        if (en_ligne) s.add(id_utilisateur); else s.delete(id_utilisateur);
        return s;
      });
    }
    function surModifie({ message }) {
      setMessages((prec) => prec.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
    }
    function surSupprime({ message }) {
      setMessages((prec) => prec.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
    }

    socket.on('messenger:message', surMessage);
    socket.on('messenger:message-envoye', surEnvoiConfirme);
    socket.on('messenger:lu', surLu);
    socket.on('messenger:typing', surTyping);
    socket.on('messenger:presence', surPresence);
    socket.on('messenger:message-modifie', surModifie);
    socket.on('messenger:message-supprime', surSupprime);

    return () => {
      socket.off('messenger:message', surMessage);
      socket.off('messenger:message-envoye', surEnvoiConfirme);
      socket.off('messenger:lu', surLu);
      socket.off('messenger:typing', surTyping);
      socket.off('messenger:presence', surPresence);
      socket.off('messenger:message-modifie', surModifie);
      socket.off('messenger:message-supprime', surSupprime);
    };
  }, [convOuverte, chargerConversations, moi]);

  /* ---- Ouverture d'une conversation ---- */
  const ouvrirConversation = useCallback(async (conv) => {
    setConvOuverte(conv);
    setReponseA(null);
    setEditionId(null);
    setPlanningContexte('');
    setChargementMsgs(true);
    setPanneauInfo(false);
    nettoyerPieceJointe();
    setEnregistrementActif(false);
    try {
      const data = await api.get(`/messenger/conversations/${conv.id}/messages?limite=${LIMITE_MESSAGES}`, getToken());
      setMessages(data.messages || []);
      setAPlus(Boolean(data.a_plus));
      // Marquage lu + rafraîchissement de la liste (compteur à 0).
      await api.post(`/messenger/conversations/${conv.id}/read`, {}, getToken());
      socketRef.current && socketRef.current.emit('messenger:conversation-ouverte', { conversation_id: conv.id });
      chargerConversations();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargementMsgs(false);
    }
  }, [chargerConversations]);

  // Défilement en bas à l'arrivée de nouveaux messages.
  useEffect(() => {
    if (finMessagesRef.current) finMessagesRef.current.scrollIntoView({ block: 'end' });
  }, [messages, chargementMsgs]);

  /* ---- Envoi TEXTE (HTTP REST ; le socket relaie aux autres membres) ---- */
  async function envoyer() {
    if (!convOuverte || enEnvoi || envoiPJ) return;
    if (pieceJointe) return envoyerLaPieceJointe(); // pièce jointe = priorité
    const texte = saisie.trim();
    if (!texte) return;
    setEnEnvoi(true);
    setErreur('');
    try {
      const body = { contenu: texte };
      if (reponseA) body.repondre_a = reponseA.id;
      const pid = Number(planningContexte);
      if (Number.isInteger(pid) && pid > 0) body.planning_id = pid;
      const { message } = await api.post(`/messenger/conversations/${convOuverte.id}/messages`, body, getToken());
      setMessages((prec) => (prec.some((m) => m.id === message.id) ? prec : [...prec, message]));
      setSaisie('');
      setReponseA(null);
      setPlanningContexte('');
      chargerConversations();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnEnvoi(false);
    }
  }

  function surTouche(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      envoyer();
    }
  }

  // Typing indicator : émission limitée (au plus toutes les 1,5 s).
  function surChangementSaisie(valeur) {
    setSaisie(valeur);
    const socket = socketRef.current;
    if (!socket || !convOuverte) return;
    if (typingTimerRef.current) return;
    typingTimerRef.current = setTimeout(() => {
      typingTimerRef.current = null;
      socket.emit('messenger:typing', { conversation_id: convOuverte.id, ecrit: saisie.length > 0 });
    }, 300);
    clearTimeout(typingTimerRef.timeoutArret);
    typingTimerRef.timeoutArret = setTimeout(() => {
      socket.emit('messenger:typing', { conversation_id: convOuverte.id, ecrit: false });
    }, 2500);
  }

  /* ==================== PIECES JOINTES / EMOJI / VOCAL ==================== */

  function nettoyerPieceJointe() {
    setPieceJointe((pj) => {
      if (pj && pj.apercu) URL.revokeObjectURL(pj.apercu);
      return null;
    });
    if (inputFichierRef.current) inputFichierRef.current.value = '';
  }

  // Ouverture du sélecteur de fichiers avec le bon « accept » selon le type.
  function choisirFichier(accept) {
    if (!inputFichierRef.current) return;
    setMenuPieceJointe(false);
    inputFichierRef.current.accept = accept;
    inputFichierRef.current.click();
  }

  function surFichierChoisi(e) {
    const fichier = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!fichier) return;
    setErreur('');
    if (fichier.size > TAILLE_MAX_PJ) {
      setErreur('Fichier trop volumineux (maximum 15 Mo).');
      return;
    }
    const mime = (fichier.type || '').toLowerCase();
    const estMedia = mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
    if (!estMedia && mime && !/pdf|msword|officedocument|text\/plain|text\/csv|zip/.test(mime)) {
      setErreur('Type de fichier non accepté (image, vidéo, audio ou document).');
      return;
    }
    const type = mime.startsWith('image/') ? 'image'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('audio/') ? 'audio'
      : 'fichier';
    setPieceJointe({
      fichier,
      type,
      nom: fichier.name || 'fichier',
      taille: fichier.size,
      apercu: URL.createObjectURL(fichier),
    });
  }

  /* --- Message vocal : MediaRecorder (aperçu + lecteur avant envoi) --- */
  function arreterFlux() {
    if (fluxRef.current) {
      fluxRef.current.getTracks().forEach((t) => t.stop());
      fluxRef.current = null;
    }
  }

  async function demarrerEnregistrement() {
    setErreur('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      setErreur("L'enregistrement vocal n'est pas pris en charge par ce navigateur.");
      return;
    }
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
      fluxRef.current = flux;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(flux, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current || [], { type: mimeType || 'audio/webm' });
        if (blob.size > 0) {
          const fichier = new File([blob], `message-vocal-${Date.now()}.webm`, { type: blob.type });
          setPieceJointe({
            fichier,
            type: 'audio',
            nom: 'Message vocal',
            taille: blob.size,
            apercu: URL.createObjectURL(blob),
          });
        }
        arreterFlux();
      };
      rec.start();
      recorderRef.current = rec;
      setEnregistrementActif(true);
      setDureeEnregistrement(0);
      timerEnregistrementRef.current = setInterval(() => setDureeEnregistrement((d) => d + 1), 1000);
    } catch {
      setErreur("Microphone inaccessible : autorisez l'accès au micro pour envoyer un message vocal.");
    }
  }

  function arreterEnregistrement(envoyer) {
    if (timerEnregistrementRef.current) {
      clearInterval(timerEnregistrementRef.current);
      timerEnregistrementRef.current = null;
    }
    setEnregistrementActif(false);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) { arreterFlux(); return; }
    if (!envoyer) rec.onstop = null; // annulation : aucun aperçu créé
    try { rec.stop(); } catch { arreterFlux(); }
  }

  // Nettoyage final (fermer la page) : micro, minuteur et aperçus.
  useEffect(() => () => {
    if (timerEnregistrementRef.current) clearInterval(timerEnregistrementRef.current);
    try { recorderRef.current && recorderRef.current.state !== 'inactive' && recorderRef.current.stop(); } catch { /* ignore */ }
    arreterFlux();
  }, []);

  /* --- Envoi de la pièce jointe (multipart POST, même logique serveur) --- */
  async function envoyerLaPieceJointe() {
    if (!pieceJointe || !convOuverte || envoiPJ) return;
    setEnvoiPJ(true);
    setErreur('');
    try {
      const champs = {};
      if (saisie.trim()) champs.contenu = saisie.trim(); // légende facultative
      if (reponseA) champs.repondre_a = reponseA.id;
      const pid = Number(planningContexte);
      if (Number.isInteger(pid) && pid > 0) champs.planning_id = pid;
      const { message } = await api.envoyerPieceJointe(
        `/messenger/conversations/${convOuverte.id}/fichiers`,
        pieceJointe.fichier,
        getToken(),
        champs
      );
      setMessages((prec) => (prec.some((m) => m.id === message.id) ? prec : [...prec, message]));
      nettoyerPieceJointe();
      setSaisie('');
      setReponseA(null);
      setPlanningContexte('');
      chargerConversations();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoiPJ(false);
    }
  }

  /* ---- Modification / suppression (auteur uniquement, côté serveur) ---- */
  async function enregistrerEdition(id, contenuActuel) {
    const texte = (contenuActuel !== undefined ? contenuActuel : '').trim();
    if (!texte) { setEditionId(null); return; }
    try {
      const { message } = await api.patch(`/messenger/messages/${id}`, { contenu: texte }, getToken());
      setMessages((prec) => prec.map((m) => (m.id === id ? { ...m, ...message } : m)));
      socketRef.current && socketRef.current.emit('messenger:message-modifie', { conversation_id: message.conversation_id, message });
      setEditionId(null);
    } catch (e) { setErreur(e.message); }
  }
  async function supprimer(id) {
    if (!confirm('Supprimer ce message ? Les autres membres verront « Message supprimé ».')) return;
    try {
      const { message } = await api.delete(`/messenger/messages/${id}`, getToken());
      setMessages((prec) => prec.map((m) => (m.id === id ? { ...m, ...message } : m)));
      socketRef.current && socketRef.current.emit('messenger:message-supprime', { conversation_id: message.conversation_id, message });
      chargerConversations();
    } catch (e) { setErreur(e.message); }
  }

  /* ---- Gestion d'une discussion (menu ⋮) : épingler / archiver / supprimer ---- */
  async function basculerEpingle(conv) {
    setMenuOuvertId(null);
    try {
      await api.patch(`/messenger/conversations/${conv.id}/epingle`, { epinglee: !conv.epinglee }, getToken());
      await chargerConversations();
    } catch (e) { setErreur(e.message); }
  }
  async function basculerArchive(conv) {
    setMenuOuvertId(null);
    try {
      await api.patch(`/messenger/conversations/${conv.id}/archive`, { archivee: !conv.archivee }, getToken());
      await chargerConversations();
    } catch (e) { setErreur(e.message); }
  }
  async function confirmerSuppression() {
    const conv = convASupprimer;
    if (!conv) return;
    try {
      await api.delete(`/messenger/conversations/${conv.id}`, getToken());
      setConvASupprimer(null);
      if (convOuverte && convOuverte.id === conv.id) {
        setConvOuverte(null);
        setMessages([]);
      }
      await chargerConversations();
    } catch (e) { setErreur(e.message); }
  }

  // Fermeture des menus flottants (menu ⋮, pièce jointe, emoji) au clic ailleurs.
  useEffect(() => {
    if (!menuOuvertId && !menuPieceJointe && !emojiOuvert) return undefined;
    function fermerMenus() {
      setMenuOuvertId(null);
      setMenuPieceJointe(false);
      setEmojiOuvert(false);
    }
    document.addEventListener('click', fermerMenus);
    return () => document.removeEventListener('click', fermerMenus);
  }, [menuOuvertId, menuPieceJointe, emojiOuvert]);

  /* ---- Nouvelle conversation (utilisateurs autorisés RÉELS) ---- */
  async function ouvrirModalNouvelle() {
    setModalNouvelle(true);
    setRechercheUser('');
    try {
      const liste = await api.get('/messenger/utilisateurs', getToken());
      setUtilisateurs(Array.isArray(liste) ? liste : []);
    } catch (e) { setErreur(e.message); }
  }
  async function demarrerConversation(u) {
    try {
      const { id } = await api.post('/messenger/conversations', { utilisateur_id: u.id_utilisateur }, getToken());
      setModalNouvelle(false);
      await chargerConversations();
      // Ouvre directement la conversation (existante ou nouvellement créée).
      const conv = { id };
      setConvOuverte(conv);
      ouvrirConversation({ ...conv, membres: [u] });
    } catch (e) { setErreur(e.message); }
  }

  /* ---- Données dérivées ---- */
  const conversationsFiltrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const autres = (c.membres || []).filter((m) => Number(m.id_utilisateur) !== Number(moi && moi.id_utilisateur));
      const noms = autres.map(nomComplet).join(' ').toLowerCase();
      const contenu = c.dernier_message && c.dernier_message.contenu ? String(c.dernier_message.contenu).toLowerCase() : '';
      return noms.includes(q) || contenu.includes(q);
    });
  }, [conversations, recherche, moi]);

  // Répartition PAR ÉTAT (états exclusifs -> aucun doublon dans la liste) :
  // épinglées en haut, archivées dans leur section, le reste chronologique.
  const epinglees = conversationsFiltrees.filter((c) => c.epinglee && !c.archivee);
  const principales = conversationsFiltrees.filter((c) => !c.epinglee && !c.archivee);
  const archivees = conversationsFiltrees.filter((c) => c.archivee);
  const listeAffichee = vueArchivees ? archivees : [...epinglees, ...principales];

  const utilisateursFiltres = useMemo(() => {
    const q = rechercheUser.trim().toLowerCase();
    if (!q) return utilisateurs;
    return utilisateurs.filter((u) => nomComplet(u).toLowerCase().includes(q) ||
      (LIBELLES_ROLE[u.role] || '').toLowerCase().includes(q));
  }, [utilisateurs, rechercheUser]);

  // L'AUTRE membre (conversation privée 1-1) : pour le titre du chat.
  const interlocuteur = useMemo(() => {
    if (!convOuverte) return null;
    const membres = convOuverte.membres || [];
    return membres.find((m) => Number(m.id_utilisateur) !== Number(moi && moi.id_utilisateur)) || membres[0] || null;
  }, [convOuverte, moi]);

  const typingNoms = useMemo(() => {
    if (!convOuverte) return [];
    const map = typingPar[convOuverte.id] || {};
    return Object.keys(map)
      .filter((id) => Number(id) !== Number(moi && moi.id_utilisateur))
      .map((id) => {
        const membre = (convOuverte.membres || []).find((m) => Number(m.id_utilisateur) === Number(id));
        return membre ? nomComplet(membre) : null;
      })
      .filter(Boolean);
  }, [typingPar, convOuverte, moi]);

  /* ---- Pagination vers le passé ---- */
  async function chargerAvant() {
    if (!convOuverte || messages.length === 0) return;
    const premier = messages[0];
    try {
      const data = await api.get(`/messenger/conversations/${convOuverte.id}/messages?avant=${premier.id}&limite=${LIMITE_MESSAGES}`, getToken());
      setMessages((prec) => [...(data.messages || []), ...prec]);
      setAPlus(Boolean(data.a_plus));
    } catch (e) { setErreur(e.message); }
  }

  /* ---- Rendu d'une pièce jointe dans une bulle ---- */
  function rendrePieceJointe(m) {
    if (!m || !m.type_message || m.type_message === 'texte' || !m.fichier_chemin) return null;
    const url = urlPhoto(m.fichier_chemin);
    if (m.type_message === 'image') {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="msg-pj-media">
          <img src={url} alt={m.nom_fichier || 'Image'} loading="lazy" />
        </a>
      );
    }
    if (m.type_message === 'video') {
      return (
        <video controls preload="metadata" className="msg-pj-media msg-pj-video" src={url}>
          <track kind="captions" />
        </video>
      );
    }
    if (m.type_message === 'audio') {
      return (
        <span className="msg-pj-vocal">
          <Mic size={14} aria-hidden="true" />
          <audio controls preload="metadata" src={url} />
        </span>
      );
    }
    return (
      <a href={url} download={m.nom_fichier || true} className="msg-pj-fichier" target="_blank" rel="noopener noreferrer">
        <FileText size={18} aria-hidden="true" />
        <span className="msg-pj-fichier-info">
          <strong>{m.nom_fichier || 'Fichier'}</strong>
          <small>{m.mime_type || 'document'}</small>
        </span>
      </a>
    );
  }

  if (!moi) return <p className="muted">Chargement…</p>;

  return (
    <div className={`msg-page ${panneauInfo && convOuverte && interlocuteur ? 'msg-page-avec-info' : ''}`}>
      {/* ===================== ZONE 1 : CONVERSATIONS ===================== */}
      <aside className={`msg-liste ${convOuverte ? 'msg-liste-mobile-cachee' : ''}`}>
        <div className="msg-liste-haut">
          <h2 className="msg-titre">
            <MessageCircle size={17} aria-hidden="true" /> Messagerie
          </h2>
          {/* Nouvelle discussion : icône seule, style WhatsApp (accessible :
              title + aria-label « Nouvelle discussion ») */}
          <button
            className="msg-nouvelle"
            onClick={ouvrirModalNouvelle}
            title="Nouvelle discussion"
            aria-label="Nouvelle discussion"
          >
            <MessageCirclePlus size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="msg-recherche">
          <Search size={14} aria-hidden="true" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une conversation…"
            aria-label="Rechercher une conversation"
          />
          {recherche && <button onClick={() => setRecherche('')} aria-label="Effacer"><X size={13} /></button>}
        </div>

        {/* Accès à la section des discussions archivées (bascule WhatsApp) */}
        {archivees.length > 0 && (
          <button
            className="msg-archives-bascule"
            onClick={() => setVueArchivees((v) => !v)}
            aria-pressed={vueArchivees}
            title={vueArchivees ? 'Revenir aux discussions actives' : 'Voir les discussions archivées'}
          >
            {vueArchivees ? <ArrowLeft size={13} aria-hidden="true" /> : <Archive size={13} aria-hidden="true" />}
            {vueArchivees ? 'Toutes les discussions' : `Discussions archivées (${archivees.length})`}
          </button>
        )}

        <div className="msg-convs">
          {chargementConvs && (
            <p className="msg-vide"><Loader2 size={14} className="spin" aria-hidden="true" /> Chargement…</p>
          )}
          {!chargementConvs && listeAffichee.length === 0 && (
            <div className="msg-vide">
              <MessageCircle size={26} strokeWidth={1.4} aria-hidden="true" />
              <p>
                {vueArchivees
                  ? (archivees.length === 0 ? 'Aucune discussion archivée.' : 'Aucune discussion archivée ne correspond à la recherche.')
                  : (conversations.length === 0
                      ? 'Aucune conversation. Cliquez sur le bouton ci-dessus pour démarrer.'
                      : 'Aucune conversation ne correspond à la recherche.')}
              </p>
            </div>
          )}
          {/* Indication discrète du groupe « Épinglées » (en haut de la liste) */}
          {!vueArchivees && epinglees.length > 0 && (
            <p className="msg-groupe-label">
              <Pin size={11} aria-hidden="true" /> Épinglées
            </p>
          )}
          {!vueArchivees && principales.length > 0 && (
            <p className="msg-groupe-label">Toutes les discussions</p>
          )}
          {listeAffichee.map((c) => {
            const autre = (c.membres || []).find((m) => Number(m.id_utilisateur) !== Number(moi.id_utilisateur)) || c.membres[0];
            const enLigne = autre ? enLigneIds.has(Number(autre.id_utilisateur)) : false;
            const ecrit = Object.keys(typingPar[c.id] || {}).some((id) => Number(id) !== Number(moi.id_utilisateur));
            const actif = convOuverte && convOuverte.id === c.id;
            const nonLus = Number(c.non_lus) || 0;
            const apercu = c.dernier_message
              ? (libelleMedia(c.dernier_message) || (c.dernier_message.supprime ? 'Message supprimé' : c.dernier_message.contenu))
              : 'Nouvelle conversation';
            return (
              <div
                key={c.id}
                className={`msg-conv ${actif ? 'msg-conv-active' : ''} ${nonLus > 0 ? 'msg-conv-non-lue' : ''} ${c.archivee ? 'msg-conv-archivee' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => ouvrirConversation(c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirConversation(c); }
                }}
              >
                <Avatar utilisateur={autre} enLigne={enLigne} />
                <span className="msg-conv-corps">
                  <span className="msg-conv-haut">
                    <span className="msg-conv-nom">{nomComplet(autre)}</span>
                    <span className="msg-conv-heure" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {/* Épinglée : indication discrète */}
                      {c.epinglee && !c.archivee && <Pin size={11} className="msg-conv-epinglee" aria-label="Épinglée" />}
                      {c.dernier_message ? heureCourte(c.dernier_message.created_at) : ''}
                    </span>
                  </span>
                  <span className="msg-conv-bas">
                    <span className="msg-conv-apercu">
                      {ecrit ? 'est en train d\u2019écrire…' : apercu}
                    </span>
                    {nonLus > 0 && <span className="msg-badge">{nonLus > 99 ? '99+' : nonLus}</span>}
                  </span>
                </span>
                {/* Menu discret ⋮ : épingler / archiver / supprimer */}
                <button
                  className={`msg-conv-menu-btn ${menuOuvertId === c.id ? 'msg-conv-menu-btn-ouvert' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setMenuOuvertId(menuOuvertId === c.id ? null : c.id); }}
                  title="Options de la discussion"
                  aria-label={`Options de la discussion avec ${nomComplet(autre)}`}
                  aria-expanded={menuOuvertId === c.id}
                >
                  <MoreVertical size={15} aria-hidden="true" />
                </button>
                {menuOuvertId === c.id && (
                  <div className="msg-conv-menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => basculerEpingle(c)}>
                      {c.epinglee ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
                      {c.epinglee ? 'Désépingler' : 'Épingler'}
                    </button>
                    <button onClick={() => basculerArchive(c)}>
                      {c.archivee ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
                      {c.archivee ? 'Désarchiver' : 'Archiver'}
                    </button>
                    <button
                      className="msg-menu-danger"
                      onClick={() => { setMenuOuvertId(null); setConvASupprimer(c); }}
                    >
                      <Trash2 size={14} aria-hidden="true" /> Supprimer
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ===================== ZONE 2 : CONVERSATION ====================== */}
      <section className={`msg-chat ${convOuverte ? '' : 'msg-chat-mobile-cachee'}`}>
        {!convOuverte ? (
          <div className="msg-chat-vide">
            <MessageCircle size={42} strokeWidth={1.2} aria-hidden="true" />
            <p>Sélectionnez une conversation<br />ou démarrez-en une nouvelle.</p>
          </div>
        ) : (
          <>
            <header className="msg-chat-header">
              <button className="msg-retour" onClick={() => { setConvOuverte(null); setMessages([]); }} aria-label="Retour aux conversations">
                <ArrowLeft size={17} aria-hidden="true" />
              </button>
              {/* Photo + nom cliquables : le profil détaillé s'ouvre UNIQUEMENT
                  ici (panneau latéral qui pousse le chat, sans le masquer). */}
              <button
                className="msg-chat-tete"
                onClick={() => setPanneauInfo(true)}
                title="Voir le profil"
                aria-label="Voir le profil"
              >
                {interlocuteur && <Avatar utilisateur={interlocuteur} enLigne={enLigneIds.has(Number(interlocuteur.id_utilisateur))} />}
                <div className="msg-chat-titre">
                  <strong>{interlocuteur ? nomComplet(interlocuteur) : `Conversation #${convOuverte.id}`}</strong>
                  <small>
                    {interlocuteur && (LIBELLES_ROLE[interlocuteur.role] || interlocuteur.role)}
                    {interlocuteur && interlocuteur.nom_service ? ` · ${interlocuteur.nom_service}` : ''}
                    {' · '}
                    {enLigneIds.has(Number(interlocuteur && interlocuteur.id_utilisateur)) ? 'En ligne' : 'Hors ligne'}
                  </small>
                </div>
              </button>
            </header>

            <div className="msg-fil">
              {aPlus && (
                <button className="msg-avant" onClick={chargerAvant}>
                  <ChevronLeft size={13} aria-hidden="true" /> Messages plus anciens <ChevronRight size={13} aria-hidden="true" />
                </button>
              )}
              {chargementMsgs && (
                <p className="msg-vide"><Loader2 size={14} className="spin" aria-hidden="true" /> Chargement des messages…</p>
              )}
              {!chargementMsgs && messages.length === 0 && (
                <p className="msg-vide">Aucun message. Envoyez le premier !</p>
              )}
              {messages.map((m) => {
                const mien = Number(m.expediteur.id_utilisateur) === Number(moi.id_utilisateur);
                const pj = rendrePieceJointe(m);
                return (
                  <div key={m.id} className={`msg-ligne ${mien ? 'msg-mien' : 'msg-recu'}`}>
                    {!mien && <Avatar utilisateur={m.expediteur} taille={28} />}
                    <div className={`msg-bulle ${pj ? 'msg-bulle-media' : ''}`}>
                      {m.supprime ? (
                        <span className="msg-supprime">
                          <Trash2 size={12} aria-hidden="true" /> Message supprimé
                        </span>
                      ) : (
                        <>
                          {m.reponse && (
                            <div className="msg-reponse-apercu">
                              <Reply size={11} aria-hidden="true" />
                              <span>
                                <strong>{m.reponse.nom_expediteur}</strong>
                                {' — '}
                                {m.reponse.supprime ? 'Message supprimé' : (m.reponse.contenu || 'Pièce jointe')}
                              </span>
                            </div>
                          )}
                          {pj}
                          {editionId === m.id ? (
                            <div className="msg-edition">
                              <textarea
                                defaultValue={m.contenu}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enregistrerEdition(m.id, e.target.value); }
                                  if (e.key === 'Escape') setEditionId(null);
                                }}
                                autoFocus
                              />
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button className="btn secondary" onClick={() => setEditionId(null)}>Annuler</button>
                                <button className="btn" onClick={(e) => enregistrerEdition(m.id, e.target.closest('.msg-edition').querySelector('textarea').value)}>Enregistrer</button>
                              </div>
                            </div>
                          ) : (
                            m.contenu ? <p className="msg-texte">{m.contenu}</p> : null
                          )}
                          {m.planning && (
                            <Link href={`/planning/${m.planning.id_planning}`} className="msg-bloc-planning">
                              <CalendarDays size={13} aria-hidden="true" />
                              <span>
                                Planning S{m.planning.numero_semaine}/{m.planning.annee}
                                {m.planning.service ? ` · ${m.planning.service}` : ''}
                              </span>
                            </Link>
                          )}
                          <div className="msg-meta">
                            <span>{heureCourte(m.created_at)}</span>
                            {m.modifie && <span className="msg-modifie">modifié</span>}
                            {mien && (m.lu
                              ? <CheckCheck size={13} aria-hidden="true" title="Lu" />
                              : <Check size={13} aria-hidden="true" title="Envoyé" />)}
                          </div>
                          {!m.supprime && (
                            <div className="msg-actions">
                              {/* Modification du TEXTE uniquement (les pièces
                                  jointes ne sont pas modifiables). */}
                              {mien && m.type_message === 'texte' && (
                                <button onClick={() => setEditionId(m.id)} title="Modifier"><Pencil size={13} aria-hidden="true" /></button>
                              )}
                              <button onClick={() => supprimer(m.id)} title="Supprimer"><Trash2 size={13} aria-hidden="true" /></button>
                              {m.contenu && (
                                <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(m.contenu || ''); }} title="Copier"><Copy size={13} aria-hidden="true" /></button>
                              )}
                              <button onClick={() => { setReponseA(m); }} title="Répondre"><Reply size={13} aria-hidden="true" /></button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {typingNoms.length > 0 && (
                <p className="msg-typing">
                  <Loader2 size={12} className="spin" aria-hidden="true" />
                  {typingNoms.join(', ')} est en train d&rsquo;écrire…
                </p>
              )}
              <div ref={finMessagesRef} />
            </div>

            {reponseA && (
              <div className="msg-bandeau-reponse">
                <Reply size={13} aria-hidden="true" />
                <span>
                  Réponse à <strong>{[reponseA.expediteur.prenom, reponseA.expediteur.nom].filter(Boolean).join(' ')}</strong>
                  {' — '}{(reponseA.contenu || 'Pièce jointe').slice(0, 60)}
                </span>
                <button onClick={() => setReponseA(null)} aria-label="Annuler la réponse"><X size={13} /></button>
              </div>
            )}

            <footer className="msg-saisie">
              {/* --- Aperçu de la pièce jointe AVANT envoi (image, vidéo,
                      vocal avec lecteur, ou fichier) --- */}
              {pieceJointe && (
                <div className="msg-pj-apercu" role="group" aria-label="Pièce jointe en préparation">
                  {pieceJointe.type === 'image' && <img src={pieceJointe.apercu} alt="Aperçu de l'image" className="msg-pj-apercu-image" />}
                  {pieceJointe.type === 'video' && <video src={pieceJointe.apercu} controls className="msg-pj-apercu-video" />}
                  {pieceJointe.type === 'audio' && <audio src={pieceJointe.apercu} controls className="msg-pj-apercu-audio" />}
                  {pieceJointe.type === 'fichier' && (
                    <span className="msg-pj-apercu-fichier">
                      <FileText size={18} aria-hidden="true" />
                      <span>
                        <strong>{pieceJointe.nom}</strong>
                        <small>{(pieceJointe.fichier.type || 'document')} · {tailleLisible(pieceJointe.taille)}</small>
                      </span>
                    </span>
                  )}
                  {pieceJointe.type !== 'fichier' && (
                    <span className="msg-pj-apercu-info">
                      {pieceJointe.type === 'audio' ? pieceJointe.nom : pieceJointe.nom}
                      {pieceJointe.taille ? <small> · {tailleLisible(pieceJointe.taille)}</small> : null}
                    </span>
                  )}
                  <button
                    className="msg-pj-apercu-fermer"
                    onClick={nettoyerPieceJointe}
                    disabled={envoiPJ}
                    aria-label="Retirer la pièce jointe"
                    title="Retirer la pièce jointe"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              )}

              {/* --- Enregistrement vocal en cours (barre dédiée) --- */}
              {enregistrementActif && (
                <div className="msg-enregistrement" role="status">
                  <span className="msg-rec-dot" aria-hidden="true" />
                  <span>Enregistrement… {dureeFormat(dureeEnregistrement)}</span>
                  <button
                    className="msg-rec-annuler"
                    onClick={() => arreterEnregistrement(false)}
                    title="Annuler l'enregistrement"
                    aria-label="Annuler l'enregistrement"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                  <button
                    className="msg-rec-arreter"
                    onClick={() => arreterEnregistrement(true)}
                    title="Terminer et prévisualiser"
                    aria-label="Terminer l'enregistrement"
                  >
                    <Square size={13} aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="msg-saisie-ligne">
              <input
                className="msg-planning-input"
                value={planningContexte}
                onChange={(e) => setPlanningContexte(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="N° planning (facultatif)"
                title="Contextualiser le message avec un planning (identifiant facultatif)"
                style={{ width: 150 }}
              />
              <div className="msg-outils">
                {/* Pièce jointe : menu image / vidéo / fichier */}
                <div className="msg-outil-wrap">
                  <button
                    className="msg-outil"
                    onClick={(e) => { e.stopPropagation(); setMenuPieceJointe((v) => !v); setEmojiOuvert(false); }}
                    disabled={enregistrementActif || envoiPJ}
                    title="Joindre une image, une vidéo ou un fichier"
                    aria-label="Joindre un contenu"
                    aria-expanded={menuPieceJointe}
                  >
                    <Paperclip size={17} aria-hidden="true" />
                  </button>
                  {menuPieceJointe && (
                    <div className="msg-menu-pj" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => choisirFichier('image/jpeg,image/png,image/webp,image/gif')}>
                        <ImagePlus size={15} aria-hidden="true" /> Image
                      </button>
                      <button onClick={() => choisirFichier('video/mp4,video/webm,video/quicktime')}>
                        <Film size={15} aria-hidden="true" /> Vidéo
                      </button>
                      <button onClick={() => choisirFichier('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip')}>
                        <FileText size={15} aria-hidden="true" /> Fichier
                      </button>
                    </div>
                  )}
                </div>
                {/* Emoji : contenu utilisateur (jamais une icône d'interface) */}
                <div className="msg-outil-wrap">
                  <button
                    className="msg-outil"
                    onClick={(e) => { e.stopPropagation(); setEmojiOuvert((v) => !v); setMenuPieceJointe(false); }}
                    disabled={enregistrementActif || envoiPJ}
                    title="Insérer un emoji"
                    aria-label="Insérer un emoji"
                    aria-expanded={emojiOuvert}
                  >
                    <Smile size={17} aria-hidden="true" />
                  </button>
                  {emojiOuvert && (
                    <div className="msg-emoji-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sélecteur d'emoji">
                      {EMOJIS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          className="msg-emoji-item"
                          onClick={() => { setSaisie((s) => s + em); setEmojiOuvert(false); }}
                          aria-label={`Insérer ${em}`}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <textarea
                value={saisie}
                onChange={(e) => surChangementSaisie(e.target.value)}
                onKeyDown={surTouche}
                placeholder={pieceJointe ? 'Ajouter une légende (facultatif)…' : 'Écrire un message…'}
                rows={1}
                aria-label="Écrire un message"
                disabled={enEnvoi || envoiPJ}
              />
              {/* Micro : remplacé par l'envoi quand du contenu est prêt */}
              {!saisie.trim() && !pieceJointe ? (
                <button
                  className="msg-outil msg-micro"
                  onClick={demarrerEnregistrement}
                  disabled={enregistrementActif || envoiPJ || enEnvoi}
                  title="Message vocal"
                  aria-label="Enregistrer un message vocal"
                >
                  <Mic size={17} aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="msg-envoyer"
                  onClick={envoyer}
                  disabled={(!saisie.trim() && !pieceJointe) || enEnvoi || envoiPJ}
                  title="Envoyer (Entrée)"
                >
                  {enEnvoi || envoiPJ ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                </button>
              )}
              </div>
            </footer>

            {/* Sélecteur de fichier unique, « accept » posé dynamiquement */}
            <input ref={inputFichierRef} type="file" onChange={surFichierChoisi} style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
          </>
        )}
      </section>

      {/* ============ ZONE 3 : PROFIL (drawer latéral, ouvert au clic) ============
          Plus AUCUN cadre de profil affiché en permanence : le panneau
          n'apparaît que via la photo/le nom de l'en-tête. Desktop : il pousse
          légèrement le chat (3e colonne) ; mobile : drawer superposé. */}
      {panneauInfo && convOuverte && interlocuteur && (
      <aside className="msg-info msg-info-mobile-visible">
        <button className="msg-info-fermer" onClick={() => setPanneauInfo(false)} aria-label="Fermer le profil">
          <X size={14} aria-hidden="true" />
        </button>
        <>
            <Avatar utilisateur={interlocuteur} taille={64} enLigne={enLigneIds.has(Number(interlocuteur.id_utilisateur))} />
            <h3>{nomComplet(interlocuteur)}</h3>
            <p className="msg-info-role">
              {LIBELLES_ROLE[interlocuteur.role] || interlocuteur.role}
              {interlocuteur.nom_service ? ` · ${interlocuteur.nom_service}` : ''}
            </p>
            <p className="msg-info-statut">
              {enLigneIds.has(Number(interlocuteur.id_utilisateur)) ? 'En ligne' : 'Hors ligne'}
            </p>
            <div className="msg-info-bloc">
              <h4><Users size={13} aria-hidden="true" /> Membres</h4>
              {(convOuverte.membres || []).map((m) => (
                <div key={m.id_utilisateur} className="msg-info-membre">
                  <Avatar utilisateur={m} taille={24} enLigne={enLigneIds.has(Number(m.id_utilisateur))} />
                  <span>{nomComplet(m)}{Number(m.id_utilisateur) === Number(moi.id_utilisateur) ? ' (vous)' : ''}</span>
                </div>
              ))}
            </div>
            <div className="msg-info-bloc">
              <h4><Paperclip size={13} aria-hidden="true" /> À propos</h4>
              <p className="muted" style={{ fontSize: 12 }}>
                Messages, photos, vidéos, notes vocales et fichiers conservés dans
                l&rsquo;application. Vous pouvez modifier ou supprimer vos propres
                messages et joindre un numéro de planning pour contextualiser.
              </p>
            </div>
          </>
      </aside>
      )}

      {/* ================== MODAL NOUVELLE CONVERSATION =================== */}
      {modalNouvelle && (
        <div className="msg-modal-voile" onClick={() => setModalNouvelle(false)}>
          <div className="msg-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Nouvelle conversation">
            <div className="msg-modal-haut">
              <strong>Nouvelle conversation</strong>
              <button onClick={() => setModalNouvelle(false)} aria-label="Fermer"><X size={15} /></button>
            </div>
            <div className="msg-recherche" style={{ margin: '10px 12px' }}>
              <Search size={14} aria-hidden="true" />
              <input
                value={rechercheUser}
                onChange={(e) => setRechercheUser(e.target.value)}
                placeholder="Rechercher un utilisateur…"
                aria-label="Rechercher un utilisateur"
              />
            </div>
            <div className="msg-modal-liste">
              {utilisateursFiltres.length === 0 && <p className="msg-vide">Aucun utilisateur autorisé trouvé.</p>}
              {utilisateursFiltres.map((u) => (
                <button key={u.id_utilisateur} className="msg-modal-item" onClick={() => demarrerConversation(u)}>
                  <Avatar utilisateur={u} enLigne={enLigneIds.has(Number(u.id_utilisateur))} />
                  <span className="msg-modal-item-info">
                    <strong>{nomComplet(u)}</strong>
                    <small>
                      {LIBELLES_ROLE[u.role] || u.role}
                      {u.nom_service ? ` · ${u.nom_service}` : ''}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== Confirmation AVANT toute suppression de discussion ===== */}
      {convASupprimer && (
        <Modal titre="Supprimer la discussion" onClose={() => setConvASupprimer(null)} largeur={420}>
          <p style={{ marginTop: 0 }}>Supprimer cette discussion ?</p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Elle disparaîtra de votre liste de discussions. Si votre correspondant
            vous écrit à nouveau, elle réapparaîtra avec son historique.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setConvASupprimer(null)}>Annuler</button>
            <button className="btn danger" onClick={confirmerSuppression}>Supprimer</button>
          </div>
        </Modal>
      )}

      {erreur && (
        <div className="msg-erreur" role="alert">
          {erreur}
          <button onClick={() => setErreur('')} aria-label="Fermer"><X size={13} /></button>
        </div>
      )}
    </div>
  );
}
