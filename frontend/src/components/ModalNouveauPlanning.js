'use client';

// MODAL « Nouveau planning » — intégration du formulaire de creation EXISTANT
// (/planning/new) dans un modal, sans changer son fonctionnement :
// memes champs (date_debut, date_fin), memes calculs (annee + numero ISO),
// meme endpoint POST /plannings. Aucune modification backend/DB/RBAC.

import { useState } from 'react';
import Modal from './Modal';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

// Calcule le numero de semaine ISO a partir d'une date (copie de /planning/new)
function numeroSemaineISO(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export default function ModalNouveauPlanning({ onClose, onCree }) {
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!dateDebut || !dateFin) return;

    // Garde de role identique a /planning/new : la creation est reservee
    // au chef de service (permission planning.create en base).
    if (getUser()?.role !== 'CHEF_SERVICE') {
      setError('Seul le chef de service peut créer un planning.');
      return;
    }

    const debut = new Date(dateDebut);
    const annee = debut.getFullYear();
    const numero_semaine = numeroSemaineISO(debut);

    setLoading(true);
    try {
      const token = getToken();
      // MEME endpoint et MEMES champs que le formulaire existant
      const { id_planning } = await api.post(
        '/plannings',
        { annee, numero_semaine, date_debut: dateDebut, date_fin: dateFin },
        token
      );
      // Succes : fermeture auto du modal, la liste est rafraichie par le parent
      onCree && onCree(id_planning);
      onClose();
    } catch (err) {
      // Erreur API : le modal RESTE ouvert, message affiche dans le modal
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal titre="Ajouter un planning" onClose={onClose} largeur={480}>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>Date de debut (lundi)</label>
          <input
            type="date"
            value={dateDebut}
            onChange={(e) => setDateDebut(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="form-row">
          <label>Date de fin (dimanche)</label>
          <input
            type="date"
            value={dateFin}
            onChange={(e) => setDateFin(e.target.value)}
            required
          />
        </div>

        {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={loading}>
            Annuler
          </button>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Création...' : 'Créer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
