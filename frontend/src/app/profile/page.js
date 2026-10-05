'use client';

// PAGE PROFIL — page permanente et complete (inspiree des profils modernes,
// design propre a Zomatel : couverture sobre, avatar rond, cartes aerees).
// - Infos : session + API existantes (GET /auth/me, GET /auth/permissions,
//   GET /services). Aucune donnee inventee.
// - Photo : PUT /api/auth/profile/photo + DELETE (id pris du JWT cote serveur).
// - Apercu local immediat (URL.createObjectURL) AVANT enregistrement.
// - Bouton « Modifier le profil » : déplie le formulaire d'infos modifiables.
//   NB : PUT /auth/users/:id exige la permission user.update (RH/ADMIN) —
//   pour un compte sans cette permission, le formulaire n'est pas propose
//   (aucun contournement des permissions).

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  User, ShieldCheck, Camera, Trash2, Save, X, CircleCheck, Pencil, KeyRound,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { getToken, getUser, saveSession } from '@/lib/auth';

const LIBELLES_ROLE = {
  ADMIN: 'Administrateur',
  RH: 'Ressources Humaines',
  CHEF_SERVICE: 'Chef de service',
};

// URL absolue de la photo (chemin relatif servi par le serveur API).
function urlPhoto(chemin) {
  if (!chemin) return null;
  if (chemin.startsWith('http')) return chemin;
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api')
    .replace(/\/api\/?$/, '');
  return `${base}${chemin}`;
}

export default function ProfilPage() {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [nomService, setNomService] = useState('');
  const [photoActuelle, setPhotoActuelle] = useState(null);
  const [apercu, setApercu] = useState(null);
  const [fichierChoisi, setFichierChoisi] = useState(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [message, setMessage] = useState('');
  const [erreurPhoto, setErreurPhoto] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Mode modification des infos (visible selon permission user.update)
  const [modifOuverte, setModifOuverte] = useState(false);
  const [peutModifier, setPeutModifier] = useState(false);
  const [form, setForm] = useState({ nom: '', prenom: '' });
  const [savingInfos, setSavingInfos] = useState(false);
  const inputFichier = useRef(null);
  const router = useRouter();

  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace('/login');
      return;
    }
    const u = getUser();
    setUser(u);
    setPhotoActuelle(u?.photo_profil || null);

    (async () => {
      try {
        const [me, perms] = await Promise.all([
          api.get('/auth/me', t).catch(() => null),
          api.get('/auth/permissions', t).catch(() => null),
        ]);
        if (me?.user) {
          setUser((prev) => ({ ...(prev || {}), ...me.user }));
          setPhotoActuelle(me.user.photo_profil || null);
        }
        if (perms?.mes_permissions) {
          setPermissions(perms.mes_permissions);
          // Le bouton Modifier n'est affiche que si le compte possede
          // reellement la permission de mise a jour (source : catalogue RBAC).
          setPeutModifier(perms.mes_permissions.includes('user.update'));
          setForm({ nom: (me.user.nom || '').toString(), prenom: (me.user.prenom || '').toString() });
        }
        if (u?.id_service) {
          const services = await api.get('/services', t).catch(() => []);
          const s = (Array.isArray(services) ? services : []).find(
            (x) => Number(x.id_service) === Number(u.id_service)
          );
          if (s) setNomService(s.nom || '');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (apercu) URL.revokeObjectURL(apercu);
    };
  }, [apercu]);

  // ---------- Photo ----------
  function choisirFichier(e) {
    setErreurPhoto('');
    setMessage('');
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    const typesOk = ['image/jpeg', 'image/png', 'image/webp'];
    if (!typesOk.includes(fichier.type)) {
      setErreurPhoto('Format refusé : choisissez une image JPG, PNG ou WEBP.');
      return;
    }
    if (fichier.size > 2 * 1024 * 1024) {
      setErreurPhoto('Image trop volumineuse (maximum 2 Mo).');
      return;
    }
    if (apercu) URL.revokeObjectURL(apercu);
    setFichierChoisi(fichier);
    setApercu(URL.createObjectURL(fichier));
  }

  function annulerPhoto() {
    if (apercu) URL.revokeObjectURL(apercu);
    setApercu(null);
    setFichierChoisi(null);
    setErreurPhoto('');
  }

  async function enregistrerPhoto() {
    if (!fichierChoisi) return;
    setEnregistrement(true);
    setErreurPhoto('');
    setMessage('');
    try {
      const data = await api.uploadPhoto('/auth/profile/photo', fichierChoisi, getToken());
      setPhotoActuelle(data.photo_profil);
      const u = getUser();
      if (u) saveSession(getToken(), { ...u, photo_profil: data.photo_profil });
      annulerPhoto();
      setMessage(data.message || 'Photo mise à jour.');
    } catch (err) {
      setErreurPhoto(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  async function supprimerPhoto() {
    if (!confirm('Supprimer votre photo de profil ?')) return;
    setErreurPhoto('');
    setMessage('');
    try {
      await api.delete('/auth/profile/photo', getToken());
      setPhotoActuelle(null);
      annulerPhoto();
      const u = getUser();
      if (u) saveSession(getToken(), { ...u, photo_profil: null });
      setMessage('Photo supprimée.');
    } catch (err) {
      setErreurPhoto(err.message);
    }
  }

  // ---------- Infos (si permission user.update) ----------
  async function enregistrerInfos(e) {
    e.preventDefault();
    if (!user?.id_utilisateur) return;
    setSavingInfos(true);
    setMessage('');
    setError('');
    try {
      await api.put(
        `/auth/users/${user.id_utilisateur}`,
        { nom: form.nom.trim(), prenom: form.prenom.trim() },
        getToken()
      );
      const maj = { ...user, nom: form.nom.trim(), prenom: form.prenom.trim() };
      setUser(maj);
      saveSession(getToken(), maj);
      setModifOuverte(false);
      setMessage('Informations mises à jour.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingInfos(false);
    }
  }

  if (loading && !user) {
    return (
      <AppShell>
        <div className="container"><p className="muted">Chargement...</p></div>
      </AppShell>
    );
  }

  const nomComplet = [user?.prenom, user?.nom].filter(Boolean).join(' ') || user?.nom_utilisateur || user?.login || '—';
  const photoAffichee = apercu || urlPhoto(photoActuelle);
  const initiales = (user?.prenom || user?.nom || user?.nom_utilisateur || '?')
    .split(' ').map((m) => m[0]).join('').slice(0, 2).toUpperCase();

  return (
    <AppShell>
      <div className="container">
        {/* ===== En-tete du profil (couverture sobre + avatar rond) ===== */}
        <div className="pf-couverture" role="img" aria-label="Couverture du profil">
          <span className="pf-monogramme" aria-hidden="true">{initiales}</span>
        </div>

        <div className="pf-tete">
          <div className="pf-avatar-zone">
            {photoAffichee ? (
              <img src={photoAffichee} alt="Photo de profil" className="pf-avatar" />
            ) : (
              <span className="pf-avatar pf-avatar-defaut" aria-hidden="true"><User size={44} /></span>
            )}
            {/* Action rapide façon messageries modernes : camera sur l'avatar
                (le detail et la suppression restent dans la carte Photo). */}
            <button
              type="button"
              className="pf-avatar-camera"
              onClick={() => inputFichier.current?.click()}
              disabled={enregistrement}
              title="Changer la photo de profil"
              aria-label="Changer la photo de profil"
            >
              <Camera size={15} aria-hidden="true" />
            </button>
            {apercu && <span className="pf-badge-apercu">aperçu</span>}
          </div>

          <div className="pf-identite">
            <h1 className="pf-nom">{nomComplet}</h1>
            <p className="pf-sous-titre">
              <span className={`badge ${user?.role}`}>{LIBELLES_ROLE[user?.role] || user?.role}</span>
              {user?.login && <span className="muted"> · {user.login}</span>}
              {nomService && <span className="muted"> · {nomService}</span>}
            </p>
          </div>

          <div className="pf-actions">
            {peutModifier && !modifOuverte && (
              <button className="btn" onClick={() => setModifOuverte(true)}>
                <Pencil size={14} aria-hidden="true" /> Modifier le profil
              </button>
            )}
          </div>
        </div>

        {message && (
          <div className="bandeau-succes" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CircleCheck size={14} aria-hidden="true" /> {message}
          </div>
        )}
        {error && <div className="error">{error}</div>}

        {/* ===== Formulaire de modification (permission user.update requise) ===== */}
        {peutModifier && modifOuverte && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Modifier mes informations</h3>
            <form onSubmit={enregistrerInfos}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div className="form-row">
                  <label>Nom</label>
                  <input
                    value={form.nom}
                    onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-row">
                  <label>Prénom</label>
                  <input
                    value={form.prenom}
                    onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))}
                  />
                </div>
              </div>
              <p className="muted" style={{ fontSize: 12.5 }}>
                Le login et le rôle ne sont pas modifiables ici.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" type="submit" disabled={savingInfos}>
                  <Save size={14} aria-hidden="true" /> {savingInfos ? 'Enregistrement...' : 'Enregistrer'}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => { setModifOuverte(false); setForm({ nom: user?.nom || '', prenom: user?.prenom || '' }); }}
                >
                  <X size={14} aria-hidden="true" /> Annuler
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ===== Photo ===== */}
        <div className="card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Camera size={16} aria-hidden="true" /> Photo de profil
          </h3>
          {erreurPhoto && <div className="error">{erreurPhoto}</div>}
          <div className="profil-photo-zone">
            {photoAffichee ? (
              <img src={photoAffichee} alt="Photo de profil" className="profil-photo-img" />
            ) : (
              <span className="profil-avatar-grand" aria-hidden="true"><User size={30} /></span>
            )}
            <div className="profil-photo-actions">
              {apercu && (
                <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
                  Aperçu non enregistré — cliquez sur « Enregistrer » pour valider.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => inputFichier.current?.click()}
                  disabled={enregistrement}
                >
                  <Camera size={14} aria-hidden="true" /> {photoActuelle ? 'Remplacer' : 'Choisir une image'}
                </button>
                {apercu && (
                  <>
                    <button className="btn" onClick={enregistrerPhoto} disabled={enregistrement}>
                      <Save size={14} aria-hidden="true" /> {enregistrement ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                    <button className="btn secondary" onClick={annulerPhoto} disabled={enregistrement}>
                      <X size={14} aria-hidden="true" /> Annuler
                    </button>
                  </>
                )}
                {photoActuelle && !apercu && (
                  <button className="btn danger" onClick={supprimerPhoto} disabled={enregistrement}>
                    <Trash2 size={14} aria-hidden="true" /> Supprimer
                  </button>
                )}
              </div>
              <input
                ref={inputFichier}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={choisirFichier}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        </div>

        {/* ===== Informations ===== */}
        <div className="card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={16} aria-hidden="true" /> Informations
          </h3>
          <dl className="fiche-lignes">
            <div>
              <dt>Nom</dt>
              <dd>{user?.nom_utilisateur || user?.nom || '—'}</dd>
            </div>
            <div>
              <dt>Prénom</dt>
              <dd>{user?.prenom || '—'}</dd>
            </div>
            <div>
              <dt>Identifiant (login)</dt>
              <dd>{user?.login || '—'}</dd>
            </div>
            <div>
              <dt>Rôle</dt>
              <dd>{LIBELLES_ROLE[user?.role] || user?.role || '—'}</dd>
            </div>
            {user?.id_service ? (
              <div>
                <dt>Service</dt>
                <dd>{nomService || `#${user.id_service}`}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {/* ===== Permissions reelles ===== */}
        <div className="card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={16} aria-hidden="true" /> Permissions
          </h3>
          {permissions.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Aucune information de permission disponible.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {permissions.map((code) => (
                <span key={code} className="badge VALIDE" style={{ fontSize: 12 }}>{code}</span>
              ))}
            </div>
          )}
          <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>
            Gérées par la RH/Administrateur : <KeyRound size={12} aria-hidden="true" /> <strong>Gestion utilisateurs</strong>.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
