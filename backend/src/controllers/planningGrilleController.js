const pool = require('../config/db');
const { logAction } = require('../utils/historique');
const { notifierRole } = require('../utils/notifier');

const PERIODES = ['MATIN', 'APRES_MIDI', 'SOIR'];
const STATUTS_JOUR = ['TRAVAIL', 'REPOS', 'CONGE', 'ABSENCE'];

function hmin(h) {
  if (!h || !/^\d{1,2}:\d{2}$/.test(h)) return null;
  const [hh, mm] = h.split(':').map(Number);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

// GET /api/plannings/:id/grille
// Donnees de saisie de la grille : employes du service, affectations + creneaux,
// contraintes RH (conges valides, indisponibilites, recuperations) sur la semaine.
async function getGrille(req, res, next) {
  try {
    const { id } = req.params;

    const [[planning]] = await pool.query(
      `SELECT p.id_planning, p.annee, p.numero_semaine,
              p.date_debut_semaine AS date_debut,
              p.date_fin_semaine   AS date_fin,
              p.statut, p.service_id AS id_service,
              s.nom_service AS service_nom
       FROM planning p JOIN service s ON s.id_service = p.service_id
       WHERE p.id_planning = ?`,
      [id]
    );
    if (!planning) return res.status(404).json({ message: 'Planning introuvable.' });
    // Un chef ne manipule que les grilles de son service
    if (req.user.role === 'CHEF_SERVICE' && planning.id_service !== req.user.id_service) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }

    const [employes] = await pool.query(
      `SELECT e.id_employe, e.nom, e.matricule, e.statut,
              e.reference_hebdo, e.fonction
       FROM employe e
       WHERE e.service_id = ? AND e.actif = 1
       ORDER BY e.nom`,
      [planning.id_service]
    );

    const [affectations] = await pool.query(
      `SELECT a.id_affectation, a.employe_id AS id_employe,
              a.date_jour AS jour, a.statut AS statut_jour,
              a.commentaire AS observation
       FROM affectation a
       WHERE a.planning_id = ?
       ORDER BY a.date_jour`,
      [id]
    );

    const [creneaux] = await pool.query(
      `SELECT ct.id_creneau, ct.affectation_id AS id_affectation,
              ct.type_creneau AS periode, ct.heure_entree, ct.heure_sortie
       FROM creneau_travail ct
       JOIN affectation a ON a.id_affectation = ct.affectation_id
       WHERE a.planning_id = ?`,
      [id]
    );

    const debut = planning.date_debut;
    const fin = planning.date_fin;

    const [conges] = await pool.query(
      `SELECT c.employe_id AS id_employe, c.date_debut, c.date_fin,
              c.type_conge, c.statut
       FROM conge c
       WHERE c.statut = 'VALIDE'
         AND c.date_debut <= ? AND c.date_fin >= ?`,
      [fin, debut]
    );

    const [indispos] = await pool.query(
      `SELECT i.employe_id AS id_employe, i.date_debut, i.date_fin,
              i.type_indispo, i.motif
       FROM indisponibilite i
       WHERE i.date_debut <= ? AND i.date_fin >= ?`,
      [fin, debut]
    );

    const [recuperations] = await pool.query(
      `SELECT r.employe_id AS id_employe, r.date_recuperation AS jour,
              r.nombre_heures, r.motif
       FROM recuperation r
       WHERE r.date_recuperation BETWEEN ? AND ?`,
      [debut, fin]
    );

    res.json({
      planning,
      employes,
      affectations,
      creneaux,
      contraintes: { conges, indisponibilites: indispos, recuperations },
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/plannings/:id/grille
// Sauvegarde en masse de la grille. Corps : { cellules: [...] }
// Chaque cellule :
//   { id_employe, jour, statut_jour, creneau: { periode, heure_entree, heure_sortie } | null }
// statut_jour null ou "VIDE" => suppression de l'affectation existante.
// Reponse : { ok, resultats: [{ id_employe, jour, ok, id_affectation?, erreur? }] }
// Les cellules en erreur n'annulent PAS les autres (sauvegarde partielle visible).
async function saveGrille(req, res, next) {
  try {
    const { id } = req.params;
    const cellules = Array.isArray(req.body.cellules) ? req.body.cellules : null;
    if (!cellules) {
      return res.status(400).json({ message: 'Tableau "cellules" requis.' });
    }

    const [[planning]] = await pool.query(
      `SELECT id_planning, statut, service_id, date_debut_semaine, date_fin_semaine
       FROM planning WHERE id_planning = ?`,
      [id]
    );
    if (!planning) return res.status(404).json({ message: 'Planning introuvable.' });
    if (req.user.role === 'CHEF_SERVICE' && planning.service_id !== req.user.id_service) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }
    if (planning.statut === 'VALIDE' || planning.statut === 'SOUMIS') {
      return res.status(409).json({
        message: 'Planning soumis ou valide : modification impossible.',
      });
    }

    // Employes du service uniquement
    const [emps] = await pool.query(
      'SELECT id_employe FROM employe WHERE service_id = ? AND actif = 1',
      [planning.service_id]
    );
    const employesService = new Set(emps.map((e) => e.id_employe));

    const resultats = [];
    let modifiees = 0;

    for (const cellule of cellules) {
      const base = { id_employe: cellule.id_employe, jour: cellule.jour };
      try {
        const { id_employe, jour, statut_jour, creneau } = cellule;
        if (!id_employe || !jour) {
          resultats.push({ ...base, ok: false, erreur: 'id_employe et jour requis.' });
          continue;
        }
        if (!employesService.has(Number(id_employe))) {
          resultats.push({ ...base, ok: false, erreur: 'Employe hors de votre service.' });
          continue;
        }
        if (jour < planning.date_debut_semaine || jour > planning.date_fin_semaine) {
          resultats.push({ ...base, ok: false, erreur: 'Hors de la semaine du planning.' });
          continue;
        }

        // Cellule videe : on supprime l'affectation (et ses creneaux via FK ON DELETE CASCADE)
        if (!statut_jour || statut_jour === 'VIDE') {
          const [del] = await pool.query(
            'DELETE FROM affectation WHERE planning_id = ? AND employe_id = ? AND date_jour = ?',
            [id, id_employe, jour]
          );
          if (del.affectedRows > 0) modifiees += 1;
          resultats.push({ ...base, ok: true, supprime: del.affectedRows > 0 });
          continue;
        }

        const statut = String(statut_jour).toUpperCase();
        if (!STATUTS_JOUR.includes(statut)) {
          resultats.push({ ...base, ok: false, erreur: `Statut invalide : ${statut}` });
          continue;
        }

        // Controle local du creneau (les triggers rejouent les regles en base)
        let minutes = 0;
        if (creneau && (creneau.heure_entree || creneau.heure_sortie)) {
          if (statut !== 'TRAVAIL') {
            resultats.push({
              ...base,
              ok: false,
              erreur: `Un horaire ne peut pas coexister avec le statut ${statut}.`,
            });
            continue;
          }
          const periode = String(creneau.periode || 'MATIN').toUpperCase();
          const entree = hmin(creneau.heure_entree);
          const sortie = hmin(creneau.heure_sortie);
          if (!PERIODES.includes(periode)) {
            resultats.push({ ...base, ok: false, erreur: `Periode invalide : ${periode}` });
            continue;
          }
          if (entree === null || sortie === null) {
            resultats.push({ ...base, ok: false, erreur: 'Format d\'heure invalide (attendu HH:MM).' });
            continue;
          }
          if (sortie <= entree) {
            resultats.push({ ...base, ok: false, erreur: 'Heure de fin anterieure ou egale a l\'heure de debut.' });
            continue;
          }
          if (sortie - entree > 480) {
            resultats.push({ ...base, ok: false, erreur: '8h/jour maximum par employe.' });
            continue;
          }
          minutes = sortie - entree;
        } else if (statut === 'TRAVAIL' && (!creneau || !creneau.heure_entree || !creneau.heure_sortie)) {
          resultats.push({ ...base, ok: false, erreur: 'Un jour TRAVAIL doit avoir un horaire.' });
          continue;
        }

        // Doublon de periode si le jour a deja plusieurs creneaux (ex. MATIN + SOIR)
        // : l'upsert ON DUPLICATE KEY de creneau_travail ecrase la periode existante,
        // ce qui est le comportement voulu (modification directe).

        await pool.query(
          `INSERT INTO affectation (planning_id, employe_id, date_jour, statut, commentaire)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE statut = VALUES(statut), commentaire = VALUES(commentaire)`,
          [id, id_employe, jour, statut, cellule.observation || null]
        );

        const [[aff]] = await pool.query(
          'SELECT id_affectation FROM affectation WHERE planning_id = ? AND employe_id = ? AND date_jour = ?',
          [id, id_employe, jour]
        );

        if (creneau && creneau.heure_entree && creneau.heure_sortie) {
          const periode = String(creneau.periode || 'MATIN').toUpperCase();
          await pool.query(
            `INSERT INTO creneau_travail (affectation_id, type_creneau, heure_entree, heure_sortie)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE heure_entree = VALUES(heure_entree), heure_sortie = VALUES(heure_sortie)`,
            [aff.id_affectation, periode, creneau.heure_entree, creneau.heure_sortie]
          );
        }

        modifiees += 1;
        resultats.push({
          ...base,
          ok: true,
          id_affectation: aff.id_affectation,
          duree_minutes: minutes || undefined,
        });
      } catch (cellErr) {
        // Erreurs des triggers MariaDB (8h/jour, chevauchement, date hors semaine...)
        const message = /depassee/i.test(cellErr.message)
          ? 'Regle 8h/jour depassee pour cet employe ce jour.'
          : /chevauch/i.test(cellErr.message)
            ? 'Conflit d\'horaires : chevauchement avec un autre creneau.'
            : /non travail/i.test(cellErr.message)
              ? 'Impossible : le jour n\'est pas en TRAVAIL.'
              : /hors de la semaine/i.test(cellErr.message)
                ? 'Date hors de la semaine du planning.'
                : cellErr.message;
        resultats.push({ ...base, ok: false, erreur: message });
      }
    }

    if (modifiees > 0) {
      await logAction(
        id,
        req.user.id_utilisateur,
        'Grille mise a jour',
        `${modifiees} cellule(s) modifiee(s)`
      );
    }

    const nbErreurs = resultats.filter((r) => !r.ok).length;
    res.status(nbErreurs > 0 ? 207 : 200).json({
      ok: nbErreurs === 0,
      modifiees,
      erreurs: nbErreurs,
      resultats,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/plannings/:id/modifiable
// Indique si le chef peut modifier la grille (BROUILLON ou REJETE).
async function modifiable(req, res, next) {
  try {
    const { id } = req.params;
    const [[planning]] = await pool.query(
      'SELECT statut, service_id FROM planning WHERE id_planning = ?',
      [id]
    );
    if (!planning) return res.status(404).json({ message: 'Planning introuvable.' });
    if (req.user.role === 'CHEF_SERVICE' && planning.service_id !== req.user.id_service) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }
    res.json({
      modifiable: planning.statut === 'BROUILLON' || planning.statut === 'REJETE',
      statut: planning.statut,
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/plannings/:id/soumettre : BROUILLON ou REJETE -> SOUMIS
// (remplace la version limitee au seul statut BROUILLON)
async function soumettre(req, res, next) {
  try {
    const { id } = req.params;
    const [[planning]] = await pool.query(
      `SELECT p.id_planning, p.statut, p.service_id, p.numero_semaine, p.annee,
              s.nom_service
       FROM planning p JOIN service s ON s.id_service = p.service_id
       WHERE p.id_planning = ?`,
      [id]
    );
    if (!planning) return res.status(404).json({ message: 'Planning introuvable.' });
    if (req.user.role === 'CHEF_SERVICE' && planning.service_id !== req.user.id_service) {
      return res.status(403).json({ message: 'Ce planning ne concerne pas votre service.' });
    }
    if (planning.statut !== 'BROUILLON' && planning.statut !== 'REJETE') {
      return res.status(409).json({
        message: 'Seul un planning BROUILLON ou REJETE peut etre soumis.',
      });
    }
    await pool.query(
      "UPDATE planning SET statut = 'SOUMIS' WHERE id_planning = ?",
      [id]
    );
    await logAction(id, req.user.id_utilisateur, 'Soumission pour validation RH');

    // Notification aux RH : un planning attend leur validation
    await notifierRole(
      'RH',
      id,
      'Planning soumis pour validation',
      `Le planning ${planning.nom_service} S${planning.numero_semaine}/${planning.annee} a ete soumis pour validation.`,
      { exceptUtilisateurId: req.user.id_utilisateur }
    );

    res.json({ message: 'Planning soumis a la RH.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getGrille, saveGrille, modifiable, soumettre };
