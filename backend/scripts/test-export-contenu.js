/* Test exact (READ-ONLY en base) :
 * 1. login RH ; 2. sélection du planning VALIDE #40 (CUISINE CANTINE S45/2030) ;
 * 3. export HTTP ; 4. vérification cellule par cellule : chaque employé du
 * planning apparaît dans le RECAP avec SON total hebdo exact ; les horaires
 * LUNDI de chaque employé sont aux cellules prévues par le modèle (C/D/E
 * matin, F/G/H après-midi, I/J/K soir) ; aucun résidu des données d'exemple
 * du modèle ; la barre Service C5 porte le nom du service du planning.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const AdmZip = require('adm-zip');
const fs = require('fs');

const TEMP = process.env.TEMP || '/tmp';
const FICHIER = path.join(TEMP, 'export-exact-rh.xlsx');

(async () => {
  try {
    // 1. Login RH + export HTTP du planning sélectionné (#40, VALIDE)
    const lr = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'rh', mot_de_passe: 'rh123' }),
    });
    const lj = await lr.json();
    if (!lr.ok) { console.log('login KO', lr.status); process.exit(2); }
    const H = { Authorization: 'Bearer ' + lj.token };
    const ID = 40; // planning sélectionné par la RH (VALIDE, CUISINE CANTINE)

    const er = await fetch('http://localhost:4000/api/plannings/' + ID + '/emploi-du-temps.xlsx', { headers: H });
    if (er.status !== 200) { console.log('export KO :', er.status); process.exit(2); }
    fs.writeFileSync(FICHIER, Buffer.from(await er.arrayBuffer()));
    console.log('Export HTTP 200 du planning sélectionné #40 ->', FICHIER);

    // 2. Données RÉELLES du planning sélectionné (SELECT uniquement)
    const [[planning]] = await pool.query(
      `SELECT p.id_planning, p.numero_semaine, p.date_debut_semaine, s.nom_service
       FROM planning p JOIN service s ON s.id_service = p.service_id WHERE p.id_planning = ?`, [ID]);
    const [affectations] = await pool.query(
      `SELECT a.employe_id, a.date_jour, a.statut, e.nom, e.matricule
       FROM affectation a JOIN employe e ON e.id_employe = a.employe_id
       WHERE a.planning_id = ? ORDER BY e.nom, a.date_jour`, [ID]);
    const [creneaux] = await pool.query(
      `SELECT ct.affectation_id, ct.heure_entree, ct.heure_sortie
       FROM creneau_travail ct JOIN affectation a ON a.id_affectation = ct.affectation_id
       WHERE a.planning_id = ?`, [ID]);
    const creParAff = {};
    for (const c of creneaux) (creParAff[c.affectation_id] = creParAff[c.affectation_id] || []).push(c);
    const affParEmpJour = {};
    const employes = new Map();
    for (const a of affectations) {
      employes.set(a.employe_id, { nom: a.nom, matricule: a.matricule || '' });
      affParEmpJour[a.employe_id + '|' + String(a.date_jour).slice(0, 10)] = {
        statut: a.statut, creneaux: creParAff[a.id_affectation || a.id_affectation] || [],
      };
    }
    // NB : affectation n'expose pas id_affectation dans ce SELECT -> requête dédiée :
    const [aff2] = await pool.query(
      `SELECT a.id_affectation, a.employe_id, a.date_jour, a.statut, e.nom, e.matricule
       FROM affectation a JOIN employe e ON e.id_employe = a.employe_id
       WHERE a.planning_id = ? ORDER BY e.nom, a.date_jour`, [ID]);
    const affParEmpJour2 = {};
    for (const a of aff2) {
      affParEmpJour2[a.employe_id + '|' + String(a.date_jour).slice(0, 10)] = {
        statut: a.statut, creneaux: creParAff[a.id_affectation] || [],
      };
    }
    const enM = (h) => { const m = String(h).slice(0, 5).match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    const totalHebdo = {};
    for (const idEmp of employes.keys()) {
      let t = 0;
      for (const cle of Object.keys(affParEmpJour2)) {
        if (!cle.startsWith(idEmp + '|')) continue;
        for (const c of affParEmpJour2[cle].creneaux) {
          const d = enM(c.heure_entree); if (d == null) continue;
          t += Math.max(0, enM(c.heure_sortie) - d);
        }
      }
      totalHebdo[idEmp] = t;
    }

    // 3. Lecture de l'Excel exporté
    const xml = new AdmZip(FICHIER).getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
    const cellules = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = (m[2].match(/t="(\w+)"/) || [])[1];
      let v = (m[3] || '').match(/<v>([\s\S]*?)<\/v>/);
      v = v ? v[1] : '';
      if (t === 'inlineStr') v = ((m[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || ['', ''])[1];
      cellules[m[1]] = v;
    }
    const nbEmp = employes.size;
    // Gabarit SECURITE : blocs FIXES de 17 lignes (jour + périodes + entêtes
    // + 12 lignes employés + totaux + fantôme), comme le modèle WEEK 37.
    const pasBloc = 17;
    const dates = [];
    { const d = new Date(String(planning.date_debut_semaine).slice(0, 10) + 'T00:00:00Z');
      for (let i = 0; i < 7; i++) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } }

    let ecarts = 0;
    const echec = (msg) => { ecarts++; console.log('ÉCART :', msg); };

    // Barre Service + titre
    if (cellules['C5'] !== planning.nom_service) echec(`C5="${cellules['C5']}" attendu "${planning.nom_service}"`);
    // Zone 1 — titre au FORMAT DU MODÈLE (WEEK n conservé)
    if (cellules['E2'] !== `EMPLOI DU TEMPS ${planning.nom_service} WEEK ${planning.numero_semaine}`) echec('titre E2 incorrect : ' + cellules['E2']);

    // Chaque employé, chaque jour : horaires aux cellules prévues.
    // Les heures sont stockées en fractions de jour (0.25 = 06:00, format h:mm
    // du modèle) : on convertit la valeur de cellule en HH:MM pour comparer.
    const enHHMM = (frac) => { const tot = Math.round(frac * 1440); return String(Math.floor(tot / 60)).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0'); };
    const luHHMM = (v) => (v !== '' && !isNaN(Number(v)) ? enHHMM(Number(v)) : v);
    for (let i = 0; i < 7; i++) {
      const debutBloc = 5 + i * pasBloc + 3; // 1re ligne employé du bloc
      let k = 0;
      for (const [idEmp, emp] of employes) {
        const r = debutBloc + k; k++;
        const aff = affParEmpJour2[idEmp + '|' + dates[i]];
        if (cellules['A' + r] !== emp.matricule) echec(`${dates[i]} A${r}="${cellules['A' + r]}" attendu "${emp.matricule}"`);
        // Gabarit Sécurité sans colonne M : un statut non-travail est affiché
        // entre parenthèses après le nom (colonne B).
        const stJour = (affParEmpJour2[idEmp + '|' + dates[i]] || {}).statut;
        const nomAttendu = stJour && stJour !== 'TRAVAIL' ? `${emp.nom} (${stJour})` : emp.nom;
        if (cellules['B' + r] !== nomAttendu) echec(`${dates[i]} B${r}="${cellules['B' + r]}" attendu "${nomAttendu}"`);
        // attendu : { C: {e,s} | null } — D/G/J sont les sorties de C/F/I.
        // Règle de répartition par intersection (fenêtres du modèle :
        // <12:00 matin, 12:00-18:00 après-midi, >=18:00 soir).
        const attendu = { C: null, F: null, I: null };
        if (aff && aff.statut === 'TRAVAIL') {
          for (const c of aff.creneaux) {
            const d = enM(c.heure_entree); if (d == null) continue;
            const f = Math.max(d, enM(c.heure_sortie));
            for (const [col, wD, wF] of [['C', 0, 720], ['F', 720, 1080], ['I', 1080, 1440]]) {
              const a = Math.max(d, wD), b = Math.min(f, wF);
              if (b <= a) continue;
              if (!attendu[col]) attendu[col] = { e: enHHMM(a / 1440), s: enHHMM(Math.min(b, 1439) / 1440) };
            }
          }
        }
        for (const [col, att] of Object.entries(attendu)) {
          const colS = String.fromCharCode(col.charCodeAt(0) + 1);
          const vuE = luHHMM(cellules[col + r]), vuS = luHHMM(cellules[colS + r]);
          if (att === null) {
            if (vuE !== '') echec(`${dates[i]} ${col}${r} devrait être vide, trouvé "${vuE}"`);
            if (vuS !== '') echec(`${dates[i]} ${colS}${r} devrait être vide, trouvé "${vuS}"`);
          } else if (vuE !== att.e || vuS !== att.s) {
            echec(`${dates[i]} ${col}${r}="${vuE}/${vuS}" attendu "${att.e}/${att.s}"`);
          }
        }
      }
    }

    // RECAP : total hebdo exact par employé (blocs fixes de 17 lignes,
    // lignes 124-125 réservées, RECAP sans ligne de titre à partir de 126)
    const debutRecap = 126;
    let k = 0;
    for (const [idEmp, emp] of employes) {
      const r = debutRecap + k; k++;
      const vu = Number(cellules['C' + r]);
      const att = Number((totalHebdo[idEmp] / 1440).toPrecision(15));
      if (cellules['B' + r] !== emp.nom) echec(`RECAP B${r}="${cellules['B' + r]}" attendu "${emp.nom}"`);
      if (Math.abs(vu - att) > 1e-9) echec(`RECAP ${emp.nom} C${r}=${cellules['C' + r]} attendu ${att} (${Math.round(totalHebdo[idEmp] / 60)} min)`);
    }

    // Résidus des données d'exemple
    const residus = ['ANYAH', 'AVOTRA', 'AUGUSTIN', 'EDHINO', 'HERMANN', 'JEAN CHRYS', 'RAVAKA', 'ROLAND', 'ZIANI', 'JIMMY', 'MANOELA', 'CUISINE SNACK'];
    const trouves = residus.filter((t) => xml.includes(t));
    if (trouves.length) echec('résidus du modèle : ' + trouves.join(', '));

    console.log(ecarts === 0
      ? '=== CORRESPONDANCE EXACTE : le contenu Excel = les données réelles du planning sélectionné (0 écart) ==='
      : `=== ${ecarts} écart(s) détecté(s) ===`);
    process.exit(ecarts === 0 ? 0 : 1);
  } catch (err) {
    console.error('ERREUR :', err);
    process.exit(1);
  }
})();
