// Contrôleur : heures planifiées pour la page Statistiques.
// L'agrégation est faite EN BASE (MariaDB) à partir des données réelles,
// pour garantir un comptage unique et cohérent côté client.

const pool = require('../config/db');

// Objectif hebdomadaire métier Zomatel : 44 h pour Administration, 48 h pour
// les autres services. Utilisé comme objectif de départ (l'employé peut
// avoir une référence_hebdo spécifique, sinon l'objectif standard s'applique).
const HEURES_ADMIN = 44;
const HEURES_AUTRES = 48;

function objectifHebdo(nomService) {
  return String(nomService || '').toLowerCase().includes('admin')
    ? HEURES_ADMIN
    : HEURES_AUTRES;
}

// GET /api/plannings/statistiques-heures
// Réponse :
// {
//   plannings: [
//     {
//       id_planning, annee, numero_semaine, date_debut, date_fin,
//       statut, id_service, service_nom,
//       nb_employes, nb_manques, nb_exces, heures_service,
//       par_employe: [
//         { id_employe, nom_employe, matricule, service_nom, id_service,
//           heures, heures_valides, heures_non_valides, objectif, ecart,
//         },
//         ...
//       ],
//     },
//     ...
//   ],
//   employes: [ { id_employe, nom, matricule, id_service, service_nom,
//                 reference_hebdo, objectif_hebdo_reglementaire,
//                 heures_total, heures_valides, heures_non_valides,
//                 nb_plannings_par_semaine: { "2026-W40": heures } } ]
//   ...
// }
async function statistiquesHeures(req, res, next) {
  try {
    const params = [];
    let filtreService = '';
    let filtreAnnee = '';
    let filtreStatut = '';

    // Périmètre : un chef / utilisateur restreint ne voit que son service.
    const vueGlobale = !req.user.id_service || req.permissions.includes('planning.view_all');
    if (!vueGlobale) {
      if (!req.user.id_service) {
        return res.status(403).json({ message: 'Aucun service n’est associé à votre compte.' });
      }
      filtreService = req.user.id_service;
      params.push(req.user.id_service);
    } else if (req.query.id_service) {
      filtreService = req.query.id_service;
      params.push(req.query.id_service);
    }
    if (req.query.annee) {
      filtreAnnee = req.query.annee;
      params.push(req.query.annee);
    }
    if (req.query.statut) {
      filtreStatut = req.query.statut;
      params.push(req.query.statut);
    }
    let sqlWhere = '';
    if (filtreService) { sqlWhere += ' AND p.service_id = ?'; }
    if (filtreAnnee) { sqlWhere += ' AND p.annee = ?'; }
    if (filtreStatut) { sqlWhere += ' AND p.statut = ?'; }

    // ------------------------------------------------------------------
    // 1) Plannings de la période (en base) avec totaux agrégés par service.
    //    heures_service = somme des durées des créneaux TRAVAIL de ce planning
    //    (chaque créneau compté exactement une fois, pas de double comptage).
    //    La comparaison employé/objectif se fait par employé dans la section 2.
    // ------------------------------------------------------------------
    const sqlPlannings = `
      SELECT p.id_planning, p.annee, p.numero_semaine,
             p.date_debut_semaine AS date_debut,
             p.date_fin_semaine   AS date_fin,
             p.statut, p.service_id AS id_service,
             s.nom_service AS service_nom,
             COALESCE(SUM(d.duree), 0) AS heures_service,
             COUNT(DISTINCT a.employe_id) AS nb_employes
      FROM planning p
      JOIN service s ON s.id_service = p.service_id
      LEFT JOIN affectation a ON a.planning_id = p.id_planning AND a.statut = 'TRAVAIL'
      LEFT JOIN (
        SELECT affectation_id, SUM(TIMESTAMPDIFF(MINUTE, heure_entree, heure_sortie)) / 60 AS duree
        FROM creneau_travail
        GROUP BY affectation_id
      ) d ON d.affectation_id = a.id_affectation
      WHERE 1=1 ${sqlWhere}
      GROUP BY p.id_planning, p.annee, p.numero_semaine, p.date_debut_semaine,
               p.date_fin_semaine, p.statut, p.service_id, s.nom_service
      ORDER BY p.annee DESC, p.numero_semaine DESC`;
    const [planningsBrut] = await pool.query(sqlPlannings, params);

    // ------------------------------------------------------------------
    // 2) Heures par employé et par planning (donc par semaine).
    // ------------------------------------------------------------------
    const sqlParEmploye = `
      SELECT p.id_planning, p.annee, p.numero_semaine,
             p.statut, p.service_id AS id_service,
             s.nom_service AS service_nom,
             e.id_employe, e.nom AS nom_employe, e.matricule,
             COALESCE(SUM(
               TIMESTAMPDIFF(MINUTE, c.heure_entree, c.heure_sortie)
             ) / 60) AS heures
      FROM planning p
      JOIN service s ON s.id_service = p.service_id
      JOIN affectation a ON a.planning_id = p.id_planning AND a.statut = 'TRAVAIL'
      JOIN employe e ON e.id_employe = a.employe_id
      LEFT JOIN creneau_travail c ON c.affectation_id = a.id_affectation
      WHERE 1=1 ${sqlWhere}
      GROUP BY p.id_planning, p.annee, p.numero_semaine, p.statut,
               p.service_id, s.nom_service, e.id_employe, e.nom, e.matricule
      ORDER BY p.annee DESC, p.numero_semaine DESC, e.nom ASC`;
    const [parEmploye] = await pool.query(sqlParEmploye, params);

    // ------------------------------------------------------------------
    // 3) Liste complète des employés du périmètre (pour insérer les lignes
    //    sans planning, afin d'éviter de les écrire en frontend).
    // ------------------------------------------------------------------
    let sqlEmployes = `
      SELECT e.id_employe, e.nom, e.matricule,
             s.id_service, s.nom_service AS service_nom,
             e.reference_hebdo
      FROM employe e
      JOIN service s ON s.id_service = e.service_id
      WHERE e.actif = 1`;
    const paramsEmp = [];
    if (!vueGlobale) {
      sqlEmployes += ' AND e.service_id = ?';
      paramsEmp.push(req.user.id_service);
    } else if (filtreService) {
      sqlEmployes += ' AND e.service_id = ?';
      paramsEmp.push(filtreService);
    }
    sqlEmployes += ' ORDER BY e.nom';
    const [employesBrut] = await pool.query(sqlEmployes, paramsEmp);

    // ------------------------------------------------------------------
    // 4) Mise au format final : plannings + par_employe avec écart/objectif.
    // ------------------------------------------------------------------
    const plannings = [];
    for (const p of planningsBrut) {
      const obj = objectifHebdo(p.service_nom);
      const lignes = [];

      for (const row of parEmploye) {
        if (row.id_planning !== p.id_planning) continue;
        const heures = Number(row.heures) || 0;
        lignes.push({
          id_employe: row.id_employe,
          nom_employe: row.nom_employe,
          matricule: row.matricule,
          service_nom: row.service_nom,
          id_service: row.id_service,
          heures: Math.round(heures * 10) / 10,
          objectif: obj,
          ecart: Math.round((heures - obj) * 10) / 10,
        });
      }

      plannings.push({
        id_planning: p.id_planning,
        annee: p.annee,
        numero_semaine: p.numero_semaine,
        date_debut: String(p.date_debut || '').slice(0, 10),
        date_fin: String(p.date_fin || '').slice(0, 10),
        statut: p.statut,
        id_service: p.id_service,
        service_nom: p.service_nom,
        nb_employes: p.nb_employes || 0,
        heures_service: Math.round((Number(p.heures_service) || 0) * 10) / 10,
        par_employe: lignes,
      });
    }

    // ------------------------------------------------------------------
    // 5) Employés + totaux sur la période (heures validées et en attente).
    // ------------------------------------------------------------------
    const heuresParEmploye = new Map(); // id_employe -> { total, valides, nonValides }
    const semainesParEmploye = new Map(); // id_employe -> { "annee-Wxx": heures }
    for (const row of parEmploye) {
      const heures = Number(row.heures) || 0;
      const acc = heuresParEmploye.get(row.id_employe) || { total: 0, valides: 0, nonValides: 0 };
      acc.total += heures;
      if (row.statut === 'VALIDE') acc.valides += heures;
      else acc.nonValides += heures;
      heuresParEmploye.set(row.id_employe, acc);

      const cle = `${row.annee}-W${String(row.numero_semaine).padStart(2, '0')}`;
      const map = semainesParEmploye.get(row.id_employe) || new Map();
      map.set(cle, (map.get(cle) || 0) + heures);
      semainesParEmploye.set(row.id_employe, map);
    }

    const employes = employesBrut.map((e) => {
      const acc = heuresParEmploye.get(e.id_employe) || { total: 0, valides: 0, nonValides: 0 };
      const map = semainesParEmploye.get(e.id_employe) || new Map();
      const parSemaine = {};
      for (const [cle, v] of map.entries()) parSemaine[cle] = Math.round(v * 10) / 10;
      return {
        id_employe: e.id_employe,
        nom: e.nom,
        matricule: e.matricule,
        id_service: e.id_service,
        service_nom: e.service_nom,
        reference_hebdo: e.reference_hebdo,
        objectif_hebdo_reglementaire: objectifHebdo(e.service_nom),
        heures_total: Math.round((acc.total || 0) * 10) / 10,
        heures_valides: Math.round((acc.valides || 0) * 10) / 10,
        heures_non_valides: Math.round((acc.nonValides || 0) * 10) / 10,
        par_semaine: parSemaine,
      };
    });

    res.json({ plannings, employes });
  } catch (err) {
    next(err);
  }
}

module.exports = { statistiquesHeures };
