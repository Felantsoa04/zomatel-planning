/*
 * TEST OCR de bout en bout (sans toucher la base de données) :
 *   1. Génère une image de planning imprimé (SVG -> PNG via sharp) avec une
 *      VRAIE géométrie de grille : colonne noms + colonnes de jours.
 *   2. Lance le service OCR dessus.
 *   3. Vérifie les points clés : service, semaine, association noms/BD,
 *      créneaux par jour, REPOS/CONGÉ, « FS » laissé vide (aucune invention),
 *      nom inconnu proposé au RH (employe_id null, aucun employé créé).
 * Usage : node backend/scripts/test-ocr-planning.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { analyserPlanning, scoreNom, normaliser } = require('../src/services/ocrPlannings');

/* Liste des services/employés « base de données » du test */
const SERVICES = [
  { id_service: 1, nom_service: 'Réception' },
  { id_service: 2, nom_service: 'Sécurité' },
  { id_service: 3, nom_service: 'Administration' },
];
const EMPLOYES = [
  { id_employe: 11, nom: 'RAKOTO Jean', service_id: 1, matricule: 'EMP-11', fonction: '', reference_hebdo: 48 },
  { id_employe: 12, nom: 'ANDRIAMANANA Lucie', service_id: 1, matricule: 'EMP-12', fonction: '', reference_hebdo: 48 },
  { id_employe: 13, nom: 'RAMAIOSON Feno', service_id: 1, matricule: 'EMP-13', fonction: '', reference_hebdo: 48 },
  { id_employe: 21, nom: 'RABE Georges', service_id: 2, matricule: 'EMP-21', fonction: 'Chef de poste', reference_hebdo: 48 },
];

/* Image de test : tableau imprimé avec colonnes réellement séparées
 * (x fixes par colonne, centrage identique aux en-têtes). */
const LARGEUR = 2400;
const X_JOURS = [620, 1120, 1620, 2120]; // centres LUNDI..JEUDI

function cellule(texteX, y, contenu, ancre = 'middle') {
  return `<text x="${texteX}" y="${y}" text-anchor="${ancre}" font-family="DejaVu Sans, Arial" font-size="40" fill="black">${contenu}</text>`;
}

function svgPlanning() {
  const emplois = [
    { nom: 'RAKOTO Jean', cellules: ['07:00-15:00', '07:00-15:00', 'REPOS', ''] },
    { nom: 'ANDRIAMANANA Lucie', cellules: ['08:00-16:00', '18:00-FS', '08:00-16:00', ''] },
    { nom: 'RAMAIOSON Feno', cellules: ['CONGE', '06:00-14:00', '06:00-14:00', ''] },
    { nom: 'RANAIVO Hery', cellules: ['08:00-12:00', '', '08:00-12:00', ''] },
  ];
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${LARGEUR}" height="1120">`);
  parts.push('<rect width="100%" height="100%" fill="white"/>');
  parts.push('<text x="700" y="100" font-family="DejaVu Sans, Arial" font-size="64" fill="black" font-weight="bold" text-anchor="middle">EMPLOI DU TEMPS WEEK 49_2026</text>');
  parts.push(cellule(60, 240, 'Réception', 'start'));
  /* En-têtes : noms + jours (les x des libellés définissent les colonnes) */
  parts.push(cellule(60, 420, 'NOM', 'start'));
  ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI'].forEach((j, i) => parts.push(cellule(X_JOURS[i], 420, j)));
  /* Lignes de données : une cellule par colonne */
  emplois.forEach((e, k) => {
    const y = 560 + k * 160;
    parts.push(cellule(60, y, e.nom, 'start'));
    e.cellules.forEach((c, i) => { if (c) parts.push(cellule(X_JOURS[i], y, c)); });
  });
  parts.push('</svg>');
  return Buffer.from(parts.join('\n'));
}

(async () => {
  const image = path.resolve(__dirname, 'tmp-ocr-planning.png');
  await sharp(svgPlanning()).png().toFile(image);
  console.log('Image de test générée :', image);

  const donnees = await analyserPlanning(image, SERVICES, EMPLOYES, (p) => {
    process.stdout.write(`\rOCR progression : ${(p * 100).toFixed(0)}%   `);
  });
  console.log('\n\n=== RÉSULTAT OCR (JSON) ===');
  console.log(JSON.stringify(donnees, null, 2));

  /* --- Vérifications --- */
  const verdicts = [];
  const ok = (nom, cond) => verdicts.push({ nom, ok: !!cond });
  const rakoto = donnees.employes.find((e) => e.nom_bd === 'RAKOTO Jean');
  const lucie = donnees.employes.find((e) => e.nom_bd === 'ANDRIAMANANA Lucie');
  const feno = donnees.employes.find((e) => e.nom_bd === 'RAMAIOSON Feno');
  const inconnu = donnees.employes.find((e) => e.nom_ocr && e.nom_ocr.includes('RANAIVO'));

  // Dates ISO de la semaine 49/2026 : lundi 2026-11-30 .. jeudi 2026-12-03
  ok('Semaine 49 reconnue', donnees.semaine.numero === 49);
  ok('Année 2026 reconnue', donnees.semaine.annee === 2026);
  ok('Service = Réception', donnees.service.id === 1);
  ok('RAKOTO Jean associé à la base (id 11)', rakoto && rakoto.employe_id === 11);
  ok('Créneau LUNDI RAKOTO (07:00-15:00)',
    rakoto && rakoto.jours['2026-11-30'] && rakoto.jours['2026-11-30'].creneaux.length === 1
    && rakoto.jours['2026-11-30'].creneaux[0].heure_entree === '07:00'
    && rakoto.jours['2026-11-30'].creneaux[0].heure_sortie === '15:00');
  ok('MARDI RAKOTO distinct du LUNDI (07:00-15:00)',
    rakoto && rakoto.jours['2026-12-01'] && rakoto.jours['2026-12-01'].creneaux.length === 1
    && rakoto.jours['2026-12-01'].creneaux[0].heure_sortie === '15:00');
  ok('REPOS MERCREDI RAKOTO', rakoto && rakoto.jours['2026-12-02'] && rakoto.jours['2026-12-02'].statut === 'REPOS');
  ok('« FS » pour Lucie: créneau 18:00 sans heure de sortie (aucune invention)',
    lucie && lucie.jours['2026-12-01'] && lucie.jours['2026-12-01'].creneaux.length === 1
    && lucie.jours['2026-12-01'].creneaux[0].heure_entree === '18:00'
    && (lucie.jours['2026-12-01'].creneaux[0].heure_sortie == null));
  ok('Alerte « FS » présente', donnees.alertes.some((a) => a.includes('FS')));
  ok('CONGÉ LUNDI Feno', feno && feno.jours['2026-11-30'] && feno.jours['2026-11-30'].statut === 'CONGE');
  ok('Nom inconnu « RANAIVO Hery » proposé sans être créé (employe_id null)',
    inconnu && inconnu.employe_id == null);
  ok('Aucun employé créé automatiquement', !donnees.employes.some((e) => e.employe_id == null && e.nom_bd != null));
  ok('Aucune alerte sur le nom de RAKOTO lui-même', !donnees.alertes.some((a) => a.includes('RAKOTO') && a.includes('non interpretable')));

  console.log('\n=== VÉRIFICATIONS ===');
  let reussis = 0;
  for (const v of verdicts) {
    console.log(v.ok ? `OK   ${v.nom}` : `ECHEC ${v.nom}`);
    if (v.ok) reussis++;
  }
  console.log(`\n${reussis}/${verdicts.length} vérifications réussies.`);
  try { fs.unlinkSync(image); } catch { /* nettoyage optionnel */ }
  process.exit(reussis === verdicts.length ? 0 : 1);
})().catch((err) => {
  console.error('ECHEC test OCR :', err);
  process.exit(1);
});
