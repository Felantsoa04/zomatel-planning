/* Comparateur de fidélité EXPORT vs MODÈLE (règle gabarit par service) :
 *   1. trouve un planning VALIDÉ réel (READ-ONLY) ;
 *   2. génère l'export via le service ;
 *   3. compare cellule par cellule l'export à LA FEUILLE DU SERVICE dans le
 *      classeur modèle (repli : feuille SECURITE, sheet23) — les lignes
 *      générées occupent les MÊMES numéros que le gabarit (jour, périodes,
 *      en-têtes, employés, totaux, fantôme, espacements, récapitulatif) ;
 *   4. rendu texte des deux feuilles (modèle vs export) pour comparaison.
 * RÈGLE GABARIT PAR SERVICE : chaque service garde SON modèle (RECEPTION
 * 11 lignes employés/jour, SECURITE 12, ADMINISTRATION 8…). Les feuilles à
 * structure irrégulière (6 ou 8 blocs) utilisent le repli SECURITE.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const { genererEmploiDuTempsExcel } = require('../src/services/emploiDuTempsExcel');
const AdmZip = require('adm-zip');

const MODELE = path.resolve(__dirname, '..', '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');
const SORTIE = path.join(process.env.TEMP || '/tmp', `edt-fidelite-${Date.now()}.xlsx`);
const GABARIT_REPLI = 'xl/worksheets/sheet23.xml'; // feuille SECURITE du modèle

function lireFeuille(fichier, entree) {
  const xml = new AdmZip(fichier).getEntry(entree).getData().toString('utf8');
  const lignes = {};
  for (const m of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const c of m[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const s = (c[2].match(/s="(\d+)"/) || [])[1];
      const t = (c[2].match(/t="(\w+)"/) || [])[1];
      let v = (c[3] || '').match(/<v>([\s\S]*?)<\/v>/);
      let texte = v ? v[1] : '';
      if (t === 'inlineStr') texte = (c[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/)[1];
      const f = (c[3] || '').match(/<f[^>]*>([\s\S]*?)<\/f>/);
      cells[c[1]] = { s: s ? Number(s) : null, t: t || null, v: texte, f: f ? f[1] : null };
    }
    lignes[Number(m[1])] = cells;
  }
  return { xml, lignes };
}

/* Détermine l'entrée zip du gabarit du service, comme le service d'export :
 * feuille du modèle de nom normalisé identique, sinon feuille SECURITE. */
const normalise = (nom) => String(nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
function entreeGabaritService(z, nomService) {
  const wb = z.getEntry('xl/workbook.xml').getData().toString('utf8');
  const rels = z.getEntry('xl/_rels/workbook.xml.rels').getData().toString('utf8');
  const ridToTarget = {};
  for (const m of rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) ridToTarget[m[1]] = m[2];
  const cible = normalise(nomService);
  const candidats = new Set();
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const nomFeuille = normalise(m[1]);
    if (nomFeuille === cible) candidats.add('xl/' + ridToTarget[m[2]].replace(/^\//, ''));
  }
  if (candidats.size === 1) return [...candidats][0];
  return GABARIT_REPLI;
}

/* Blocs + récapitulatif du gabarit (mêmes règles que le générateur). */
function structure(gabaritXml) {
  const blocs = [];
  for (const m of gabaritXml.matchAll(/<c r="E(\d+)"[^>]*><f>SUM\(E(\d+):E(\d+)\)<\/f>/g)) {
    blocs.push({
      ligneJour: Number(m[2]) - 3,
      empDebut: Number(m[2]),
      empFin: Number(m[3]),
      ligneTotaux: Number(m[1]),
      ligneFantome: Number(m[1]) + 1,
    });
  }
  if (blocs.length !== 7) return null;
  const dernierFantome = Math.max(...blocs.map((b) => b.ligneFantome));
  // Récapitulatif : première ligne B(t=s)+C(sans SUM) après le dernier fantôme.
  const cellulesB = {};
  const cellulesC = {};
  for (const m of gabaritXml.matchAll(/<c r="([BC])(\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    (m[1] === 'B' ? cellulesB : cellulesC)[m[2]] = { attrs: m[3], contenue: m[4] || '' };
  }
  const dernierFantomeX = dernierFantome;
  let recapStart = null;
  for (let r = dernierFantomeX + 1; r < dernierFantomeX + 40; r++) {
    const b = cellulesB[r];
    const c = cellulesC[r];
    if (b && c && /t="s"/.test(b.attrs) && !/<f>SUM\(/.test(c.contenue)) { recapStart = r; break; }
  }
  let nbRecap = 0;
  if (recapStart) {
    let r = recapStart;
    while (cellulesB[r] && cellulesC[r] && !/<f>SUM\(/.test(cellulesC[r].contenue)) { nbRecap++; r++; }
  }
  return { blocs, recapStart: recapStart || (dernierFantome + 1), nbRecap };
}

(async () => {
  try {
    // 1. Planning VALIDÉ réel (READ-ONLY)
    const [rows] = await pool.query(
      `SELECT p.id_planning, p.service_id, s.nom_service, p.numero_semaine, p.annee,
              COUNT(a.id_affectation) AS nb_aff
       FROM planning p
       JOIN service s ON s.id_service = p.service_id
       LEFT JOIN affectation a ON a.planning_id = p.id_planning
       WHERE p.statut = 'VALIDE'
       GROUP BY p.id_planning
       ORDER BY nb_aff DESC`
    );
    if (!rows.length) { console.log('Aucun planning VALIDE en base.'); process.exit(0); }
    const cible = rows[0];
    console.log(`Planning VALIDÉ retenu : #${cible.id_planning} ${cible.nom_service} S${cible.numero_semaine}/${cible.annee} (${cible.nb_aff} affectations)`);

    // 2. Génération
    const res = await genererEmploiDuTempsExcel({ id_planning: cible.id_planning, sortie: SORTIE });
    console.log(`Export généré : ${SORTIE} (${res.nbEmployes} employés)`);

    // 3. Comparaison de fidélité vs LA FEUILLE DU SERVICE du modèle
    const entree = entreeGabaritService(new AdmZip(MODELE), cible.nom_service);
    const M = lireFeuille(MODELE, entree);
    const E = lireFeuille(SORTIE, 'xl/worksheets/sheet1.xml');
    const st = structure(M.xml);
    if (!st) { console.log('Gabarit du modèle irrégulier -> export sur repli SECURITE'); return; }
    const recapFin = st.recapStart + st.nbRecap - 1;
    console.log(`Gabarit utilisé : ${entree} (employés/jour=${st.blocs[0].empFin - st.blocs[0].empDebut + 1}, récap=${st.recapStart}..${recapFin})`);

    // Les lignes générées occupent les MÊMES numéros que le gabarit.
    let ecarts = 0;
    for (let r = 2; r <= recapFin; r++) {
      const lm = M.lignes[r] || {};
      const le = E.lignes[r] || {};
      // Colonnes du gabarit uniquement (l'export ne recrée jamais de colonne)
      for (const col of Object.keys(lm)) {
        const sm = lm[col].s;
        const se = le[col] ? le[col].s : sm; // absent à l'export = vide, même style non requis
        if (sm !== se && le[col]) {
          ecarts++;
          if (ecarts <= 12) console.log(`ÉCART : ligne ${r} modèle ${col} s=${sm} vs export s=${se}`);
        }
      }
      // Cellules générées absentes du gabarit (aucune colonne inventée)
      for (const col of Object.keys(le)) {
        if (!lm[col]) { le[col] && (ecarts++, ecarts <= 12 && console.log(`ÉCART : colonne supplémentaire ${col}${r} à l'export`)); }
      }
    }
    console.log(ecarts === 0
      ? 'FIDÉLITÉ : toutes les cellules homologues portent les styles EXACTS du gabarit du service (0 écart).'
      : `ATTENTION : ${ecarts} écart(s) de style détecté(s).`);

    // 4. Rendu texte : modèle (bloc lundi) vs export (bloc lundi)
    const rendre = (lignes, de, a, titre) => {
      console.log(`\n--- ${titre} (lignes ${de}-${a}) ---`);
      for (let r = de; r <= a; r++) {
        const l = lignes[r];
        if (!l) continue;
        const txt = Object.entries(l).map(([col, c]) => {
          const v = c.f ? c.f + '=' + c.v : c.v;
          return `${col}[s${c.s}]${v !== '' ? '=' + v : ''}`;
        }).join(' | ');
        console.log(`r${r}: ${txt}`);
      }
    };
    const b1 = st.blocs[0];
    rendre(M.lignes, b1.ligneJour, b1.empDebut + 2, `MODÈLE ${entree} début bloc LUNDI`);
    rendre(E.lignes, b1.ligneJour, b1.empDebut + 2, 'EXPORT bloc LUNDI');
    if (st.nbRecap) {
      rendre(M.lignes, st.recapStart, st.recapStart + 2, 'MODÈLE RECAP');
      rendre(E.lignes, st.recapStart, st.recapStart + 2, 'EXPORT RECAP');
    }

    console.log('\nOK — comparaison terminée.');
    process.exit(ecarts === 0 ? 0 : 1);
  } catch (err) {
    console.error('ERREUR :', err.message);
    process.exit(1);
  }
})();
