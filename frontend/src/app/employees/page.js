'use client';

// LISTE DES EMPLOYES + CRUD complet
// - RH : ajoute/modifie/desactive les employes de TOUS les services
// - CHEF_SERVICE : idem mais uniquement dans SON service (le backend verrouille :
//   id_service force, transfert refuse, desactivation hors service refusee)
// - EMPLOYE / autres : consultation refusee par l'API (403)
// Suppression = desactivation (soft delete) : aucune donnee effacee.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RetourButton from '@/components/RetourButton';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

const FORM_VIDE = {
  nom: '',
  matricule: '',
  statut: 'TITULAIRE',
  fonction: '',
  id_service: '',
  reference_hebdo: 44,
};

export default function EmployeesPage() {
  const [employes, setEmployes] = useState([]);
  const [services, setServices] = useState([]);
  const [form, setForm] = useState(FORM_VIDE);
  // edition = null (ferme) | { id_employe, ...champs }
  const [edition, setEdition] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const router = useRouter();

  const peutGerer = user?.role === 'RH' || user?.role === 'CHEF_SERVICE';
  const estChef = user?.role === 'CHEF_SERVICE';

  useEffect(() => {
    // Lu uniquement apres le montage cote client -> identique au HTML
    // du serveur au premier rendu (evite le mismatch d'hydratation).
    const t = getToken();

    if (!t) {
      router.replace('/login');
      return;
    }

    setUser(getUser());
    setToken(t);
    charger(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function charger(tokenActuel) {
    try {
      const [emps, svcs] = await Promise.all([
        api.get('/employes', tokenActuel),
        api.get('/services', tokenActuel),
      ]);
      setEmployes(emps);
      setServices(svcs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Recherche instantanee cote client (nom ou matricule) ; l'API supporte
  // aussi ?recherche= si l'on veut passer au filtrage serveur plus tard.
  const employesFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return employes;
    return employes.filter(
      (e) =>
        String(e.nom || '').toLowerCase().includes(q) ||
        String(e.matricule || '').toLowerCase().includes(q)
    );
  }, [employes, recherche]);

  function resetMessages() {
    setError('');
    setMessage('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetMessages();
    try {
      await api.post('/employes', { ...form, id_service: Number(form.id_service) }, token);
      setMessage(`Employe ${form.nom} ajoute.`);
      setForm(FORM_VIDE);
      await charger(token);
    } catch (err) {
      setError(err.message);
    }
  }

  function ouvrirEdition(emp) {
    resetMessages();
    setEdition({
      id_employe: emp.id_employe,
      nom: emp.nom || '',
      matricule: emp.matricule || '',
      statut: emp.statut || 'TITULAIRE',
      fonction: emp.fonction || '',
      id_service: emp.id_service ? String(emp.id_service) : '',
      reference_hebdo: emp.reference_hebdo || 44,
    });
  }

  async function enregistrerEdition(ev) {
    ev.preventDefault();
    resetMessages();
    try {
      await api.put(
        `/employes/${edition.id_employe}`,
        { ...edition, id_service: Number(edition.id_service) },
        token
      );
      setMessage(`Employe ${edition.nom} mis a jour.`);
      setEdition(null);
      await charger(token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function desactiverEmploye(emp) {
    if (!confirm(`Desactiver l'employe ${emp.nom} ? Il disparaitra des listes actives (ses donnees sont conservees).`)) return;
    resetMessages();
    try {
      await api.delete(`/employes/${emp.id_employe}`, token);
      setMessage(`Employe ${emp.nom} desactive.`);
      await charger(token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <Navbar />
      <div className="container">
        <RetourButton fallback="/dashboard" hasUnsaved={!!(form.nom || edition)} />
        <h1>Employes</h1>
        {error && <div className="error">{error}</div>}
        {message && (
          <div style={{ color: '#166534', background: '#dcfce7', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            {message}
          </div>
        )}

        {(user?.role === 'RH' || user?.role === 'CHEF_SERVICE') && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Ajouter un employe</h3>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-row">
                  <label>Nom</label>
                  <input
                    value={form.nom}
                    onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-row">
                  <label>Matricule (optionnel, vide pour stagiaire)</label>
                  <input
                    value={form.matricule}
                    onChange={(e) => setForm((f) => ({ ...f, matricule: e.target.value }))}
                  />
                </div>
                <div className="form-row">
                  <label>Statut</label>
                  <select
                    value={form.statut}
                    onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))}
                  >
                    <option value="TITULAIRE">Titulaire</option>
                    <option value="STAGIAIRE">Stagiaire</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Fonction</label>
                  <input
                    value={form.fonction}
                    onChange={(e) => setForm((f) => ({ ...f, fonction: e.target.value }))}
                  />
                </div>
                <div className="form-row">
                  <label>Service {estChef && '(fixe : votre service)'}</label>
                  <select
                    value={form.id_service}
                    onChange={(e) => setForm((f) => ({ ...f, id_service: e.target.value }))}
                    required
                    disabled={estChef}
                  >
                    <option value="">-- choisir --</option>
                    {services.map((s) => (
                      <option key={s.id_service} value={s.id_service}>
                        {s.nom}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label>Reference hebdo (h)</label>
                  <select
                    value={form.reference_hebdo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, reference_hebdo: Number(e.target.value) }))
                    }
                  >
                    <option value={44}>44</option>
                    <option value={48}>48</option>
                  </select>
                </div>
              </div>
              <button className="btn" type="submit">
                Ajouter
              </button>
            </form>
          </div>
        )}

        {/* ---------- Modification (formulaire inline) ---------- */}
        {peutGerer && edition && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Modifier l&apos;employe #{edition.id_employe}</h3>
            <form onSubmit={enregistrerEdition}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-row">
                  <label>Nom</label>
                  <input
                    value={edition.nom}
                    onChange={(e) => setEdition((f) => ({ ...f, nom: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-row">
                  <label>Matricule</label>
                  <input
                    value={edition.matricule}
                    onChange={(e) => setEdition((f) => ({ ...f, matricule: e.target.value }))}
                  />
                </div>
                <div className="form-row">
                  <label>Statut</label>
                  <select
                    value={edition.statut}
                    onChange={(e) => setEdition((f) => ({ ...f, statut: e.target.value }))}
                  >
                    <option value="TITULAIRE">Titulaire</option>
                    <option value="STAGIAIRE">Stagiaire</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Fonction</label>
                  <input
                    value={edition.fonction}
                    onChange={(e) => setEdition((f) => ({ ...f, fonction: e.target.value }))}
                  />
                </div>
                <div className="form-row">
                  <label>Service {estChef && '(fixe : votre service)'}</label>
                  <select
                    value={edition.id_service}
                    onChange={(e) => setEdition((f) => ({ ...f, id_service: e.target.value }))}
                    required
                    disabled={estChef}
                  >
                    <option value="">-- choisir --</option>
                    {services.map((s) => (
                      <option key={s.id_service} value={s.id_service}>
                        {s.nom}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label>Reference hebdo (h)</label>
                  <select
                    value={edition.reference_hebdo}
                    onChange={(e) =>
                      setEdition((f) => ({ ...f, reference_hebdo: Number(e.target.value) }))
                    }
                  >
                    <option value={44}>44</option>
                    <option value={48}>48</option>
                  </select>
                </div>
              </div>
              <button className="btn" type="submit">Enregistrer</button>
              <button
                className="btn secondary"
                type="button"
                style={{ marginLeft: 8 }}
                onClick={() => setEdition(null)}
              >
                Annuler
              </button>
            </form>
          </div>
        )}

        <div className="card">
          <div className="form-row">
            <input
              placeholder="Rechercher un employe (nom ou matricule)..."
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
                  <th>Matricule</th>
                  <th>Nom</th>
                  <th>Statut</th>
                  <th>Fonction</th>
                  <th>Service</th>
                  <th>Reference</th>
                  {peutGerer && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {employesFiltres.map((e) => (
                  <tr key={e.id_employe}>
                    <td>{e.matricule || <span className="muted">—</span>}</td>
                    <td>{e.nom}</td>
                    <td>{e.statut}</td>
                    <td>{e.fonction || '—'}</td>
                    <td>{e.service_nom}</td>
                    <td>{e.reference_hebdo} h</td>
                    {peutGerer && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn secondary" onClick={() => ouvrirEdition(e)} title="Modifier">✏️</button>{' '}
                        <button className="btn danger" onClick={() => desactiverEmploye(e)} title="Desactiver">🗑️</button>
                      </td>
                    )}
                  </tr>
                ))}
                {employesFiltres.length === 0 && (
                  <tr>
                    <td colSpan={peutGerer ? 7 : 6} className="muted">
                      Aucun employe trouve.
                    </td>
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