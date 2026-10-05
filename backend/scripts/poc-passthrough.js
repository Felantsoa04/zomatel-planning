/* POC passthrough XML : lit le modèle, modifie des cellules par manipulation
 * XML directe dans le zip, écrit un fichier de sortie. Styles/fusions/format
 * préservés par construction (aucune resérialisation).
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const XLSX = require('xlsx');

const MODELE = path.resolve(__dirname, '..', '..', 'document utiliise', 'EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');
const SORTIE = path.resolve(__dirname, 'poc-sortie.xlsx');

const zip = new AdmZip(MODELE);
const entries = zip.getEntries();
const sheet1 = entries.find((e) => e.entryName === 'xl/worksheets/sheet1.xml');
let xml = sheet1.getData().toString('utf8');

// Modifie C7 ("entrée" -> "ENTREE-TEST") : on CONSERVE l'attribut s="96"
// (style) et on bascule t="s" (chaine partagee) vers t="inlineStr".
const avant = xml.slice(xml.indexOf('<c r="C7"'), xml.indexOf('<c r="D7"'));
console.log('AVANT C7 :', avant.slice(0, 160));
xml = xml.replace(
  /<c r="C7"([^>]*)>.*?<\/c>/s,
  (m, attrs) => {
    const style = (attrs.match(/s="(\d+)"/) || ['', ''])[1];
    return `<c r="C7"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t>ENTREE-TEST</t></is></c>`;
  }
);
// Modifie aussi une cellule NUMERIQUE (durée E8 -> 0.5 = midi) en gardant son style
xml = xml.replace(
  /<c r="E8"([^>]*)>.*?<\/c>/s,
  (m, attrs) => {
    const style = (attrs.match(/s="(\d+)"/) || ['', ''])[1];
    return `<c r="E8"${style ? ` s="${style}"` : ''}><v>0.5</v></c>`;
  }
);
sheet1.setData(xml);

zip.writeZip(SORTIE);
console.log('écrit :', SORTIE);

// Relecture pour vérifier
const wb = XLSX.readFile(SORTIE, { cellStyles: true });
console.log('C7 relu :', wb.Sheets['CUISINE SNACK']['C7']?.v);
console.log('E8 relu (durée) :', wb.Sheets['CUISINE SNACK']['E8']?.v, '(attendu 0.5)');
console.log('merges conservés :', (wb.Sheets['CUISINE SNACK']['!merges'] || []).length);
const c8 = wb.Sheets['CUISINE SNACK']['C8'];
console.log('C8 (style conservé ?) :', c8 && c8.s ? 'STYLE PRÉSENT (' + (c8.s.patternType || '?') + ')' : 'PAS DE STYLE');
