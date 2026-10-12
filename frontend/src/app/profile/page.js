'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BriefcaseBusiness, Camera, CheckCircle2, CircleAlert,
  IdCard, LockKeyhole, Mail, Pencil, Phone, Save, ShieldCheck,
  Trash2, X,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import Modal from '@/components/Modal';
import { api } from '@/lib/api';
import { getToken, getUser, saveSession } from '@/lib/auth';

const LIBELLES_ROLE = {
  ADMIN: 'Administrateur',
  RH: 'Ressources Humaines',
  CHEF_SERVICE: 'Chef de service',
};

const TYPES_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const TAILLE_MAX_IMAGE = 2 * 1024 * 1024;

function urlPhoto(chemin) {
  if (!chemin) return null;
  if (chemin.startsWith('http')) return chemin;
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api')
    .replace(/\/api\/?$/, '');
  return `${base}${chemin}`;
}

function valeursFormulaire(utilisateur) {
  return {
    nom: utilisateur?.nom || '',
    prenom: utilisateur?.prenom || '',
    login: utilisateur?.login || '',
  };
}

function memeFormulaire(a, b) {
  return a.nom === b.nom && a.prenom === b.prenom && a.login === b.login;
}

export default function ProfilPage() {
  const router = useRouter();
  const inputFichier = useRef(null);
  const [user, setUser] = useState(null);
  const [ficheEmploye, setFicheEmploye] = useState(null);
  const [nomService, setNomService] = useState('');
  const [peutModifier, setPeutModifier] = useState(false);
  const [form, setForm] = useState({ nom: '', prenom: '', login: '' });
  const [formOriginal, setFormOriginal] = useState({ nom: '', prenom: '', login: '' });
  const [editionOuverte, setEditionOuverte] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [sauvegarde, setSauvegarde] = useState(false);
  const [sauvegardePhoto, setSauvegardePhoto] = useState(false);
  const [suppressionPhoto, setSuppressionPhoto] = useState(false);
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  const [photoApercu, setPhotoApercu] = useState(null);
  const [fichierPhoto, setFichierPhoto] = useState(null);
  const [erreur, setErreur] = useState('');
  const [erreurPhoto, setErreurPhoto] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let actif = true;

    async function chargerProfil() {
      const token = getToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const resultat = await api.get('/auth/me', token);
        if (!resultat?.user?.id_utilisateur) {
          throw new Error('Les informations du compte ne sont pas disponibles.');
        }

        const compteSession = getUser();
        let profil = {
          ...(Number(compteSession?.id_utilisateur) === Number(resultat.user.id_utilisateur)
            ? compteSession
            : {}),
          ...resultat.user,
        };
        let permissions = [];

        try {
          const droits = await api.get('/auth/permissions', token);
          permissions = Array.isArray(droits?.mes_permissions) ? droits.mes_permissions : [];
        } catch {
          // Cette route est restreinte aux comptes possédant user.view.
        }

        let propreCompteRelu = false;
        if (permissions.includes('user.view')) {
          try {
            const comptes = await api.get('/auth/users', token);
            const propreCompte = Array.isArray(comptes)
              ? comptes.find((compte) => Number(compte.id_utilisateur) === Number(profil.id_utilisateur))
              : null;
            if (propreCompte) {
              profil = { ...profil, ...propreCompte };
              propreCompteRelu = true;
            }
          } catch {
            // Le profil reste consultable; l'édition exige une relecture fiable.
          }
        }

        let employe = null;
        if (profil.id_employe) {
          try {
            employe = await api.get('/employes/me/profil', token);
          } catch {
            // Une fiche employé peut avoir été supprimée ou détachée.
          }
        }

        let service = '';
        if (profil.id_service) {
          try {
            const services = await api.get('/services', token);
            service = Array.isArray(services)
              ? services.find((item) => Number(item.id_service) === Number(profil.id_service))?.nom || ''
              : '';
          } catch {
            // Le reste du profil reste disponible si les services ne répondent pas.
          }
        }
        if (employe?.service_nom) service = employe.service_nom;

        if (!actif) return;
        const droitsEdition = permissions.includes('user.update')
          && permissions.includes('user.view')
          && propreCompteRelu;
        const valeurs = valeursFormulaire(profil);
        setUser(profil);
        setFicheEmploye(employe);
        setNomService(service);
        setPeutModifier(droitsEdition);
        setForm(valeurs);
        setFormOriginal(valeurs);
        saveSession(token, profil);
      } catch (err) {
        if (actif) setErreur(err.message || 'Impossible de charger les informations du profil.');
      } finally {
        if (actif) setChargement(false);
      }
    }

    chargerProfil();
    return () => { actif = false; };
  }, [router]);

  useEffect(() => () => {
    if (photoApercu) URL.revokeObjectURL(photoApercu);
  }, [photoApercu]);

  const photo = photoApercu || urlPhoto(user?.photo_profil);
  const initiales = [user?.prenom, user?.nom]
    .filter(Boolean)
    .map((partie) => partie.trim()[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase() || user?.login?.slice(0, 2).toUpperCase() || '?';
  const formulaireModifie = !memeFormulaire(form, formOriginal);

  function choisirPhoto(event) {
    setErreurPhoto('');
    setMessage('');
    const fichier = event.target.files?.[0];
    event.target.value = '';
    if (!fichier) return;
    if (!TYPES_IMAGE.includes(fichier.type)) {
      setErreurPhoto('Choisissez une image JPG, PNG ou WEBP.');
      return;
    }
    if (fichier.size > TAILLE_MAX_IMAGE) {
      setErreurPhoto('La photo ne doit pas dépasser 2 Mo.');
      return;
    }
    if (photoApercu) URL.revokeObjectURL(photoApercu);
    setFichierPhoto(fichier);
    setPhotoApercu(URL.createObjectURL(fichier));
  }

  function annulerApercu() {
    setPhotoApercu(null);
    setFichierPhoto(null);
    setErreurPhoto('');
  }

  async function enregistrerPhoto() {
    if (!fichierPhoto || sauvegardePhoto) return;
    setSauvegardePhoto(true);
    setErreurPhoto('');
    setMessage('');
    try {
      const token = getToken();
      const resultat = await api.uploadPhoto('/auth/profile/photo', fichierPhoto, token);
      const profilMisAJour = { ...user, photo_profil: resultat.photo_profil };
      setUser(profilMisAJour);
      saveSession(token, profilMisAJour);
      setPhotoApercu(null);
      setFichierPhoto(null);
      setMessage('Votre photo de profil a été mise à jour.');
    } catch (err) {
      setErreurPhoto(err.message || 'La photo n’a pas pu être enregistrée.');
    } finally {
      setSauvegardePhoto(false);
    }
  }

  async function supprimerPhoto() {
    setSuppressionPhoto(true);
    setErreurPhoto('');
    setMessage('');
    try {
      const token = getToken();
      await api.delete('/auth/profile/photo', token);
      const profilMisAJour = { ...user, photo_profil: null };
      setUser(profilMisAJour);
      saveSession(token, profilMisAJour);
      setConfirmerSuppression(false);
      annulerApercu();
      setMessage('Votre photo de profil a été supprimée.');
    } catch (err) {
      setErreurPhoto(err.message || 'La photo n’a pas pu être supprimée.');
      setConfirmerSuppression(false);
    } finally {
      setSuppressionPhoto(false);
    }
  }

  const annulerModification = useCallback(() => {
    setForm(formOriginal);
    setEditionOuverte(false);
    setErreur('');
    setErreurPhoto('');
    setPhotoApercu(null);
    setFichierPhoto(null);
  }, [formOriginal]);

  async function enregistrerProfil(event) {
    event.preventDefault();
    if (!user?.id_utilisateur || !peutModifier || sauvegarde || !formulaireModifie) return;
    setSauvegarde(true);
    setErreur('');
    setMessage('');
    const donnees = {
      nom: form.nom.trim(),
      prenom: form.prenom.trim(),
      login: form.login.trim(),
    };

    try {
      const token = getToken();
      await api.put(`/auth/users/${user.id_utilisateur}`, donnees, token);
      const profilMisAJour = { ...user, ...donnees };
      setUser(profilMisAJour);
      setForm(donnees);
      setFormOriginal(donnees);
      saveSession(token, profilMisAJour);
      setEditionOuverte(false);
      setMessage('Vos informations ont été enregistrées.');
    } catch (err) {
      setErreur(err.message || 'Les modifications n’ont pas pu être enregistrées.');
    } finally {
      setSauvegarde(false);
    }
  }

  if (chargement) {
    return (
      <AppShell>
        <div className="container profil-page">
          <p className="muted" role="status">Chargement du profil…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="container profil-page">
        {message && (
          <div className="profil-notice profil-notice-succes" role="status">
            <CheckCircle2 size={17} aria-hidden="true" /> {message}
          </div>
        )}
        {erreur && (
          <div className="profil-notice profil-notice-erreur" role="alert">
            <CircleAlert size={17} aria-hidden="true" /> {erreur}
          </div>
        )}

        <section className="card profil-carte-principale" aria-labelledby="profil-titre">
          <div className="profil-principal-entete">
            <div>
              <p className="profil-eyebrow">COMPTE</p>
              <h1 id="profil-titre">Mon profil</h1>
            </div>
            <button
              type="button"
              className="profil-editer-bouton"
              onClick={() => {
                setForm(formOriginal);
                setErreur('');
                setErreurPhoto('');
                setMessage('');
                setEditionOuverte(true);
              }}
              title="Modifier le profil"
              aria-label="Modifier le profil"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="profil-resume">
            <div className="profil-avatar-wrap">
              {photo ? (
                <img src={photo} alt="Photo de profil" className="profil-avatar" />
              ) : (
                <span className="profil-avatar profil-avatar-initiales" aria-label={`Initiales ${initiales}`}>
                  {initiales}
                </span>
              )}
            </div>
            <h2>{[user?.prenom, user?.nom].filter(Boolean).join(' ') || user?.login || 'Mon compte'}</h2>
            {user?.login && <p className="profil-login">@{user.login}</p>}
          </div>

          <dl className="profil-informations">
            <div>
              <dt><ShieldCheck size={15} aria-hidden="true" /> Rôle</dt>
              <dd>{LIBELLES_ROLE[user?.role] || user?.role || '—'}</dd>
            </div>
            <div>
              <dt><BriefcaseBusiness size={15} aria-hidden="true" /> Service</dt>
              <dd>{nomService || 'Non renseigné'}</dd>
            </div>
            {ficheEmploye?.matricule && (
              <div>
                <dt><IdCard size={15} aria-hidden="true" /> Matricule</dt>
                <dd>{ficheEmploye.matricule}</dd>
              </div>
            )}
            {user?.email && (
              <div>
                <dt><Mail size={15} aria-hidden="true" /> Email</dt>
                <dd>{user.email}</dd>
              </div>
            )}
            {user?.telephone && (
              <div>
                <dt><Phone size={15} aria-hidden="true" /> Téléphone</dt>
                <dd>{user.telephone}</dd>
              </div>
            )}
          </dl>

          {!peutModifier && (
            <p className="profil-lecture-seule">La modification des informations du compte requiert les permissions de gestion utilisateur.</p>
          )}
        </section>

        <section className="card profil-securite-compacte" aria-labelledby="profil-securite-titre">
          <div>
            <h2 id="profil-securite-titre"><LockKeyhole size={16} aria-hidden="true" /> Sécurité</h2>
            <p>Le changement de mot de passe n’est pas disponible dans l’API actuelle.</p>
          </div>
          <button type="button" className="btn secondary" disabled title="Fonctionnalité non disponible">
            Modifier le mot de passe
          </button>
        </section>
      </div>

      {editionOuverte && (
        <Modal titre="Modifier mon profil" onClose={annulerModification} largeur={520}>
          <form className="profil-modal-form" onSubmit={enregistrerProfil}>
            <div className="profil-modal-avatar">
              {photo ? (
                <img src={photo} alt="Aperçu de la photo de profil" className="profil-avatar" />
              ) : (
                <span className="profil-avatar profil-avatar-initiales" aria-label={`Initiales ${initiales}`}>
                  {initiales}
                </span>
              )}
              <div className="profil-modal-photo-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => inputFichier.current?.click()}
                  disabled={sauvegardePhoto || suppressionPhoto}
                >
                  <Camera size={15} aria-hidden="true" /> {user?.photo_profil ? 'Remplacer la photo' : 'Ajouter une photo'}
                </button>
                {user?.photo_profil && !photoApercu && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setConfirmerSuppression(true)}
                    disabled={suppressionPhoto}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Supprimer
                  </button>
                )}
                <input
                  ref={inputFichier}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={choisirPhoto}
                  className="profil-fichier-cache"
                  aria-label="Sélectionner une image JPG, PNG ou WEBP de 2 Mo maximum"
                />
                <span className="profil-aide">JPG, PNG ou WEBP · 2 Mo maximum</span>
              </div>
            </div>
            {photoApercu && (
              <div className="profil-apercu-actions">
                <span>Aperçu non enregistré</span>
                <button type="button" className="btn secondary" onClick={annulerApercu} disabled={sauvegardePhoto}>
                  <X size={14} aria-hidden="true" /> Annuler l’aperçu
                </button>
                <button type="button" className="btn profil-bouton-principal" onClick={enregistrerPhoto} disabled={sauvegardePhoto}>
                  <Save size={14} aria-hidden="true" /> {sauvegardePhoto ? 'Enregistrement…' : 'Enregistrer la photo'}
                </button>
              </div>
            )}
            {message && (
              <div className="profil-notice profil-notice-succes" role="status">
                <CheckCircle2 size={15} aria-hidden="true" /> {message}
              </div>
            )}
            {erreurPhoto && <p className="profil-message-erreur" role="alert">{erreurPhoto}</p>}

            {peutModifier ? (
              <div className="profil-champs-grille profil-modal-champs">
                <label className="profil-champ">
                  <span>Prénom</span>
                  <input
                    value={form.prenom}
                    onChange={(event) => setForm((ancien) => ({ ...ancien, prenom: event.target.value }))}
                    required={Boolean(formOriginal.prenom)}
                    maxLength={100}
                    autoComplete="given-name"
                  />
                </label>
                <label className="profil-champ">
                  <span>Nom</span>
                  <input
                    value={form.nom}
                    onChange={(event) => setForm((ancien) => ({ ...ancien, nom: event.target.value }))}
                    required
                    maxLength={100}
                    autoComplete="family-name"
                  />
                </label>
                <label className="profil-champ profil-champ-large">
                  <span>Nom d’utilisateur</span>
                  <input
                    value={form.login}
                    onChange={(event) => setForm((ancien) => ({ ...ancien, login: event.target.value }))}
                    required
                    maxLength={100}
                    autoComplete="username"
                  />
                </label>
              </div>
            ) : (
              <p className="profil-lecture-seule">Vous pouvez gérer votre photo de profil. La modification des informations du compte requiert la permission de gestion utilisateur.</p>
            )}

            {erreur && <p className="profil-message-erreur" role="alert">{erreur}</p>}
            {fichierPhoto && peutModifier && (
              <p className="profil-aide">Enregistrez ou annulez l’aperçu photo avant de valider les autres modifications.</p>
            )}
            {peutModifier && (
              <div className="profil-modal-actions">
                <button type="button" className="btn secondary" onClick={annulerModification} disabled={sauvegarde || sauvegardePhoto}>
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn profil-bouton-principal"
                  disabled={sauvegarde || sauvegardePhoto || Boolean(fichierPhoto) || !formulaireModifie || !form.nom.trim() || !form.login.trim()}
                >
                  <Save size={15} aria-hidden="true" /> {sauvegarde ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            )}
            {!peutModifier && (
              <div className="profil-modal-actions">
                <button type="button" className="btn secondary" onClick={annulerModification}>Fermer</button>
              </div>
            )}
          </form>
        </Modal>
      )}

      {confirmerSuppression && (
        <Modal titre="Supprimer la photo de profil" onClose={() => setConfirmerSuppression(false)} largeur={400}>
          <p style={{ marginTop: 0 }}>Voulez-vous supprimer votre photo de profil ?</p>
          <div className="profil-modal-actions">
            <button type="button" className="btn secondary" onClick={() => setConfirmerSuppression(false)} disabled={suppressionPhoto}>
              Annuler
            </button>
            <button type="button" className="btn danger" onClick={supprimerPhoto} disabled={suppressionPhoto}>
              <Trash2 size={15} aria-hidden="true" /> {suppressionPhoto ? 'Suppression…' : 'Supprimer la photo'}
            </button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
