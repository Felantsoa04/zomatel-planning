const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/db');

// PHOTO DE PROFIL — fonctionnalite minimale et isolee :
// - l'utilisateur authentifie modifie UNIQUEMENT SA photo (id issu du JWT,
//   jamais du body) : personne ne peut toucher la photo d'un autre compte ;
// - validation REELLE du fichier par octets magiques (pas seulement le
//   Content-Type envoye par le navigateur) ;
// - chemin relatif stocke en base (ex. /uploads/profiles/user_3_1690.jpg),
//   fichier physique dans backend/uploads/profiles ;
// - l'ancienne photo est supprimee du disque apres remplacement/suppression.
// Aucune modification de l'authentification, des roles ni des permissions.

const DOSSIER_UPLOADS = path.join(__dirname, '..', '..', 'uploads', 'profiles');
const TAILLE_MAX_OCTETS = 2 * 1024 * 1024; // 2 Mo
const EXTENSIONS_AUTORISEES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Detection reelle du type par octets magiques (magic bytes) :
// JPEG = FF D8 FF ; PNG = 89 50 4E 47 ; WEBP = "RIFF"...."WEBP"
function typeReel(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// Stockage en memoire : la validation des octets magiques se fait AVANT
// l'ecriture sur le disque (un fichier falsifie n'est jamais sauvegarde).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX_OCTETS, files: 1 },
});

// Middleware multer (champ attendu du formulaire : "photo")
const recevoirFichier = upload.single('photo');

// Enveloppe le callback multer en Promise propre (gestion d'erreur JSON).
function recevoirFichierAsync(req, res) {
  return new Promise((resolve, reject) => {
    recevoirFichier(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return reject(Object.assign(new Error('Image trop volumineuse (maximum 2 Mo).'), { status: 413 }));
        }
        return reject(Object.assign(new Error("Fichier non accepte."), { status: 400 }));
      }
      resolve();
    });
  });
}

function supprimerFichier(cheminRelatif) {
  if (!cheminRelatif) return;
  // cheminRelatif = "/uploads/profiles/user_3_xxx.jpg" -> nom de fichier seul,
  // on ne fait jamais confiance a un chemin complet venu de la base.
  const nom = path.basename(cheminRelatif);
  const absolu = path.join(DOSSIER_UPLOADS, nom);
  // Garde-fou : le fichier reste bien dans uploads/profiles
  if (!absolu.startsWith(DOSSIER_UPLOADS)) return;
  fs.unlink(absolu, () => {
    /* absence du fichier = rien a faire */
  });
}

// PUT /api/profile/photo  (multipart/form-data, champ "photo")
async function definirPhoto(req, res, next) {
  try {
    await recevoirFichierAsync(req, res);

    if (!req.file) {
      return res.status(400).json({ message: 'Aucune image recue (champ "photo").' });
    }

    // 1) Validation reelle : octets magiques, pas le Content-Type declare.
    const type = typeReel(req.file.buffer);
    if (!type || !EXTENSIONS_AUTORISEES[type]) {
      return res.status(415).json({
        message: 'Fichier refuse : image JPG, PNG ou WEBP attendue.',
      });
    }

    // 2) L'utilisateur concerne est UNIQUEMENT celui du JWT (req.user).
    const idUtilisateur = req.user.id_utilisateur;
    if (!idUtilisateur) {
      return res.status(401).json({ message: 'Session invalide.' });
    }

    // 3) Ancienne photo : a remplacer sur le disque apres enregistrement.
    const [[compte]] = await pool.query(
      'SELECT photo_profil FROM utilisateur WHERE id_utilisateur = ?',
      [idUtilisateur]
    );
    if (!compte) {
      return res.status(404).json({ message: 'Compte introuvable.' });
    }

    // 4) Nom sur et unique : user_<id>_<timestamp>.<ext> — le nom fourni par
    //    l'utilisateur n'est JAMAIS utilise.
    const extension = EXTENSIONS_AUTORISEES[type];
    const nomFichier = `user_${idUtilisateur}_${Date.now()}.${extension}`;

    if (!fs.existsSync(DOSSIER_UPLOADS)) {
      fs.mkdirSync(DOSSIER_UPLOADS, { recursive: true });
    }
    fs.writeFileSync(path.join(DOSSIER_UPLOADS, nomFichier), req.file.buffer);

    // 5) Chemin relatif en base (servi par Express via express.static).
    const cheminRelatif = `/uploads/profiles/${nomFichier}`;
    await pool.query(
      'UPDATE utilisateur SET photo_profil = ? WHERE id_utilisateur = ?',
      [cheminRelatif, idUtilisateur]
    );

    // 6) L'ancien fichier n'est supprime qu'apres le succes de l'ecriture.
    if (compte.photo_profil) supprimerFichier(compte.photo_profil);

    return res.json({
      message: 'Photo de profil mise a jour.',
      photo_profil: cheminRelatif,
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/profile/photo
async function supprimerPhoto(req, res, next) {
  try {
    const idUtilisateur = req.user.id_utilisateur;
    const [[compte]] = await pool.query(
      'SELECT photo_profil FROM utilisateur WHERE id_utilisateur = ?',
      [idUtilisateur]
    );
    if (!compte) {
      return res.status(404).json({ message: 'Compte introuvable.' });
    }
    if (!compte.photo_profil) {
      return res.status(404).json({ message: 'Aucune photo a supprimer.' });
    }
    supprimerFichier(compte.photo_profil);
    await pool.query(
      'UPDATE utilisateur SET photo_profil = NULL WHERE id_utilisateur = ?',
      [idUtilisateur]
    );
    return res.json({ message: 'Photo supprimee.', photo_profil: null });
  } catch (err) {
    next(err);
  }
}

module.exports = { definirPhoto, supprimerPhoto };
