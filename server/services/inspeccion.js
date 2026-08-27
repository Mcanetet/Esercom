/**
 * Módulo Inspección de fabricación: OC, CECO, encargado, proveedor, plano,
 * piezas (catálogo reutilizable + foto), chat colaborativo.
 */
const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data', 'inspeccion');
const ESTADOS = ['Pendiente', 'En inspección', 'Completada', 'Con observaciones', 'Anulada'];

const _colCache = new Map();

async function tableColumns(db, table) {
  if (db.driver !== 'mysql') return null;
  const safe = String(table || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!safe) return new Set();
  const key = `${db.database || 'db'}:${safe}`;
  if (_colCache.has(key)) return _colCache.get(key);
  let set = new Set();
  try {
    // SHOW COLUMNS es más fiable que information_schema con placeholders
    const rows = await db.prepare(`SHOW COLUMNS FROM \`${safe}\``).all();
    set = new Set(
      rows
        .map((r) => String(r.Field || r.field || r.COLUMN_NAME || r.n || '').toLowerCase())
        .filter(Boolean)
    );
  } catch (_) {
    try {
      const rows = await db.prepare(`
        SELECT COLUMN_NAME AS n
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
      `).all(safe);
      set = new Set(rows.map((r) => String(r.n || r.COLUMN_NAME || '').toLowerCase()).filter(Boolean));
    } catch (_2) { /* ignore */ }
  }
  _colCache.set(key, set);
  return set;
}

function hasCol(cols, name) {
  if (cols == null) return true; // sqlite → schema ESERCOM
  return cols.has(String(name).toLowerCase());
}

function sqlUserFullName(db, alias) {
  if (db.driver === 'mysql') {
    return `TRIM(CONCAT(COALESCE(${alias}.nombre,''), ' ', COALESCE(${alias}.apellido,'')))`;
  }
  return `(COALESCE(${alias}.nombre,'') || ' ' || COALESCE(${alias}.apellido,''))`;
}

/** Productivo PHP usa `nombre`; ESERCOM usa `razon_social`. Nunca asumir columnas. */
async function proveedorNombreExpr(db, alias = 'p') {
  const cols = await tableColumns(db, 'proveedores');
  const hasNom = hasCol(cols, 'nombre');
  const hasRazon = hasCol(cols, 'razon_social');
  if (cols == null) {
    // SQLite local ESERCOM
    return `COALESCE(${alias}.razon_social, ${alias}.nombre)`;
  }
  if (hasNom && hasRazon) {
    return `COALESCE(NULLIF(TRIM(${alias}.nombre),''), ${alias}.razon_social)`;
  }
  if (hasNom) return `${alias}.nombre`;
  if (hasRazon) return `${alias}.razon_social`;
  return `CAST(${alias}.id AS CHAR)`;
}

function clearProveedorColCache(db) {
  const prefix = `${db.database || 'db'}:proveedores`;
  for (const k of _colCache.keys()) {
    if (k === prefix || String(k).endsWith(':proveedores')) _colCache.delete(k);
  }
}

function err(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function safeSlug(empresaSlug) {
  return String(empresaSlug || 'shared').replace(/[^a-z0-9_-]/gi, '') || 'shared';
}

function userName(u) {
  if (!u) return null;
  return [u.nombre, u.apellido].filter(Boolean).join(' ').trim() || u.email || null;
}

async function ensureInspeccionSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inspecciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(32) NOT NULL,
        fabricacion VARCHAR(255) NOT NULL,
        orden_compra VARCHAR(64) NOT NULL,
        ceco_id INT NULL,
        jefe_proyecto_id INT NULL,
        encargado_id INT NOT NULL,
        proveedor_id INT NULL,
        fecha_necesaria DATE NULL,
        fecha_realizada DATE NULL,
        observaciones TEXT NULL,
        plano_ruta VARCHAR(512) NULL,
        plano_nombre VARCHAR(255) NULL,
        estado VARCHAR(32) NOT NULL DEFAULT 'Pendiente',
        creado_por INT NOT NULL,
        empresa_slug VARCHAR(64) NULL,
        eliminado TINYINT NOT NULL DEFAULT 0,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME NULL,
        INDEX idx_insp_estado (estado),
        INDEX idx_insp_encargado (encargado_id),
        INDEX idx_insp_ceco (ceco_id)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inspeccion_piezas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inspeccion_id INT NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        observacion TEXT NULL,
        foto_ruta VARCHAR(512) NULL,
        estado VARCHAR(32) NOT NULL DEFAULT 'Pendiente',
        orden_n INT NOT NULL DEFAULT 0,
        creado_por INT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_insp_pieza (inspeccion_id)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inspeccion_piezas_catalogo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        usos INT NOT NULL DEFAULT 1,
        creado_por INT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_ultimo_uso DATETIME NULL,
        UNIQUE KEY uq_insp_pieza_nombre (nombre)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inspeccion_chat (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inspeccion_id INT NOT NULL,
        usuario_id INT NOT NULL,
        mensaje TEXT NOT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_insp_chat (inspeccion_id)
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inspecciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL,
        fabricacion TEXT NOT NULL,
        orden_compra TEXT NOT NULL,
        ceco_id INTEGER,
        jefe_proyecto_id INTEGER,
        encargado_id INTEGER NOT NULL,
        proveedor_id INTEGER,
        fecha_necesaria TEXT,
        fecha_realizada TEXT,
        observaciones TEXT,
        plano_ruta TEXT,
        plano_nombre TEXT,
        estado TEXT NOT NULL DEFAULT 'Pendiente',
        creado_por INTEGER NOT NULL,
        empresa_slug TEXT,
        eliminado INTEGER NOT NULL DEFAULT 0,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
        fecha_actualizacion TEXT
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inspeccion_piezas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inspeccion_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        observacion TEXT,
        foto_ruta TEXT,
        estado TEXT NOT NULL DEFAULT 'Pendiente',
        orden_n INTEGER NOT NULL DEFAULT 0,
        creado_por INTEGER,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inspeccion_piezas_catalogo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        usos INTEGER NOT NULL DEFAULT 1,
        creado_por INTEGER,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
        fecha_ultimo_uso TEXT
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inspeccion_chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inspeccion_id INTEGER NOT NULL,
        usuario_id INTEGER NOT NULL,
        mensaje TEXT NOT NULL,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
}

async function nextCodigo(db) {
  const row = await db.prepare(`
    SELECT codigo AS c FROM inspecciones WHERE codigo LIKE 'INSP-%' ORDER BY id DESC LIMIT 1
  `).get();
  let n = 1;
  if (row?.c) {
    const m = String(row.c).match(/INSP-(\d+)/i);
    if (m) n = Number(m[1]) + 1;
  }
  return `INSP-${String(n).padStart(5, '0')}`;
}

function decodeDataUrl(dataUrl, { imagesOnly = false } = {}) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) throw err('Archivo inválido (usa data URL base64)');
  const mime = String(match[1] || 'application/octet-stream').toLowerCase();
  if (imagesOnly && !mime.startsWith('image/')) {
    throw err('Solo se permiten imágenes JPG/PNG/WEBP');
  }
  if (/heic|heif|tiff|svg/.test(mime)) {
    throw err('Formato no soportado. Usa JPEG, PNG, WEBP o PDF.');
  }
  const buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length) throw err('Archivo vacío');
  if (buf.length > 12 * 1024 * 1024) throw err('Archivo supera 12 MB');
  let ext = 'bin';
  if (mime.includes('pdf')) ext = 'pdf';
  else if (mime.includes('png')) ext = 'png';
  else if (mime.includes('webp')) ext = 'webp';
  else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
  else if (mime.startsWith('image/')) ext = 'jpg';
  return { buf, mime, ext };
}

async function saveFile(dataUrl, empresaSlug, prefix, opts = {}) {
  const { buf, ext } = decodeDataUrl(dataUrl, opts);
  const slug = safeSlug(empresaSlug);
  const dir = path.join(DATA_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, buf);
  return { ruta: `inspeccion/${slug}/${filename}`, filename, full };
}

function resolveFile(empresa, file) {
  const slug = safeSlug(empresa);
  const name = path.basename(String(file || ''));
  if (!name || name.includes('..')) return null;
  const full = path.join(DATA_ROOT, slug, name);
  if (!fs.existsSync(full)) return null;
  return full;
}

async function rememberPiezaNombre(db, nombre, userId) {
  const n = String(nombre || '').trim();
  if (!n || n.length < 2) return;
  const existing = await db.prepare(
    'SELECT id, usos FROM inspeccion_piezas_catalogo WHERE LOWER(nombre) = LOWER(?)'
  ).get(n);
  if (existing) {
    await db.prepare(`
      UPDATE inspeccion_piezas_catalogo
      SET usos = ?, fecha_ultimo_uso = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
      WHERE id = ?
    `).run(Number(existing.usos || 0) + 1, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO inspeccion_piezas_catalogo (nombre, usos, creado_por, fecha_ultimo_uso)
      VALUES (?, 1, ?, ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"})
    `).run(n, userId || null);
  }
}

async function listPiezasCatalogo(db, q = '') {
  await ensureInspeccionSchema(db);
  const term = String(q || '').trim();
  if (term) {
    return db.prepare(`
      SELECT id, nombre, usos FROM inspeccion_piezas_catalogo
      WHERE nombre LIKE ?
      ORDER BY usos DESC, nombre ASC LIMIT 80
    `).all(`%${term}%`);
  }
  return db.prepare(`
    SELECT id, nombre, usos FROM inspeccion_piezas_catalogo
    ORDER BY usos DESC, nombre ASC LIMIT 80
  `).all();
}

async function hydrateInspeccion(db, row) {
  if (!row) return null;
  const piezas = await db.prepare(`
    SELECT * FROM inspeccion_piezas WHERE inspeccion_id = ? ORDER BY orden_n ASC, id ASC
  `).all(row.id);
  const chatCount = await db.prepare(
    'SELECT COUNT(*) AS c FROM inspeccion_chat WHERE inspeccion_id = ?'
  ).get(row.id);
  return {
    ...row,
    piezas,
    chat_count: Number(chatCount?.c || 0)
  };
}

async function buildListSql(db, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 80, 1), 200);
  const estado = opts.estado ? String(opts.estado) : null;
  const q = String(opts.q || '').trim();
  const params = [];
  const provNom = await proveedorNombreExpr(db, 'p');
  const nameJp = sqlUserFullName(db, 'jp');
  const nameEn = sqlUserFullName(db, 'en');
  const nameCr = sqlUserFullName(db, 'cr');
  let sql = `
    SELECT i.*,
           c.codigo AS ceco_codigo, c.nombre AS ceco_nombre,
           ${nameJp} AS jefe_proyecto,
           ${nameEn} AS encargado_nombre,
           en.email AS encargado_email,
           ${provNom} AS proveedor_nombre,
           ${nameCr} AS creado_por_nombre
    FROM inspecciones i
    LEFT JOIN cecos c ON c.id = i.ceco_id
    LEFT JOIN usuarios jp ON jp.id = i.jefe_proyecto_id
    LEFT JOIN usuarios en ON en.id = i.encargado_id
    LEFT JOIN proveedores p ON p.id = i.proveedor_id
    LEFT JOIN usuarios cr ON cr.id = i.creado_por
    WHERE COALESCE(i.eliminado, 0) = 0
  `;
  if (estado) {
    sql += ' AND i.estado = ?';
    params.push(estado);
  }
  if (opts.mias && opts.userId) {
    sql += ' AND (i.encargado_id = ? OR i.creado_por = ? OR i.jefe_proyecto_id = ?)';
    params.push(opts.userId, opts.userId, opts.userId);
  }
  if (q) {
    sql += ` AND (
      i.codigo LIKE ? OR i.fabricacion LIKE ? OR i.orden_compra LIKE ?
      OR COALESCE(c.nombre,'') LIKE ? OR COALESCE(${provNom},'') LIKE ?
      OR COALESCE(en.nombre,'') LIKE ? OR COALESCE(en.apellido,'') LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }
  sql += ' ORDER BY i.id DESC LIMIT ?';
  params.push(limit);
  return { sql, params, provNom };
}

async function listInspecciones(db, opts = {}) {
  await ensureInspeccionSchema(db);
  let built = await buildListSql(db, opts);
  try {
    const rows = await db.prepare(built.sql).all(...built.params);
    return { data: rows, estados: ESTADOS };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/razon_social/i.test(msg)) {
      clearProveedorColCache(db);
      // Forzar solo `nombre` (esquema productivo PHP)
      _colCache.set(`${db.database || 'db'}:proveedores`, new Set(['id', 'nombre', 'rut', 'email', 'telefono', 'activo']));
      built = await buildListSql(db, opts);
      const rows = await db.prepare(built.sql).all(...built.params);
      return { data: rows, estados: ESTADOS };
    }
    throw e;
  }
}

async function getInspeccion(db, id) {
  await ensureInspeccionSchema(db);
  const nameJp = sqlUserFullName(db, 'jp');
  const nameEn = sqlUserFullName(db, 'en');
  const nameCr = sqlUserFullName(db, 'cr');
  const runGet = async () => {
    const provNom = await proveedorNombreExpr(db, 'p');
    return db.prepare(`
      SELECT i.*,
             c.codigo AS ceco_codigo, c.nombre AS ceco_nombre,
             ${nameJp} AS jefe_proyecto,
             ${nameEn} AS encargado_nombre,
             en.email AS encargado_email,
             ${provNom} AS proveedor_nombre, p.rut AS proveedor_rut,
             ${nameCr} AS creado_por_nombre
      FROM inspecciones i
      LEFT JOIN cecos c ON c.id = i.ceco_id
      LEFT JOIN usuarios jp ON jp.id = i.jefe_proyecto_id
      LEFT JOIN usuarios en ON en.id = i.encargado_id
      LEFT JOIN proveedores p ON p.id = i.proveedor_id
      LEFT JOIN usuarios cr ON cr.id = i.creado_por
      WHERE i.id = ? AND COALESCE(i.eliminado, 0) = 0
    `).get(Number(id));
  };
  let row;
  try {
    row = await runGet();
  } catch (e) {
    if (/razon_social/i.test(String(e && e.message ? e.message : e))) {
      clearProveedorColCache(db);
      _colCache.set(`${db.database || 'db'}:proveedores`, new Set(['id', 'nombre', 'rut', 'email', 'telefono', 'activo']));
      row = await runGet();
    } else {
      throw e;
    }
  }
  return hydrateInspeccion(db, row);
}

async function createInspeccion(db, opts = {}) {
  await ensureInspeccionSchema(db);
  const b = opts.body || {};
  const fabricacion = String(b.fabricacion || '').trim();
  const ordenCompra = String(b.orden_compra || b.oc || '').trim();
  const encargadoId = Number(b.encargado_id);
  const cecoId = b.ceco_id ? Number(b.ceco_id) : null;
  const proveedorId = b.proveedor_id ? Number(b.proveedor_id) : null;
  const fechaNecesaria = b.fecha_necesaria ? String(b.fecha_necesaria).slice(0, 10) : null;
  const observaciones = String(b.observaciones || '').trim() || null;

  if (!fabricacion) throw err('Indica la fabricación / requerimiento');
  if (!ordenCompra) throw err('Indica la orden de compra (OC)');
  if (!encargadoId) throw err('Selecciona el encargado de inspección');
  if (!cecoId) throw err('Selecciona el CECO');
  if (!proveedorId) throw err('Selecciona el proveedor');
  if (!fechaNecesaria) throw err('Indica la fecha en que se necesita la inspección');

  const ceco = await db.prepare(
    'SELECT id, jefe_proyecto_id, codigo, nombre FROM cecos WHERE id = ?'
  ).get(cecoId);
  if (!ceco) throw err('CECO no encontrado');
  const jefeId = ceco.jefe_proyecto_id ? Number(ceco.jefe_proyecto_id) : null;

  let planoRuta = b.plano_ruta || null;
  let planoNombre = b.plano_nombre || null;
  if (b.planoDataUrl || b.plano_data_url) {
    const saved = await saveFile(b.planoDataUrl || b.plano_data_url, opts.empresaSlug, 'plano');
    planoRuta = saved.ruta;
    planoNombre = String(b.plano_nombre || saved.filename).slice(0, 255);
  }
  if (!planoRuta) throw err('Debes subir el plano junto con la OC / requerimiento');

  const codigo = await nextCodigo(db);
  const r = await db.prepare(`
    INSERT INTO inspecciones (
      codigo, fabricacion, orden_compra, ceco_id, jefe_proyecto_id, encargado_id, proveedor_id,
      fecha_necesaria, observaciones, plano_ruta, plano_nombre, estado, creado_por, empresa_slug
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
  `).run(
    codigo,
    fabricacion,
    ordenCompra,
    cecoId,
    jefeId,
    encargadoId,
    proveedorId,
    fechaNecesaria,
    observaciones,
    planoRuta,
    planoNombre,
    opts.userId,
    safeSlug(opts.empresaSlug)
  );

  const id = Number(r.lastInsertRowid);
  const piezas = Array.isArray(b.piezas) ? b.piezas : [];
  let orden = 0;
  for (const p of piezas) {
    const nombre = String(p.nombre || p).trim();
    if (!nombre) continue;
    await db.prepare(`
      INSERT INTO inspeccion_piezas (inspeccion_id, nombre, observacion, orden_n, creado_por)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, nombre, String(p.observacion || '').trim() || null, orden++, opts.userId);
    await rememberPiezaNombre(db, nombre, opts.userId);
  }

  return getInspeccion(db, id);
}

async function updateInspeccion(db, id, opts = {}) {
  await ensureInspeccionSchema(db);
  const current = await getInspeccion(db, id);
  if (!current) throw err('Inspección no encontrada', 404);
  const b = opts.body || {};
  const userId = opts.userId;

  const isEncargado = Number(current.encargado_id) === Number(userId);
  const isCreador = Number(current.creado_por) === Number(userId);
  const isJp = current.jefe_proyecto_id && Number(current.jefe_proyecto_id) === Number(userId);
  const isAdmin = opts.isAdmin;

  if (!isEncargado && !isCreador && !isJp && !isAdmin) {
    throw err('No tienes permiso para editar esta inspección', 403);
  }

  const fabricacion = b.fabricacion != null ? String(b.fabricacion).trim() : current.fabricacion;
  const ordenCompra = b.orden_compra != null ? String(b.orden_compra).trim() : current.orden_compra;
  let cecoId = b.ceco_id != null ? Number(b.ceco_id) : current.ceco_id;
  let jefeId = current.jefe_proyecto_id;
  if (b.ceco_id != null) {
    const ceco = await db.prepare('SELECT jefe_proyecto_id FROM cecos WHERE id = ?').get(cecoId);
    if (!ceco) throw err('CECO no encontrado');
    jefeId = ceco.jefe_proyecto_id || null;
  }
  const encargadoId = b.encargado_id != null ? Number(b.encargado_id) : current.encargado_id;
  const proveedorId = b.proveedor_id != null ? Number(b.proveedor_id) : current.proveedor_id;
  const fechaNecesaria = b.fecha_necesaria != null
    ? String(b.fecha_necesaria).slice(0, 10)
    : current.fecha_necesaria;
  const fechaRealizada = b.fecha_realizada != null
    ? (b.fecha_realizada ? String(b.fecha_realizada).slice(0, 10) : null)
    : current.fecha_realizada;
  const observaciones = b.observaciones != null
    ? (String(b.observaciones).trim() || null)
    : current.observaciones;
  let estado = b.estado != null ? String(b.estado) : current.estado;
  if (estado && !ESTADOS.includes(estado)) throw err('Estado inválido');

  let planoRuta = current.plano_ruta;
  let planoNombre = current.plano_nombre;
  if (b.planoDataUrl || b.plano_data_url) {
    const saved = await saveFile(b.planoDataUrl || b.plano_data_url, opts.empresaSlug || current.empresa_slug, 'plano');
    planoRuta = saved.ruta;
    planoNombre = String(b.plano_nombre || saved.filename).slice(0, 255);
  }

  // Solo encargado (o admin) puede marcar fecha realizada / completar
  if ((b.fecha_realizada != null || (b.estado && ['Completada', 'Con observaciones', 'En inspección'].includes(b.estado)))
    && !isEncargado && !isAdmin) {
    throw err('Solo el encargado de inspección puede registrar la fecha/resultado', 403);
  }

  if (fechaRealizada && estado === 'Pendiente') estado = 'En inspección';

  await db.prepare(`
    UPDATE inspecciones SET
      fabricacion = ?, orden_compra = ?, ceco_id = ?, jefe_proyecto_id = ?, encargado_id = ?,
      proveedor_id = ?, fecha_necesaria = ?, fecha_realizada = ?, observaciones = ?,
      plano_ruta = ?, plano_nombre = ?, estado = ?,
      fecha_actualizacion = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
    WHERE id = ?
  `).run(
    fabricacion, ordenCompra, cecoId, jefeId, encargadoId, proveedorId,
    fechaNecesaria, fechaRealizada, observaciones, planoRuta, planoNombre, estado, Number(id)
  );

  if (Array.isArray(b.piezas)) {
    await replacePiezas(db, Number(id), b.piezas, userId, opts.empresaSlug || current.empresa_slug);
  }

  return getInspeccion(db, id);
}

async function replacePiezas(db, inspeccionId, piezas, userId, empresaSlug) {
  await db.prepare('DELETE FROM inspeccion_piezas WHERE inspeccion_id = ?').run(inspeccionId);
  let orden = 0;
  for (const p of piezas) {
    const nombre = String(p.nombre || '').trim();
    if (!nombre) continue;
    let fotoRuta = p.foto_ruta || null;
    if (p.fotoDataUrl || p.foto_data_url) {
      const saved = await saveFile(p.fotoDataUrl || p.foto_data_url, empresaSlug, 'pieza', { imagesOnly: true });
      fotoRuta = saved.ruta;
    }
    await db.prepare(`
      INSERT INTO inspeccion_piezas
        (inspeccion_id, nombre, observacion, foto_ruta, estado, orden_n, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      inspeccionId,
      nombre,
      String(p.observacion || '').trim() || null,
      fotoRuta,
      String(p.estado || 'Pendiente').slice(0, 32),
      orden++,
      userId || null
    );
    await rememberPiezaNombre(db, nombre, userId);
  }
}

async function addPieza(db, inspeccionId, opts = {}) {
  await ensureInspeccionSchema(db);
  const current = await getInspeccion(db, inspeccionId);
  if (!current) throw err('Inspección no encontrada', 404);
  const nombre = String(opts.nombre || '').trim();
  if (!nombre) throw err('Nombre de pieza requerido');
  let fotoRuta = opts.foto_ruta || null;
  if (opts.fotoDataUrl) {
    const saved = await saveFile(opts.fotoDataUrl, opts.empresaSlug || current.empresa_slug, 'pieza', { imagesOnly: true });
    fotoRuta = saved.ruta;
  }
  const maxOrd = await db.prepare(
    'SELECT MAX(orden_n) AS m FROM inspeccion_piezas WHERE inspeccion_id = ?'
  ).get(Number(inspeccionId));
  const orden = Number(maxOrd?.m || 0) + 1;
  const r = await db.prepare(`
    INSERT INTO inspeccion_piezas
      (inspeccion_id, nombre, observacion, foto_ruta, estado, orden_n, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(inspeccionId),
    nombre,
    String(opts.observacion || '').trim() || null,
    fotoRuta,
    String(opts.estado || 'Pendiente').slice(0, 32),
    orden,
    opts.userId || null
  );
  await rememberPiezaNombre(db, nombre, opts.userId);
  return db.prepare('SELECT * FROM inspeccion_piezas WHERE id = ?').get(r.lastInsertRowid);
}

async function updatePieza(db, piezaId, opts = {}) {
  await ensureInspeccionSchema(db);
  const pieza = await db.prepare('SELECT * FROM inspeccion_piezas WHERE id = ?').get(Number(piezaId));
  if (!pieza) throw err('Pieza no encontrada', 404);
  const insp = await getInspeccion(db, pieza.inspeccion_id);
  const isEncargado = Number(insp.encargado_id) === Number(opts.userId);
  if (!isEncargado && !opts.isAdmin) {
    throw err('Solo el encargado técnico puede actualizar fotos/estado de piezas', 403);
  }
  let fotoRuta = pieza.foto_ruta;
  if (opts.fotoDataUrl) {
    const saved = await saveFile(opts.fotoDataUrl, opts.empresaSlug || insp.empresa_slug, 'pieza', { imagesOnly: true });
    fotoRuta = saved.ruta;
  }
  const nombre = opts.nombre != null ? String(opts.nombre).trim() : pieza.nombre;
  const observacion = opts.observacion != null
    ? (String(opts.observacion).trim() || null)
    : pieza.observacion;
  const estado = opts.estado != null ? String(opts.estado).slice(0, 32) : pieza.estado;
  await db.prepare(`
    UPDATE inspeccion_piezas SET nombre = ?, observacion = ?, foto_ruta = ?, estado = ?
    WHERE id = ?
  `).run(nombre, observacion, fotoRuta, estado, Number(piezaId));
  if (opts.nombre != null) await rememberPiezaNombre(db, nombre, opts.userId);
  return db.prepare('SELECT * FROM inspeccion_piezas WHERE id = ?').get(Number(piezaId));
}

async function listChat(db, inspeccionId, limit = 100) {
  await ensureInspeccionSchema(db);
  const rows = await db.prepare(`
    SELECT c.*,
           (COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')) AS usuario_nombre,
           u.email AS usuario_email
    FROM inspeccion_chat c
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE c.inspeccion_id = ?
    ORDER BY c.id ASC
    LIMIT ?
  `).all(Number(inspeccionId), Math.min(Number(limit) || 100, 300));
  return rows;
}

async function postChat(db, inspeccionId, opts = {}) {
  await ensureInspeccionSchema(db);
  const insp = await getInspeccion(db, inspeccionId);
  if (!insp) throw err('Inspección no encontrada', 404);
  const mensaje = String(opts.mensaje || '').trim();
  if (!mensaje) throw err('Escribe un mensaje');
  if (mensaje.length > 4000) throw err('Mensaje demasiado largo');
  const r = await db.prepare(`
    INSERT INTO inspeccion_chat (inspeccion_id, usuario_id, mensaje) VALUES (?, ?, ?)
  `).run(Number(inspeccionId), opts.userId, mensaje);
  return db.prepare(`
    SELECT c.*,
           (COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,'')) AS usuario_nombre,
           u.email AS usuario_email
    FROM inspeccion_chat c
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE c.id = ?
  `).get(r.lastInsertRowid);
}

async function softDeleteInspeccion(db, id, opts = {}) {
  await ensureInspeccionSchema(db);
  const current = await getInspeccion(db, id);
  if (!current) throw err('Inspección no encontrada', 404);
  if (!opts.isAdmin && Number(current.creado_por) !== Number(opts.userId)) {
    throw err('Solo el creador o un admin puede anular', 403);
  }
  await db.prepare(`
    UPDATE inspecciones SET eliminado = 1, estado = 'Anulada',
      fecha_actualizacion = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
    WHERE id = ?
  `).run(Number(id));
  return { ok: true };
}

/** Resumen compacto para Angel IA (aprendizaje / consulta). */
async function angelSummary(db, opts = {}) {
  await ensureInspeccionSchema(db);
  const limit = Math.min(Number(opts.limit) || 30, 80);
  const q = String(opts.q || '').trim();
  const like = q ? `%${q}%` : null;
  const provNom = await proveedorNombreExpr(db, 'p');
  const rows = like
    ? await db.prepare(`
        SELECT i.id, i.codigo, i.fabricacion, i.orden_compra, i.estado,
               i.fecha_necesaria, i.fecha_realizada, i.observaciones,
               c.nombre AS ceco, ${provNom} AS proveedor
        FROM inspecciones i
        LEFT JOIN cecos c ON c.id = i.ceco_id
        LEFT JOIN proveedores p ON p.id = i.proveedor_id
        WHERE COALESCE(i.eliminado,0)=0
          AND (i.codigo LIKE ? OR i.fabricacion LIKE ? OR i.orden_compra LIKE ?
            OR COALESCE(c.nombre,'') LIKE ? OR COALESCE(i.observaciones,'') LIKE ?)
        ORDER BY i.id DESC LIMIT ?
      `).all(like, like, like, like, like, limit)
    : await db.prepare(`
        SELECT i.id, i.codigo, i.fabricacion, i.orden_compra, i.estado,
               i.fecha_necesaria, i.fecha_realizada, i.observaciones,
               c.nombre AS ceco, ${provNom} AS proveedor
        FROM inspecciones i
        LEFT JOIN cecos c ON c.id = i.ceco_id
        LEFT JOIN proveedores p ON p.id = i.proveedor_id
        WHERE COALESCE(i.eliminado,0)=0
        ORDER BY i.id DESC LIMIT ?
      `).all(limit);

  const out = [];
  for (const r of rows) {
    const piezas = await db.prepare(
      'SELECT nombre, estado, observacion FROM inspeccion_piezas WHERE inspeccion_id = ? ORDER BY orden_n'
    ).all(r.id);
    const chat = await db.prepare(`
      SELECT mensaje FROM inspeccion_chat WHERE inspeccion_id = ? ORDER BY id DESC LIMIT 5
    `).all(r.id);
    out.push({
      ...r,
      piezas: piezas.map((p) => p.nombre + (p.estado ? ` [${p.estado}]` : '')),
      chat_reciente: chat.map((c) => c.mensaje).reverse()
    });
  }
  return out;
}

module.exports = {
  ESTADOS,
  ensureInspeccionSchema,
  listInspecciones,
  getInspeccion,
  createInspeccion,
  updateInspeccion,
  addPieza,
  updatePieza,
  listPiezasCatalogo,
  listChat,
  postChat,
  softDeleteInspeccion,
  saveFile,
  resolveFile,
  angelSummary,
  userName
};
