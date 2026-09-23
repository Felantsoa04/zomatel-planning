const pool = require('../config/db');

// GET /api/employes?id_service=1
// Restriction reelle cote serveur :
//  - CHEF_SERVICE : FORCE a son propre service (le parametre id_service est ignore) ;
//  - EMPLOYE : acces refuse (pas de consultation des listes de personnel) ;
//  - RH / ADMIN : tous les services, filtre id_service optionnel.
async function list(req, res, next) {
  try {
    const { id_service } = req.query;
    let sql = `SELECT e.id_employe, e.nom, e.matricule, e.statut, e.fonction,
                      e.service_id AS id_service, e.reference_hebdo,
                      e.date_entree, s.nom_service AS service_nom
               FROM employe e JOIN service s ON s.id_service = e.service_id
               WHERE e.actif = 1`;
    const params = [];

    if (req.user.role === 'CHEF_SERVICE') {
      if (!req.user.id_service) {
        return res.status(403).json({ message: 'Ce compte n\'est rattache a aucun service.' });
      }
      sql += ' AND e.service_id = ?';
      params.push(req.user.id_service);
    } else if (req.user.role === 'EMPLOYE') {
      return res.status(403).json({ message: 'Acces refuse : un employe consulte uniquement ses propres donnees.' });
    } else if (id_service) {
      // NB : la colonne reelle est service_id (e.id_service n'existe pas)
      sql += ' AND e.service_id = ?';
      params.push(id_service);
    }

    // Recherche facultative : nom ou matricule (ex. /employes?recherche=RAM)
    const { recherche } = req.query;
    if (recherche) {
      sql += ' AND (e.nom LIKE ? OR e.matricule LIKE ?)';
      const motif = `%${recherche}%`;
      params.push(motif, motif);
    }

    sql += ' ORDER BY e.nom';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/employes/me/profil : fiche de l'employe rattache au compte connecte
// Le lien est relu en base (utilisateur.id_employe) : le JWT n'est pas une source de verite.
async function monProfil(req, res, next) {
  try {
    const [[row]] = await pool.query(
      `SELECT e.id_employe, e.nom, e.matricule, e.statut, e.fonction,
              e.reference_hebdo, e.date_entree,
              e.service_id AS id_service, s.nom_service AS service_nom
       FROM utilisateur u
       JOIN employe e ON e.id_employe = u.id_employe
       JOIN service s ON s.id_service = e.service_id
       WHERE u.id_utilisateur = ? AND u.actif = 1`,
      [req.user.id_utilisateur]
    );
    if (!row) {
      return res.status(404).json({ message: 'Aucune fiche employe rattachee a ce compte.' });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
}

// GET /api/employes/me/plannings : mes affectations + horaires, pour MOI uniquement
async function mesPlannings(req, res, next) {
  try {
    const [[emp]] = await pool.query(
      'SELECT id_employe FROM utilisateur WHERE id_utilisateur = ? AND id_employe IS NOT NULL',
      [req.user.id_utilisateur]
    );
    if (!emp) {
      return res.status(404).json({ message: 'Aucune fiche employe rattachee a ce compte.' });
    }
    const [rows] = await pool.query(
      `SELECT p.id_planning, p.annee, p.numero_semaine,
              p.date_debut_semaine AS date_debut,
              p.date_fin_semaine   AS date_fin,
              p.statut,
              s.nom_service AS service_nom,
              a.date_jour AS jour, a.statut AS statut_jour,
              a.commentaire AS observation,
              ct.type_creneau AS periode,
              ct.heure_entree, ct.heure_sortie
       FROM affectation a
       JOIN planning p ON p.id_planning = a.planning_id
       JOIN service s  ON s.id_service = p.service_id
       LEFT JOIN creneau_travail ct ON ct.affectation_id = a.id_affectation
       WHERE a.employe_id = ?
       ORDER BY p.date_debut_semaine DESC, a.date_jour, ct.type_creneau`,
      [emp.id_employe]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/employes/me/plannings/:id : un planning precis, si j'en fais partie
async function monPlanningDetail(req, res, next) {
  try {
    const [[emp]] = await pool.query(
      'SELECT id_employe FROM utilisateur WHERE id_utilisateur = ? AND id_employe IS NOT NULL',
      [req.user.id_utilisateur]
    );
    if (!emp) {
      return res.status(404).json({ message: 'Aucune fiche employe rattachee a ce compte.' });
    }

    const [[planning]] = await pool.query(
      `SELECT p.id_planning, p.annee, p.numero_semaine,
              p.date_debut_semaine AS date_debut,
              p.date_fin_semaine   AS date_fin,
              p.statut, s.nom_service AS service_nom
       FROM planning p JOIN service s ON s.id_service = p.service_id
       WHERE p.id_planning = ?`,
      [req.params.id]
    );
    if (!planning) return res.status(404).json({ message: 'Planning introuvable.' });

    // Le planning n'est visible que si l'employe y est affecte
    const [mesLignes] = await pool.query(
      `SELECT a.date_jour AS jour, a.statut AS statut_jour,
              a.commentaire AS observation,
              ct.type_creneau AS periode,
              ct.heure_entree, ct.heure_sortie
       FROM affectation a
       LEFT JOIN creneau_travail ct ON ct.affectation_id = a.id_affectation
       WHERE a.planning_id = ? AND a.employe_id = ?
       ORDER BY a.date_jour, ct.type_creneau`,
      [req.params.id, emp.id_employe]
    );
    if (mesLignes.length === 0) {
      return res.status(403).json({ message: 'Ce planning ne vous concerne pas.' });
    }

    res.json({ planning, mes_lignes: mesLignes });
  } catch (err) {
    next(err);
  }
}

// POST /api/employes
// Un chef de service ne peut creer des employes que dans SON service :
// l'id_service du corps est ignore et remplace par celui du compte.
async function create(req, res, next) {
  try {
    let { matricule, nom, statut, fonction, id_service, reference_hebdo, date_entree } = req.body;
    if (req.user.role === 'CHEF_SERVICE') {
      if (!req.user.id_service) {
        return res.status(403).json({ message: "Ce compte n'est rattache a aucun service." });
      }
      id_service = req.user.id_service;
    }
    if (!nom || !id_service) {
      return res.status(400).json({ message: 'nom et id_service requis.' });
    }
    const [result] = await pool.query(
      `INSERT INTO employe (matricule, nom, statut, fonction, service_id, reference_hebdo, date_entree)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        matricule || null,
        nom,
        statut || 'TITULAIRE',
        fonction || null,
        id_service,
        reference_hebdo || 44,
        date_entree || null,
      ]
    );
    res.status(201).json({ id_employe: result.insertId });
  } catch (err) {
    next(err);
  }
}

// PUT /api/employes/:id
// Un chef de service ne peut modifier que les employes de SON service.
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { matricule, nom, statut, fonction, id_service, reference_hebdo, date_entree, actif } = req.body;

    if (req.user.role === 'EMPLOYE') {
      return res.status(403).json({ message: 'Acces refuse.' });
    }
    if (req.user.role === 'CHEF_SERVICE') {
      const [[emp]] = await pool.query(
        'SELECT service_id FROM employe WHERE id_employe = ?',
        [id]
      );
      if (!emp) return res.status(404).json({ message: 'Employe introuvable.' });
      if (Number(emp.service_id) !== Number(req.user.id_service)) {
        return res.status(403).json({ message: 'Cet employe ne fait pas partie de votre service.' });
      }
      // Un chef ne peut pas transferer un employe vers un autre service
      if (id_service && Number(id_service) !== Number(req.user.id_service)) {
        return res.status(403).json({ message: 'Un chef de service ne peut pas transferer un employe vers un autre service.' });
      }
    }

    await pool.query(
      `UPDATE employe SET
         matricule = COALESCE(?, matricule),
         nom = COALESCE(?, nom),
         statut = COALESCE(?, statut),
         fonction = COALESCE(?, fonction),
         service_id = COALESCE(?, service_id),
         reference_hebdo = COALESCE(?, reference_hebdo),
         date_entree = COALESCE(?, date_entree),
         actif = COALESCE(?, actif)
       WHERE id_employe = ?`,
      [matricule, nom, statut, fonction, id_service, reference_hebdo, date_entree, actif, id]
    );
    res.json({ message: 'Employe mis a jour.' });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/employes/:id : DESACTIVATION (soft delete)
// Aucune donnee n'est effacee : l'employe passe actif = 0 et disparait des
// listes actives, mais ses affectations et plannings passes restent intactes.
// RH : tous services. CHEF_SERVICE : uniquement les employes de SON service.
async function desactiver(req, res, next) {
  try {
    const { id } = req.params;
    const [[emp]] = await pool.query(
      'SELECT id_employe, nom, service_id, actif FROM employe WHERE id_employe = ?',
      [id]
    );
    if (!emp) return res.status(404).json({ message: 'Employe introuvable.' });

    if (req.user.role === 'CHEF_SERVICE') {
      if (Number(emp.service_id) !== Number(req.user.id_service)) {
        return res.status(403).json({ message: 'Cet employe ne fait pas partie de votre service.' });
      }
    }
    // Un compte employe rattache ne peut pas se desactiver lui-meme
    if (req.user.id_employe && Number(emp.id_employe) === Number(req.user.id_employe)) {
      return res.status(400).json({ message: 'Impossible de desactiver son propre compte employe.' });
    }

    await pool.query('UPDATE employe SET actif = 0 WHERE id_employe = ?', [id]);
    res.json({ message: 'Employe desactive (acces coupe des listes, donnees conservees).' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, desactiver, monProfil, mesPlannings, monPlanningDetail };