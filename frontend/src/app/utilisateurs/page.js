'use client';

// GESTION DES UTILISATEURS (RH/ADMIN) — architecture Utilisateur -> Role -> Permissions.
// Le nom ne determine JAMAIS le role : le RH choisit explicitement le role, le
// service (si necessaire) et les permissions (cases a cocher, defauts proposes
// selon le role). La vraie protection est cote backend : chaque route verifie
// la permission en base a chaque requete (requirePermission).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Pencil, Power, Search, User } from 'lucide-react';
import AppShell from '@/components/AppShell';
import Modal from '@/components/Modal';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

// REGLE PROJET : l'Employe ne possede pas de compte et ne se connecte pas.
// Les seuls roles connectables sont ADMIN, RH et CHEF_SERVICE.
const ROLES = {
  ADMIN: 'Administrateur',
  RH: 'RH',
  CHEF_SERVICE: 'Chef de service',
};

const FORM_VIDE = {
  nom: '',
  prenom: '',
  login: '',
  mot_de_passe: '',
  confirmation: '',
  role: 'CHEF_SERVICE',
  id_service: '',
  id_employe: '',
  permissions: [],
};

function libelleRole(role) {
  return ROLES[role] || role;
}

function classeBadgeRole(role) {
  return {
    ADMIN: 'badge VALIDE',
    RH: 'badge SOUMIS',
    CHEF_SERVICE: 'badge BROUILLON',
  }[role] || 'badge';
}

export default function UtilisateursPage() {
  const [users, setUsers] = useState([]);
  const [services, setServices] = useState([]);
  const [catalogue, setCatalogue] = useState([]); // [{ code, nom }]
  const [defautsParRole, setDefautsParRole] = useState({});
  const [recherche, setRecherche] = useState('');
  const [filtreRole, setFiltreRole] = useState('');
  const [filtreActif, setFiltreActif] = useState('');
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
    // La vraie protection reste cote serveur (permission user.view en base).
    const t = getToken();
    const u = getUser();
    if (!t) {
      router.replace('/login');
      return;
    }
    if (!['RH', 'ADMIN'].includes(u?.role)) {
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
      const [us, svcs, perms] = await Promise.all([
        api.get('/auth/users', tokenActuel),
        api.get('/services', tokenActuel),
        api.get('/auth/permissions', tokenActuel),
      ]);
      setUsers(us);
      setServices(svcs);
      setCatalogue(perms.catalogue || []);
      setDefautsParRole(perms.defauts_par_role || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const usersFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return users.filter((u) => {
      if (filtreRole && u.role !== filtreRole) return false;
      if (filtreActif === 'actif' && !u.actif) return false;
      if (filtreActif === 'inactif' && u.actif) return false;
      if (!q) return true;
      return [u.nom, u.prenom, u.login, u.nom_service, libelleRole(u.role), ...(u.permissions || [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [users, recherche, filtreRole, filtreActif]);

  // Statistiques compactes — uniquement des comptages des donnees reelles.
  const statsUsers = useMemo(() => {
    const parRole = { ADMIN: 0, RH: 0, CHEF_SERVICE: 0 };
    let actifs = 0;
    for (const u of users) {
      if (parRole[u.role] !== undefined) parRole[u.role] += 1;
      if (u.actif) actifs += 1;
    }
    return { total: users.length, parRole, actifs };
  }, [users]);

  function setChamp(champ, valeur) {
    setForm((f) => ({ ...f, [champ]: valeur }));
  }

  // Changement de role : on PROPOSE les permissions par defaut du role
  // (modifiables case par case ensuite — le role n'impose rien).
  function changerRole(role) {
    setForm((f) => ({ ...f, role, permissions: [...(defautsParRole[role] || [])] }));
  }

  function basculerPermission(code) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(code)
        ? f.permissions.filter((c) => c !== code)
        : [...f.permissions, code],
    }));
  }

  function ouvrirAjout() {
    setError('');
    setSucces('');
    setEditId(null);
    setForm({ ...FORM_VIDE, permissions: [...(defautsParRole.CHEF_SERVICE || [])] });
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
      confirmation: '',
      role: u.role,
      id_service: u.id_service ? String(u.id_service) : '',
      id_employe: u.id_employe ? String(u.id_employe) : '',
      permissions: [...(u.permissions || [])],
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
    if (form.mot_de_passe !== form.confirmation) {
      setError('La confirmation du mot de passe ne correspond pas.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        nom: form.nom,
        prenom: form.prenom,
        login: form.login,
        role: form.role,
        id_service: form.id_service ? Number(form.id_service) : null,
        permissions: form.permissions,
      };
      if (form.mot_de_passe) body.mot_de_passe = form.mot_de_passe;
      if (form.id_employe) body.id_employe = Number(form.id_employe);

      if (mode === 'create') {
        await api.post('/auth/users', body, token);
        setSucces(`Compte ${libelleRole(form.role)} créé.`);
      } else {
        await api.put(`/auth/users/${editId}`, body, token);
        setSucces('Compte mis à jour (permissions incluses).');
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
  const toutCocher = () => setChamp('permissions', catalogue.map((p) => p.code));
  const toutDecocher = () => setChamp('permissions', []);

  return (
<AppShell>
      <div className="container">
        <div className="tete-page">
          <div>
            <h1 style={{ margin: 0 }}>Gestion des utilisateurs</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Comptes, rôles et permissions (vérifiées côté backend à chaque requête).
            </p>
          </div>
          {!mode && (
            <button className="btn btn-ajout" onClick={ouvrirAjout}><UserPlus size={15} aria-hidden="true" /> Ajouter un utilisateur</button>
          )}
        </div>

        {/* Statistiques compactes (comptages reels) */}
        <div className="dash-stats">
          <div className="dash-stat dash-stat-gris">
            <div className="stat-icone"><User size={18} aria-hidden="true" /></div>
            <div className="valeur">{statsUsers.total}</div>
            <div className="libelle">Total utilisateurs</div>
          </div>
          <div className="dash-stat dash-stat-bleu">
            <div className="valeur">{statsUsers.parRole.ADMIN}</div>
            <div className="libelle">Administrateurs</div>
          </div>
          <div className="dash-stat dash-stat-orange">
            <div className="valeur">{statsUsers.parRole.RH}</div>
            <div className="libelle">RH</div>
          </div>
          <div className="dash-stat">
            <div className="valeur">{statsUsers.parRole.CHEF_SERVICE}</div>
            <div className="libelle">Chefs de service</div>
          </div>
          <div className="dash-stat dash-stat-vert">
            <div className="valeur">{statsUsers.actifs}</div>
            <div className="libelle">Utilisateurs actifs</div>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
        {succes && <div className="bandeau-succes">{succes}</div>}

        {mode && (
          <Modal
            titre={mode === 'create' ? 'Ajouter un utilisateur' : `Modifier : ${form.nom || ''}`}
            onClose={fermerFormulaire}
            largeur={720}
          >
            <form onSubmit={handleSubmit}>
              {/* === Section : Informations du compte === */}
              <h4>Informations du compte</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <div className="form-row">
                  <label>Nom</label>
                  <input value={form.nom} onChange={(e) => setChamp('nom', e.target.value)} required />
                </div>
                <div className="form-row">
                  <label>Prénom</label>
                  <input value={form.prenom} onChange={(e) => setChamp('prenom', e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Identifiant (login)</label>
                  <input value={form.login} onChange={(e) => setChamp('login', e.target.value)} required />
                </div>
                <div className="form-row">
                  <label>{mode === 'create' ? 'Mot de passe (6 caractères min.)' : 'Nouveau mot de passe (vide = inchangé)'}</label>
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
                  <label>Confirmation du mot de passe</label>
                  <input
                    type="password"
                    value={form.confirmation}
                    onChange={(e) => setChamp('confirmation', e.target.value)}
                    required={mode === 'create'}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {/* === Section : Rôle === */}
              <h4>Rôle</h4>
              <div className="form-row" style={{ maxWidth: 320 }}>
                <select value={form.role} onChange={(e) => changerRole(e.target.value)}>
                  {Object.entries(ROLES).map(([code, libelle]) => (
                    <option key={code} value={code}>{libelle}</option>
                  ))}
                </select>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                {form.role === 'CHEF_SERVICE'
                  ? 'Un Chef de service est rattaché à UN seul service : il ne verra que ses employés et ses plannings.'
                  : form.role === 'RH'
                    ? 'La RH gère le personnel, les services, la validation des plannings et les comptes.'
                    : 'L\'Administrateur a un accès global selon les permissions attribuées.'}
              </p>

              {/* === Section : Service === */}
              <h4>Service</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <div className="form-row">
                  <label>Service {form.role === 'CHEF_SERVICE' ? '(obligatoire)' : '(facultatif)'}</label>
                  <select
                    value={form.id_service}
                    onChange={(e) => setChamp('id_service', e.target.value)}
                    required={form.role === 'CHEF_SERVICE'}
                  >
                    <option value="">-- aucun --</option>
                    {services.map((s) => (
                      <option key={s.id_service} value={s.id_service}>{s.nom}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* === Section : Permissions === */}
              <h4>Permissions</h4>
              <p className="muted" style={{ fontSize: 12 }}>
                Le rôle ne fait que proposer des permissions par défaut : décochez ou cochez librement.
                Chaque permission correspond à une fonctionnalité réelle vérifiée côté backend.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button type="button" className="btn secondary" onClick={toutCocher}>Tout sélectionner</button>
                <button type="button" className="btn secondary" onClick={toutDecocher}>Tout désélectionner</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 6 }}>
                {catalogue.map((p) => (
                  <label key={p.code} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(p.code)}
                      onChange={() => basculerPermission(p.code)}
                    />
                    <span>
                      <strong>{p.nom}</strong>
                      <span className="muted"> — {p.code}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn secondary" onClick={fermerFormulaire}>
                  Annuler
                </button>
                <button className="btn" type="submit" disabled={saving}>
                  {saving ? 'Enregistrement...' : mode === 'create' ? 'Créer le compte' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* === Tableau des utilisateurs === */}
        <div className="card">
          <div className="arch-filtres">
            <div className="form-row" style={{ flex: 1, minWidth: 220 }}>
              <input
                placeholder="Rechercher (nom, prénom, login, rôle, service, permission)..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
            </div>
            <div className="form-row" style={{ width: 'auto' }}>
              <select value={filtreRole} onChange={(e) => setFiltreRole(e.target.value)}>
                <option value="">Tous les rôles</option>
                {Object.entries(ROLES).map(([code, libelle]) => (
                  <option key={code} value={code}>{libelle}</option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ width: 'auto' }}>
              <select value={filtreActif} onChange={(e) => setFiltreActif(e.target.value)}>
                <option value="">Actifs et inactifs</option>
                <option value="actif">Actifs uniquement</option>
                <option value="inactif">Inactifs uniquement</option>
              </select>
            </div>
          </div>

          {loading ? (
            <p className="muted">Chargement...</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Utilisateur</th>
                    <th>Rôle</th>
                    <th>Service</th>
                    <th>Permissions</th>
                    <th>Statut</th>
                    <th>Créé le</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersFiltres.map((u) => {
                    const initiales = [u.prenom, u.nom].filter(Boolean).join(' ')
                      .split(' ').map((m) => m[0]).join('').slice(0, 2).toUpperCase()
                      || (u.login || '?').slice(0, 2).toUpperCase();
                    return (
                      <tr key={u.id_utilisateur}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="badge VALIDE" style={{ minWidth: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: 700 }} aria-hidden="true">
                              {initiales}
                            </span>
                            <span>
                              <strong>{[u.prenom, u.nom].filter(Boolean).join(' ') || u.login}</strong>
                              <div className="muted" style={{ fontSize: 12 }}>{u.login}</div>
                            </span>
                          </div>
                        </td>
                        <td><span className={classeBadgeRole(u.role)}>{libelleRole(u.role)}</span></td>
                        <td>{u.nom_service || <span className="muted">—</span>}</td>
                        <td>
                          <span className="muted" style={{ fontSize: 12 }} title={(u.permissions || []).join(', ')}>
                            {(u.permissions || []).length} permission(s)
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${u.actif ? 'VALIDE' : 'REJETE'}`}>
                            {u.actif ? 'Actif' : 'Inactif'}
                          </span>
                        </td>
                        <td>
                          {u.date_creation ? (
                            <span className="muted" style={{ fontSize: 12.5 }}>
                              {String(u.date_creation).slice(0, 10).split('-').reverse().join('/')}
                            </span>
                          ) : <span className="muted">—</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn-icone" title="Modifier" onClick={() => ouvrirModification(u)}>
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                          {!estMoi(u) && (
                            <button
                              className="btn-icone"
                              style={{ marginLeft: 6 }}
                              title={u.actif ? 'Désactiver' : 'Réactiver'}
                              onClick={() => basculerStatut(u)}
                            >
                              <Power size={15} aria-hidden="true" style={{ color: u.actif ? 'var(--c-danger)' : 'var(--c-ok)' }} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {usersFiltres.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">Aucun utilisateur trouvé.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
