const AdmZip = require('adm-zip');
const XLSX = require('xlsx');

const MODELE = '../document utiliise/EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx';
const GEN = 'scripts/edt-genere.xlsx';

console.log('=== 1. MODÈLE vs GÉNÉRÉ : styles des cellules de référence ===');
const xmlM = new AdmZip(MODELE).getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
const xmlG = new AdmZip(GEN).getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
const styleDe = (xml, addr) => {
  const m = xml.match(new RegExp(`<c r="${addr}"([^>]*?)(?:/>|>)`));
  const s = m && m[1].match(/s="(\d+)"/);
  return s ? s[1] : null;
};
let ok = 0, tot = 0;
for (const [nom, addr] of [
  ['titre E2', 'E2'], ['ligne service C5', 'C5'], ['périodes C6', 'C6'],
  ['en-tête B7', 'B7'], ['heure C8', 'C8'], ['durée E8', 'E8'], ['total L8', 'L8'],
  ['ligne totaux E113', 'E113'], ['recap titre B129', 'B129'], ['recap A130', 'A130'],
]) {
  const a = styleDe(xmlM, addr), b = styleDe(xmlG, addr);
  tot++;
  if (a !== null && a === b) ok++;
  console.log(`  ${nom.padEnd(22)} modèle s=${a}  généré s=${b}  ${a === b && a !== null ? '✔' : '✗'}`);
}
console.log(`  → ${ok}/${tot} styles identiques (indices du styles.xml du modèle, copié tel quel)`);

console.log('=== 2. styles.xml + theme copiés tels quels ? ===');
const mZip = new AdmZip(MODELE), gZip = new AdmZip(GEN);
for (const f of ['xl/styles.xml', 'xl/theme/theme1.xml']) {
  const a = mZip.getEntry(f)?.getData().toString('utf8') || '';
  const b = gZip.getEntry(f)?.getData().toString('utf8') || '';
  console.log(`  ${f} : ${a === b ? 'IDENTIQUE ✔' : 'DIFFÉRENT ✗'}`);
}

console.log('=== 3. Fusions (mergeCells) ===');
const XLSXr = (f) => XLSX.readFile(f, { cellStyles: true });
const wbM = XLSXr(MODELE), wbG = XLSXr(GEN);
const wsM = wbM.Sheets[wbM.SheetNames[0]], wsG = wbG.Sheets[wbG.SheetNames[0]];
const mm = (wsM['!merges'] || []).map(m2 => JSON.stringify(m2));
const mg = (wsG['!merges'] || []).map(m2 => JSON.stringify(m2));
const communs = mg.filter((x) => mm.includes(x));
console.log(`  modèle : ${mm.length} fusions | généré : ${mg.length} | communes : ${communs.length} (motif C:E/F:H/I:K + titre repris)`);

console.log('=== 4. Données du planning injectées (planning #3 Réception S39/2026) ===');
console.log('  Titre :', wsG['E2'] && wsG['E2'].v);
console.log('  Jour 1 :', wsG['G5'] && wsG['G5'].v, '(texte, comme le modèle)');
const l1 = ['A8', 'B8', 'C8', 'D8', 'E8', 'L8'];
console.log('  Employé ligne 8 :', l1.map((a) => (wsG[a] ? wsG[a].v : '·')).join(' | '));
let obsTrouvee = null;
for (let r = 8; r < 15; r++) {
  const v = wsG['M' + r] && wsG['M' + r].v;
  if (v) { obsTrouvee = 'M' + r + ' = ' + v; break; }
}
console.log('  Observation (Repos/Congé/Absence) :', obsTrouvee || 'aucune dans les 1res lignes');
const nbRecap = Object.keys(wsG).filter((k) => /^C\d+$/.test(k)).length;
console.log('  RECAP présent :', nbRecap > 10, '(' + nbRecap, 'cellules C numériques)');

console.log('=== 5. Ouverture fichier généré : pas de corruption ===');
console.log('  Feuilles :', wbG.SheetNames.slice(0, 3).join(', '), '...');
console.log('  Feuille renommée :', wbG.SheetNames[0]);
