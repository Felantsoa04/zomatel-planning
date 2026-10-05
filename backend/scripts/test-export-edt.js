/* Comparateur de fidélité EXPORT vs MODÈLE (gabarit SECURITE) :
 *   1. trouve un planning VALIDÉ réel (READ-ONLY) ;
 *   2. génère l'export via le service ;
 *   3. vérifie cellule par cellule que chaque cellule de l'export porte le
 *      même indice de style (s=) que sa cellule homologue de la feuille
 *      SECURITE du modèle (sheet23 = modèle de tableau du projet) ;
 *   4. rendu texte des deux feuilles (modèle vs export) pour comparaison.
 * Cartographie Sécurité : r2 titre, r4 espace, r5 jour, r6 périodes, r7
 * entêtes, r8..r19 employés (canoniques complètes r16..r19), r20 totaux
 * (SUM) + fantôme N, r21 fantôme N, bloc suivant +17, RECAP r126+ (sans
 * titre, A s3 / B s24 / C s21).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const { genererEmploiDuTempsExcel } = require('../src/services/emploiDuTempsExcel');
const AdmZip = require('adm-zip');

const MODELE = path.resolve(__dirname, '..', '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');
const SORTIE = path.join(process.env.TEMP || '/tmp', `edt-fidelite-${Date.now()}.xlsx`);
const GABARIT = 'xl/worksheets/sheet23.xml'; // feuille SECURITE du modèle

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

    // 3. Comparaison de fidélité vs feuille SECURITE du modèle
    const M = lireFeuille(MODELE, GABARIT);
    const E = lireFeuille(SORTIE, 'xl/worksheets/sheet1.xml');

    // Cartographie des lignes homologues (gabarit Sécurité) :
    // bloc = jour(5) + périodes(6) + entêtes(7) + N employés + totaux(20) +
    // fantôme(21) = 3 + N + 2 lignes ; employés canoniques = r16..r19 (complètes).
    const nb = res.nbEmployes;
    const pasExport = 3 + nb + 2;
    const homologues = [[2, 2, 'titre'], [4, 4, 'espace']];
    for (let i = 0; i < 7; i++) {
      const re = 5 + i * pasExport;
      homologues.push([5, re, 'jour']);
      homologues.push([6, re + 1, 'periodes']);
      homologues.push([7, re + 2, 'entetes']);
      for (let k = 0; k < nb; k++) {
        homologues.push([16 + (k % 4), re + 3 + k, 'employe']);
      }
      homologues.push([20, re + 3 + nb, 'totaux']);
      homologues.push([21, re + 4 + nb, 'fantome']);
    }
    const recapE = 5 + 7 * pasExport;
    for (let k = 0; k < nb; k++) homologues.push([126, recapE + k, 'recap']);

    let ecarts = 0;
    for (const [rm, re, type] of homologues) {
      const lm = M.lignes[rm] || {};
      const le = E.lignes[re] || {};
      const cols = new Set([...Object.keys(lm), ...Object.keys(le)]);
      for (const col of cols) {
        const sm = lm[col] ? lm[col].s : null;
        const se = le[col] ? le[col].s : null;
        if (sm !== se) {
          ecarts++;
          if (ecarts <= 12) console.log(`ÉCART ${type} : modèle ${col}${rm} s=${sm} vs export ${col}${re} s=${se}`);
        }
      }
    }
    console.log(ecarts === 0
      ? 'FIDÉLITÉ : toutes les cellules homologues portent les styles EXACTS du gabarit SECURITE (0 écart).'
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
    rendre(M.lignes, 5, 9, 'MODÈLE SECURITE bloc LUNDI');
    rendre(E.lignes, 5, 5 + 2 + nb + 1, 'EXPORT bloc LUNDI');
    rendre(M.lignes, 126, 128, 'MODÈLE SECURITE RECAP');
    rendre(E.lignes, recapE, recapE + 2, 'EXPORT RECAP');

    console.log('\nOK — comparaison terminée.');
    process.exit(ecarts === 0 ? 0 : 1);
  } catch (err) {
    console.error('ERREUR :', err.message);
    process.exit(1);
  }
})();
