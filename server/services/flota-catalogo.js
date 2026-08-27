/**
 * Catálogo de flota — carga Excel (patente / modelo) y alertas por correo.
 */
const ExcelJS = require('exceljs');
const { sendMail } = require('./mailer');

const FLOTA_ALERT_EMAIL = process.env.FLOTA_ALERT_EMAIL || 'flota@serviciossercom.cl';

function normalizarPatente(patente) {
  return String(patente || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

const HEADER_MAP = {
  patente: ['patente', 'placa', 'ppu', 'placapatente', 'patentevehiculo', 'nropatente', 'pat', 'ppuvehiculo'],
  modelo: ['modelo', 'model', 'version', 'versionmodelo', 'descripcion', 'vehiculo', 'nombrevehiculo'],
  marca: ['marca', 'brand', 'make', 'fabricante'],
  tipo: ['tipo', 'tipovehiculo', 'type', 'tipodevehiculo', 'categoria', 'clase'],
  anio: ['anio', 'ano', 'year', 'anofabricacion', 'aniofabricacion', 'añofabricacion'],
  propietario_nombre: ['propietario', 'dueno', 'dueño', 'owner', 'nombrepropietario', 'empresa', 'titular'],
  propietario_rut: ['rut', 'propietariorut', 'rutpropietario', 'documento', 'run'],
  // Quién usa / tiene el vehículo (columna típica del Excel de flota)
  asignado_nombre: [
    'asignado', 'asignada', 'asignadoa', 'responsable', 'conductor', 'chofer',
    'operador', 'usuarioasignado', 'nombreasignado', 'personal', 'funcionario',
    'trabajador', 'conductorasignado', 'encargado', 'usuario', 'nombreconductor'
  ]
};

function normHeader(value) {
  return String(cellText(value) || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function cellText(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
  if (typeof val === 'object') {
    if (val.result != null) return cellText(val.result);
    if (val.text != null) return String(val.text).trim();
    if (val.richText) return val.richText.map((t) => t.text || '').join('').trim();
    if (val.hyperlink && val.text) return String(val.text).trim();
  }
  return String(val).trim();
}

function mapHeader(cellValue) {
  const key = normHeader(cellValue);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    if (aliases.includes(key) || aliases.some((a) => key.includes(a))) return field;
  }
  return null;
}

async function tableExists(db, table) {
  if (db.driver === 'mysql') {
    const row = await db.prepare(`
      SELECT 1 AS ok FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
      LIMIT 1
    `).get(table);
    return !!row;
  }
  const row = await db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table);
  return !!row;
}

async function ensureSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS flota_vehiculos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        patente VARCHAR(32) NOT NULL,
        modelo VARCHAR(255) NULL,
        marca VARCHAR(128) NULL,
        tipo VARCHAR(128) NULL,
        anio VARCHAR(16) NULL,
        propietario_nombre VARCHAR(255) NULL,
        propietario_rut VARCHAR(32) NULL,
        asignado_nombre VARCHAR(255) NULL,
        fecha_carga DATETIME DEFAULT CURRENT_TIMESTAMP,
        cargado_por INT NULL,
        UNIQUE KEY uq_flota_patente (patente)
      )
    `);
    try {
      await db.exec(`ALTER TABLE flota_vehiculos ADD COLUMN asignado_nombre VARCHAR(255) NULL`);
    } catch (_) { /* ya existe */ }
    await db.exec(`
      CREATE TABLE IF NOT EXISTS flota_catalogo_meta (
        id INT NOT NULL PRIMARY KEY DEFAULT 1,
        archivo_nombre VARCHAR(255) NULL,
        total INT NOT NULL DEFAULT 0,
        fecha_carga DATETIME NULL,
        cargado_por INT NULL,
        cargado_por_nombre VARCHAR(255) NULL
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS flota_patente_alertas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        patente VARCHAR(32) NOT NULL,
        fecha_envio DATETIME DEFAULT CURRENT_TIMESTAMP,
        usuario_id INT NULL,
        usuario_nombre VARCHAR(255) NULL,
        email_destino VARCHAR(255) NULL,
        INDEX idx_flota_alerta_patente (patente, fecha_envio)
      )
    `);
    return;
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS flota_vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patente TEXT NOT NULL UNIQUE,
      modelo TEXT,
      marca TEXT,
      tipo TEXT,
      anio TEXT,
      propietario_nombre TEXT,
      propietario_rut TEXT,
      asignado_nombre TEXT,
      fecha_carga TEXT DEFAULT (datetime('now')),
      cargado_por INTEGER
    )
  `);
  try {
    await db.exec(`ALTER TABLE flota_vehiculos ADD COLUMN asignado_nombre TEXT`);
  } catch (_) { /* ya existe */ }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS flota_catalogo_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      archivo_nombre TEXT,
      total INTEGER NOT NULL DEFAULT 0,
      fecha_carga TEXT,
      cargado_por INTEGER,
      cargado_por_nombre TEXT
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS flota_patente_alertas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patente TEXT NOT NULL,
      fecha_envio TEXT DEFAULT (datetime('now')),
      usuario_id INTEGER,
      usuario_nombre TEXT,
      email_destino TEXT
    )
  `);
}

async function parseExcelBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

function extractRowsFromSheet(ws) {
  if (!ws || ws.rowCount < 1) return [];

  let headerRowNum = null;
  let colMap = {};

  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const row = ws.getRow(r);
    const trial = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const field = mapHeader(cell.value);
      if (field) trial[col] = field;
    });
    if (Object.values(trial).includes('patente')) {
      headerRowNum = r;
      colMap = trial;
      break;
    }
  }

  if (!headerRowNum) return [];

  const rows = [];
  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const item = {};
    for (const [col, field] of Object.entries(colMap)) {
      const val = cellText(row.getCell(Number(col)).value);
      if (val) item[field] = val;
    }
    const patente = normalizarPatente(item.patente);
    if (!patente || patente.length < 5) continue;

    let modelo = String(item.modelo || '').trim();
    const marca = item.marca ? String(item.marca).trim() : null;
    if (!modelo && marca) modelo = marca;
    if (!modelo) modelo = 'Sin modelo';

    rows.push({
      patente,
      modelo,
      marca,
      tipo: item.tipo ? String(item.tipo).trim() : null,
      anio: item.anio != null ? String(item.anio).trim() : null,
      propietario_nombre: item.propietario_nombre ? String(item.propietario_nombre).trim() : null,
      propietario_rut: item.propietario_rut ? String(item.propietario_rut).trim() : null,
      asignado_nombre: item.asignado_nombre ? String(item.asignado_nombre).trim() : null
    });
  }
  return rows;
}

async function readRowsFromWorkbook(wb) {
  const sheets = wb.worksheets || [];
  if (!sheets.length) {
    throw Object.assign(new Error('El Excel no tiene hojas'), { status: 400 });
  }

  const byPatente = new Map();
  let sheetsUsed = 0;
  for (const ws of sheets) {
    const rows = extractRowsFromSheet(ws);
    if (!rows.length) continue;
    sheetsUsed += 1;
    for (const row of rows) byPatente.set(row.patente, row);
  }

  if (!byPatente.size) {
    throw Object.assign(new Error(
      'No se encontraron filas con columna Patente. Use la plantilla o nombre la columna "Patente".'
    ), { status: 400 });
  }

  return { rows: Array.from(byPatente.values()), sheetsUsed };
}

async function saveMeta(db, meta) {
  await ensureSchema(db);
  const existing = await db.prepare('SELECT id FROM flota_catalogo_meta WHERE id = 1').get();
  if (existing) {
    await db.prepare(`
      UPDATE flota_catalogo_meta
      SET archivo_nombre = ?, total = ?, fecha_carga = ?, cargado_por = ?, cargado_por_nombre = ?
      WHERE id = 1
    `).run(meta.archivo_nombre, meta.total, meta.fecha_carga, meta.cargado_por, meta.cargado_por_nombre);
  } else {
    await db.prepare(`
      INSERT INTO flota_catalogo_meta
        (id, archivo_nombre, total, fecha_carga, cargado_por, cargado_por_nombre)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(meta.archivo_nombre, meta.total, meta.fecha_carga, meta.cargado_por, meta.cargado_por_nombre);
  }
}

async function importCatalogo(db, buffer, opts = {}) {
  await ensureSchema(db);
  const wb = await parseExcelBuffer(buffer);
  const { rows, sheetsUsed } = await readRowsFromWorkbook(wb);
  const userId = opts.userId || null;
  const userName = opts.userName || null;
  const archivo = String(opts.filename || 'catalogo_flota.xlsx').slice(0, 255);
  const fecha = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await db.exec('DELETE FROM flota_vehiculos');
  const stmt = db.prepare(`
    INSERT INTO flota_vehiculos
      (patente, modelo, marca, tipo, anio, propietario_nombre, propietario_rut, asignado_nombre, cargado_por, fecha_carga)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    await stmt.run(
      row.patente, row.modelo, row.marca, row.tipo, row.anio,
      row.propietario_nombre, row.propietario_rut, row.asignado_nombre, userId, fecha
    );
  }

  await saveMeta(db, {
    archivo_nombre: archivo,
    total: rows.length,
    fecha_carga: fecha,
    cargado_por: userId,
    cargado_por_nombre: userName
  });

  return { total: rows.length, archivo_nombre: archivo, sheets_used: sheetsUsed, fecha_carga: fecha };
}

async function deleteCatalogo(db) {
  await ensureSchema(db);
  await db.exec('DELETE FROM flota_vehiculos');
  await saveMeta(db, {
    archivo_nombre: null,
    total: 0,
    fecha_carga: null,
    cargado_por: null,
    cargado_por_nombre: null
  });
  return { total: 0 };
}

async function getCatalogoInfo(db) {
  await ensureSchema(db);
  let meta = null;
  try {
    meta = await db.prepare(`
      SELECT archivo_nombre, total, fecha_carga, cargado_por, cargado_por_nombre
      FROM flota_catalogo_meta WHERE id = 1
    `).get();
  } catch (_) { meta = null; }

  let total = Number(meta?.total || 0);
  let ultima = meta?.fecha_carga || null;
  if (!total && (await tableExists(db, 'flota_vehiculos'))) {
    const row = await db.prepare(`
      SELECT COUNT(*) AS total, MAX(fecha_carga) AS ultima_carga
      FROM flota_vehiculos
    `).get();
    total = Number(row?.total || 0);
    ultima = row?.ultima_carga || ultima;
  }

  return {
    total,
    ultima_carga: ultima,
    archivo_nombre: meta?.archivo_nombre || null,
    cargado_por_nombre: meta?.cargado_por_nombre || null
  };
}

async function listCatalogo(db, opts = {}) {
  await ensureSchema(db);
  if (!(await tableExists(db, 'flota_vehiculos'))) return [];
  const q = String(opts.q || '').trim();
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 200));
  const cols = 'patente, modelo, marca, tipo, anio, propietario_nombre, propietario_rut, asignado_nombre, fecha_carga';
  if (q) {
    // Varias palabras (ej. "Jose Jofre"): cada token debe aparecer en asignado/propietario/patente/modelo
    const tokens = q.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
    if (tokens.length > 1) {
      const clauses = [];
      const params = [];
      for (const t of tokens) {
        const like = `%${t}%`;
        clauses.push(`(
          patente LIKE ? OR modelo LIKE ? OR COALESCE(marca,'') LIKE ?
          OR COALESCE(propietario_nombre,'') LIKE ?
          OR COALESCE(asignado_nombre,'') LIKE ?
        )`);
        params.push(like, like, like, like, like);
      }
      return db.prepare(`
        SELECT ${cols}
        FROM flota_vehiculos
        WHERE ${clauses.join(' AND ')}
        ORDER BY patente ASC
        LIMIT ${limit}
      `).all(...params);
    }
    const like = `%${q}%`;
    return db.prepare(`
      SELECT ${cols}
      FROM flota_vehiculos
      WHERE patente LIKE ? OR modelo LIKE ? OR COALESCE(marca,'') LIKE ?
         OR COALESCE(propietario_nombre,'') LIKE ?
         OR COALESCE(asignado_nombre,'') LIKE ?
      ORDER BY patente ASC
      LIMIT ${limit}
    `).all(like, like, like, like, like);
  }
  return db.prepare(`
    SELECT ${cols}
    FROM flota_vehiculos
    ORDER BY patente ASC
    LIMIT ${limit}
  `).all();
}

async function buscarEnCatalogo(db, patenteRaw) {
  await ensureSchema(db);
  const patente = normalizarPatente(patenteRaw);
  if (!patente) return null;
  return db.prepare(`
    SELECT patente, modelo, marca, tipo, anio, propietario_nombre, propietario_rut, asignado_nombre
    FROM flota_vehiculos
    WHERE patente = ?
    LIMIT 1
  `).get(patente);
}

/**
 * Contexto para Angel: busca por nombre (asignado/propietario) o patente.
 */
async function angelBuscarFlota(db, query, limit = 15) {
  await ensureSchema(db);
  const info = await getCatalogoInfo(db);
  const q = String(query || '').trim();
  if (!q) {
    return {
      total_catalogo: info.total,
      archivo: info.archivo_nombre,
      nota: 'Indica nombre de la persona asignada o una patente.',
      data: []
    };
  }
  const rows = await listCatalogo(db, { q, limit });
  return {
    total_catalogo: info.total,
    archivo: info.archivo_nombre,
    ultima_carga: info.ultima_carga,
    consulta: q,
    total: rows.length,
    data: rows,
    nota: rows.length
      ? 'Cada fila es un vehículo del Excel de catálogo flota (Configuraciones). Usa patente + asignado_nombre/propietario_nombre.'
      : 'Sin coincidencias en el catálogo. Verifica el nombre o pide re-cargar el Excel en Configuraciones → Catálogo flota.'
  };
}

async function tieneCatalogo(db) {
  const info = await getCatalogoInfo(db);
  return info.total > 0;
}

async function alertaReciente(db, patente) {
  const sinceExpr = db.driver === 'mysql'
    ? 'fecha_envio > DATE_SUB(NOW(), INTERVAL 24 HOUR)'
    : "fecha_envio > datetime('now', '-24 hours')";
  const row = await db.prepare(`
    SELECT id FROM flota_patente_alertas
    WHERE patente = ? AND ${sinceExpr}
    LIMIT 1
  `).get(patente);
  return !!row;
}

async function alertarPatenteAusente(db, patenteRaw, opts = {}) {
  const patente = normalizarPatente(patenteRaw);
  if (!patente) return { sent: false, reason: 'patente_invalida' };
  if (!(await tieneCatalogo(db))) return { sent: false, reason: 'catalogo_vacio' };
  if (await alertaReciente(db, patente)) return { sent: false, reason: 'ya_notificado' };

  const usuario = opts.usuario || {};
  const usuarioNombre = [usuario.nombre, usuario.apellido].filter(Boolean).join(' ').trim()
    || usuario.email
    || 'Usuario ESERCOM';
  const info = await getCatalogoInfo(db);
  const subject = `[ESERCOM] Patente no registrada en catálogo flota: ${patente}`;
  const text = [
    'Se ingresó una patente que NO está en el catálogo de flota cargado por Excel.',
    '',
    `Patente: ${patente}`,
    `Archivo Excel: ${info.archivo_nombre || '—'}`,
    `Usuario: ${usuarioNombre}${usuario.email ? ` (${usuario.email})` : ''}`,
    `Fecha: ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`,
    '',
    'Revise Configuraciones → Catálogo flota (Excel) o agregue el vehículo al archivo.'
  ].join('\n');

  const mailResult = await sendMail({
    to: FLOTA_ALERT_EMAIL,
    subject,
    text,
    db
  });

  try {
    const { dispatchNotificaciones } = require('./notificaciones-reglas');
    await dispatchNotificaciones(db, {
      modulo: 'catalogo-flota',
      estado: 'alerta',
      tipo: 'patente_faltante',
      tipos: ['patente_faltante'],
      cantidad: 1,
      titulo: subject,
      mensaje: text,
      referencia: patente
    });
  } catch (_) { /* */ }

  if (mailResult.sent) {
    await db.prepare(`
      INSERT INTO flota_patente_alertas (patente, usuario_id, usuario_nombre, email_destino)
      VALUES (?, ?, ?, ?)
    `).run(patente, opts.usuarioId || null, usuarioNombre, FLOTA_ALERT_EMAIL);
  }

  return { ...mailResult, email: FLOTA_ALERT_EMAIL };
}

async function buildPlantillaBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Flota');
  ws.addRow(['Patente', 'Modelo', 'Marca', 'Tipo', 'Año', 'Propietario', 'RUT', 'Asignado']);
  ws.addRow(['ABCD12', 'HILUX 2.8', 'TOYOTA', 'CAMIONETA', '2021', 'SERCOM SpA', '76123456-7', 'José Jofré']);
  ws.getRow(1).font = { bold: true };
  ws.columns = [
    { width: 12 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 8 }, { width: 24 }, { width: 14 }, { width: 22 }
  ];
  return wb.xlsx.writeBuffer();
}

function decodeUploadBody(body) {
  const raw = body?.dataUrl || body?.base64 || body?.file;
  if (!raw) {
    throw Object.assign(new Error('Archivo Excel requerido (dataUrl o base64)'), { status: 400 });
  }
  const b64 = String(raw).includes(',') ? String(raw).split(',')[1] : String(raw);
  return Buffer.from(b64, 'base64');
}

module.exports = {
  ensureSchema,
  importCatalogo,
  deleteCatalogo,
  getCatalogoInfo,
  listCatalogo,
  buscarEnCatalogo,
  angelBuscarFlota,
  tieneCatalogo,
  alertarPatenteAusente,
  buildPlantillaBuffer,
  decodeUploadBody,
  normalizarPatente,
  FLOTA_ALERT_EMAIL
};
