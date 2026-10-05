/* SERVICE EMAIL — envoi des codes de récupération de mot de passe.
 * Configuration 100 % via variables .env (JAMAIS de mot de passe en dur) :
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE,
 *   MAIL_FROM (ex. "Zomatel <no-reply@zomatel.com>")
 *
 * - SMTP configuré   -> envoi réel via nodemailer.
 * - SMTP absent      -> MODE DÉVELOPPEMENT : le code est affiché dans la
 *   console du serveur (aucun blocage, aucun envoi). Permet de tester le
 *   workflow complet en local sans serveur de mail.
 *
 * Le module nodemailer est chargé en lazy : si le paquet n'est pas installé,
 * le service retombe proprement sur le mode console (aucun crash).
 */

const IS_SMTP_CONFIGURE = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

// Transporteur créé une seule fois (lazy require pour ne pas casser si le
// paquet nodemailer n'est pas encore installé).
let transporteur = null;
function getTransporteur() {
  if (transporteur) return transporteur;
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    const nodemailer = require('nodemailer');
    transporteur = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    return transporteur;
  } catch (err) {
    console.warn('[EMAIL] nodemailer indisponible :', err.message);
    return null;
  }
}

/**
 * Envoie un email simple (texte).
 * @param {{to:string, sujet:string, texte:string}} params
 * @returns {Promise<{envoye:boolean, mode:'smtp'|'console'}>}
 */
async function envoyerEmail({ to, sujet, texte }) {
  if (!to) throw new Error('Destinataire requis.');

  // Mode développement : SMTP non configuré -> code affiché en console.
  if (!IS_SMTP_CONFIGURE) {
    console.log('\n==========================================================');
    console.log('[EMAIL] SMTP non configuré — MODE DÉVELOPPEMENT');
    console.log(`[EMAIL] Destinataire : ${to}`);
    console.log(`[EMAIL] Sujet        : ${sujet}`);
    console.log(`[EMAIL] Contenu      : ${texte}`);
    console.log('==========================================================\n');
    return { envoye: true, mode: 'console' };
  }

  const t = getTransporteur();
  if (!t) {
    // nodemailer absent : fallback console (jamais de crash applicatif)
    console.log(`[EMAIL] (console fallback) ${sujet} -> ${to} : ${texte}`);
    return { envoye: true, mode: 'console' };
  }

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: sujet,
    text: texte,
  });
  return { envoye: true, mode: 'smtp' };
}

/**
 * Envoie le code de récupération de mot de passe.
 * @param {string} email destinataire
 * @param {string} code code à 6 chiffres (en clair DANS l'email uniquement)
 */
async function envoyerCodeRecuperation(email, code) {
  return envoyerEmail({
    to: email,
    sujet: 'Zomatel — Votre code de récupération',
    texte: [
      'Bonjour,',
      '',
      `Votre code de récupération : ${code}`,
      '',
      'Ce code est valable 15 minutes et à usage unique.',
      'Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet email.',
      '',
      '— Zomatel Planning',
    ].join('\n'),
  });
}

module.exports = { envoyerEmail, envoyerCodeRecuperation, IS_SMTP_CONFIGURE };
