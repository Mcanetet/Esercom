/**
 * Checklist Flota — lectura/escritura unificada MySQL (producción PHP) / SQLite.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const UPLOAD_DIR = path.join(config.dataDir, 'uploads', 'checklist');
const LEGACY_UPLOAD_DIR = path.join(config.publicDir, 'uploads', 'checklist');

const PHOTO_FIELDS = [
  'foto_frontal',
  'foto_lateral_izq',
  'foto_lateral_der',
  'foto_trasera',
  'foto_rueda',
  'foto_kit_herramientas',
  'foto_colision'
];

const INSPECTION_ITEMS = [
  { key: 'neumaticos', label: 'Estado de neumáticos' },
  { key: 'luces', label: 'Luces' },
  { key: 'frenos', label: 'Sistema de frenos' },
  { key: 'nivel_combustible', label: 'Nivel de combustible' },
  { key: 'limpieza_interior', label: 'Limpieza interior' },
  { key: 'limpieza_exterior', label: 'Limpieza exterior' },
  { key: 'documentacion', label: 'Documentación al día', alt: 'documentos' },
  { key: 'kit_emergencia', label: 'Kit de emergencia' },
  { key: 'extintor', label: 'Extintor vigente' },
  { key: 'rueda_repuesto', label: 'Rueda de repuesto' },
  { key: 'nivel_aceite', label: '¿Choque o colisión?', inverted: true }
];

const MYSQL_COLS = [
  ['conductor_id', 'INT NULL'],
  ['operario_id', 'INT NULL'],
  ['tecnico_asignado_id', 'INT NULL'],
  ['estado_general', "VARCHAR(64) DEFAULT 'OK'"],
  ['neumaticos', "VARCHAR(32) DEFAULT 'OK'"],
  ['luces', "VARCHAR(32) DEFAULT 'OK'"],
  ['frenos', "VARCHAR(32) DEFAULT 'OK'"],
  ['aceite', "VARCHAR(32) DEFAULT 'OK'"],
  ['documentos', "VARCHAR(32) DEFAULT 'OK'"],
  ['anulado', 'TINYINT NOT NULL DEFAULT 0'],
  ['codigo', 'VARCHAR(64) NULL'],
  ['fecha_inspeccion', 'DATE NULL'],
  ['nivel_aceite', 'VARCHAR(32) NULL'],
  ['nivel_combustible', 'VARCHAR(32) NULL'],
  ['limpieza_interior', 'VARCHAR(32) NULL'],
  ['limpieza_exterior', 'VARCHAR(32) NULL'],
  ['documentacion', 'VARCHAR(32) NULL'],
  ['kit_emergencia', 'VARCHAR(32) NULL'],
  ['extintor', 'VARCHAR(32) NULL'],
  ['rueda_repuesto', 'VARCHAR(32) NULL'],
  ['requiere_atencion', 'TINYINT NOT NULL DEFAULT 0'],
  ['estado_seguimiento', "VARCHAR(64) DEFAULT 'sin_revisar'"],
  ['foto_frontal', 'VARCHAR(500) NULL'],
  ['foto_lateral_izq', 'VARCHAR(500) NULL'],
  ['foto_lateral_der', 'VARCHAR(500) NULL'],
  ['foto_trasera', 'VARCHAR(500) NULL'],
  ['foto_rueda', 'VARCHAR(500) NULL'],
  ['foto_kit_herramientas', 'VARCHAR(500) NULL'],
  ['foto_colision', 'VARCHAR(500) NULL'],
  ['vehiculo_marca', 'VARCHAR(128) NULL'],
  ['vehiculo_modelo', 'VARCHAR(128) NULL'],
  ['vehiculo_tipo', 'VARCHAR(128) NULL'],
  ['vehiculo_anio', 'VARCHAR(16) NULL'],
  ['propietario_nombre', 'VARCHAR(255) NULL'],
  ['propietario_rut', 'VARCHAR(32) NULL']
];

const SQLITE_COLS = MYSQL_COLS.map(([col, ddl]) => [
  col,
  ddl
    .replace(/VARCHAR\([^)]+\)/g, 'TEXT')
    .replace(/TINYINT[^ ]+/, 'INTEGER')
    .replace(/INT NULL/, 'INTEGER')
]);

async function getTableColumns(db, table) {
  if (db.driver === 'mysql') {
    const rows = await db.prepare(`
      SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position
    `).all(table);
    return rows.map((r) => r.c);
  }
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.map((r) => r.name);
}

async function tableExists(db, table) {
  if (db.driver === 'mysql') {
    const row = await db.prepare(`
      SELECT COUNT(*) AS c FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
    `).get(table);
    return row && Number(row.c) > 0;
  }
  const row = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
  return !!row;
}

async function columnExists(db, table, col) {
  const cols = await getTableColumns(db, table);
  return cols.includes(col);
}

function pickCol(colSet, ...candidates) {
  for (const c of candidates) {
    if (colSet.has(c)) return c;
  }
  return null;
}

function formatDateValue(v) {
  if (!v) return null;
  if (v instanceof Date) {
    // DATE de MySQL suele llegar como UTC medianoche: usar UTC para no correr el día
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function chileTodayYmd() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  } catch (_) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

function nameConcat(db, alias = 'u') {
  if (db.driver === 'mysql') {
    return `TRIM(CONCAT(COALESCE(${alias}.nombre,''), ' ', COALESCE(${alias}.apellido,'')))`;
  }
  return `TRIM(COALESCE(${alias}.nombre,'') || ' ' || COALESCE(${alias}.apellido,''))`;
}

function isBadValue(val, inverted = false) {
  const s = String(val ?? '').trim().toLowerCase();
  if (!s) return false;
  if (inverted) return s === 'falla' || s === 'sí' || s === 'si' || s === '1' || s === 'true';
  return s === 'falla' || s === 'malo' || s === '0' || s === 'observación' || s === 'observacion';
}

function countInspectionStats(row) {
  let buenos = 0;
  let malos = 0;
  for (const item of INSPECTION_ITEMS) {
    const col = row[item.key] ?? (item.alt ? row[item.alt] : null);
    if (col == null || col === '') continue;
    if (isBadValue(col, item.inverted)) malos += 1;
    else buenos += 1;
  }
  return { items_buenos: buenos, items_malos: malos, items_total: INSPECTION_ITEMS.length };
}

function calcEstadoGeneral(stats) {
  if (stats.items_malos >= 4) return 'Malo';
  if (stats.items_malos >= 2) return 'Regular';
  if (stats.items_malos === 1) return 'Bueno';
  return 'Excelente';
}

async function ensureColumns(db, table, columns) {
  for (const [col, ddl] of columns) {
    if (await columnExists(db, table, col)) continue;
    try {
      const sql = db.driver === 'mysql'
        ? `ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`
        : `ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`;
      await db.exec(sql);
      console.log(`[checklist-flota] ${table}.${col} añadida`);
    } catch (err) {
      if (!/duplicate column/i.test(err.message || '')) {
        console.warn(`[checklist-flota] ${table}.${col}:`, err.message);
      }
    }
  }
}

async function ensureChecklistSchema(db) {
  if (!(await tableExists(db, 'checklist_flota'))) return;
  const cols = db.driver === 'mysql' ? MYSQL_COLS : SQLITE_COLS;
  await ensureColumns(db, 'checklist_flota', cols);
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function normalizePhotoUrl(v) {
  if (!v) return null;
  let s = String(v).trim().replace(/\\/g, '/');
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  if (s.startsWith('/')) return s;
  if (s.startsWith('uploads/') || s.startsWith('php/')) return `/${s}`;
  if (!s.includes('/')) {
    return `/uploads/fotos_checklist/${s}`;
  }
  return `/${s.replace(/^\.\//, '')}`;
}

function mapChecklistRow(r, colSet) {
  const tecnicoCol = pickCol(colSet, 'tecnico_asignado_id', 'tecnico_id');
  const conductorCol = pickCol(colSet, 'conductor_id', 'operario_id');
  const stats = countInspectionStats(r);
  const fotos = {};
  for (const f of PHOTO_FIELDS) {
    if (r[f]) fotos[f] = normalizePhotoUrl(r[f]);
  }
  const fotoCount = Object.keys(fotos).length;
  return {
    id: r.id,
    codigo: r.codigo || null,
    patente: r.patente || '',
    kilometraje: r.kilometraje ?? 0,
    fecha: formatDateValue(r.fecha || r.fecha_inspeccion || r.fecha_creacion),
    estado_general: r.estado_general || r.estado || calcEstadoGeneral(stats),
    neumaticos: r.neumaticos || 'OK',
    luces: r.luces || 'OK',
    frenos: r.frenos || 'OK',
    nivel_combustible: r.nivel_combustible || 'OK',
    limpieza_interior: r.limpieza_interior || 'OK',
    limpieza_exterior: r.limpieza_exterior || 'OK',
    documentacion: r.documentacion || r.documentos || 'OK',
    kit_emergencia: r.kit_emergencia || 'OK',
    extintor: r.extintor || 'OK',
    rueda_repuesto: r.rueda_repuesto || 'OK',
    nivel_aceite: r.nivel_aceite || r.aceite || 'OK',
    observaciones: r.observaciones || null,
    vehiculo_marca: r.vehiculo_marca || null,
    vehiculo_modelo: r.vehiculo_modelo || null,
    vehiculo_tipo: r.vehiculo_tipo || null,
    vehiculo_anio: r.vehiculo_anio || null,
    propietario_nombre: r.propietario_nombre || null,
    propietario_rut: r.propietario_rut || null,
    conductor: r.conductor || null,
    tecnico: r.tecnico || null,
    tecnico_asignado_id: tecnicoCol ? (r[tecnicoCol] ?? null) : null,
    conductor_id: conductorCol ? (r[conductorCol] ?? null) : null,
    requiere_atencion: Number(r.requiere_atencion) || (stats.items_malos > 0 ? 1 : 0),
    estado_seguimiento: r.estado_seguimiento || 'sin_revisar',
    anulado: Number(r.anulado) || 0,
    items_buenos: stats.items_buenos,
    items_malos: stats.items_malos,
    items_total: stats.items_total,
    fotos,
    foto_count: fotoCount,
    tiene_fotos: fotoCount > 0
  };
}

async function buildListQuery(db, colSet, opts = {}) {
  const conductorCol = pickCol(colSet, 'conductor_id', 'operario_id');
  const tecnicoCol = pickCol(colSet, 'tecnico_asignado_id', 'tecnico_id');
  const joins = [];
  let conductorExpr = 'NULL AS conductor';
  let tecnicoExpr = 'NULL AS tecnico';
  if (conductorCol) {
    joins.push(`LEFT JOIN usuarios u ON u.id = c.${conductorCol}`);
    conductorExpr = `${nameConcat(db, 'u')} AS conductor`;
  }
  if (tecnicoCol) {
    joins.push(`LEFT JOIN usuarios t ON t.id = c.${tecnicoCol}`);
    tecnicoExpr = `${nameConcat(db, 't')} AS tecnico`;
  }
  const whereParts = [];
  const params = [];
  if (colSet.has('anulado')) whereParts.push('c.anulado = 0');
  if (opts.solo_incidencias) {
    whereParts.push('(COALESCE(c.requiere_atencion, 0) = 1 OR c.estado_seguimiento IN (\'pendiente\', \'en_gestion\', \'sin_revisar\'))');
  }
  if (opts.q) {
    const like = `%${opts.q}%`;
    whereParts.push('(c.patente LIKE ? OR c.codigo LIKE ? OR c.observaciones LIKE ?)');
    params.push(like, like, like);
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderFecha = pickCol(colSet, 'fecha', 'fecha_inspeccion', 'fecha_creacion') || 'id';
  const baseFrom = `
    FROM checklist_flota c
    ${joins.join('\n')}
    ${where}
  `;
  return { baseFrom, conductorExpr, tecnicoExpr, orderFecha, params };
}

async function listChecklistFlota(db, opts = {}) {
  if (!(await tableExists(db, 'checklist_flota'))) {
    return { rows: [], total: 0, page: 1, limit: 10, totalPages: 0 };
  }
  await ensureChecklistSchema(db);
  const colSet = new Set(await getTableColumns(db, 'checklist_flota'));
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 10));
  const offset = (page - 1) * limit;

  const q = await buildListQuery(db, colSet, opts);
  const countRow = await db.prepare(`SELECT COUNT(*) AS c ${q.baseFrom}`).get(...q.params);
  const total = Number(countRow?.c || 0);

  const rows = await db.prepare(`
    SELECT c.*, ${q.conductorExpr}, ${q.tecnicoExpr}
    ${q.baseFrom}
    ORDER BY c.${q.orderFecha} DESC, c.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `).all(...q.params);

  return {
    rows: rows.map((r) => mapChecklistRow(r, colSet)),
    total,
    page,
    limit,
    totalPages: total ? Math.ceil(total / limit) : 0
  };
}

async function getChecklistFlota(db, id) {
  if (!(await tableExists(db, 'checklist_flota'))) return null;
  await ensureChecklistSchema(db);
  const colSet = new Set(await getTableColumns(db, 'checklist_flota'));
  const conductorCol = pickCol(colSet, 'conductor_id', 'operario_id');
  const tecnicoCol = pickCol(colSet, 'tecnico_asignado_id', 'tecnico_id');
  const joins = [];
  let conductorExpr = 'NULL AS conductor';
  let tecnicoExpr = 'NULL AS tecnico';
  if (conductorCol) {
    joins.push(`LEFT JOIN usuarios u ON u.id = c.${conductorCol}`);
    conductorExpr = `${nameConcat(db, 'u')} AS conductor`;
  }
  if (tecnicoCol) {
    joins.push(`LEFT JOIN usuarios t ON t.id = c.${tecnicoCol}`);
    tecnicoExpr = `${nameConcat(db, 't')} AS tecnico`;
  }
  const row = await db.prepare(`
    SELECT c.*, ${conductorExpr}, ${tecnicoExpr}
    FROM checklist_flota c
    ${joins.join('\n')}
    WHERE c.id = ?
  `).get(Number(id));
  if (!row) return null;
  return mapChecklistRow(row, colSet);
}

async function nextCodigo(db) {
  const year = new Date().getFullYear();
  const prefix = `CHK-FLOTA-${year}-`;
  const row = await db.prepare(`
    SELECT codigo FROM checklist_flota WHERE codigo LIKE ? ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`);
  let n = 1;
  if (row?.codigo) {
    const m = String(row.codigo).match(/(\d+)\s*$/);
    if (m) n = Number(m[1]) + 1;
  }
  return `${prefix}${String(n).padStart(4, '0')}`;
}

function applyInspectionFields(fields, colSet, body) {
  const b = body || {};
  for (const item of INSPECTION_ITEMS) {
    const val = b[item.key] ?? (item.alt ? b[item.alt] : null);
    if (val == null) continue;
    if (colSet.has(item.key)) fields[item.key] = val;
    else if (item.alt && colSet.has(item.alt)) fields[item.alt] = val;
  }
  if (colSet.has('aceite') && b.aceite && !fields.aceite) fields.aceite = b.aceite;
}

async function createChecklistFlota(db, userId, body, empresaSlug = 'shared') {
  await ensureChecklistSchema(db);
  const colSet = new Set(await getTableColumns(db, 'checklist_flota'));
  const b = body || {};
  if (!b.patente) throw Object.assign(new Error('Patente requerida'), { status: 400 });

  const fields = {};
  fields.patente = String(b.patente).toUpperCase();
  if (colSet.has('kilometraje')) fields.kilometraje = Number(b.kilometraje) || 0;

  const fechaCol = pickCol(colSet, 'fecha', 'fecha_inspeccion');
  const conductorCol = pickCol(colSet, 'conductor_id', 'operario_id');
  const tecnicoCol = pickCol(colSet, 'tecnico_asignado_id', 'tecnico_id');
  const estadoCol = pickCol(colSet, 'estado_general', 'estado');

  if (fechaCol) fields[fechaCol] = (b.fecha && String(b.fecha).slice(0, 10)) || chileTodayYmd();
  if (conductorCol) fields[conductorCol] = userId;
  if (tecnicoCol && b.tecnico_asignado_id) fields[tecnicoCol] = Number(b.tecnico_asignado_id);
  applyInspectionFields(fields, colSet, b);

  const stats = countInspectionStats(b);
  const estado = b.estado_general || calcEstadoGeneral(stats);
  if (estadoCol) fields[estadoCol] = estado;
  if (colSet.has('requiere_atencion')) fields.requiere_atencion = stats.items_malos > 0 ? 1 : 0;
  if (colSet.has('estado_seguimiento')) {
    fields.estado_seguimiento = stats.items_malos > 0 ? 'pendiente' : 'sin_revisar';
  }
  if (colSet.has('observaciones')) fields.observaciones = b.observaciones || null;
  if (colSet.has('vehiculo_marca') && b.vehiculo_marca) fields.vehiculo_marca = b.vehiculo_marca;
  if (colSet.has('vehiculo_modelo') && b.vehiculo_modelo) fields.vehiculo_modelo = b.vehiculo_modelo;
  if (colSet.has('vehiculo_tipo') && b.vehiculo_tipo) fields.vehiculo_tipo = b.vehiculo_tipo;
  if (colSet.has('vehiculo_anio') && b.vehiculo_anio) fields.vehiculo_anio = String(b.vehiculo_anio);
  if (colSet.has('propietario_nombre') && b.propietario_nombre) fields.propietario_nombre = b.propietario_nombre;
  if (colSet.has('propietario_rut') && b.propietario_rut) fields.propietario_rut = b.propietario_rut;
  if (colSet.has('codigo') && !b.codigo) fields.codigo = await nextCodigo(db);

  const fotos = b.fotos || {};
  for (const f of PHOTO_FIELDS) {
    if (!colSet.has(f) || !fotos[f]) continue;
    let pathVal = fotos[f];
    if (String(pathVal).startsWith('data:image/')) {
      pathVal = await saveChecklistPhoto(fields.patente, f, pathVal, empresaSlug);
    }
    fields[f] = pathVal;
  }

  const keys = Object.keys(fields);
  const placeholders = keys.map(() => '?');
  const values = keys.map((k) => fields[k]);

  const info = await db.prepare(`
    INSERT INTO checklist_flota (${keys.join(', ')})
    VALUES (${placeholders.join(', ')})
  `).run(...values);

  const created = { id: info.lastInsertRowid, codigo: fields.codigo || null, ...fields };

  try {
    const { buildChecklistEvent, dispatchNotificaciones } = require('./notificaciones-reglas');
    const event = buildChecklistEvent(fields, stats, b);
    event.referencia = String(created.id);
    await dispatchNotificaciones(db, event);
  } catch (err) {
    console.warn('[checklist] notificación:', err.message);
  }

  return { id: created.id, codigo: created.codigo || null };
}

async function saveChecklistPhoto(patente, tipo, dataUrl, empresaSlug = 'shared') {
  if (!patente || !tipo || !dataUrl) {
    throw Object.assign(new Error('Patente, tipo y foto requeridos'), { status: 400 });
  }
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:image\/([a-z0-9+.-]+)(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) {
    throw Object.assign(new Error('Formato de imagen inválido. Usa JPG o PNG (en iPhone: Foto → Formatos → Más compatible).'), {
      status: 400
    });
  }
  const kind = String(match[1] || '').toLowerCase();
  if (/heic|heif|tiff|tif|svg/.test(kind)) {
    throw Object.assign(new Error('Formato no soportado (HEIC/HEIF). En iPhone: Ajustes → Cámara → Formatos → Más compatible, o elige “Imagen JPEG” al compartir.'), {
      status: 400
    });
  }
  const ext = kind === 'jpeg' || kind === 'jpg' ? 'jpg' : (kind === 'png' ? 'png' : (kind === 'webp' ? 'webp' : 'jpg'));
  let buf;
  try {
    buf = Buffer.from(match[2], 'base64');
  } catch (_) {
    throw Object.assign(new Error('No se pudo decodificar la imagen'), { status: 400 });
  }
  if (!buf.length) {
    throw Object.assign(new Error('Imagen vacía'), { status: 400 });
  }
  if (buf.length > 8 * 1024 * 1024) {
    throw Object.assign(new Error('La imagen supera 8 MB'), { status: 400 });
  }

  const slug = String(empresaSlug || 'shared').replace(/[^a-z0-9_-]/gi, '') || 'shared';
  const safePatente = String(patente).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SINPAT';
  const safeTipo = String(tipo).replace(/[^a-z0-9_]/gi, '') || 'foto';
  const filename = `${safePatente}_${Date.now()}_${safeTipo}.${ext}`;

  // Preferir data/ (fuera de public). Si el hosting no deja escribir, caer a public/uploads.
  const candidates = [
    path.join(UPLOAD_DIR, slug),
    path.join(LEGACY_UPLOAD_DIR, slug),
    LEGACY_UPLOAD_DIR
  ];
  let written = null;
  let lastErr = null;
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fullPath = path.join(dir, filename);
      fs.writeFileSync(fullPath, buf);
      // prueba de lectura rápida
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size < 1) {
        throw new Error('Escritura incompleta');
      }
      written = { dir, fullPath };
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!written) {
    throw Object.assign(
      new Error(`No se pudo guardar la foto en el servidor (${lastErr?.message || 'sin permiso de escritura'})`),
      { status: 500 }
    );
  }
  return `/api/modulos/checklist/foto/${slug}/${filename}`;
}

function resolveChecklistPhoto(empresaParam, filename, authEmpresa) {
  const slug = String(empresaParam || '').replace(/[^a-z0-9_-]/gi, '');
  const file = path.basename(String(filename || ''));
  if (!slug || !file || !/\.(jpe?g|png|webp|gif)$/i.test(file)) return null;
  // Permitir ver fotos de la propia empresa; admins / mismo slug
  if (authEmpresa && slug !== String(authEmpresa).replace(/[^a-z0-9_-]/gi, '') && slug !== 'shared') {
    return null;
  }
  const candidates = [
    path.resolve(path.join(UPLOAD_DIR, slug, file)),
    path.resolve(path.join(LEGACY_UPLOAD_DIR, slug, file)),
    path.resolve(path.join(LEGACY_UPLOAD_DIR, file)),
    path.resolve(path.join(UPLOAD_DIR, file))
  ];
  const roots = [
    path.resolve(UPLOAD_DIR),
    path.resolve(LEGACY_UPLOAD_DIR)
  ];
  for (const full of candidates) {
    const okRoot = roots.some((root) => full === root || full.startsWith(root + path.sep));
    if (!okRoot) continue;
    if (fs.existsSync(full)) return full;
  }
  return null;
}

async function assignChecklistFlota(db, id, tecnicoId) {
  await ensureChecklistSchema(db);
  const colSet = new Set(await getTableColumns(db, 'checklist_flota'));
  const tecnicoCol = pickCol(colSet, 'tecnico_asignado_id', 'tecnico_id');
  if (!tecnicoCol) {
    throw Object.assign(new Error('Tabla sin columna de encargado de flota'), { status: 400 });
  }
  const anuladoWhere = colSet.has('anulado') ? ' AND anulado = 0' : '';
  const sets = [`${tecnicoCol} = ?`];
  if (colSet.has('estado_seguimiento')) sets.push("estado_seguimiento = 'en_gestion'");
  await db.prepare(`
    UPDATE checklist_flota SET ${sets.join(', ')} WHERE id = ?${anuladoWhere}
  `).run(Number(tecnicoId), Number(id));
}

async function updateChecklistFlota(db, id, body) {
  await ensureChecklistSchema(db);
  const colSet = new Set(await getTableColumns(db, 'checklist_flota'));
  const b = body || {};
  const sets = [];
  const values = [];

  for (const item of INSPECTION_ITEMS) {
    const val = b[item.key];
    if (val == null) continue;
    if (colSet.has(item.key)) {
      sets.push(`${item.key} = ?`);
      values.push(val);
    } else if (item.alt && colSet.has(item.alt)) {
      sets.push(`${item.alt} = ?`);
      values.push(val);
    }
  }

  if (b.observaciones !== undefined && colSet.has('observaciones')) {
    sets.push('observaciones = ?');
    values.push(b.observaciones || null);
  }
  if (b.estado_seguimiento && colSet.has('estado_seguimiento')) {
    sets.push('estado_seguimiento = ?');
    values.push(b.estado_seguimiento);
  }
  const tecnicoCol = pickCol(colSet, 'tecnico_asignado_id', 'tecnico_id');
  if (tecnicoCol && b.tecnico_asignado_id) {
    sets.push(`${tecnicoCol} = ?`);
    values.push(Number(b.tecnico_asignado_id));
  }

  const stats = countInspectionStats({ ...b });
  if (colSet.has('requiere_atencion')) {
    sets.push('requiere_atencion = ?');
    values.push(stats.items_malos > 0 ? 1 : 0);
  }
  const estadoCol = pickCol(colSet, 'estado_general', 'estado');
  if (estadoCol && b.estado_general) {
    sets.push(`${estadoCol} = ?`);
    values.push(b.estado_general);
  } else if (estadoCol) {
    sets.push(`${estadoCol} = ?`);
    values.push(calcEstadoGeneral(stats));
  }

  if (!sets.length) {
    throw Object.assign(new Error('Sin campos para actualizar'), { status: 400 });
  }
  values.push(Number(id));
  await db.prepare(`UPDATE checklist_flota SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  try {
    const row = await getChecklistFlota(db, Number(id));
    if (row) {
      const { buildChecklistEvent, dispatchNotificaciones } = require('./notificaciones-reglas');
      const merged = { ...row, ...b };
      const st = countInspectionStats(merged);
      const event = buildChecklistEvent(merged, st, b);
      event.referencia = String(id);
      // Solo notificar si hay colisión/siniestro o fallas relevantes al actualizar
      if ((event.tipos || []).some((t) => t === 'colision' || t === 'siniestro' || t === 'con_fallas')) {
        await dispatchNotificaciones(db, event);
      }
    }
  } catch (err) {
    console.warn('[checklist] notificación update:', err.message);
  }
}

async function anularChecklistFlota(db, id) {
  const colSet = new Set(await getTableColumns(db, 'checklist_flota'));
  if (!colSet.has('anulado')) {
    throw Object.assign(new Error('Tabla sin columna anulado'), { status: 400 });
  }
  await db.prepare(`UPDATE checklist_flota SET anulado = 1 WHERE id = ?`).run(Number(id));
}

function getInspectionCatalog() {
  return INSPECTION_ITEMS.map((i) => ({
    key: i.key,
    label: i.label,
    inverted: !!i.inverted
  }));
}

function getPhotoCatalog() {
  return [
    { key: 'foto_frontal', label: 'Vista frontal', required: true },
    { key: 'foto_lateral_izq', label: 'Lateral izquierdo', required: true },
    { key: 'foto_lateral_der', label: 'Lateral derecho', required: true },
    { key: 'foto_trasera', label: 'Vista trasera', required: true },
    { key: 'foto_rueda', label: 'Rueda de repuesto', required: true },
    { key: 'foto_kit_herramientas', label: 'Kit herramientas', required: true },
    { key: 'foto_colision', label: 'Colisión (si aplica)', required: false }
  ];
}

module.exports = {
  INSPECTION_ITEMS,
  PHOTO_FIELDS,
  ensureChecklistSchema,
  listChecklistFlota,
  getChecklistFlota,
  createChecklistFlota,
  saveChecklistPhoto,
  resolveChecklistPhoto,
  assignChecklistFlota,
  updateChecklistFlota,
  anularChecklistFlota,
  getInspectionCatalog,
  getPhotoCatalog
};
