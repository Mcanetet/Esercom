/**
 * Envío de correos vía SMTP (env o config Angel IA en BD).
 */
const nodemailer = require('nodemailer');
const { decrypt } = require('./crypto');

function envConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function isConfigured() {
  return envConfigured();
}

function transporterFromEnv() {
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  return {
    transporter: nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    }),
    from: process.env.SMTP_FROM || process.env.SMTP_USER
  };
}

async function transporterFromDb(db) {
  if (!db) return null;
  try {
    const cfg = await db.prepare('SELECT * FROM angel_ia_config WHERE id = 1').get();
    if (!cfg?.smtp_host || !cfg?.smtp_user || !cfg?.smtp_pass_enc) return null;
    const pass = decrypt(cfg.smtp_pass_enc);
    if (!pass) return null;
    const port = Number(cfg.smtp_port) || 587;
    return {
      transporter: nodemailer.createTransport({
        host: cfg.smtp_host,
        port,
        secure: port === 465,
        auth: { user: cfg.smtp_user, pass }
      }),
      from: cfg.smtp_from || cfg.smtp_user
    };
  } catch (_) {
    return null;
  }
}

async function sendMail({ to, subject, text, html, db }) {
  if (!to) return { sent: false, reason: 'no_recipient' };
  let pack = envConfigured() ? transporterFromEnv() : null;
  if (!pack) pack = await transporterFromDb(db);
  if (!pack) {
    console.warn('[mailer] SMTP no configurado — correo no enviado:', subject);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try {
    await pack.transporter.sendMail({
      from: pack.from,
      to,
      subject,
      text,
      html: html || String(text || '').replace(/\n/g, '<br>')
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer]', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { isConfigured, sendMail, envConfigured };
