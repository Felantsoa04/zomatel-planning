/* Export Excel de l'EMPLOI DU TEMPS (fidèle au modèle du projet).
 * GET  /api/plannings/:id/emploi-du-temps.xlsx     (1 planning -> 1 fichier)
 * POST /api/plannings/emploi-du-temps-multi.xlsx   (N plannings -> fichiers
 *        GROUPÉS PAR SEMAINE : 1 WEEK = 1 fichier Excel, tous les services
 *        de la semaine dans le même classeur, une feuille par service)
 * - RÈGLE MÉTIER : seuls les plannings VALIDÉS peuvent être exportés (contrôle
 *   serveur, pas seulement côté interface) — BROUILLON / SOUMIS / REJETE sont
 *   refusés avec 403 ;
 * - les routes limitent l'export au rôle RH avec la permission
 *   planning.export_edt ;
 * - regroupement automatique par WEEK : les services d'une même semaine vont
 *   dans UN SEUL fichier (WEEK_39.xlsx) ; des semaines différentes donnent des
 *   fichiers différents — plusieurs semaines => une archive ZIP des fichiers ;
 * - le modèle Excel du projet ne sert QUE de structure/présentation : aucune
 *   donnée d'exemple n'est copiée, les données viennent du planning réel.
 */
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { genererEmploiDuTempsExcel, genererClasseursParSemaine } = require('../services/emploiDuTempsExcel');
const pool = require('../config/db');

/* Contrôles communs GET/POST : existence, périmètre et statut VALIDE.
 * Retourne le planning ou une réponse d'erreur déjà formée. */
async function controlerAcces(req, id) {
  const [[planning]] = await pool.query(
    `SELECT p.id_planning, p.service_id, s.nom_service, p.numero_semaine, p.annee, p.statut
     FROM planning p JOIN service s ON s.id_service = p.service_id
     WHERE p.id_planning = ?`,
    [id]
  );
  if (!planning) return { erreur: [404, 'Planning introuvable.'] };
  // Le chef ne doit exporter que SON service (identique aux autres routes).
  if ((req.user.role === 'CHEF_SERVICE' || !req.permissions.includes('planning.view_all'))
      && Number(planning.service_id) !== Number(req.user.id_service)) {
    return { erreur: [403, 'Ce planning ne concerne pas votre service.'] };
  }
  // RÈGLE MÉTIER : l'export Excel est réservé aux plannings VALIDÉS.
  // Contrôle serveur (le masquage du bouton côté front ne suffit pas).
  if (planning.statut !== 'VALIDE') {
    return { erreur: [403, `Export réservé aux plannings validés (statut actuel : ${planning.statut}).`] };
  }
  return { planning };
}

function envoyerFichier(res, sortie, nomFichier, typeMime) {
  res.setHeader('Content-Type', typeMime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nomFichier)}"`);
  const flux = fs.createReadStream(sortie);
  flux.on('close', () => fs.unlink(sortie, () => {})); // nettoyage du temporaire
  flux.pipe(res);
}

const nomTemporaire = (ext) => path.join(process.env.TEMP || '/tmp', 'edt-' + Date.now() + '-' + Math.random().toString(36).slice(2) + ext);

/* GET /api/plannings/:id/emploi-du-temps.xlsx — export SIMPLE (historique). */
async function exporter(req, res, next) {
  try {
    const { id } = req.params;
    const { erreur, planning } = await controlerAcces(req, id);
    if (erreur) return res.status(erreur[0]).json({ message: erreur[1] });

    const nomFichier = `EMPLOI DU TEMPS ${String(planning.nom_service).replace(/[\\/:*?"<>|]/g, ' ')} WEEK ${planning.numero_semaine}_${planning.annee}.xlsx`;
    const sortie = nomTemporaire('.xlsx');

    await genererEmploiDuTempsExcel({ id_planning: Number(id), sortie });
    envoyerFichier(res, sortie, nomFichier, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (err) {
    next(err);
  }
}

/* POST /api/plannings/emploi-du-temps-multi.xlsx — export GROUPÉ PAR SEMAINE.
 * Body JSON : { ids_plannings: [id, ...] } (ordre conservé, doublons ignorés)
 * OU {} / absent pour exporter TOUS les plannings validés accessibles (même
 * périmètre : le chef reste limité à son service).
 * RÈGLE FINALE : regroupement automatique par WEEK —
 *   1 seule semaine concernée -> UN classeur « WEEK_<n>.xlsx » ;
 *   plusieurs semaines        -> UNE archive ZIP contenant un « WEEK_<n>.xlsx »
 *                                par semaine (chaque classeur regroupe tous
 *                                les services de la semaine, 1 feuille chacun).
 * Un seul ID non VALIDE => refus global (403), jamais d'export partiel. */
async function exporterMulti(req, res, next) {
  try {
    const ids = req.body && Array.isArray(req.body.ids_plannings)
      ? req.body.ids_plannings
      : null; // absent -> TOUS les plannings validés accessibles
    if (ids && ids.length === 0) {
      return res.status(400).json({ message: 'Fournir ids_plannings : tableau non vide d\u2019identifiants (ou omettre ce champ pour tous les plannings valides).' });
    }
    if (ids && ids.length > 200) {
      return res.status(400).json({ message: 'Au maximum 200 plannings par export groupé.' });
    }

    // Mêmes contrôles que l'export simple, pour CHAQUE planning demandé
    // (liste explicite uniquement : sans liste, le filtre « tous les VALIDÉS
    // accessibles » applique déjà le périmètre du chef ci-dessous).
    if (ids) {
      for (const id of ids) {
        const { erreur } = await controlerAcces(req, id);
        if (erreur) return res.status(erreur[0]).json({ message: erreur[1] });
      }
    }

    // Sans liste : résoudre « tous les validés accessibles » ICI (contrôleur),
    // pour appliquer le périmètre CHEF_SERVICE avant toute génération.
    let idsFinaleux = ids ? [...new Set(ids.map(Number))] : null;
    if (!idsFinaleux) {
      let sql = `SELECT p.id_planning FROM planning p JOIN service s ON s.id_service = p.service_id WHERE p.statut = 'VALIDE'`;
      const params = [];
      if (req.user.role === 'CHEF_SERVICE' || !req.permissions.includes('planning.view_all')) {
        if (!req.user.id_service) {
          return res.status(403).json({ message: 'Aucun service n’est associé à votre compte.' });
        }
        sql += ' AND p.service_id = ?';
        params.push(req.user.id_service);
      }
      sql += ' ORDER BY p.annee, p.numero_semaine, s.nom_service';
      const [rows] = await pool.query(sql, params);
      idsFinaleux = rows.map((r) => r.id_planning);
      if (idsFinaleux.length === 0) {
        return res.status(404).json({ message: 'Aucun planning validé à exporter.' });
      }
    }

    // Génération : UN FICHIER PAR WEEK (dossier temporaire, nettoyé après envoi)
    const dossier = nomTemporaire('');
    fs.mkdirSync(dossier, { recursive: true });
    const produits = await genererClasseursParSemaine({ ids_plannings: idsFinaleux, dossier });

    if (produits.length === 0) {
      fs.rmSync(dossier, { recursive: true, force: true });
      return res.status(404).json({ message: 'Aucun planning validé à exporter.' });
    }

    if (produits.length === 1) {
      // 1 WEEK = 1 fichier Excel (sorti du dossier temporaire, qui est supprimé)
      const p = produits[0];
      const cible = nomTemporaire('.xlsx');
      fs.renameSync(p.fichier, cible);
      fs.rmSync(dossier, { recursive: true, force: true });
      envoyerFichier(res, cible, p.nomFichier, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return;
    }

    // Plusieurs WEEK -> une archive ZIP des fichiers par semaine
    const sortieZip = nomTemporaire('.zip');
    const archive = new AdmZip();
    for (const p of produits) archive.addLocalFile(p.fichier);
    archive.writeZip(sortieZip);
    fs.rmSync(dossier, { recursive: true, force: true }); // xlsx internes supprimés
    const nomZip = `EMPLOI DU TEMPS ${produits.map((p) => `S${p.numero_semaine}`).join('_')}.zip`;
    envoyerFichier(res, sortieZip, nomZip, 'application/zip');
  } catch (err) {
    next(err);
  }
}

module.exports = { exporter, exporterMulti };
