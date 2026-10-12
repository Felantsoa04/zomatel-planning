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
import { usePermissions } from '@/lib/permissions';

// REGLE PROJET : l'Employe ne possede pas de compte et ne se connecte pas.
// Les seuls roles connectables sont ADMIN, RH et CHEF_SERVICE.
const ROLES = {
  ADMIN: 'Administrateur',
  RH: 'RH',
  CHEF_SERVICE: 'Chef de service',
};

const GROUPES_PERMISSIONS = [
  {
    nom: 'Employés',
    permissions: [
      ['employe.manage', 'Ajouter / modifier / désactiver les employés'],
      ['employe.view', 'Consulter les employés'],
    ],
  },
  {
    nom: 'Messagerie',
    permissions: [['messenger.use', 'Utiliser la messagerie interne']],
  },
  {
    nom: 'Plannings',
    permissions: [
      ['planning.create', 'Créer un planning'],
      ['planning.delete', 'Supprimer un planning'],
      ['planning.export_edt', "Exporter l'emploi du temps Excel (RH)"],
      ['planning.reopen', 'Rouvrir un planning valide'],
      ['planning.submit', 'Soumettre un planning à la RH'],
      ['planning.update', "Modifier la grille d'un planning"],
      ['planning.validate', 'Valider / refuser un planning'],
      ['planning.view', 'Consulter les plannings de son périmètre'],
      ['planning.view_all', 'Consulter tous les plannings'],
    ],
  },
  {
    nom: 'Services',
    permissions: [['service.manage', 'Gérer les services']],
  },
  {
    nom: 'Utilisateurs',
    permissions: [
      ['user.create', 'Créer un compte utilisateur'],
      ['user.update', 'Modifier / désactiver / réactiver un compte'],
      ['user.view', 'Consulter les comptes utilisateurs'],
    ],
  },
];

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
  const { autorise } = usePermissions();
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
        permissions: form.permissions,
      };
      if (!(mode === 'edit' && form.role === 'CHEF_SERVICE'
          && editId === user?.id_utilisateur)) {
        body.id_service = form.id_service ? Number(form.id_service) : null;
      }
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
  const catalogueParCode = new Map(catalogue.map((permission) => [permission.code, permission]));
  const permissionsGroupees = GROUPES_PERMISSIONS.map((groupe) => ({
    ...groupe,
    permissions: groupe.permissions
      .map(([code, nom]) => ({ ...catalogueParCode.get(code), code, nom }))
      .filter((permission) => catalogueParCode.has(permission.code)),
  })).filter((groupe) => groupe.permissions.length > 0);
  const codesGroupes = new Set(GROUPES_PERMISSIONS.flatMap((groupe) => groupe.permissions.map(([code]) => code)));
  const permissionsAutres = catalogue.filter((permission) => !codesGroupes.has(permission.code));

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
          {!mode && autorise('user.create') && (
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
            largeur={900}
            className="modal-utilisateur"
            sousTitre={mode === 'create' ? 'Créer un nouveau compte utilisateur' : 'Modifier les informations du compte'}
          >
            <form className="utilisateur-formulaire" onSubmit={handleSubmit}>
              {error && <div className="error utilisateur-formulaire-erreur" role="alert">{error}</div>}

              <div className="utilisateur-formulaire-haut">
                <section className="utilisateur-formulaire-section" aria-labelledby="utilisateur-informations-titre">
                  <h4 id="utilisateur-informations-titre">Informations du compte</h4>
                  <div className="utilisateur-champs">
                    <label className="utilisateur-champ">
                      <span>Nom</span>
                      <input value={form.nom} onChange={(e) => setChamp('nom', e.target.value)} required autoComplete="family-name" />
                    </label>
                    <label className="utilisateur-champ">
                      <span>Prénom</span>
                      <input value={form.prenom} onChange={(e) => setChamp('prenom', e.target.value)} autoComplete="given-name" />
                    </label>
                    <label className="utilisateur-champ">
                      <span>Identifiant</span>
                      <input value={form.login} onChange={(e) => setChamp('login', e.target.value)} required autoComplete="username" />
                    </label>
                    <label className="utilisateur-champ">
                      <span>Mot de passe</span>
                      <input
                        type="password"
                        value={form.mot_de_passe}
                        onChange={(e) => setChamp('mot_de_passe', e.target.value)}
                        required={mode === 'create'}
                        minLength={6}
                        autoComplete="new-password"
                      />
                      <small>{mode === 'create' ? '6 caractères min.' : 'Laisser vide pour conserver le mot de passe actuel.'}</small>
                    </label>
                    <label className="utilisateur-champ utilisateur-champ-large">
                      <span>Confirmation du mot de passe</span>
                      <input
                        type="password"
                        value={form.confirmation}
                        onChange={(e) => setChamp('confirmation', e.target.value)}
                        required={mode === 'create'}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                </section>

                <section className="utilisateur-formulaire-section utilisateur-role-service" aria-labelledby="utilisateur-role-titre">
                  <h4 id="utilisateur-role-titre">Rôle &amp; service</h4>
                  <fieldset className="utilisateur-roles">
                    <legend>Rôle</legend>
                    {Object.entries(ROLES).map(([code, libelle]) => (
                      <label className={`utilisateur-role-option${form.role === code ? ' selectionne' : ''}`} key={code}>
                        <input
                          type="radio"
                          name="role-utilisateur"
                          value={code}
                          checked={form.role === code}
                          onChange={() => changerRole(code)}
                        />
                        <span>{libelle}</span>
                      </label>
                    ))}
                  </fieldset>
                  {form.role === 'CHEF_SERVICE' && (
                    <p className="utilisateur-role-aide">Un Chef de service est limité à son service.</p>
                  )}
                  <label className="utilisateur-champ utilisateur-service-champ">
                    <span>Service{form.role === 'CHEF_SERVICE' ? ' (obligatoire)' : ''}</span>
                    <select
                      value={form.id_service}
                      onChange={(e) => setChamp('id_service', e.target.value)}
                      required={form.role === 'CHEF_SERVICE'}
                      disabled={mode === 'edit' && form.role === 'CHEF_SERVICE'
                        && editId === user?.id_utilisateur}
                    >
                      <option value="">-- aucun --</option>
                      {services.map((s) => (
                        <option key={s.id_service} value={s.id_service}>{s.nom}</option>
                      ))}
                    </select>
                  </label>
                </section>
              </div>

              <section className="utilisateur-permissions" aria-labelledby="utilisateur-permissions-titre">
                <div className="utilisateur-permissions-entete">
                  <div>
                    <h4 id="utilisateur-permissions-titre">Permissions</h4>
                    <p>Le rôle propose des permissions par défaut. Vous pouvez les modifier.</p>
                  </div>
                  <div className="utilisateur-permissions-actions">
                    <button type="button" className="btn secondary" onClick={toutCocher}>Tout sélectionner</button>
                    <button type="button" className="btn secondary" onClick={toutDecocher}>Tout désélectionner</button>
                  </div>
                </div>
                <div className="utilisateur-permissions-liste">
                  {permissionsGroupees.map((groupe) => (
                    <fieldset className="utilisateur-permission-groupe" key={groupe.nom}>
                      <legend>{groupe.nom}</legend>
                      {groupe.permissions.map((permission) => (
                        <label className="utilisateur-permission-option" key={permission.code}>
                          <input
                            type="checkbox"
                            checked={form.permissions.includes(permission.code)}
                            onChange={() => basculerPermission(permission.code)}
                          />
                          <span>{permission.nom}</span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  {permissionsAutres.length > 0 && (
                    <fieldset className="utilisateur-permission-groupe" key="autres">
                      <legend>Autres permissions</legend>
                      {permissionsAutres.map((permission) => (
                        <label className="utilisateur-permission-option" key={permission.code}>
                          <input
                            type="checkbox"
                            checked={form.permissions.includes(permission.code)}
                            onChange={() => basculerPermission(permission.code)}
                          />
                          <span>{permission.nom}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
              </section>

              <div className="utilisateur-formulaire-actions">
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
                    {autorise('user.update') && <th>Actions</th>}
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
                        {autorise('user.update') && <td style={{ whiteSpace: 'nowrap' }}>
                          {autorise('user.update') && (
                            <button className="btn-icone" title="Modifier" onClick={() => ouvrirModification(u)}>
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                          )}
                          {autorise('user.update') && !estMoi(u) && (
                            <button
                              className="btn-icone"
                              style={{ marginLeft: 6 }}
                              title={u.actif ? 'Désactiver' : 'Réactiver'}
                              onClick={() => basculerStatut(u)}
                            >
                              <Power size={15} aria-hidden="true" style={{ color: u.actif ? 'var(--c-danger)' : 'var(--c-ok)' }} />
                            </button>
                          )}
                        </td>}
                      </tr>
                    );
                  })}
                  {usersFiltres.length === 0 && (
                    <tr>
                      <td colSpan={autorise('user.update') ? 7 : 6} className="muted">Aucun utilisateur trouvé.</td>
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
