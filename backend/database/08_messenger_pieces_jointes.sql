-- ======================================================================
-- MIGRATION 08 — MESSENGER : PIECES JOINTES (image / video / audio / fichier)
-- Additive et idempotente : aucun contenu existant n'est modifie ni supprime.
-- Les messages texte restent identiques (type_message = 'texte' par defaut).
-- ======================================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS type_message ENUM('texte','image','video','audio','fichier')
    NOT NULL DEFAULT 'texte' AFTER contenu,
  ADD COLUMN IF NOT EXISTS fichier_chemin VARCHAR(255) DEFAULT NULL AFTER type_message,
  ADD COLUMN IF NOT EXISTS nom_fichier    VARCHAR(255) DEFAULT NULL AFTER fichier_chemin,
  ADD COLUMN IF NOT EXISTS mime_type      VARCHAR(120) DEFAULT NULL AFTER nom_fichier;

-- Recherche pratique : pieces jointes d'une conversation (chemin relatif
-- servi par Express via express.static, comme les photos de profil).
-- fichier_chemin ex. : /uploads/messenger/conv1_msg_<timestamp>.jpg
