const AdmZip = require('adm-zip');
const zip = new AdmZip('../document utiliise/EMPLOI DU TEMPS ZOMATEL WEEK 37_2026.xlsx');
const suspectes = /[:*?"<>|\\]/;
for (const e of zip.getEntries()) {
  if (suspectes.test(e.entryName)) {
    console.log('ENTREE SUSPECTE :', JSON.stringify(e.entryName));
  }
}
console.log('total entrées :', zip.getEntries().length);
console.log('exemples :', zip.getEntries().slice(0, 5).map((e) => e.entryName));
