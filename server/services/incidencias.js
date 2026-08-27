/**
 * Incidencias de soporte: usuario reporta problema (con foto) → notifica admin/subadmin.
 */
const fs = require('fs');
const path = require('path');
const { sendMail } = require('./mailer');

const TABLE = 'incidencias_soporte';
const DATA_ROOT = path.join(__dirname, '..', '..', 'data', 'incidencias');
const LEGACY_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads', 'incidencias');

const ESTADOS = ['Abierta', 'En proceso', 'Resuelta', 'Cerrada'];

function isAdminOrSubadmin(user) {
  if (!user) return false;
  if (Number(user.rol_id) === 1) return true;
  if (Array.isArray(user.rol_ids) && user.rol_ids.map(Number).includes(1)) return true;
  const names = [
    user.rol,
    ...(Array.isArray(user.roles) ? user.roles : [])
  ].join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return /\badmin|\badministrador|\bsubadmin|\bsubadministrador|\bsub-administrador/.test(names)
    || names.includes('admin');
}

async function ensureIncidenciasSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(32) NOT NULL,
        titulo VARCHAR(255) NOT NULL,
        descripcion TEXT NOT NULL,
        foto_ruta VARCHAR(512) NULL,
        origen VARCHAR(32) NOT NULL DEFAULT 'modulo',
        categoria VARCHAR(64) NULL,
        estado VARCHAR(32) NOT NULL DEFAULT 'Abierta',
        prioridad VARCHAR(16) NOT NULL DEFAULT 'media',
        solicitante_id INT NOT NULL,
        asignado_id INT NULL,
        admin_nota TEXT NULL,
        empresa_slug VARCHAR(64) NULL,
        eliminado TINYINT NOT NULL DEFAULT 0,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME NULL,
        fecha_cierre DATETIME NULL,
        INDEX idx_inc_estado (estado),
        INDEX idx_inc_solicitante (solicitante_id)
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL,
        titulo TEXT NOT NULL,
        descripcion TEXT NOT NULL,
        foto_ruta TEXT,
        origen TEXT NOT NULL DEFAULT 'modulo',
        categoria TEXT,
        estado TEXT NOT NULL DEFAULT 'Abierta',
        prioridad TEXT NOT NULL DEFAULT 'media',
        solicitante_id INTEGER NOT NULL,
        asignado_id INTEGER,
        admin_nota TEXT,
        empresa_slug TEXT,
        eliminado INTEGER NOT NULL DEFAULT 0,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
        fecha_actualizacion TEXT,
        fecha_cierre TEXT
      )
    `);
  }
}

async function nextCodigo(db) {
  const row = await db.prepare(`
    SELECT codigo AS c FROM ${TABLE} WHERE codigo LIKE 'INC-%' ORDER BY id DESC LIMIT 1
  `).get();
  let n = 1;
  if (row?.c) {
    const m = String(row.c).match(/INC-(\d+)/i);
    if (m) n = Number(m[1]) + 1;
  }
  return `INC-${String(n).padStart(5, '0')}`;
}

async function saveIncidenciaPhoto(dataUrl, empresaSlug = 'shared') {
  if (!dataUrl) {
    throw Object.assign(new Error('Foto requerida'), { status: 400 });
  }
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:image\/([a-z0-9+.-]+)(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) {
    throw Object.assign(new Error('Formato de imagen inválido. Usa JPG o PNG.'), { status: 400 });
  }
  const kind = String(match[1] || '').toLowerCase();
  if (/heic|heif|tiff|tif|svg/.test(kind)) {
    throw Object.assign(new Error('Formato no soportado (HEIC/HEIF). Usa JPEG o PNG.'), { status: 400 });
  }
  const ext = kind === 'jpeg' || kind === 'jpg' ? 'jpg' : (kind === 'png' ? 'png' : (kind === 'webp' ? 'webp' : 'jpg'));
  let buf;
  try {
    buf = Buffer.from(match[2], 'base64');
  } catch (_) {
    throw Object.assign(new Error('No se pudo decodificar la imagen'), { status: 400 });
  }
  if (!buf.length) throw Object.assign(new Error('Imagen vacía'), { status: 400 });
  if (buf.length > 8 * 1024 * 1024) {
    throw Object.assign(new Error('La imagen supera 8 MB'), { status: 400 });
  }

  const slug = String(empresaSlug || 'shared').replace(/[^a-z0-9_-]/gi, '') || 'shared';
  const filename = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const candidates = [
    path.join(DATA_ROOT, slug),
    path.join(LEGACY_ROOT, slug),
    LEGACY_ROOT
  ];
  let written = null;
  let lastErr = null;
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fullPath = path.join(dir, filename);
      fs.writeFileSync(fullPath, buf);
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size < 1) throw new Error('Escritura incompleta');
      written = { dir, fullPath };
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!written) {
    throw Object.assign(
      new Error(`No se pudo guardar la foto (${lastErr?.message || 'sin permiso'})`),
      { status: 500 }
    );
  }
  return `/api/modulos/incidencias/foto/${slug}/${filename}`;
}

function resolveIncidenciaPhoto(empresaParam, filename) {
  const slug = String(empresaParam || '').replace(/[^a-z0-9_-]/gi, '');
  const file = path.basename(String(filename || ''));
  if (!slug || !file || !/\.(jpe?g|png|webp|gif)$/i.test(file)) return null;
  const candidates = [
    path.resolve(path.join(DATA_ROOT, slug, file)),
    path.resolve(path.join(LEGACY_ROOT, slug, file)),
    path.resolve(path.join(LEGACY_ROOT, file))
  ];
  const roots = [path.resolve(DATA_ROOT), path.resolve(LEGACY_ROOT)];
  for (const full of candidates) {
    if (!roots.some((r) => full.startsWith(r + path.sep) || full === r)) continue;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

async function listAdminRecipients(db) {
  const rows = await db.prepare(`
    SELECT DISTINCT u.id, u.email, u.nombre, u.apellido,
           COALESCE(r.nombre, '') AS rol_nombre, u.rol_id, u.rol_ids
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
    WHERE u.activo = 1
      AND u.email IS NOT NULL AND TRIM(u.email) != ''
  `).all();

  return (rows || []).filter((u) => {
    if (Number(u.rol_id) === 1) return true;
    try {
      const ids = typeof u.rol_ids === 'string' ? JSON.parse(u.rol_ids) : u.rol_ids;
      if (Array.isArray(ids) && ids.map(Number).includes(1)) return true;
    } catch (_) { /* ignore */ }
    const n = String(u.rol_nombre || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    return /\badmin|\badministrador|\bsubadmin|\bsubadministrador|\bsub-administrador/.test(n)
      || n.includes('admin');
  }).map((u) => ({
    id: u.id,
    email: u.email,
    nombre: `${u.nombre || ''} ${u.apellido || ''}`.trim()
  }));
}

async function createAngelAlertsForAdmins(db, incidencia, admins) {
  for (const a of admins || []) {
    try {
      await db.prepare(`
        INSERT INTO angel_ia_alertas (tipo, severidad, titulo, mensaje, modulo, referencia, usuario_id, leida)
        VALUES ('incidencia', 'alta', ?, ?, 'incidencias', ?, ?, 0)
      `).run(
        `Incidencia ${incidencia.codigo}`,
        `${incidencia.titulo}\n${String(incidencia.descripcion || '').slice(0, 280)}`,
        String(incidencia.id),
        a.id
      );
    } catch (_) { /* tabla puede no existir en entornos viejos */ }
  }
}

async function notifyAdmins(db, incidencia, solicitante) {
  const admins = await listAdminRecipients(db);
  await createAngelAlertsForAdmins(db, incidencia, admins);
  const emails = [...new Set(admins.map((a) => a.email).filter(Boolean))];
  if (!emails.length) {
    return { emailed: 0, alerted: admins.length, reason: 'sin_destinatarios' };
  }
  const who = solicitante
    ? `${solicitante.nombre || ''} ${solicitante.apellido || ''}`.trim() || solicitante.email
    : `Usuario #${incidencia.solicitante_id}`;
  const subject = `[ESERCOM] Nueva incidencia ${incidencia.codigo}: ${incidencia.titulo}`;
  const text = [
    `Se registró una nueva incidencia de soporte.`,
    '',
    `Código: ${incidencia.codigo}`,
    `Título: ${incidencia.titulo}`,
    `Reportado por: ${who}${solicitante?.email ? ` (${solicitante.email})` : ''}`,
    `Origen: ${incidencia.origen || 'modulo'}`,
    `Prioridad: ${incidencia.prioridad || 'media'}`,
    '',
    'Descripción:',
    incidencia.descripcion || '—',
    '',
    incidencia.foto_ruta ? `Foto adjunta: disponible en el módulo Incidencias.` : 'Sin foto.',
    '',
    'Revisa y gestiona en: /incidencias.html'
  ].join('\n');

  let sent = 0;
  for (const to of emails) {
    const r = await sendMail({ to, subject, text, db });
    if (r.sent) sent += 1;
  }
  return { emailed: sent, alerted: admins.length, recipients: emails.length };
}

async function createIncidencia(db, {
  userId,
  user,
  titulo,
  descripcion,
  fotoDataUrl,
  fotoRuta,
  origen = 'modulo',
  categoria = null,
  prioridad = 'media',
  empresaSlug = 'shared'
} = {}) {
  await ensureIncidenciasSchema(db);
  const t = String(titulo || '').trim().slice(0, 255);
  const d = String(descripcion || '').trim();
  if (!t) throw Object.assign(new Error('Indica un título o resumen del problema'), { status: 400 });
  if (!d && !fotoDataUrl && !fotoRuta) {
    throw Object.assign(new Error('Describe el problema o adjunta una foto'), { status: 400 });
  }

  let foto = fotoRuta || null;
  if (fotoDataUrl) {
    foto = await saveIncidenciaPhoto(fotoDataUrl, empresaSlug);
  }

  const codigo = await nextCodigo(db);
  const pri = /alta|media|baja/i.test(String(prioridad || ''))
    ? String(prioridad).toLowerCase()
    : 'media';
  const desc = d || '(Sin descripción — ver foto adjunta)';

  const result = await db.prepare(`
    INSERT INTO ${TABLE}
      (codigo, titulo, descripcion, foto_ruta, origen, categoria, estado, prioridad, solicitante_id, empresa_slug)
    VALUES (?, ?, ?, ?, ?, ?, 'Abierta', ?, ?, ?)
  `).run(
    codigo,
    t,
    desc,
    foto,
    String(origen || 'modulo').slice(0, 32),
    categoria ? String(categoria).slice(0, 64) : null,
    pri,
    Number(userId),
    String(empresaSlug || 'shared').slice(0, 64)
  );

  const id = Number(result.lastInsertRowid || result.insertId);
  const row = await getIncidencia(db, id);
  const notify = await notifyAdmins(db, row, user || null);
  return { ...row, notificacion: notify };
}

async function getIncidencia(db, id) {
  await ensureIncidenciasSchema(db);
  const row = await db.prepare(`
    SELECT i.*,
           u.nombre AS solicitante_nombre, u.apellido AS solicitante_apellido, u.email AS solicitante_email,
           a.nombre AS asignado_nombre, a.apellido AS asignado_apellido
    FROM ${TABLE} i
    LEFT JOIN usuarios u ON u.id = i.solicitante_id
    LEFT JOIN usuarios a ON a.id = i.asignado_id
    WHERE i.id = ? AND COALESCE(i.eliminado, 0) = 0
  `).get(Number(id));
  return row || null;
}

async function listIncidencias(db, { user, estado, mias, q, limit = 100 } = {}) {
  await ensureIncidenciasSchema(db);
  const admin = isAdminOrSubadmin(user);
  const where = ['COALESCE(i.eliminado, 0) = 0'];
  const params = [];

  if (!admin || mias) {
    where.push('i.solicitante_id = ?');
    params.push(Number(user?.id || user?.userId || 0));
  }
  if (estado && ESTADOS.includes(estado)) {
    where.push('i.estado = ?');
    params.push(estado);
  }
  if (q) {
    where.push('(i.codigo LIKE ? OR i.titulo LIKE ? OR i.descripcion LIKE ? OR u.nombre LIKE ? OR u.email LIKE ?)');
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like, like, like);
  }

  const lim = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const rows = await db.prepare(`
    SELECT i.*,
           u.nombre AS solicitante_nombre, u.apellido AS solicitante_apellido, u.email AS solicitante_email
    FROM ${TABLE} i
    LEFT JOIN usuarios u ON u.id = i.solicitante_id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE i.estado WHEN 'Abierta' THEN 1 WHEN 'En proceso' THEN 2 WHEN 'Resuelta' THEN 3 ELSE 4 END,
      i.id DESC
    LIMIT ${lim}
  `).all(...params);

  return {
    data: rows || [],
    canManage: admin,
    estados: ESTADOS
  };
}

async function updateIncidencia(db, id, { user, estado, admin_nota, asignado_id, prioridad } = {}) {
  await ensureIncidenciasSchema(db);
  if (!isAdminOrSubadmin(user)) {
    throw Object.assign(new Error('Solo administradores y subadministradores pueden gestionar incidencias'), { status: 403 });
  }
  const cur = await getIncidencia(db, id);
  if (!cur) throw Object.assign(new Error('Incidencia no encontrada'), { status: 404 });

  const nextEstado = estado && ESTADOS.includes(estado) ? estado : cur.estado;
  const nota = admin_nota != null ? String(admin_nota).trim() : cur.admin_nota;
  const asig = asignado_id != null ? (asignado_id === '' || asignado_id === 0 ? null : Number(asignado_id)) : cur.asignado_id;
  const pri = prioridad && /alta|media|baja/i.test(prioridad) ? String(prioridad).toLowerCase() : cur.prioridad;
  const cierre = ['Resuelta', 'Cerrada'].includes(nextEstado)
    ? (db.driver === 'mysql' ? new Date() : new Date().toISOString().slice(0, 19).replace('T', ' '))
    : null;

  if (db.driver === 'mysql') {
    await db.prepare(`
      UPDATE ${TABLE}
      SET estado = ?, admin_nota = ?, asignado_id = ?, prioridad = ?,
          fecha_actualizacion = NOW(),
          fecha_cierre = CASE WHEN ? IS NOT NULL THEN COALESCE(fecha_cierre, NOW()) ELSE fecha_cierre END
      WHERE id = ?
    `).run(nextEstado, nota, asig, pri, cierre ? 1 : null, Number(id));
  } else {
    await db.prepare(`
      UPDATE ${TABLE}
      SET estado = ?, admin_nota = ?, asignado_id = ?, prioridad = ?,
          fecha_actualizacion = datetime('now'),
          fecha_cierre = CASE WHEN ? IS NOT NULL THEN COALESCE(fecha_cierre, datetime('now')) ELSE fecha_cierre END
      WHERE id = ?
    `).run(nextEstado, nota, asig, pri, cierre, Number(id));
  }

  return getIncidencia(db, id);
}

module.exports = {
  TABLE,
  ESTADOS,
  ensureIncidenciasSchema,
  isAdminOrSubadmin,
  saveIncidenciaPhoto,
  resolveIncidenciaPhoto,
  createIncidencia,
  getIncidencia,
  listIncidencias,
  updateIncidencia,
  listAdminRecipients,
  notifyAdmins
};
