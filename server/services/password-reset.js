/**
 * Recuperación de contraseña por código enviado al correo.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendMail, isConfigured } = require('./mailer');

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

async function ensureResetColumns(db) {
  const cols = db.driver === 'mysql'
    ? [
      ['reset_codigo_hash', 'VARCHAR(128) NULL'],
      ['reset_expira', 'DATETIME NULL'],
      ['reset_enviado_at', 'DATETIME NULL'],
      ['reset_intentos', 'INT NOT NULL DEFAULT 0']
    ]
    : [
      ['reset_codigo_hash', 'TEXT'],
      ['reset_expira', 'TEXT'],
      ['reset_enviado_at', 'TEXT'],
      ['reset_intentos', 'INTEGER NOT NULL DEFAULT 0']
    ];

  for (const [col, ddl] of cols) {
    try {
      if (db.driver === 'mysql') {
        const rows = await db.prepare(`
          SELECT 1 AS ok FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'usuarios' AND column_name = ?
        `).all(col);
        if (rows.length) continue;
        await db.exec(`ALTER TABLE usuarios ADD COLUMN ${col} ${ddl}`);
      } else {
        const info = await db.prepare(`PRAGMA table_info(usuarios)`).all();
        if (info.some((c) => c.name === col)) continue;
        await db.exec(`ALTER TABLE usuarios ADD COLUMN ${col} ${ddl}`);
      }
    } catch (err) {
      if (!/duplicate column/i.test(err.message || '')) {
        console.warn('[password-reset] column', col, err.message);
      }
    }
  }
}

function genCode() {
  return String(crypto.randomInt(100000, 999999));
}

function nowIso() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function findUserByEmail(db, email) {
  return db.prepare(`
    SELECT id, nombre, apellido, email, activo
    FROM usuarios
    WHERE LOWER(email) = LOWER(?) AND (activo = 1 OR activo IS NULL)
  `).get(String(email).trim());
}

async function enviarCodigoRecuperacion(db, { email, empresaNombre }) {
  await ensureResetColumns(db);
  const user = await findUserByEmail(db, email);

  // Respuesta genérica (no revelar si el correo existe)
  const generic = {
    success: true,
    message: 'Si el correo está registrado, enviamos un código de verificación. Revisa tu bandeja (y spam).'
  };

  if (!user) return generic;

  if (!isConfigured()) {
    return {
      success: false,
      message: 'El envío de correos no está configurado en el servidor. Contacte al administrador.'
    };
  }

  const row = await db.prepare(`
    SELECT reset_enviado_at FROM usuarios WHERE id = ?
  `).get(user.id);
  const last = parseDate(row?.reset_enviado_at);
  if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last.getTime())) / 1000);
    return {
      success: false,
      message: `Espere ${wait}s antes de solicitar otro código`
    };
  }

  const code = genCode();
  const hash = bcrypt.hashSync(code, 8);
  const expira = new Date(Date.now() + CODE_TTL_MS);
  const expiraStr = expira.toISOString().slice(0, 19).replace('T', ' ');
  const enviado = nowIso();

  await db.prepare(`
    UPDATE usuarios
    SET reset_codigo_hash = ?, reset_expira = ?, reset_enviado_at = ?, reset_intentos = 0
    WHERE id = ?
  `).run(hash, expiraStr, enviado, user.id);

  const nombre = [user.nombre, user.apellido].filter(Boolean).join(' ').trim() || 'Usuario';
  const subject = 'ESERCOM — Código para recuperar contraseña';
  const text = [
    `Hola ${nombre},`,
    '',
    `Tu código de verificación para restablecer la contraseña en ESERCOM${empresaNombre ? ` (${empresaNombre})` : ''} es:`,
    '',
    `    ${code}`,
    '',
    'Válido por 15 minutos. Si no solicitaste este cambio, ignora este correo.',
    '',
    'ESERCOM'
  ].join('\n');

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
      <h2 style="color:#0284c7;margin:0 0 12px">ESERCOM</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Tu código para recuperar la contraseña${empresaNombre ? ` en <strong>${empresaNombre}</strong>` : ''} es:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;background:#f1f5f9;padding:16px 20px;border-radius:10px;text-align:center;margin:20px 0">${code}</p>
      <p style="color:#64748b;font-size:14px">Válido por <strong>15 minutos</strong>. Si no pediste este cambio, ignora este mensaje.</p>
    </div>
  `;

  const mail = await sendMail({ to: user.email, subject, text, html });
  if (!mail.sent) {
    console.warn('[password-reset] no enviado:', mail.reason, 'code=', code);
    return {
      success: false,
      message: 'No se pudo enviar el correo. Intente más tarde o contacte al administrador.'
    };
  }

  return generic;
}

async function restablecerConCodigo(db, { email, codigo, passwordNueva }) {
  await ensureResetColumns(db);
  const user = await findUserByEmail(db, email);
  if (!user) {
    return { success: false, message: 'Código inválido o expirado' };
  }

  const row = await db.prepare(`
    SELECT id, reset_codigo_hash, reset_expira, reset_intentos
    FROM usuarios WHERE id = ?
  `).get(user.id);

  if (!row?.reset_codigo_hash || !row.reset_expira) {
    return { success: false, message: 'Solicite primero un código de verificación' };
  }

  const exp = parseDate(row.reset_expira);
  if (!exp || exp.getTime() < Date.now()) {
    await db.prepare(`
      UPDATE usuarios SET reset_codigo_hash = NULL, reset_expira = NULL, reset_intentos = 0 WHERE id = ?
    `).run(user.id);
    return { success: false, message: 'El código expiró. Solicite uno nuevo' };
  }

  const intentos = Number(row.reset_intentos) || 0;
  if (intentos >= MAX_ATTEMPTS) {
    return { success: false, message: 'Demasiados intentos. Solicite un código nuevo' };
  }

  const ok = bcrypt.compareSync(String(codigo).trim(), String(row.reset_codigo_hash));
  if (!ok) {
    await db.prepare(`UPDATE usuarios SET reset_intentos = ? WHERE id = ?`).run(intentos + 1, user.id);
    return { success: false, message: 'Código incorrecto' };
  }

  const nueva = String(passwordNueva || '').trim();
  if (nueva.length < 6) {
    return { success: false, message: 'La nueva contraseña debe tener al menos 6 caracteres' };
  }

  const newHash = bcrypt.hashSync(nueva, 10);
  await db.prepare(`
    UPDATE usuarios
    SET password = ?, reset_codigo_hash = NULL, reset_expira = NULL, reset_enviado_at = NULL, reset_intentos = 0
    WHERE id = ?
  `).run(newHash, user.id);

  return { success: true, message: 'Contraseña actualizada. Ya puede iniciar sesión' };
}

module.exports = {
  enviarCodigoRecuperacion,
  restablecerConCodigo,
  ensureResetColumns
};
