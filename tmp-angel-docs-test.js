/**
 * Cerebro de Angel IA: documentos (texto, imagen, excel, word, pdf)
 * + recuperación por relevancia (mente ligera) para no inyectar todo el corpus.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const config = require('../config');

const TABLE = 'angel_ia_conocimiento_docs';
const CHUNKS = 'angel_ia_conocimiento_chunks';
const DIR_ROOT = path.join(config.dataDir, 'angel-conocimiento');
const MAX_TEXT = 250000;
const MAX_PROMPT_CHARS = 22000;
const MAX_CHUNKS_IN_PROMPT = 20;
const STOP_TOKENS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'y', 'o', 'u', 'a', 'al',
  'que', 'por', 'con', 'para', 'se', 'su', 'sus', 'es', 'son', 'me', 'te', 'lo', 'le', 'mi', 'tu',
  'si', 'no', 'ya', 'hay', 'esta', 'este', 'esto', 'esos', 'esas', 'esa', 'como', 'mas', 'muy',
  'revisa', 'revisar', 'busca', 'buscar', 'dime', 'cual', 'quien', 'quienes', 'sobre', 'tiene',
  'tengo', 'donde', 'cuando', 'porque', 'desde', 'hasta', 'entre', 'sin', 'segun', 'hacia',
  'tambien', 'solo', 'puede', 'puedo', 'favor', 'hola', 'gracias', 'porfa', 'porfis', 'lee',
  'leer', 'mira', 'mirar', 'ver', 'dice', 'sale', 'sale', 'aparece', 'archivo', 'documento'
]);
const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 60;
const EXCEL_MAX_ROWS = 8000;
const EXCEL_MAX_COLS = 80;
const TABLA_JSON_MAX = 8_000_000; // ~8MB safety
const MAX_TABLA_HITS = 25;

function dirForEmpresa(empresa) {
  const slug = String(empresa || 'shared').replace(/[^a-z0-9_-]/gi, '') || 'shared';
  const dir = path.join(DIR_ROOT, slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const TYPE_META = {
  texto: { icon: 'fa-align-left', label: 'Texto' },
  excel: { icon: 'fa-file-excel', label: 'Excel' },
  word: { icon: 'fa-file-word', label: 'Word' },
  pdf: { icon: 'fa-file-pdf', label: 'PDF' },
  imagen: { icon: 'fa-image', label: 'Imagen' },
  otro: { icon: 'fa-file', label: 'Archivo' }
};

/** Temas de la empresa: carpetas del cerebro para saber qué está cubierto. */
const CATEGORIAS = [
  {
    id: 'flota',
    label: 'Flota y vehículos',
    icon: 'fa-truck',
    descripcion: 'Checklist, patentes, mantención, siniestros',
    keywords: ['flota', 'vehiculo', 'camion', 'patente', 'checklist', 'neumatico', 'mantencion',
      'kilometraje', 'chofer', 'conductor', 'siniestro', 'colision', 'combustible', 'taller',
      'leasing', 'marca', 'modelo', 'responsable', 'costo', 'arriendo']
  },
  {
    id: 'agenda',
    label: 'Camión pluma / agenda',
    icon: 'fa-calendar-days',
    descripcion: 'Programación de servicios y grúas',
    keywords: ['pluma', 'agenda', 'grua', 'izaje', 'programacion', 'faena', 'turno']
  },
  {
    id: 'materiales',
    label: 'Materiales y bodega',
    icon: 'fa-boxes-stacked',
    descripcion: 'Salidas, recetas, inventario y stock',
    keywords: ['material', 'materiales', 'bodega', 'inventario', 'stock', 'receta', 'insumo',
      'poste', 'cable', 'salida de material', 'guia de despacho', 'catalogo']
  },
  {
    id: 'compras',
    label: 'Compras',
    icon: 'fa-cart-shopping',
    descripcion: 'Solicitudes, cotizaciones y órdenes',
    keywords: ['compra', 'compras', 'cotizacion', 'orden de compra', 'oc ', 'adquisicion', 'presupuesto']
  },
  {
    id: 'proveedores',
    label: 'Proveedores',
    icon: 'fa-handshake',
    descripcion: 'Fichas, evaluación y portal',
    keywords: ['proveedor', 'proveedores', 'rut proveedor', 'portal proveedores', 'subcontrato']
  },
  {
    id: 'facturas',
    label: 'Facturas y pagos',
    icon: 'fa-file-invoice-dollar',
    descripcion: 'Aprobación, lotes y estados de pago',
    keywords: ['factura', 'facturas', 'pago', 'boleta', 'estado de pago', 'sii', 'nota de credito', 'cobranza']
  },
  {
    id: 'contratos',
    label: 'Contratos',
    icon: 'fa-file-signature',
    descripcion: 'Vigencias, anexos y seguimiento',
    keywords: ['contrato', 'contratos', 'anexo', 'vigencia', 'licitacion', 'clausula', 'mandante']
  },
  {
    id: 'proyectos',
    label: 'Proyectos y CECOs',
    icon: 'fa-diagram-project',
    descripcion: 'Centros de costo, obras y actividades',
    keywords: ['ceco', 'cecos', 'centro de costo', 'proyecto', 'obra', 'actividad', 'paradero',
      'avance', 'jefe de proyecto']
  },
  {
    id: 'ssgg',
    label: 'Servicios generales',
    icon: 'fa-screwdriver-wrench',
    descripcion: 'Requerimientos de mantención e instalaciones',
    keywords: ['servicios generales', 'ssgg', 'aseo', 'instalacion', 'oficina', 'reparacion', 'mantenimiento']
  },
  {
    id: 'telecom',
    label: 'Telecomunicaciones',
    icon: 'fa-tower-cell',
    descripcion: 'Equipos, líneas y requerimientos telecom',
    keywords: ['telecom', 'telecomunicaciones', 'fibra', 'antena', 'red', 'internet', 'telefono', 'enlace']
  },
  {
    id: 'personas',
    label: 'Personas y roles',
    icon: 'fa-users',
    descripcion: 'Usuarios, cargos, permisos y turnos',
    keywords: ['usuario', 'usuarios', 'rol', 'roles', 'permiso', 'cargo', 'personal', 'rrhh',
      'trabajador', 'organigrama', 'induccion']
  },
  {
    id: 'seguridad',
    label: 'Seguridad y prevención',
    icon: 'fa-helmet-safety',
    descripcion: 'Prevención de riesgos, EPP y protocolos',
    keywords: ['seguridad', 'prevencion', 'riesgo', 'epp', 'accidente', 'emergencia', 'protocolo',
      'incidente', 'mutual', 'ats']
  },
  {
    id: 'procedimientos',
    label: 'Procedimientos y calidad',
    icon: 'fa-clipboard-check',
    descripcion: 'Instructivos, normas y formularios',
    keywords: ['procedimiento', 'instructivo', 'norma', 'politica', 'manual', 'formulario',
      'calidad', 'iso', 'reglamento']
  },
  {
    id: 'general',
    label: 'General',
    icon: 'fa-folder',
    descripcion: 'Sin tema asignado todavía',
    keywords: []
  }
];

const CATEGORIA_IDS = CATEGORIAS.map((c) => c.id);
const CATEGORIA_MAP = CATEGORIAS.reduce((acc, c) => {
  acc[c.id] = c;
  return acc;
}, {});

function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Clasifica un documento en un tema de la empresa por palabras clave. */
function clasificarTema(nombre, texto) {
  const nom = normalizar(nombre);
  const cuerpo = normalizar(String(texto || '').slice(0, 4000));
  let mejor = { id: 'general', score: 0 };
  for (const cat of CATEGORIAS) {
    if (!cat.keywords.length) continue;
    let score = 0;
    for (const kw of cat.keywords) {
      const k = normalizar(kw);
      if (nom.includes(k)) score += 4;
      const hits = cuerpo.split(k).length - 1;
      if (hits > 0) score += Math.min(4, 1 + hits * 0.4);
    }
    if (score > mejor.score) mejor = { id: cat.id, score };
  }
  return mejor.score >= 2 ? mejor.id : 'general';
}

function categoriaValida(id) {
  const v = String(id || '').trim();
  return CATEGORIA_IDS.includes(v) ? v : null;
}

function categoriaMeta(id) {
  return CATEGORIA_MAP[id] || CATEGORIA_MAP.general;
}

function ensureDir() {
  if (!fs.existsSync(DIR_ROOT)) fs.mkdirSync(DIR_ROOT, { recursive: true });
}

async function columnExists(db, table, col) {
  try {
    if (db.driver === 'mysql') {
      const rows = await db.prepare(`
        SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      `).all(table, col);
      return rows.length > 0;
    }
    const rows = await db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === col);
  } catch (_) {
    return false;
  }
}

async function ensureAngelDocsSchema(db) {
  ensureDir();
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        archivo VARCHAR(512) NULL,
        tipo VARCHAR(32) NOT NULL DEFAULT 'excel',
        mime VARCHAR(120) NULL,
        texto LONGTEXT NULL,
        resumen VARCHAR(500) NULL,
        filas INT NOT NULL DEFAULT 0,
        hojas INT NOT NULL DEFAULT 0,
        creado_por INT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${CHUNKS} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doc_id INT NOT NULL,
        idx_chunk INT NOT NULL DEFAULT 0,
        texto LONGTEXT NOT NULL,
        FOREIGN KEY (doc_id) REFERENCES ${TABLE}(id) ON DELETE CASCADE
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        archivo TEXT,
        tipo TEXT NOT NULL DEFAULT 'excel',
        mime TEXT,
        texto TEXT,
        resumen TEXT,
        filas INTEGER NOT NULL DEFAULT 0,
        hojas INTEGER NOT NULL DEFAULT 0,
        creado_por INTEGER,
        fecha_creacion TEXT DEFAULT (datetime('now'))
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${CHUNKS} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        idx_chunk INTEGER NOT NULL DEFAULT 0,
        texto TEXT NOT NULL
      )
    `);
  }

  const extras = [
    ['tipo', db.driver === 'mysql' ? "VARCHAR(32) NOT NULL DEFAULT 'excel'" : "TEXT NOT NULL DEFAULT 'excel'"],
    ['mime', db.driver === 'mysql' ? 'VARCHAR(120) NULL' : 'TEXT'],
    ['resumen', db.driver === 'mysql' ? 'VARCHAR(500) NULL' : 'TEXT'],
    ['categoria', db.driver === 'mysql' ? "VARCHAR(40) NOT NULL DEFAULT 'general'" : "TEXT NOT NULL DEFAULT 'general'"],
    ['tabla_json', db.driver === 'mysql' ? 'LONGTEXT NULL' : 'TEXT']
  ];
  for (const [col, ddl] of extras) {
    if (!(await columnExists(db, TABLE, col))) {
      try {
        await db.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${col} ${ddl}`);
      } catch (_) { /* already exists / race */ }
    }
  }
}

function decodeDataUrl(dataUrl, maxMb = 12) {
  const raw = String(dataUrl || '');
  // Soporta data:mime;base64, y data:mime;charset=utf-8;base64,
  const m = raw.match(/^data:([^,]*?),(.+)$/i);
  if (!m) {
    const err = new Error('Archivo inválido');
    err.status = 400;
    throw err;
  }
  const meta = m[1] || '';
  const payload = m[2];
  const isBase64 = /;base64$/i.test(meta) || /;base64;/i.test(meta);
  const mime = (meta.split(';')[0] || 'application/octet-stream').trim() || 'application/octet-stream';
  let buf;
  try {
    buf = Buffer.from(payload, isBase64 ? 'base64' : 'utf8');
  } catch (_) {
    const err = new Error('No se pudo decodificar el archivo');
    err.status = 400;
    throw err;
  }
  if (!buf.length) {
    const err = new Error('Archivo vacío');
    err.status = 400;
    throw err;
  }
  if (buf.length > maxMb * 1024 * 1024) {
    const err = new Error(`El archivo supera ${maxMb} MB`);
    err.status = 400;
    throw err;
  }
  return { buf, mime };
}

function safeName(filename, fallback) {
  return String(filename || fallback)
    .replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '_')
    .slice(0, 180);
}

function detectTipo(filename, mime) {
  const name = String(filename || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  // Extensiones antiguas primero (MIME genérico las confunde)
  if (/\.xls$/i.test(name) && !/\.xlsx$/i.test(name)) return 'excel_old';
  if (/\.doc$/i.test(name) && !/\.docx$/i.test(name)) return 'word_old';
  if (/\.xlsx$/i.test(name) || m.includes('spreadsheetml') || (m.includes('excel') && !m.includes('ms-excel'))) {
    return 'excel';
  }
  if (m.includes('spreadsheet') && !m.includes('ms-excel')) return 'excel';
  if (/\.docx$/i.test(name) || m.includes('wordprocessingml')) return 'word';
  if (m.includes('msword') && !/\.docx$/i.test(name)) return 'word_old';
  if (/\.pdf$/i.test(name) || m.includes('pdf')) return 'pdf';
  if (/\.(png|jpe?g|webp|gif)$/i.test(name) || m.startsWith('image/')) return 'imagen';
  if (/\.(txt|md|csv)$/i.test(name) || m.startsWith('text/') || m.includes('csv')) return 'texto';
  return 'otro';
}

function truncate(text, max = MAX_TEXT) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '\n…[truncado]';
}

function cellToString(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text || '').join('').trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) {
      const s = String(v.toString()).trim();
      if (s && s !== '[object Object]') return s;
    }
    return '';
  }
  return String(v).trim();
}

function normalizeHeader(h, idx) {
  const raw = cellToString(h).replace(/\s+/g, ' ').trim();
  if (!raw) return `Campo_${idx + 1}`;
  return raw;
}

/**
 * Convierte filas tabulares en registros campo:valor.
 * Así Angel mantiene asociaciones (patente ↔ costo ↔ marca ↔ responsable ↔ leasing).
 */
function formatStructuredTable({ sheetName, matrix, maxRows = EXCEL_MAX_ROWS }) {
  if (!matrix.length) return { text: '', filas: 0, headers: [], rows: [] };

  let headerIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const filled = matrix[i].filter((c) => cellToString(c)).length;
    if (filled >= 2) {
      headerIdx = i;
      break;
    }
  }
  const headerRow = matrix[headerIdx] || [];
  const colCount = Math.min(
    EXCEL_MAX_COLS,
    Math.max(headerRow.length, ...matrix.map((r) => r.length), 1)
  );
  const headers = [];
  for (let c = 0; c < colCount; c++) {
    headers.push(normalizeHeader(headerRow[c], c));
  }

  const legend = headers.join(' | ');
  const parts = [
    `## Hoja: ${sheetName}`,
    'FORMATO: tabla estructurada. Cada "Registro" es UNA fila del Excel.',
    'Los campos de un mismo registro van juntos: si preguntan por una patente (u otro ID),',
    'responde con TODOS los campos de ese registro (costo, marca, responsable, leasing, etc.).',
    `CAMPOS: ${legend}`,
    ''
  ];

  const dataRows = [];
  let filas = 0;
  for (let r = headerIdx + 1; r < matrix.length && filas < maxRows; r++) {
    const row = matrix[r] || [];
    const cells = [];
    const pairs = [];
    let hasData = false;
    for (let c = 0; c < headers.length; c++) {
      const val = cellToString(row[c]);
      if (val) hasData = true;
      cells.push(val);
      pairs.push(`${headers[c]}: ${val || '(vacío)'}`);
    }
    if (!hasData) continue;
    filas += 1;
    dataRows.push(cells);
    parts.push(`--- Registro ${filas} (hoja: ${sheetName}) ---`);
    parts.push(pairs.join('\n'));
    parts.push('');
  }

  return {
    text: parts.join('\n'),
    filas,
    headers,
    rows: dataRows,
    headerIdx
  };
}

function sheetToMatrix(sheet, maxRows = EXCEL_MAX_ROWS + 5) {
  let maxCol = 0;
  const sparse = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > maxRows) return;
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > EXCEL_MAX_COLS) return;
      maxCol = Math.max(maxCol, colNumber);
      vals[colNumber - 1] = cellToString(cell.value);
    });
    sparse[rowNumber - 1] = vals;
  });
  const matrix = [];
  for (let i = 0; i < sparse.length; i++) {
    if (!sparse[i]) continue;
    const row = [];
    for (let c = 0; c < Math.min(maxCol, EXCEL_MAX_COLS); c++) row.push(sparse[i][c] || '');
    if (row.some((x) => x)) matrix.push(row);
  }
  return matrix;
}

function parseCsvMatrix(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
  return lines.map((line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQ = !inQ;
      } else if (ch === delim && !inQ) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out.slice(0, EXCEL_MAX_COLS);
  });
}

function buildTablaPayload(sheets) {
  const payload = {
    version: 1,
    sheets: sheets.map((s) => ({
      name: s.name,
      headers: s.headers,
      rows: s.rows,
      filas: s.filas,
      truncado: !!s.truncado,
      enabled: s.enabled !== false,
      visibleCols: Array.isArray(s.visibleCols) ? s.visibleCols : null
    }))
  };
  let json = JSON.stringify(payload);
  if (json.length > TABLA_JSON_MAX) {
    const slim = {
      version: 1,
      sheets: sheets.map((s) => {
        const max = Math.max(50, Math.floor((TABLA_JSON_MAX / Math.max(1, sheets.length)) / 200));
        return {
          name: s.name,
          headers: s.headers,
          rows: s.rows.slice(0, max),
          filas: s.filas,
          truncado: s.filas > max || !!s.truncado,
          enabled: s.enabled !== false,
          visibleCols: Array.isArray(s.visibleCols) ? s.visibleCols : null
        };
      })
    };
    json = JSON.stringify(slim);
  }
  return json;
}

/**
 * Regenera el texto que Angel indexa, solo con hojas habilitadas
 * y columnas visibles (si el usuario las desmarcó).
 * Formato denso: 1 línea por registro para buscar mejor patentes/campos.
 */
function rebuildTextoFromTabla(tabla) {
  const sheets = Array.isArray(tabla?.sheets) ? tabla.sheets : [];
  const parts = [];
  let filas = 0;
  let hojasActivas = 0;
  for (const sheet of sheets) {
    if (sheet.enabled === false) continue;
    const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
    if (!headers.length) continue;
    const vis = Array.isArray(sheet.visibleCols) && sheet.visibleCols.length === headers.length
      ? sheet.visibleCols
      : headers.map(() => true);
    const activeIdx = headers.map((_, i) => i).filter((i) => vis[i]);
    if (!activeIdx.length) continue;
    hojasActivas += 1;
    const activeHeaders = activeIdx.map((i) => headers[i]);
    const patenteIdx = activeIdx.find((i) => /patente|placa|ppü|ppu/i.test(String(headers[i] || '')));
    parts.push(`## Hoja: ${sheet.name || 'Hoja'}`);
    parts.push('REGLA: cada línea REGISTRO es UNA fila. Todos los campos de la línea pertenecen a la misma patente/unidad.');
    parts.push(`CAMPOS: ${activeHeaders.join(' | ')}`);
    parts.push('');
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    let n = 0;
    for (const row of rows) {
      const pairs = [];
      let hasData = false;
      let patenteVal = '';
      for (const i of activeIdx) {
        const val = cellToString(row?.[i]);
        if (val) hasData = true;
        if (i === patenteIdx && val) patenteVal = val;
        pairs.push(`${headers[i]}=${val || ''}`);
      }
      if (!hasData) continue;
      n += 1;
      filas += 1;
      const norm = normalizePlate(patenteVal);
      const prefix = patenteVal
        ? `REGISTRO|hoja=${sheet.name}|patente=${patenteVal}|patente_norm=${norm}|`
        : `REGISTRO|hoja=${sheet.name}|n=${n}|`;
      parts.push(prefix + pairs.join(' | '));
    }
    parts.push('');
  }
  if (!parts.length) {
    return {
      texto: 'Sin hojas habilitadas para Angel. Activa al menos una hoja del Excel y guarda.',
      filas: 0,
      hojasActivas: 0
    };
  }
  return {
    texto: truncate(parts.join('\n')),
    filas,
    hojasActivas
  };
}

function normalizePlate(v) {
  return String(v || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function analyzeQuery(query) {
  const raw = String(query || '');
  const lower = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const tokens = tokenize(raw);
  const plates = [];
  const plateRe = /\b([a-zA-Z]{2,4})\s*[- ]?\s*(\d{2,4})\b/g;
  let m;
  while ((m = plateRe.exec(raw)) !== null) {
    plates.push({
      raw: `${m[1]}${m[2]}`.toUpperCase(),
      compact: normalizePlate(`${m[1]}${m[2]}`),
      suffix: m[2]
    });
  }
  const suffixes = new Set(plates.map((p) => p.suffix));
  const sufMatch = lower.match(/(?:terminad[oa]s?|acaban?|terminen?|finalizan?|acaben?)\s+en\s+(\d{1,4})/);
  if (sufMatch) suffixes.add(sufMatch[1]);
  // "patentes … 41" / "las del 41"
  if (/\b(patente|patentes|flota|placa|vehicul)/i.test(lower)) {
    for (const t of tokens) {
      if (/^\d{2,4}$/.test(t)) suffixes.add(t);
    }
  }
  const wantsField = [];
  const fieldHints = [
    ['propiedad', /propiedad|due[nñ]o|avis|leasing|arriendo|arrend/i],
    ['modelo', /modelo/i],
    ['marca', /marca/i],
    ['asignado', /asignad|responsable|chofer|conductor/i],
    ['tipo', /tipo\s+de\s+vehicul|camioneta|camion/i],
    ['empresa', /empresa/i],
    ['estado', /estado/i],
    ['valor', /valor|costo|precio|arriendo/i]
  ];
  for (const [name, re] of fieldHints) {
    if (re.test(lower)) wantsField.push(name);
  }
  return {
    tokens,
    plates,
    suffixes: [...suffixes],
    isFleetQuery: /\b(patente|patentes|flota|placa|vehicul|leasing|arriendo)\b/i.test(lower),
    wantsField
  };
}

function scoreTablaRow(headers, row, analysis) {
  const cells = headers.map((h, i) => ({
    header: String(h || ''),
    value: cellToString(row?.[i]),
    headerNorm: String(h || '').toLowerCase(),
    valueNorm: cellToString(row?.[i]).toLowerCase(),
    valueCompact: normalizePlate(cellToString(row?.[i]))
  }));
  const patenteCell = cells.find((c) => /patente|placa|pp[uü]|ppu/i.test(c.headerNorm));
  const patenteVal = patenteCell?.value || '';
  const patenteCompact = patenteCell?.valueCompact || '';
  let score = 0;

  for (const p of analysis.plates || []) {
    if (patenteCompact && patenteCompact === p.compact) score += 50;
    else if (patenteCompact && (patenteCompact.includes(p.compact) || p.compact.includes(patenteCompact))) score += 35;
    else if (patenteCompact && patenteCompact.slice(-2) === p.compact.slice(-2) && patenteCompact.length >= 4) {
      // posible typo VRXR vs VRXL
      let diff = 0;
      const a = patenteCompact;
      const b = p.compact;
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) if ((a[i] || '') !== (b[i] || '')) diff += 1;
      if (diff <= 2) score += 28;
    }
  }

  for (const suf of analysis.suffixes || []) {
    if (patenteCompact && patenteCompact.endsWith(String(suf))) score += 40;
    else if (cells.some((c) => c.valueCompact.endsWith(String(suf)) && c.valueCompact.length >= 4)) score += 15;
  }

  for (const t of analysis.tokens || []) {
    if (t.length < 2) continue;
    for (const c of cells) {
      if (c.valueNorm.includes(t)) score += 1.2;
      if (c.headerNorm.includes(t)) score += 0.4;
    }
  }

  if (analysis.isFleetQuery && patenteVal) score += 2;
  return { score, patenteVal, patenteCompact, cells };
}

function formatRowForPrompt(sheetName, headers, row, analysis) {
  const scored = scoreTablaRow(headers, row, analysis || { tokens: [], plates: [], suffixes: [] });
  const pairs = scored.cells
    .filter((c) => c.value)
    .map((c) => `${c.header}: ${c.value}`);
  return `• Hoja ${sheetName} | Patente: ${scored.patenteVal || '(s/patente)'}\n  ${pairs.join(' | ')}`;
}

/**
 * Busca filas reales en tabla_json (más fiable que trozos de texto).
 */
async function searchExcelTabla(db, query, limit = MAX_TABLA_HITS) {
  const analysis = analyzeQuery(query);
  if (!analysis.tokens.length && !analysis.plates.length && !analysis.suffixes.length) {
    return { hits: [], analysis };
  }
  const hasTabla = await columnExists(db, TABLE, 'tabla_json');
  if (!hasTabla) return { hits: [], analysis };

  const docs = await db.prepare(`
    SELECT id, nombre, tipo, categoria, tabla_json
    FROM ${TABLE}
    WHERE tabla_json IS NOT NULL AND tabla_json != ''
    ORDER BY id DESC
    LIMIT 30
  `).all();

  const ranked = [];
  for (const doc of docs) {
    let tabla;
    try {
      tabla = typeof doc.tabla_json === 'string' ? JSON.parse(doc.tabla_json) : doc.tabla_json;
    } catch (_) {
      continue;
    }
    for (const sheet of (tabla?.sheets || [])) {
      if (sheet.enabled === false) continue;
      const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
      const vis = Array.isArray(sheet.visibleCols) && sheet.visibleCols.length === headers.length
        ? sheet.visibleCols
        : headers.map(() => true);
      const activeHeaders = headers.filter((_, i) => vis[i]);
      const activeIdx = headers.map((_, i) => i).filter((i) => vis[i]);
      for (const row of (sheet.rows || [])) {
        const activeRow = activeIdx.map((i) => row?.[i]);
        const { score, patenteVal } = scoreTablaRow(activeHeaders, activeRow, analysis);
        if (score < 8) continue;
        ranked.push({
          score,
          docId: doc.id,
          docNombre: doc.nombre,
          sheetName: sheet.name || 'Hoja',
          patente: patenteVal,
          text: formatRowForPrompt(sheet.name || 'Hoja', activeHeaders, activeRow, analysis)
        });
      }
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  // Preferir diversidad de patentes
  const seen = new Set();
  const hits = [];
  for (const r of ranked) {
    const key = normalizePlate(r.patente) || r.text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(r);
    if (hits.length >= limit) break;
  }
  return { hits, analysis };
}

function normalizeIncomingTabla(tabla) {
  if (!tabla || typeof tabla !== 'object') return null;
  const sheets = Array.isArray(tabla.sheets) ? tabla.sheets : null;
  if (!sheets) return null;
  return {
    version: 1,
    sheets: sheets.map((s) => ({
      name: String(s?.name || 'Hoja').slice(0, 120),
      headers: Array.isArray(s?.headers) ? s.headers.map((h) => String(h || '')) : [],
      rows: Array.isArray(s?.rows) ? s.rows : [],
      filas: Number(s?.filas || (Array.isArray(s?.rows) ? s.rows.length : 0)),
      truncado: !!s?.truncado,
      enabled: s?.enabled !== false,
      visibleCols: Array.isArray(s?.visibleCols) ? s.visibleCols.map(Boolean) : null
    }))
  };
}

async function extractExcelText(buffer) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheetsOut = [];
    let hojas = 0;
    wb.eachSheet((sheet) => {
      hojas += 1;
      const matrix = sheetToMatrix(sheet);
      if (!matrix.length) {
        sheetsOut.push({
          name: sheet.name || `Hoja ${hojas}`,
          headers: [],
          rows: [],
          filas: 0,
          truncado: false,
          enabled: true,
          visibleCols: null
        });
        return;
      }
      const formatted = formatStructuredTable({
        sheetName: sheet.name || `Hoja ${hojas}`,
        matrix
      });
      const truncado = matrix.length - 1 > formatted.filas;
      sheetsOut.push({
        name: sheet.name || `Hoja ${hojas}`,
        headers: formatted.headers,
        rows: formatted.rows,
        filas: formatted.filas,
        truncado,
        enabled: true,
        visibleCols: null
      });
    });
    if (!sheetsOut.some((s) => s.headers.length || s.rows.length)) {
      const err = new Error('El Excel no tiene filas con datos');
      err.status = 400;
      throw err;
    }
    const rebuilt = rebuildTextoFromTabla({ version: 1, sheets: sheetsOut });
    return {
      texto: rebuilt.texto,
      filas: rebuilt.filas,
      hojas,
      tabla_json: buildTablaPayload(sheetsOut)
    };
  } catch (err) {
    if (err.status) throw err;
    const e = new Error(`No se pudo leer el Excel (.xlsx): ${err.message}`);
    e.status = 400;
    throw e;
  }
}

function extractCsvStructured(text, filename = 'datos.csv') {
  const matrix = parseCsvMatrix(text);
  const sheetName = path.basename(filename || 'CSV');
  const formatted = formatStructuredTable({ sheetName, matrix });
  const sheetsOut = [{
    name: sheetName,
    headers: formatted.headers,
    rows: formatted.rows,
    filas: formatted.filas,
    truncado: false,
    enabled: true,
    visibleCols: null
  }];
  const rebuilt = rebuildTextoFromTabla({ version: 1, sheets: sheetsOut });
  return {
    texto: rebuilt.texto,
    filas: rebuilt.filas || 0,
    hojas: 1,
    tabla_json: buildTablaPayload(sheetsOut)
  };
}

function chunkByRecords(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // Formato denso: líneas REGISTRO|...
  if (/^REGISTRO\|/m.test(clean)) {
    const lines = clean.split('\n');
    const preamble = [];
    const records = [];
    for (const line of lines) {
      if (/^REGISTRO\|/.test(line)) records.push(line);
      else if (line.trim()) preamble.push(line.trim());
    }
    const header = preamble.join('\n');
    const chunks = [];
    let buf = header ? `${header}\n` : '';
    for (const rec of records) {
      const next = `${buf}${rec}\n`;
      if (buf && next.length > CHUNK_SIZE) {
        chunks.push(buf.trim());
        buf = (header ? `${header}\n` : '') + rec + '\n';
        if (chunks.length >= 400) break;
      } else {
        buf = next;
      }
    }
    if (buf.trim() && chunks.length < 400) chunks.push(buf.trim());
    return chunks.length ? chunks : chunkTextPlain(clean);
  }

  const blocks = clean.split(/\n(?=--- Registro \d+)/);
  const preamble = [];
  const records = [];
  for (const b of blocks) {
    if (/^--- Registro \d+/.test(b.trim())) records.push(b.trim());
    else if (b.trim()) preamble.push(b.trim());
  }
  const header = preamble.join('\n\n');
  if (!records.length) return chunkTextPlain(clean);

  const chunks = [];
  let buf = header ? `${header}\n\n` : '';
  for (const rec of records) {
    const next = buf + rec + '\n\n';
    if (buf && next.length > CHUNK_SIZE) {
      chunks.push(buf.trim());
      buf = (header ? `${header}\n\n` : '') + rec + '\n\n';
      if (chunks.length >= 250) break;
    } else {
      buf = next;
    }
  }
  if (buf.trim() && chunks.length < 250) chunks.push(buf.trim());
  return chunks;
}

function chunkText(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (/^REGISTRO\|/m.test(clean) || /--- Registro \d+/.test(clean)) return chunkByRecords(clean);
  return chunkTextPlain(clean);
}

function chunkTextPlain(clean) {
  const chunks = [];
  let i = 0;
  while (i < clean.length && chunks.length < 200) {
    const end = Math.min(clean.length, i + CHUNK_SIZE);
    let slice = clean.slice(i, end);
    if (end < clean.length) {
      const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '));
      if (lastBreak > CHUNK_SIZE * 0.5) slice = slice.slice(0, lastBreak + 1);
    }
    const piece = slice.trim();
    if (piece) chunks.push(piece);
    if (i + slice.length >= clean.length) break;
    i += Math.max(1, slice.length - CHUNK_OVERLAP);
  }
  return chunks;
}

/** Extrae una entrada de un ZIP (.docx) sin dependencias externas. */
function readZipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    const err = new Error('Archivo Word inválido (ZIP)');
    err.status = 400;
    throw err;
  }
  const zlib = require('zlib');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) {
      const err = new Error('Archivo Word corrupto');
      err.status = 400;
      throw err;
    }
    const lName = buf.readUInt16LE(localOff + 26);
    const lExtra = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lName + lExtra;
    const data = buf.slice(dataStart, dataStart + compSize);
    if (method === 0) return data;
    if (method === 8) return zlib.inflateRawSync(data);
    const err = new Error('Word comprimido con método no soportado');
    err.status = 400;
    throw err;
  }
  return null;
}

function extractDocxTextFallback(buffer) {
  const xmlBuf = readZipEntry(buffer, 'word/document.xml');
  if (!xmlBuf) {
    const err = new Error('No se encontró el contenido del Word (.docx)');
    err.status = 400;
    throw err;
  }
  const text = xmlBuf
    .toString('utf8')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

async function extractWordText(buffer) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const texto = truncate(result.value || '');
    if (texto.length >= 8) return { texto, filas: 0, hojas: 0 };
  } catch (_) {
    /* mammoth ausente o falló: usar extractor nativo */
  }
  return { texto: truncate(extractDocxTextFallback(buffer)), filas: 0, hojas: 0 };
}

function unescapePdfString(s) {
  return String(s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function extractTextFromPdfContent(contentBuf) {
  const raw = contentBuf.toString('latin1');
  const parts = [];
  // (texto) Tj  o  (texto) '
  const reTj = /\((?:\\.|[^\\)])*\)\s*(?:Tj|')/g;
  let m;
  while ((m = reTj.exec(raw))) {
    const inner = m[0].match(/^\(([\s\S]*)\)\s*(?:Tj|')$/)?.[1];
    if (inner != null) parts.push(unescapePdfString(inner));
  }
  // [(...)...] TJ
  const reTJ = /\[([\s\S]*?)\]\s*TJ/g;
  while ((m = reTJ.exec(raw))) {
    const arr = m[1];
    const reItem = /\((?:\\.|[^\\)])*\)/g;
    let im;
    while ((im = reItem.exec(arr))) {
      parts.push(unescapePdfString(im[0].slice(1, -1)));
    }
  }
  return parts.join(' ').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function extractPdfTextFallback(buffer) {
  const zlib = require('zlib');
  const latin = buffer.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(latin))) {
    let data = Buffer.from(m[1], 'latin1');
    // Quitar \r\n final típico antes de endstream
    if (data.length && data[data.length - 1] === 0x0a) {
      data = data.slice(0, data[data.length - 2] === 0x0d ? -2 : -1);
    }
    const headerStart = Math.max(0, m.index - 400);
    const header = latin.slice(headerStart, m.index);
    let decoded = data;
    if (/\/FlateDecode/.test(header)) {
      try {
        decoded = zlib.inflateSync(data);
      } catch (_) {
        try {
          decoded = zlib.inflateRawSync(data);
        } catch (__) {
          continue;
        }
      }
    }
    const t = extractTextFromPdfContent(decoded);
    if (t) chunks.push(t);
  }
  // Algunos PDF traen texto literal fuera de streams
  if (!chunks.length) {
    const loose = extractTextFromPdfContent(buffer);
    if (loose) chunks.push(loose);
  }
  const texto = chunks.join('\n\n').trim();
  if (!texto) {
    const err = new Error(
      'No se pudo leer texto del PDF (puede ser escaneado/imagen). Sube Word/texto o agrega una nota.'
    );
    err.status = 400;
    throw err;
  }
  return texto;
}

/** Extrae JPEGs embebidos (organigramas escaneados / exportados como imagen). */
function extractJpegsFromPdf(buffer, maxImages = 8) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const out = [];
  let i = 0;
  while (i < buf.length - 1 && out.length < maxImages) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8) {
      let j = i + 2;
      while (j < buf.length - 1) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          const slice = buf.subarray(i, j + 2);
          if (slice.length >= 8000) out.push(Buffer.from(slice));
          i = j + 2;
          break;
        }
        j += 1;
      }
      if (j >= buf.length - 1) break;
    } else {
      i += 1;
    }
  }
  return out;
}

async function ocrPdfImagesWithVision(buffer, db) {
  const images = extractJpegsFromPdf(buffer, 6);
  if (!images.length) return '';
  const parts = [];
  const orgPrompt =
    'Esta imagen es un organigrama del holding VERTIA GROUP (NO asumas que todos son de SERCOM).\n' +
    'Empresas del grupo: VERTIA (holding / nivel regional), SERCOM, GLOBAL, INTERCANJE, TÁCTICA, NEXUS, LAB64.\n' +
    'Para CADA persona indica: Nombre | Cargo | Empresa (una de las anteriores) | País/área | Reporta a.\n' +
    'Los del "Nivel Regional" / CEO / COO / CFO / Chief of Staff / Dir. Regional son de VERTIA (holding).\n' +
    'Dentro de cada país, respeta el bloque de empresa (SERCOM, GLOBAL, etc.). No inventes; no mezcles empresas.';
  for (let n = 0; n < images.length; n++) {
    try {
      const described = await describeImage(images[n], 'image/jpeg', db, {
        prompt: orgPrompt,
        maxTokens: 1600
      });
      const t = String(described?.texto || '').trim();
      if (t && !/no hay api key/i.test(t)) {
        parts.push(`--- Página/imagen ${n + 1} ---\n${t}`);
      }
    } catch (_) { /* siguiente imagen */ }
  }
  return parts.join('\n\n').trim();
}

/** Detecta organigrama / holding Vertia. */
function looksLikeOrganigrama(texto, filename) {
  const s = `${filename || ''} ${texto || ''}`.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /organigrama|holding|vertia|nivel regional|unidades por pais|senior leadership/.test(s);
}

/** Une letras espaciadas tipo "G L OB A L" / "S E R C O M" → GLOBAL / SERCOM. */
function collapseSpacedCaps(text) {
  return String(text || '').replace(
    /\b(?:[A-ZÁÉÍÓÚÑÜ]\s+){2,}[A-ZÁÉÍÓÚÑÜ]\b/g,
    (m) => m.replace(/\s+/g, '')
  );
}

function normalizeBrandSpelling(text) {
  let t = String(text || '');
  const brands = [
    ['VERTIA', /V\s*E\s*R\s*T\s*I\s*A/gi],
    ['SERCOM', /S\s*E\s*R\s*C\s*O\s*M/gi],
    ['GLOBAL', /G\s*L\s*O\s*B\s*A\s*L/gi],
    ['INTERCANJE', /I\s*N\s*T\s*E\s*R\s*C\s*A\s*N\s*J\s*E/gi],
    ['TACTICA', /T\s*[ÁA]\s*C\s*T\s*I\s*C\s*A/gi],
    ['NEXUS', /N\s*E\s*X\s*U\s*S/gi],
    ['LAB64', /L\s*A\s*B\s*\s*6\s*4/gi],
    ['ESERCOM', /E\s*S\s*E\s*R\s*C\s*O\s*M/gi]
  ];
  for (const [canon, re] of brands) t = t.replace(re, canon);
  // typos frecuentes del OCR/PDF
  t = t
    .replace(/Serco\s*m/gi, 'SERCOM')
    .replace(/Glo\s*bal/gi, 'GLOBAL')
    .replace(/TÁC\s*TI\s*CA|Tác\s*ti\s*ca|Tactic\s*a|T\s*[ÁA]\s*C\s*T\s*I\s*C\s*A/gi, 'TÁCTICA')
    .replace(/In\s*tercanje|Intercan\s*je/gi, 'INTERCANJE')
    .replace(/Nex\s*us/gi, 'NEXUS')
    .replace(/Lab\s*64/gi, 'LAB64')
    .replace(/Di\s*r\.\s*Regio\s*nal/gi, 'Dir. Regional')
    .replace(/Gerente\s*General/gi, 'Gerente General');
  return t;
}

/**
 * Limpia y anota el organigrama Vertia: holding ≠ Sercom; cada bloque = una empresa.
 * Además indexa PERSONA|nombre|empresa|cargo|pais para no mezclar empresas.
 */
function enrichOrganigramaTexto(texto, filename) {
  let t = normalizeBrandSpelling(collapseSpacedCaps(texto));
  t = t.replace(
    /(Nivel\s+Regional|EQUIPO\s+REGIONAL|Organigrama\s+del\s+Holding)/gi,
    (m) => `${m} [EMPRESA=VERTIA HOLDING]`
  );
  const personas = parseOrganigramaPersonas(t);
  const indexBlock = personas.length
    ? [
      '=== PERSONAS INDEXADAS (fuente de verdad: empresa exacta por bloque) ===',
      ...personas.map((p) =>
        `PERSONA|nombre=${p.nombre}|empresa=${p.empresa}|cargo=${p.cargo}|pais=${p.pais}`
      ),
      '=== FIN PERSONAS INDEXADAS ===',
      ''
    ].join('\n')
    : '';

  const legend = [
    '=== LEYENDA OBLIGATORIA — ORGANIGRAMA VERTIA GROUP ===',
    'Holding: VERTIA. El Nivel Regional / equipo regional (CEO, COO, CFO, Chief of Staff, Dir. Regional) = VERTIA, NO SERCOM.',
    'Empresas: SERCOM · GLOBAL · INTERCANJE · TÁCTICA · NEXUS · LAB64.',
    'Si una persona aparece en PERSONAS INDEXADAS, responde SOLO con esa(s) empresa(s). Ejemplo: Sebastián Silva en Chile = GLOBAL (Gerente Comercial) y también NEXUS (Gerente Comercial); NUNCA SERCOM.',
    'PROHIBIDO inventar que alguien es de SERCOM si el índice dice otra empresa.',
    `Archivo: ${filename || 'organigrama.pdf'}`,
    '=== FIN LEYENDA ===',
    '',
    indexBlock,
    t
  ].join('\n');
  return legend;
}

const ORG_COUNTRIES = [
  { id: 'México', re: /^m[eé]xico$/i },
  { id: 'Perú', re: /^per[uú]$/i },
  { id: 'Chile', re: /^chile$/i },
  { id: 'Argentina', re: /^argentina$/i },
  { id: 'Uruguay', re: /^uruguay$/i }
];

const ORG_COMPANIES = [
  { id: 'SERCOM', re: /^sercom$/i },
  { id: 'GLOBAL', re: /^global$/i },
  { id: 'INTERCANJE', re: /^intercanje$/i },
  { id: 'TÁCTICA', re: /^t[aá]ctica$/i },
  { id: 'NEXUS', re: /^nexus$/i },
  { id: 'LAB64', re: /^lab\s*64$/i },
  { id: 'VERTIA', re: /^vertia$/i }
];

function cleanOrgSpaces(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*·\s*/g, ' · ')
    .trim();
}

function fixBrokenOrgWords(s) {
  return cleanOrgSpaces(
    String(s || '')
      .replace(/Gerente\s*G\s*eneral|Gerente\s*General/gi, 'Gerente General')
      .replace(/Gerente\s*Comercial|GerenteComercial/gi, 'Gerente Comercial')
      .replace(/Director\s*Comercial|Directora\s*Comercial/gi, (m) => m.replace(/\s+/g, ' '))
      .replace(/Dir\.\s*Regional|Di\s*r\.\s*Regio\s*nal/gi, 'Dir. Regional')
      .replace(/Ch\s*ief\s*Op\s*erati\s*ng\s*Offic\s*er/gi, 'Chief Operating Officer')
      .replace(/Ch\s*ief\s*Fin\s*anci\s*al\s*Offic\s*er/gi, 'Chief Financial Officer')
      .replace(/Ch\s*ief\s*o\s*f\s*Staff/gi, 'Chief of Staff')
      .replace(/Senio\s*r\s*Ad\s*vi\s*sor/gi, 'Senior Advisor')
      .replace(/Ru\s*b[eé]n\s*G[aá]mez/gi, 'Rubén Gámez')
      .replace(/Ramiro\s*Figu\s*eroa/gi, 'Ramiro Figueroa')
      .replace(/Ro\s*drigo\s*Voigt/gi, 'Rodrigo Voigt')
      .replace(/En\s*rique\s*Esco\s*bar/gi, 'Enrique Escobar')
      .replace(/Gabriela\s*Co\s*lombo/gi, 'Gabriela Colombo')
      .replace(/Claudio\s*Palomin\s*os/gi, 'Claudio Palominos')
      .replace(/Jes[uú]s\s*Fern[aá]n\s*dez/gi, 'Jesús Fernández')
      .replace(/Lino\s*Mo\s*ntoya/gi, 'Lino Montoya')
      .replace(/Isa[ií]as\s*C\s*ruz/gi, 'Isaías Cruz')
      .replace(/Ro\s*y\s*Alarc[oó]n/gi, 'Roy Alarcón')
      .replace(/Alejandro\s*Ceriso\s*la/gi, 'Alejandro Cerisola')
  );
}

function matchOrgCountry(line) {
  const s = cleanOrgSpaces(line);
  for (const c of ORG_COUNTRIES) if (c.re.test(s)) return c.id;
  return null;
}

function matchOrgCompany(line) {
  const s = normalizeBrandSpelling(collapseSpacedCaps(cleanOrgSpaces(line)));
  for (const c of ORG_COMPANIES) if (c.re.test(s)) return c.id;
  if (/^tác\s*ti\s*ca$/i.test(s)) return 'TÁCTICA';
  return null;
}

function isOrgNoiseLine(line) {
  const s = cleanOrgSpaces(line).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!s) return true;
  if (/^===/.test(s)) return true;
  if (/leyenda|personas indexadas|fin leyenda|fin personas|archivo:/.test(s)) return true;
  if (/organigrama del holding|estructura organizacional|documento confidencial|uso interno/.test(s)) return true;
  if (/5 paises|unidades de negocio|posiciones de liderazgo|vista de liderazgo/.test(s)) return true;
  if (/unidadesporpais|seniorleadershipteam|equiporegional|argentinauruguaychile/.test(s.replace(/\s/g, ''))) return true;
  if (/empresa=vertia/.test(s)) return true;
  if (/global\s*sercom|sercom\s*global/.test(s) && s.length < 80) return true;
  return false;
}

function isOrgTitleLine(line) {
  const s = cleanOrgSpaces(line);
  if (/·/.test(s) && /gerente|director|dir\.|gte\.|head|ejecutiv|coo|cfo|ceo|chief|advisor|staff|rrhh|it\b/i.test(s)) {
    return true;
  }
  return /^(CEO|COO|CFO|Chief|Gerente|Directora?|Dir\.|Gte\.|Head|Ejecutiv|Senior\s+Advisor|Presidente|Sub\s*Gerente)/i.test(s)
    || /Gerente\s*General|Gerente\s*Comercial|Director\s+de|Dir\.\s*Regional/i.test(s);
}

function isOrgPersonName(line) {
  const s = cleanOrgSpaces(line).replace(/\s*·\s*.*$/, '').trim();
  if (!s || /^TBD$/i.test(s)) return /^TBD$/i.test(s);
  if (matchOrgCountry(s) || matchOrgCompany(s)) return false;
  if (isOrgNoiseLine(s)) return false;
  if (/transversal|administraci[oó]n|finanzas|reporta|todas las empresas/i.test(s)) return false;
  // "NOMBRE · cargo" en una línea
  if (/·/.test(line) && /^[A-ZÁÉÍÓÚÑ]/.test(s)) return true;
  if (isOrgTitleLine(s) && !/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ]/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  // Nombres en mayúsculas tipo SEBASTIAN VICENT
  if (words.every((w) => /^[A-ZÁÉÍÓÚÑ]{2,}(?:'[A-Z]+)?$/.test(w))) return true;
  // Nombre propio: inicia con mayúscula
  const nameLike = words.filter((w) => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ'’\-]+$/.test(w) || /^[A-ZÁÉÍÓÚÑ]{2,}$/.test(w));
  return nameLike.length >= 2;
}

function empresaFromCargo(cargo) {
  const c = String(cargo || '');
  if (/lab\s*64/i.test(c)) return 'LAB64';
  if (/\bsercom\b/i.test(c)) return 'SERCOM';
  if (/\bglobal\b/i.test(c)) return 'GLOBAL';
  if (/\bnexus\b/i.test(c)) return 'NEXUS';
  if (/intercanje/i.test(c)) return 'INTERCANJE';
  if (/t[aá]ctica/i.test(c)) return 'TÁCTICA';
  if (/vertia|holding|regional/i.test(c) && /dir\.\s*regional|ceo|coo|cfo|chief of staff/i.test(c)) return 'VERTIA';
  return null;
}

/** Extrae filas PERSONA con empresa exacta del bloque del organigrama. */
function parseOrganigramaPersonas(texto) {
  const raw = normalizeBrandSpelling(collapseSpacedCaps(String(texto || '')));
  const lines = raw.split(/\r?\n/).map((l) => fixBrokenOrgWords(l)).filter((l) => l.length > 0);
  const out = [];
  let pais = 'Regional';
  let empresa = 'VERTIA';

  const pushPerson = (nombre, cargo) => {
    let n = cleanOrgSpaces(nombre).replace(/\s*·\s*.*$/, '').trim();
    let c = fixBrokenOrgWords(cargo || '—');
    if (/·/.test(String(nombre))) {
      const [a, b] = String(nombre).split(/·/).map((x) => x.trim());
      if (a) n = a;
      if (b && (!c || c === '—')) c = fixBrokenOrgWords(b);
    }
    if (!n) return;
    if (/^TBD$/i.test(n)) n = 'TBD';
    let emp = empresaFromCargo(c) || empresa || 'VERTIA';
    // Hendrik Muskus Lab64
    if (/lab\s*64/i.test(c)) {
      emp = 'LAB64';
      c = c.replace(/lab\s*64/ig, '').replace(/gerente\s*general/ig, 'Gerente General').trim() || 'Gerente General';
    }
    out.push({
      nombre: n,
      empresa: emp,
      cargo: c || '—',
      pais
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isOrgNoiseLine(line)) continue;

    const country = matchOrgCountry(line);
    if (country) {
      pais = country;
      empresa = null;
      continue;
    }

    const company = matchOrgCompany(line);
    if (company) {
      empresa = company;
      continue;
    }

    if (/transversal/i.test(line) || /todas las empresas/i.test(line)) {
      empresa = 'TRANSVERSAL';
      continue;
    }
    if (/administraci[oó]n\s*y\s*finanzas/i.test(line) && /transversal/i.test(line)) {
      empresa = 'TRANSVERSAL';
      continue;
    }

    // "Nombre · Cargo" en una sola línea
    if (/·/.test(line) && isOrgPersonName(line)) {
      const [nom, ...rest] = line.split(/·/);
      pushPerson(nom, rest.join('·'));
      continue;
    }

    if (isOrgPersonName(line)) {
      const next = lines[i + 1] ? fixBrokenOrgWords(lines[i + 1]) : '';
      if (next && isOrgTitleLine(next) && !matchOrgCountry(next) && !matchOrgCompany(next)) {
        pushPerson(line, next);
        i += 1;
        continue;
      }
      // nombre sin cargo claro en regional
      if (pais === 'Regional' && empresa === 'VERTIA') {
        pushPerson(line, next && !isOrgPersonName(next) ? next : '—');
        if (next && !isOrgPersonName(next) && !matchOrgCountry(next) && !matchOrgCompany(next)) i += 1;
      }
    }
  }

  // dedupe exactos
  const seen = new Set();
  return out.filter((p) => {
    const k = `${p.nombre}|${p.empresa}|${p.cargo}|${p.pais}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function searchOrganigramaPersonas(docs, query, limit = 12) {
  const q = String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const tokens = tokenize(query).filter((t) => t.length >= 3);
  if (!tokens.length && !/quien|quién|cargo|gerente|organigrama/i.test(q)) return [];

  const hits = [];
  for (const d of docs || []) {
    if (!looksLikeOrganigrama(d.texto, d.nombre) && !/PERSONA\|nombre=/i.test(String(d.texto || ''))) {
      continue;
    }
    let personas = [];
    const indexed = String(d.texto || '').match(/^PERSONA\|[^\n]+$/gm);
    if (indexed && indexed.length) {
      personas = indexed.map((line) => {
        const m = {};
        for (const part of line.replace(/^PERSONA\|/, '').split('|')) {
          const [k, ...rest] = part.split('=');
          m[k] = rest.join('=');
        }
        return {
          nombre: m.nombre || '',
          empresa: m.empresa || '',
          cargo: m.cargo || '',
          pais: m.pais || ''
        };
      });
    } else {
      personas = parseOrganigramaPersonas(d.texto);
    }

    for (const p of personas) {
      const hay = `${p.nombre} ${p.cargo} ${p.empresa} ${p.pais}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += t.length >= 5 ? 8 : 4;
        if (String(p.nombre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(t)) {
          score += 12;
        }
      }
      if (/quien|quién|cargo|empresa|gerente|organigrama/i.test(q) && score > 0) score += 2;
      if (score < 8) continue;
      hits.push({
        score,
        text: `• ${p.nombre} — ${p.cargo} — empresa ${p.empresa} — ${p.pais}`,
        nombre: p.nombre,
        empresa: p.empresa,
        doc: d.nombre
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  // Prefer explicit company lines; keep multiple empresas for same person
  return hits.slice(0, limit);
}

async function extractPdfText(buffer, db, filename = '') {
  let texto = '';
  let hojas = 0;
  try {
    const pdfParse = require('pdf-parse');
    const result = await pdfParse(buffer);
    texto = String(result.text || '').trim();
    hojas = Number(result.numpages || 0) || 0;
  } catch (_) {
    /* pdf-parse ausente o falló */
  }

  const usable = (t) => String(t || '').replace(/\s+/g, ' ').trim().length;
  const isOrg = looksLikeOrganigrama(texto, filename);

  if (usable(texto) < 80) {
    try {
      const fallback = extractPdfTextFallback(buffer);
      if (usable(fallback) > usable(texto)) texto = fallback;
    } catch (_) { /* sin texto nativo */ }
  }

  // Organigramas escasos o PDF escaneados: OCR
  if ((usable(texto) < 120 || (isOrg && usable(texto) < 400)) && db) {
    try {
      const ocr = await ocrPdfImagesWithVision(buffer, db);
      if (usable(ocr) > usable(texto) * 0.8) {
        texto = ocr;
        if (!hojas) hojas = Math.max(1, extractJpegsFromPdf(buffer, 20).length);
      }
    } catch (err) {
      console.warn('[extractPdfText] OCR vision:', err.message);
    }
  }

  if (looksLikeOrganigrama(texto, filename)) {
    texto = enrichOrganigramaTexto(texto, filename);
  } else {
    texto = normalizeBrandSpelling(collapseSpacedCaps(texto));
  }

  texto = truncate(texto);
  if (usable(texto) < 8) {
    const err = new Error(
      'No se pudo leer el PDF (sin texto ni imágenes legibles). Prueba «Reindexar PDF» o sube una imagen/Word del organigrama.'
    );
    err.status = 400;
    throw err;
  }
  return { texto, filas: 0, hojas };
}

async function describeImage(buffer, mime, db, opts = {}) {
  try {
    const { getApiKey, getAngelModel } = require('./angel');
    const apiKey = await getApiKey(db);
    if (!apiKey) {
      return {
        texto: '[Imagen cargada al cerebro. No hay API key para describirla automáticamente. Agrega una nota de texto con el significado.]',
        filas: 0,
        hojas: 0
      };
    }
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey });
    const model = await getAngelModel(db);
    const b64 = buffer.toString('base64');
    const dataUrl = `data:${mime || 'image/jpeg'};base64,${b64}`;
    const prompt = opts.prompt ||
      'Describe esta imagen para el cerebro del grupo VERTIA / ESERCOM (holding multiempresa: VERTIA, SERCOM, GLOBAL, INTERCANJE, TÁCTICA, NEXUS, LAB64). Extrae texto visible (OCR), tablas, nombres, cargos y la EMPRESA de cada persona. No asumas que todos son de SERCOM. Responde en español, claro y concreto.';
    const resp = await client.chat.completions.create({
      model: /gpt-4o|gpt-4\.1|gpt-5/i.test(model) ? model : 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: Number(opts.maxTokens) || 900,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    });
    const texto = truncate(resp.choices?.[0]?.message?.content || '');
    return { texto: texto || '[Imagen sin descripción]', filas: 0, hojas: 0 };
  } catch (err) {
    return {
      texto: `[Imagen cargada. No se pudo analizar automáticamente: ${err.message}]`,
      filas: 0,
      hojas: 0
    };
  }
}

async function extractContent({ buf, mime, filename, tipo, db }) {
  if (tipo === 'excel') return extractExcelText(buf);
  if (tipo === 'word') return extractWordText(buf);
  if (tipo === 'pdf') return extractPdfText(buf, db, filename);
  if (tipo === 'imagen') return describeImage(buf, mime, db);
  if (tipo === 'texto') {
    let text;
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      text = buf.slice(2).toString('utf16le');
    } else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      text = buf.slice(3).toString('utf8');
    } else {
      text = buf.toString('utf8');
    }
    if (/\.csv$/i.test(filename || '') || String(mime || '').includes('csv')) {
      return extractCsvStructured(text, filename);
    }
    return { texto: truncate(text), filas: 0, hojas: 0 };
  }
  const err = new Error('Tipo de archivo no soportado. Usa texto, imagen, Excel (.xlsx), Word (.docx) o PDF.');
  err.status = 400;
  throw err;
}

async function replaceChunks(db, docId, texto) {
  await db.prepare(`DELETE FROM ${CHUNKS} WHERE doc_id = ?`).run(docId);
  const chunks = chunkText(texto);
  for (let i = 0; i < chunks.length; i++) {
    await db.prepare(`
      INSERT INTO ${CHUNKS} (doc_id, idx_chunk, texto) VALUES (?, ?, ?)
    `).run(docId, i, chunks[i]);
  }
  return chunks.length;
}

function makeResumen(texto, tipo) {
  const line = String(texto || '').replace(/\s+/g, ' ').trim();
  const prefix = TYPE_META[tipo]?.label || 'Doc';
  return `${prefix}: ${line.slice(0, 180)}${line.length > 180 ? '…' : ''}`;
}

async function saveDoc(db, {
  nombre,
  archivo,
  tipo,
  mime,
  texto,
  filas = 0,
  hojas = 0,
  tabla_json = null,
  categoria,
  userId
}) {
  const resumen = makeResumen(texto, tipo);
  const cat = categoriaValida(categoria) || clasificarTema(nombre, texto);
  const hasTabla = await columnExists(db, TABLE, 'tabla_json');
  let info;
  if (hasTabla) {
    info = await db.prepare(`
      INSERT INTO ${TABLE} (nombre, archivo, tipo, mime, texto, resumen, filas, hojas, tabla_json, categoria, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nombre,
      archivo || null,
      tipo,
      mime || null,
      texto,
      resumen,
      filas || 0,
      hojas || 0,
      tabla_json || null,
      cat,
      userId || null
    );
  } else {
    info = await db.prepare(`
      INSERT INTO ${TABLE} (nombre, archivo, tipo, mime, texto, resumen, filas, hojas, categoria, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nombre,
      archivo || null,
      tipo,
      mime || null,
      texto,
      resumen,
      filas || 0,
      hojas || 0,
      cat,
      userId || null
    );
  }
  const id = info.lastInsertRowid;
  const chunks = await replaceChunks(db, id, texto);
  const meta = categoriaMeta(cat);
  return {
    id,
    nombre,
    tipo,
    filas,
    hojas,
    chunks,
    resumen,
    categoria: cat,
    categoria_label: meta.label,
    tiene_tabla: !!tabla_json
  };
}

async function uploadAngelDoc(db, { dataUrl, filename, userId, titulo, empresa, categoria }) {
  await ensureAngelDocsSchema(db);
  const { buf, mime } = decodeDataUrl(dataUrl, 12);
  const name = safeName(filename || titulo || 'documento', 'documento.bin');
  const tipo = detectTipo(name, mime);
  if (tipo === 'excel_old') {
    const err = new Error('Excel antiguo (.xls) no soportado. Guarda como .xlsx');
    err.status = 400;
    throw err;
  }
  if (tipo === 'word_old') {
    const err = new Error('Word antiguo (.doc) no soportado. Guarda como .docx');
    err.status = 400;
    throw err;
  }
  if (tipo === 'otro') {
    const err = new Error('Formato no soportado. Usa .txt, .md, .csv, .xlsx, .docx, .pdf, .png, .jpg, .webp o .gif');
    err.status = 400;
    throw err;
  }
  const extracted = await extractContent({ buf, mime, filename: name, tipo, db });
  if (!extracted.texto || extracted.texto.length < 8) {
    const err = new Error('No se pudo extraer contenido útil del archivo');
    err.status = 400;
    throw err;
  }
  const ext = path.extname(name) || (
    tipo === 'excel' ? '.xlsx'
      : tipo === 'word' ? '.docx'
        : tipo === 'pdf' ? '.pdf'
          : tipo === 'imagen' ? '.jpg'
            : '.txt'
  );
  const stored = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const dir = dirForEmpresa(empresa);
  fs.writeFileSync(path.join(dir, stored), buf);
  const storedRel = `${String(empresa || 'shared').replace(/[^a-z0-9_-]/gi, '') || 'shared'}/${stored}`;
  return saveDoc(db, {
    nombre: titulo ? safeName(titulo, name) : name,
    archivo: storedRel,
    tipo,
    mime,
    texto: extracted.texto,
    filas: extracted.filas,
    hojas: extracted.hojas,
    tabla_json: extracted.tabla_json || null,
    categoria,
    userId
  });
}

async function addAngelTextNote(db, { titulo, texto, userId, categoria }) {
  await ensureAngelDocsSchema(db);
  const body = truncate(String(texto || '').trim());
  if (body.length < 3) {
    const err = new Error('Escribe al menos unas líneas de texto');
    err.status = 400;
    throw err;
  }
  const nombre = safeName(titulo || `Nota ${new Date().toLocaleDateString('es-CL')}`, 'nota.txt');
  return saveDoc(db, {
    nombre,
    archivo: '',
    tipo: 'texto',
    mime: 'text/plain',
    texto: body,
    categoria,
    userId
  });
}

/**
 * Relee el archivo original del disco y vuelve a indexar con formato estructurado.
 * Sirve para Excel/CSV subidos antes del fix de campos.
 */
async function reprocessAngelDoc(db, id) {
  await ensureAngelDocsSchema(db);
  const hasTabla = await columnExists(db, TABLE, 'tabla_json');
  const row = await db.prepare(`
    SELECT id, nombre, archivo, tipo, mime, categoria
           ${hasTabla ? ', tabla_json' : ''}
    FROM ${TABLE} WHERE id = ?
  `).get(Number(id));
  if (!row) {
    const err = new Error('Documento no encontrado');
    err.status = 404;
    throw err;
  }
  if (!row.archivo) {
    const err = new Error('Este documento no tiene archivo original para reprocesar (solo texto)');
    err.status = 400;
    throw err;
  }
  const full = path.join(DIR_ROOT, row.archivo);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(DIR_ROOT) + path.sep) || !fs.existsSync(resolved)) {
    const err = new Error('No se encontró el archivo original en disco. Vuelve a subirlo.');
    err.status = 404;
    throw err;
  }
  const buf = fs.readFileSync(resolved);
  const tipo = row.tipo || detectTipo(row.nombre || row.archivo, row.mime);
  if (!['excel', 'texto'].includes(tipo)) {
    const err = new Error('Solo se pueden reprocesar Excel (.xlsx) o CSV');
    err.status = 400;
    throw err;
  }
  const extracted = await extractContent({
    buf,
    mime: row.mime,
    filename: row.nombre || row.archivo,
    tipo,
    db
  });
  if (!extracted.texto || extracted.texto.length < 8) {
    const err = new Error('No se pudo extraer contenido al reprocesar');
    err.status = 400;
    throw err;
  }

  // Conservar hojas desactivadas / columnas ocultas del usuario
  let tablaJson = extracted.tabla_json || null;
  if (hasTabla && row.tabla_json && extracted.tabla_json) {
    try {
      const prev = typeof row.tabla_json === 'string' ? JSON.parse(row.tabla_json) : row.tabla_json;
      const next = typeof extracted.tabla_json === 'string' ? JSON.parse(extracted.tabla_json) : extracted.tabla_json;
      const prevByName = new Map((prev?.sheets || []).map((s) => [String(s.name || '').toLowerCase(), s]));
      next.sheets = (next.sheets || []).map((s) => {
        const old = prevByName.get(String(s.name || '').toLowerCase());
        if (!old) return s;
        return {
          ...s,
          enabled: old.enabled !== false,
          visibleCols: Array.isArray(old.visibleCols) && old.visibleCols.length === (s.headers || []).length
            ? old.visibleCols
            : s.visibleCols
        };
      });
      const rebuilt = rebuildTextoFromTabla(next);
      extracted.texto = rebuilt.texto;
      extracted.filas = rebuilt.filas;
      tablaJson = JSON.stringify(next);
    } catch (_) { /* keep extracted */ }
  }

  const resumen = makeResumen(extracted.texto, tipo);
  if (hasTabla) {
    await db.prepare(`
      UPDATE ${TABLE}
      SET texto = ?, resumen = ?, filas = ?, hojas = ?, tabla_json = ?
      WHERE id = ?
    `).run(
      extracted.texto,
      resumen,
      extracted.filas || 0,
      extracted.hojas || 0,
      tablaJson,
      Number(id)
    );
  } else {
    await db.prepare(`
      UPDATE ${TABLE}
      SET texto = ?, resumen = ?, filas = ?, hojas = ?
      WHERE id = ?
    `).run(
      extracted.texto,
      resumen,
      extracted.filas || 0,
      extracted.hojas || 0,
      Number(id)
    );
  }
  const chunks = await replaceChunks(db, Number(id), extracted.texto);
  return {
    id: Number(id),
    nombre: row.nombre,
    tipo,
    filas: extracted.filas || 0,
    hojas: extracted.hojas || 0,
    chunks,
    resumen,
    categoria: row.categoria,
    tiene_tabla: !!tablaJson
  };
}

async function reprocessAllExcelDocs(db) {
  await ensureAngelDocsSchema(db);
  const rows = await db.prepare(`
    SELECT id, nombre, tipo, archivo
    FROM ${TABLE}
    WHERE (tipo = 'excel' OR lower(nombre) LIKE '%.xlsx' OR lower(nombre) LIKE '%.csv')
      AND archivo IS NOT NULL AND archivo != ''
    ORDER BY id DESC
    LIMIT 100
  `).all();
  const results = [];
  for (const r of rows) {
    try {
      const data = await reprocessAngelDoc(db, r.id);
      results.push({ id: r.id, nombre: r.nombre, ok: true, filas: data.filas, chunks: data.chunks });
    } catch (err) {
      results.push({ id: r.id, nombre: r.nombre, ok: false, error: err.message });
    }
  }
  return { total: rows.length, results };
}

/** Relee PDF (texto + OCR de imágenes embebidas) y regenera chunks. */
async function reprocessAllPdfDocs(db) {
  await ensureAngelDocsSchema(db);
  const rows = await db.prepare(`
    SELECT id, nombre, tipo, archivo
    FROM ${TABLE}
    WHERE (tipo = 'pdf' OR lower(nombre) LIKE '%.pdf')
      AND archivo IS NOT NULL AND archivo != ''
    ORDER BY id DESC
    LIMIT 80
  `).all();
  const results = [];
  for (const r of rows) {
    try {
      const data = await reprocessAngelDoc(db, r.id);
      results.push({
        id: r.id,
        nombre: r.nombre,
        ok: true,
        chunks: data.chunks,
        texto_len: String(data.resumen || '').length,
        hojas: data.hojas
      });
    } catch (err) {
      results.push({ id: r.id, nombre: r.nombre, ok: false, error: err.message });
    }
  }
  return { total: rows.length, results };
}

function decorarDoc(r) {
  const tipo = r.tipo || 'excel';
  const cat = categoriaValida(r.categoria) || 'general';
  const meta = categoriaMeta(cat);
  return {
    ...r,
    tipo,
    tipo_label: TYPE_META[tipo]?.label || 'Archivo',
    icon: TYPE_META[tipo]?.icon || 'fa-file',
    categoria: cat,
    categoria_label: meta.label,
    categoria_icon: meta.icon,
    texto_len: Number(r.texto_len || 0)
  };
}

async function listAngelDocs(db) {
  await ensureAngelDocsSchema(db);
  const rows = await db.prepare(`
    SELECT id, nombre, archivo, tipo, mime, resumen, filas, hojas, categoria, fecha_creacion,
           LENGTH(texto) AS texto_len
    FROM ${TABLE}
    ORDER BY nombre ASC, id DESC
    LIMIT 300
  `).all();
  return rows.map(decorarDoc);
}

/** Resumen de cobertura: qué temas de la empresa tiene cubiertos el cerebro. */
async function getAngelDocsResumen(db) {
  const docs = await listAngelDocs(db);
  const porCategoria = CATEGORIAS.map((cat) => {
    const items = docs.filter((d) => d.categoria === cat.id);
    const chars = items.reduce((sum, d) => sum + Number(d.texto_len || 0), 0);
    const ultima = items
      .map((d) => d.fecha_creacion)
      .filter(Boolean)
      .sort()
      .pop() || null;
    return {
      id: cat.id,
      label: cat.label,
      icon: cat.icon,
      descripcion: cat.descripcion,
      docs: items.length,
      caracteres: chars,
      ultima_actualizacion: ultima,
      ejemplos: items.slice(0, 3).map((d) => d.nombre)
    };
  });
  const conContenido = porCategoria.filter((c) => c.docs > 0 && c.id !== 'general');
  const sinContenido = porCategoria.filter((c) => c.docs === 0 && c.id !== 'general');
  const totalChars = docs.reduce((sum, d) => sum + Number(d.texto_len || 0), 0);
  const ultima = docs.map((d) => d.fecha_creacion).filter(Boolean).sort().pop() || null;
  return {
    total_docs: docs.length,
    total_caracteres: totalChars,
    temas_totales: CATEGORIAS.length - 1,
    temas_cubiertos: conContenido.length,
    sin_clasificar: porCategoria.find((c) => c.id === 'general')?.docs || 0,
    ultima_actualizacion: ultima,
    categorias: porCategoria,
    pendientes: sinContenido.map((c) => ({ id: c.id, label: c.label, icon: c.icon }))
  };
}

function listCategorias() {
  return CATEGORIAS.map((c) => ({
    id: c.id,
    label: c.label,
    icon: c.icon,
    descripcion: c.descripcion
  }));
}

async function getAngelDoc(db, id) {
  await ensureAngelDocsSchema(db);
  const hasTabla = await columnExists(db, TABLE, 'tabla_json');
  const row = await db.prepare(`
    SELECT id, nombre, archivo, tipo, mime, texto, resumen, filas, hojas, categoria, fecha_creacion
           ${hasTabla ? ', tabla_json' : ''}
    FROM ${TABLE} WHERE id = ?
  `).get(Number(id));
  if (!row) {
    const err = new Error('Documento no encontrado');
    err.status = 404;
    throw err;
  }
  let tabla = null;
  if (row.tabla_json) {
    try {
      tabla = typeof row.tabla_json === 'string' ? JSON.parse(row.tabla_json) : row.tabla_json;
    } catch (_) {
      tabla = null;
    }
  }
  const { tabla_json, ...rest } = row;
  return {
    ...decorarDoc(rest),
    editable: true,
    tabla,
    tiene_tabla: !!(tabla && Array.isArray(tabla.sheets) && tabla.sheets.length)
  };
}

async function updateAngelDoc(db, id, { nombre, texto, categoria, tabla } = {}) {
  await ensureAngelDocsSchema(db);
  const row = await db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(Number(id));
  if (!row) {
    const err = new Error('Documento no encontrado');
    err.status = 404;
    throw err;
  }
  const nextNombre = nombre != null
    ? safeName(String(nombre).trim() || row.nombre, row.nombre)
    : row.nombre;

  const hasTabla = await columnExists(db, TABLE, 'tabla_json');
  let nextTabla = null;
  let nextTexto = row.texto;
  let nextFilas = row.filas;
  let nextHojas = row.hojas;

  if (tabla != null && hasTabla) {
    nextTabla = normalizeIncomingTabla(tabla);
    if (!nextTabla) {
      const err = new Error('Tabla Excel inválida');
      err.status = 400;
      throw err;
    }
    const rebuilt = rebuildTextoFromTabla(nextTabla);
    nextTexto = rebuilt.texto;
    nextFilas = rebuilt.filas;
    nextHojas = nextTabla.sheets.length;
  } else if (texto != null) {
    nextTexto = truncate(String(texto).trim());
    if (nextTexto.length < 3) {
      const err = new Error('El contenido debe tener al menos unas líneas');
      err.status = 400;
      throw err;
    }
  }

  const resumen = makeResumen(nextTexto, row.tipo || 'texto');
  const nextCat = categoriaValida(categoria)
    || categoriaValida(row.categoria)
    || clasificarTema(nextNombre, nextTexto);

  if (hasTabla && nextTabla) {
    await db.prepare(`
      UPDATE ${TABLE}
      SET nombre = ?, texto = ?, resumen = ?, categoria = ?, tabla_json = ?, filas = ?, hojas = ?
      WHERE id = ?
    `).run(
      nextNombre,
      nextTexto,
      resumen,
      nextCat,
      JSON.stringify(nextTabla),
      nextFilas || 0,
      nextHojas || 0,
      Number(id)
    );
  } else {
    await db.prepare(`
      UPDATE ${TABLE}
      SET nombre = ?, texto = ?, resumen = ?, categoria = ?
      WHERE id = ?
    `).run(nextNombre, nextTexto, resumen, nextCat, Number(id));
  }

  const chunks = await replaceChunks(db, Number(id), nextTexto);
  const meta = categoriaMeta(nextCat);
  const activas = nextTabla
    ? nextTabla.sheets.filter((s) => s.enabled !== false).length
    : null;
  return {
    id: Number(id),
    nombre: nextNombre,
    tipo: row.tipo || 'texto',
    tipo_label: TYPE_META[row.tipo || 'texto']?.label || 'Archivo',
    icon: TYPE_META[row.tipo || 'texto']?.icon || 'fa-file',
    categoria: nextCat,
    categoria_label: meta.label,
    categoria_icon: meta.icon,
    resumen,
    chunks,
    filas: nextFilas,
    hojas: nextHojas,
    hojas_activas: activas
  };
}

async function deleteAngelDoc(db, id) {
  await ensureAngelDocsSchema(db);
  const row = await db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(Number(id));
  if (!row) {
    const err = new Error('Documento no encontrado');
    err.status = 404;
    throw err;
  }
  try {
    if (row.archivo) {
      const parts = String(row.archivo).split('/').filter(Boolean);
      const base = path.basename(parts[parts.length - 1] || '');
      if (!base || base.includes('..')) {
        /* skip unsafe */
      } else {
        const candidates = [
          path.join(DIR_ROOT, ...parts),
          path.join(DIR_ROOT, base)
        ];
        for (const full of candidates) {
          const resolved = path.resolve(full);
          if (resolved.startsWith(path.resolve(DIR_ROOT) + path.sep) && fs.existsSync(resolved)) {
            fs.unlinkSync(resolved);
            break;
          }
        }
      }
    }
  } catch (_) { /* ignore */ }
  await db.prepare(`DELETE FROM ${CHUNKS} WHERE doc_id = ?`).run(Number(id));
  await db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(Number(id));
  return { ok: true };
}

function tokenize(q) {
  const raw = String(q || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const parts = raw
    .split(/[^a-z0-9áéíóúñü]+/i)
    .filter((t) => t.length >= 1);
  // Keep short numeric suffixes (41, 51) and plate codes
  const compact = raw.replace(/[^a-z0-9]/gi, '');
  if (compact.length >= 4 && compact.length <= 12 && !parts.includes(compact)) {
    parts.push(compact);
  }
  return [...new Set(parts.filter((t) => {
    if (/^\d+$/.test(t)) return true;
    if (t.length <= 1) return false;
    if (STOP_TOKENS.has(t)) return false;
    return t.length >= 3 || /^[a-z]{2,4}\d{2,4}$/i.test(t);
  }))];
}

function normSearch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Relevancia de un documento completo (nombre, tema, texto) frente a la pregunta. */
function scoreDocForQuery(doc, analysis, query) {
  const name = normSearch(doc.nombre);
  const cat = normSearch(`${doc.categoria || ''} ${doc.resumen || ''}`);
  const textoHead = normSearch(String(doc.texto || '').slice(0, 16000));
  const q = normSearch(query);
  let score = 0;
  for (const t of analysis.tokens || []) {
    if (!t || t.length < 2) continue;
    if (name.includes(t)) score += 20;
    if (cat.includes(t)) score += 8;
    if (textoHead.includes(t)) score += 2.5;
  }
  if (/organigrama|vertia|jerarquia|organiza|cargo|gerente|jefe|persona|rol|equipo/.test(q)) {
    if (/organigrama|vertia|organiza|persona|rol|equipo/.test(name + ' ' + cat)) score += 35;
  }
  if ((doc.tipo === 'pdf' || doc.tipo === 'word') && score > 0) score += 4;
  if (String(doc.texto || '').replace(/\s+/g, '').length < 40) score *= 0.2;
  return score;
}

function scoreChunk(chunkText, tokens, analysis = null) {
  if (!tokens.length && !(analysis?.suffixes?.length) && !(analysis?.plates?.length)) return 0;
  const hay = String(chunkText || '').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const hayCompact = hay.replace(/[^a-z0-9]/gi, '');
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (hay.includes(t)) score += 1 + Math.min(3, (hay.split(t).length - 1) * 0.2);
    if (t.length >= 4 && hayCompact.includes(t.replace(/[^a-z0-9]/gi, ''))) score += 2.5;
    if (new RegExp(`(=|:)\\s*[^|\\n]*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(hay)) {
      score += 3;
    }
  }
  if (analysis) {
    for (const suf of analysis.suffixes || []) {
      if (hayCompact.includes(String(suf)) && new RegExp(`${suf}(?:\\b|\\|_|$)`).test(hayCompact + '|')) {
        // patente ending
        if (new RegExp(`patente[^|\\n]*=?[^|\\n]*${suf}`, 'i').test(hay) || hayCompact.match(new RegExp(`[a-z]{2,4}${suf}`, 'i'))) {
          score += 20;
        }
      }
    }
    for (const p of analysis.plates || []) {
      if (hayCompact.includes(p.compact)) score += 30;
    }
  }
  if (/^REGISTRO\|/m.test(hay) || /--- registro \d+/i.test(hay)) score += 0.5;
  return score;
}

/**
 * Mente ligera: elige los trozos más relevantes a la pregunta.
 * Prioriza Excel (fila) y documentos cuyo nombre/tema coincida (PDF organigrama, etc.).
 */
async function getDocsPromptBlock(db, query = '', opts = {}) {
  try {
    await ensureAngelDocsSchema(db);
    const hasTabla = await columnExists(db, TABLE, 'tabla_json');
    const docs = await db.prepare(`
      SELECT id, nombre, tipo, resumen, texto, filas, hojas, categoria
             ${hasTabla ? ', tabla_json' : ''}
      FROM ${TABLE}
      ORDER BY id DESC
      LIMIT 60
    `).all();
    if (!docs.length) return '';

    const historyBits = (opts.history || [])
      .slice(-4)
      .map((h) => String(h.contenido || h.content || ''))
      .filter(Boolean)
      .join(' ');
    const fullQuery = `${historyBits} ${query || ''}`.trim();

    const porTema = new Map();
    for (const d of docs) {
      const cat = categoriaValida(d.categoria) || 'general';
      if (!porTema.has(cat)) porTema.set(cat, []);
      porTema.get(cat).push(d);
    }
    const index = [...porTema.entries()].map(([cat, items]) => {
      const meta = categoriaMeta(cat);
      const lista = items
        .map((d) => `   - [${d.tipo || 'doc'}] ${d.nombre}${d.resumen ? ` — ${d.resumen}` : ''}`)
        .join('\n');
      return `• ${meta.label} (${items.length}):\n${lista}`;
    }).join('\n');

    const analysis = analyzeQuery(fullQuery);
    const tokens = analysis.tokens;
    let body = '';

    // 1) Búsqueda directa en tablas Excel (fila completa)
    const { hits } = await searchExcelTabla(db, fullQuery, analysis.isFleetQuery ? 30 : 18);
    if (hits.length) {
      body += '### Coincidencias en Excel (fila completa — usa estos datos; no inventes)\n';
      for (const h of hits) {
        const block = `${h.text}\n`;
        if ((body + block).length > MAX_PROMPT_CHARS) break;
        body += block;
      }
      body += '\n';
    }

    // 2) Documentos relevantes por nombre/tema/texto (PDF organigrama, Word, notas…)
    const scoredDocs = docs
      .map((d) => ({ ...d, docScore: scoreDocForQuery(d, analysis, fullQuery) }))
      .filter((d) => d.docScore >= 6 && String(d.texto || '').replace(/\s+/g, '').length >= 40)
      .sort((a, b) => b.docScore - a.docScore);

    for (const d of scoredDocs.slice(0, 5)) {
      const isOrgDoc = looksLikeOrganigrama(d.texto, d.nombre);
      const limit = isOrgDoc ? 14000 : (d.docScore >= 25 ? 9000 : d.docScore >= 15 ? 5000 : 2800);
      let texto = String(d.texto || '');
      if (isOrgDoc && !/LEYENDA OBLIGATORIA/.test(texto)) {
        texto = enrichOrganigramaTexto(texto, d.nombre);
      }
      texto = texto.slice(0, limit);
      const block = `### ${d.nombre} (${d.tipo || 'doc'} · tema ${d.categoria || 'general'})\n${texto}`;
      if ((body + block).length > MAX_PROMPT_CHARS + (isOrgDoc ? 8000 : 0)) break;
      body += (body ? '\n\n' : '') + block;
    }

    // 3) Chunks complementarios
    let picked = [];
    if (tokens.length || analysis.suffixes.length || analysis.plates.length) {
      const chunks = await db.prepare(`
        SELECT c.texto, c.doc_id, d.nombre, d.tipo
        FROM ${CHUNKS} c
        JOIN ${TABLE} d ON d.id = c.doc_id
        ORDER BY c.id DESC
        LIMIT 1000
      `).all();
      const already = new Set(scoredDocs.slice(0, 5).map((d) => Number(d.id)));
      const ranked = chunks
        .map((c) => {
          let score = scoreChunk(c.texto, tokens, analysis);
          const name = normSearch(c.nombre);
          for (const t of tokens) {
            if (t.length >= 3 && name.includes(t)) score += 8;
          }
          return { ...c, score };
        })
        .filter((c) => c.score > 0 && !already.has(Number(c.doc_id)))
        .sort((a, b) => b.score - a.score)
        .slice(0, hits.length || scoredDocs.length ? 10 : MAX_CHUNKS_IN_PROMPT);
      picked = ranked;
    }

    if (!picked.length && !hits.length && !scoredDocs.length) {
      picked = docs.slice(0, 5).map((d) => ({
        nombre: d.nombre,
        tipo: d.tipo,
        texto: String(d.texto || '').slice(0, 2000)
      }));
    }

    for (const p of picked) {
      const block = `### ${p.nombre} (${p.tipo || 'doc'})\n${p.texto}`;
      if ((body + block).length > MAX_PROMPT_CHARS) break;
      body += (body ? '\n\n' : '') + block;
    }

    if (!body.trim()) return '';

    return `\n\nCEREBRO DE ANGEL (conocimiento cargado por admin — tienes ACCESO al contenido; úsalo):\n` +
      `REGLA: Si un archivo aparece en el ÍNDICE (PDF, Word, Excel, nota), SÍ puedes leerlo: el texto está en FRAGMENTOS. ` +
      `NUNCA digas «no tengo acceso al organigrama/PDF/documento». Responde con nombres, cargos y relaciones que aparezcan.\n` +
      `ORGANIGRAMA VERTIA: el holding es VERTIA. Nivel Regional / CEO / COO / CFO / Dir. Regional = VERTIA (no Sercom). ` +
      `Cada persona pertenece a la empresa de su bloque: SERCOM, GLOBAL, INTERCANJE, TÁCTICA, NEXUS o LAB64. ` +
      `NUNCA digas que todos son de SERCOM ni uses la empresa del login para asignar cargos del organigrama.\n` +
      `Si hay "Coincidencias en Excel", cada viñeta es UNA patente/fila: responde con los campos de ESA misma fila.\n` +
      `Si el usuario escribe una patente parecida (VRXR vs VRXL), usa la más cercana del Excel y aclara la patente exacta.\n` +
      `ÍNDICE POR TEMA:\n${index}\n\nFRAGMENTOS RELEVANTES:\n${body}`;
  } catch (err) {
    console.warn('[getDocsPromptBlock]', err.message);
    return '';
  }
}

module.exports = {
  parseOrganigramaPersonas,
  enrichOrganigramaTexto,
  searchOrganigramaPersonas,
  ensureAngelDocsSchema,
  uploadAngelDoc,
  addAngelTextNote,
  reprocessAngelDoc,
  reprocessAllExcelDocs,
  reprocessAllPdfDocs,
  listAngelDocs,
  getAngelDocsResumen,
  listCategorias,
  getAngelDoc,
  updateAngelDoc,
  deleteAngelDoc,
  getDocsPromptBlock,
  TYPE_META,
  CATEGORIAS
};
