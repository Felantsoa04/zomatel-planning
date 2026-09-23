'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RetourButton from '@/components/RetourButton';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

// REGLE METIER : la creation de comptes est reservee aux CHEFS DE SERVICE.
// Le backend (POST /api/auth/users) impose lui-meme le role 'CHEF_SERVICE' et
// exige un service unique ; l'interface suit exactement ce contrat.
const ROLES = {
  CHEF_SERVICE: 'Chef de service',
  RH: 'RH',
  ADMIN: 'Administrateur',
  EMPLOYE: 'Employé',
};

const FORM_VIDE = {
  nom: '',
  prenom: '',
  login: '',
  mot_de_passe: '',
  id_service: '',
};

function libelleRole(role) {
  return ROLES[role] || role;
}

export default function UtilisateursPage() {
  const [users, setUsers] = useState([]);
  const [services, setServices] = useState([]);
  const [recherche, setRecherche] = useState('');
  const [mode, setMode] = useState(null); // null | 'create' | 'edit'
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(FORM_VIDE);
  const [error, setError] = useState('');
  const [succes, setSucces] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const router = useRouter();

  useEffect(() => {
    // Session lue apres montage (pas de localStorage au rendu serveur).
    // La vraie protection reste cote serveur (requireRole('RH', 'ADMIN')).
    const t = getToken();
    const u = getUser();
    if (!t) {
      router.replace('/login');
      return;
    }
    if (!u || !['RH', 'ADMIN'].includes(u.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(u);
    setToken(t);
    charger(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function charger(tokenActuel) {
    try {
      const [us, svcs] = await Promise.all([
        api.get('/auth/users', tokenActuel),
        api.get('/services', tokenActuel),
      ]);
      setUsers(us);
      setServices(svcs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const usersFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.nom, u.prenom, u.login, u.nom_service, libelleRole(u.role)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [users, recherche]);

  function setChamp(champ, valeur) {
    setForm((f) => ({ ...f, [champ]: valeur }));
  }

  function ouvrirAjout() {
    setError('');
    setSucces('');
    setEditId(null);
    setForm(FORM_VIDE);
    setMode('create');
  }

  function ouvrirModification(u) {
    setError('');
    setSucces('');
    setEditId(u.id_utilisateur);
    setForm({
      nom: u.nom || '',
      prenom: u.prenom || '',
      login: u.login || '',
      mot_de_passe: '',
      id_service: u.id_service ? String(u.id_service) : '',
    });
    setMode('edit');
  }

  function fermerFormulaire() {
    setMode(null);
    setEditId(null);
    setForm(FORM_VIDE);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSucces('');
    setSaving(true);
    try {
      // Le role est impose par le backend : seul CHEF_SERVICE est cree/modifie ici.
      const body = {
        nom: form.nom,
        prenom: form.prenom,
        login: form.login,
        id_service: form.id_service ? Number(form.id_service) : null,
      };
      if (form.mot_de_passe) body.mot_de_passe = form.mot_de_passe;

      if (mode === 'create') {
        await api.post('/auth/users', body, token);
        setSucces('Compte créé.');
      } else {
        await api.put(`/auth/users/${editId}`, body, token);
        setSucces('Compte mis à jour.');
      }
      fermerFormulaire();
      await charger(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function basculerStatut(u) {
    setError('');
    setSucces('');
    const nomComplet = [u.prenom, u.nom].filter(Boolean).join(' ');
    try {
      if (u.actif) {
        if (!confirm(`Désactiver le compte de ${nomComplet} ? Il ne pourra plus se connecter (les données sont conservées).`)) return;
        await api.delete(`/auth/users/${u.id_utilisateur}`, token);
        setSucces('Compte désactivé.');
      } else {
        await api.put(`/auth/users/${u.id_utilisateur}`, { actif: true }, token);
        setSucces('Compte réactivé.');
      }
      await charger(token);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) return null;

  const estMoi = (u) => u.id_utilisateur === user.id_utilisateur;

  return (
    <div>
      <Navbar />
      <div className="container">
        <RetourButton
          fallback="/dashboard"
          hasUnsaved={!!(mode || form.nom || form.prenom || form.login || form.mot_de_passe)}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Gestion des utilisateurs</h1>
          {!mode && (
            <button className="btn" onClick={ouvrirAjout}>+ Créer un Chef de service</button>
          )}
        </div>

        <p className="muted">
          Seuls les comptes <strong>Chef de service</strong> sont créés ici, rattachés à UN seul
          service : après connexion, le chef ne voit et ne gère que les employés et plannings de
          son propre service (restriction appliquée côté backend).
        </p>

        {error && <div className="error">{error}</div>}
        {succes && (
          <div style={{ color: '#166534', background: '#dcfce7', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            {succes}
          </div>
        )}

        {mode && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>
              {mode === 'create' ? 'Créer un compte Chef de service' : 'Modifier le compte Chef de service'}
            </h3>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-row">
                  <label>Nom</label>
                  <input value={form.nom} onChange={(e) => setChamp('nom', e.target.value)} required />
                </div>
                <div className="form-row">
                  <label>Prénom</label>
                  <input value={form.prenom} onChange={(e) => setChamp('prenom', e.target.value)} required />
                </div>
                <div className="form-row">
                  <label>Identifiant (login)</label>
                  <input value={form.login} onChange={(e) => setChamp('login', e.target.value)} required />
                </div>
                <div className="form-row">
                  <label>
                    {mode === 'create' ? 'Mot de passe (6 caractères min.)' : 'Nouveau mot de passe (vide = inchangé)'}
                  </label>
                  <input
                    type="password"
                    value={form.mot_de_passe}
                    onChange={(e) => setChamp('mot_de_passe', e.target.value)}
                    required={mode === 'create'}
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                <div className="form-row">
                  <label>Rôle (imposé)</label>
                  <input value="Chef de service" disabled />
                </div>
                <div className="form-row">
                  <label>Service (unique)</label>
                  <select value={form.id_service} onChange={(e) => setChamp('id_service', e.target.value)} required>
                    <option value="">-- choisir --</option>
                    {services.map((s) => (
                      <option key={s.id_service} value={s.id_service}>{s.nom}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Enregistrement...' : mode === 'create' ? 'Créer le compte' : 'Enregistrer'}
              </button>
              <button type="button" className="btn secondary" style={{ marginLeft: 8 }} onClick={fermerFormulaire}>
                Annuler
              </button>
            </form>
          </div>
        )}

        <div className="card">
          <div className="form-row">
            <input
              placeholder="Rechercher (nom, prénom, login, rôle, service)..."
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
          </div>

          {loading ? (
            <p className="muted">Chargement...</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Prénom</th>
                  <th>Login</th>
                  <th>Rôle</th>
                  <th>Service</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {usersFiltres.map((u) => (
                  <tr key={u.id_utilisateur}>
                    <td>{u.nom}</td>
                    <td>{u.prenom || '—'}</td>
                    <td>{u.login}</td>
                    <td>{libelleRole(u.role)}</td>
                    <td>{u.nom_service || <span className="muted">—</span>}</td>
                    <td>
                      <span className={`badge ${u.actif ? 'VALIDE' : 'REJETE'}`}>
                        {u.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td>
                      {u.role !== 'CHEF_SERVICE' ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          <button className="btn secondary" onClick={() => ouvrirModification(u)}>
                            Modifier
                          </button>
                          {!estMoi(u) && (
                            <button
                              className={`btn ${u.actif ? 'danger' : 'success'}`}
                              style={{ marginLeft: 8 }}
                              onClick={() => basculerStatut(u)}
                            >
                              {u.actif ? 'Désactiver' : 'Réactiver'}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {usersFiltres.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">Aucun utilisateur trouvé.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}