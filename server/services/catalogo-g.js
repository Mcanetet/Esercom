/**
 * Catálogo G — inventario Global (empresa, producto, bodega, foto, estado).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const config = require('../config');

const ESTADOS = ['Nuevo', 'Usado', 'Chatarra', 'Venta a Tercero', 'Revisar'];
const UPLOAD_DIR = path.join(config.publicDir, 'uploads', 'catalogo-g');
const TABLE = 'catalogo_g';

const BODEGAS_DEFAULT = [
  { id: null, codigo: 'CON', nombre: 'Bodega Conchalí', ubicacion: 'Conchalí' },
  { id: null, codigo: 'MER', nombre: 'Bodega Mersan', ubicacion: 'Mersan' },
  { id: null, codigo: 'SBE', nombre: 'Bodega San Bernardo', ubicacion: 'San Bernardo' },
  { id: null, codigo: 'QUI', nombre: 'Bodega Quilicura', ubicacion: 'Quilicura' },
  { id: null, codigo: 'LAM', nombre: 'Bodega Lampa', ubicacion: 'Lampa' }
];

const EXCEL_HEADER_MAP = {
  empresa: ['empresa', 'company', 'razon', 'razonsocial', 'contratista'],
  descripcion: ['descripcion', 'descripciondelproducto', 'producto', 'detalle', 'nombre', 'item', 'articulo'],
  cantidad: ['cantidad', 'qty', 'cant', 'stock', 'unidades'],
  bodega: ['bodega', 'warehouse', 'ubicacion', 'almacen', 'deposito'],
  estado: ['estado', 'tipo', 'condicion', 'status']
};
async function ensureCatalogoGSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(64) NULL,
        empresa VARCHAR(255) NOT NULL,
        descripcion TEXT NOT NULL,
        cantidad DECIMAL(15,2) NOT NULL DEFAULT 0,
        bodega VARCHAR(255) NULL,
        foto VARCHAR(512) NULL,
        estado VARCHAR(64) NOT NULL DEFAULT 'Nuevo',
        creado_por INT NULL,
        actualizado_por INT NULL,
        eliminado TINYINT NOT NULL DEFAULT 0,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME NULL
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT,
        empresa TEXT NOT NULL,
        descripcion TEXT NOT NULL,
        cantidad REAL NOT NULL DEFAULT 0,
        bodega TEXT,
        foto TEXT,
        estado TEXT NOT NULL DEFAULT 'Nuevo',
        creado_por INTEGER,
        actualizado_por INTEGER,
        eliminado INTEGER NOT NULL DEFAULT 0,
        fecha_creacion TEXT DEFAULT (datetime('now')),
        fecha_actualizacion TEXT
      )
    `);
  }
  await ensureCatalogoGRole(db);
  await ensureColumn(db, 'correlativo', 'INT NULL', 'INTEGER');
  await ensureColumn(db, 'foto_hash', 'VARCHAR(64) NULL', 'TEXT');
  await ensureColumn(db, 'fotos', 'JSON NULL', 'TEXT');
  await ensureColumn(db, 'marca', 'VARCHAR(255) NULL', 'TEXT');
  await ensureColumn(db, 'modelo', 'VARCHAR(255) NULL', 'TEXT');
  await ensureColumn(db, 'observaciones', 'TEXT NULL', 'TEXT');
  await backfillCorrelativos(db);
  await backfillFotosJson(db);
}

async function backfillFotosJson(db) {
  try {
    const rows = await db.prepare(`
      SELECT id, foto, foto_hash, fotos FROM ${TABLE}
      WHERE eliminado = 0 AND foto IS NOT NULL AND foto <> ''
        AND (fotos IS NULL OR fotos = '' OR fotos = 'null' OR fotos = '[]')
    `).all();
    for (const r of rows) {
      const json = fotosToJson([{ ruta: r.foto, hash: r.foto_hash || null, tipo: 'articulo' }]);
      await db.prepare(`UPDATE ${TABLE} SET fotos = ? WHERE id = ?`).run(json, r.id);
    }
  } catch (err) {
    console.warn('[catalogo-g] backfill fotos:', err.message);
  }
}

async function ensureColumn(db, col, mysqlDdl, sqliteDdl) {
  try {
    if (db.driver === 'mysql') {
      const row = await db.prepare(`
        SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      `).get(TABLE, col);
      if (!row || Number(row.c) === 0) {
        await db.exec(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`${col}\` ${mysqlDdl}`);
      }
    } else {
      const cols = (await db.prepare(`PRAGMA table_info(${TABLE})`).all()).map((c) => c.name);
      if (!cols.includes(col)) await db.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${col} ${sqliteDdl}`);
    }
  } catch (err) {
    if (!/duplicate column/i.test(String(err.message || ''))) {
      console.warn(`[catalogo-g] columna ${col}:`, err.message);
    }
  }
}

async function backfillCorrelativos(db) {
  try {
    const rows = await db.prepare(`
      SELECT id, codigo, correlativo FROM ${TABLE}
      WHERE correlativo IS NULL OR correlativo = 0
      ORDER BY id ASC
    `).all();
    for (const r of rows) {
      let n = null;
      const m = String(r.codigo || '').match(/(\d+)\s*$/);
      if (m) n = Number(m[1]);
      if (!n || !Number.isFinite(n)) n = Number(r.id);
      const codigo = `CATG-${String(n).padStart(5, '0')}`;
      await db.prepare(`
        UPDATE ${TABLE}
        SET correlativo = ?, codigo = COALESCE(NULLIF(TRIM(codigo), ''), ?)
        WHERE id = ?
      `).run(n, codigo, r.id);
    }
  } catch (err) {
    console.warn('[catalogo-g] backfill correlativo:', err.message);
  }
}

/** Rol «Catálogo G» con acceso al módulo (idempotente). */
async function ensureCatalogoGRole(db) {
  const pages = ['home.html', 'catalogo-g.html'];
  const pagesJson = JSON.stringify(pages);
  const nombre = 'Catálogo G';
  const descripcion = 'Acceso al módulo Catálogo G (empresa Global). Puede crear y editar ítems.';

  let rows = [];
  try {
    rows = await db.prepare(`SELECT id, nombre, paginas_permitidas, permisos FROM roles`).all();
  } catch (_) {
    try {
      rows = await db.prepare(`SELECT id, nombre, paginas_permitidas FROM roles`).all();
    } catch (_) {
      try {
        rows = await db.prepare(`SELECT id, nombre, permisos FROM roles`).all();
      } catch (e) {
        console.warn('[catalogo-g] no se pudo leer roles:', e.message);
        return;
      }
    }
  }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const existing = (rows || []).find((r) => {
    const n = norm(r.nombre);
    return n === 'catalogo g' || n === 'catalogo-g' || /^catalogo\s*g$/.test(n);
  });

  if (existing) {
    // Asegura que tenga catalogo-g.html en páginas
    let cur = existing.paginas_permitidas != null ? existing.paginas_permitidas : existing.permisos;
    try {
      if (typeof cur === 'string') cur = JSON.parse(cur);
    } catch (_) {
      cur = [];
    }
    if (!Array.isArray(cur)) cur = [];
    if (cur.includes('*')) return;
    const has = cur.some((p) => String(p).replace(/^\//, '') === 'catalogo-g.html');
    if (has) return;
    const next = JSON.stringify([...new Set([...cur, 'home.html', 'catalogo-g.html'])]);
    try {
      await db.prepare(`UPDATE roles SET paginas_permitidas = ? WHERE id = ?`).run(next, existing.id);
    } catch (_) {
      try {
        await db.prepare(`UPDATE roles SET permisos = ? WHERE id = ?`).run(next, existing.id);
      } catch (e) {
        console.warn('[catalogo-g] no se pudo actualizar rol:', e.message);
      }
    }
    return;
  }

  try {
    await db.prepare(`
      INSERT INTO roles (nombre, descripcion, paginas_permitidas, activo)
      VALUES (?, ?, ?, 1)
    `).run(nombre, descripcion, pagesJson);
  } catch (_) {
    try {
      await db.prepare(`
        INSERT INTO roles (nombre, descripcion, permisos)
        VALUES (?, ?, ?)
      `).run(nombre, descripcion, pagesJson);
    } catch (e) {
      if (!/duplicate|unique/i.test(String(e.message || ''))) {
        console.warn('[catalogo-g] no se pudo crear rol:', e.message);
      }
    }
  }
}

function normalizeEstado(v) {
  const s = String(v || '').trim();
  return ESTADOS.includes(s) ? s : 'Nuevo';
}

async function nextCorrelativo(db) {
  const row = await db.prepare(`
    SELECT MAX(correlativo) AS m FROM ${TABLE}
  `).get();
  let n = Number(row?.m || 0) + 1;
  if (!Number.isFinite(n) || n < 1) {
    const row2 = await db.prepare(`SELECT MAX(id) AS m FROM ${TABLE}`).get();
    n = Number(row2?.m || 0) + 1;
  }
  return n;
}

function formatCodigo(n) {
  return `CATG-${String(n).padStart(5, '0')}`;
}

const FOTO_TIPOS = ['articulo', 'marca'];
const MAX_FOTOS_POR_TIPO = 6;

function normalizeFotosList(raw, fallbackFoto, fallbackHash) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch (_) { /* ignore */ }
  }
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item) continue;
    const ruta = String(item.ruta || item.url || item.foto || '').trim();
    if (!ruta || !ruta.startsWith('/uploads/')) continue;
    if (seen.has(ruta)) continue;
    seen.add(ruta);
    const tipo = FOTO_TIPOS.includes(item.tipo) ? item.tipo : 'articulo';
    out.push({
      ruta,
      hash: item.hash ? String(item.hash).toLowerCase() : null,
      tipo
    });
  }
  if (!out.length && fallbackFoto && String(fallbackFoto).startsWith('/uploads/')) {
    out.push({
      ruta: String(fallbackFoto),
      hash: fallbackHash ? String(fallbackHash).toLowerCase() : null,
      tipo: 'articulo'
    });
  }
  return out.slice(0, MAX_FOTOS_POR_TIPO * 2);
}

function fotosToJson(fotos) {
  return JSON.stringify(normalizeFotosList(fotos));
}

function primaryFoto(fotos, fallback) {
  const list = normalizeFotosList(fotos, fallback);
  const art = list.find((f) => f.tipo === 'articulo') || list[0];
  return art || null;
}

async function nextCodigo(db) {
  const n = await nextCorrelativo(db);
  return formatCodigo(n);
}

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    const err = new Error('Imagen inválida');
    err.status = 400;
    throw err;
  }
  const m = dataUrl.match(/^data:image\/([\w+.-]+);base64,(.+)$/i);
  if (!m) {
    const err = new Error('Formato de imagen no soportado (use JPG o PNG)');
    err.status = 400;
    throw err;
  }
  let ext = String(m[1] || '').toLowerCase();
  if (ext === 'jpeg' || ext === 'jpg') ext = 'jpg';
  else if (ext === 'png') ext = 'png';
  else if (ext === 'webp') ext = 'webp';
  else if (ext === 'gif') ext = 'gif';
  else {
    const err = new Error('Formato de imagen no soportado (use JPG o PNG desde la galería)');
    err.status = 400;
    throw err;
  }
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) {
    const err = new Error('La imagen supera 8 MB');
    err.status = 400;
    throw err;
  }
  return { ext, buf, hash: hashBuffer(buf) };
}

async function findDuplicatesByHash(db, hash, excludeId) {
  if (!hash) return [];
  let sql = `
    SELECT id, codigo, correlativo, descripcion, empresa, bodega, estado, foto
    FROM ${TABLE}
    WHERE eliminado = 0 AND foto_hash = ?
  `;
  const params = [hash];
  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(Number(excludeId));
  }
  sql += ' ORDER BY id DESC LIMIT 10';
  return db.prepare(sql).all(...params);
}

async function analyzePhotoWithAngel(db, dataUrl, candidates, timeoutMs = 8000) {
  if (!candidates.length) return null;
  const work = async () => {
    const { getApiKey, getAngelModel, isAngelActive } = require('./angel');
    if (!(await isAngelActive(db))) return null;
    const apiKey = await getApiKey(db);
    if (!apiKey) return null;
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey, timeout: timeoutMs });
    const model = await getAngelModel(db);

    // Reducir tamaño de la foto nueva (máx ~400KB base64) para no colgar
    let newUrl = dataUrl;
    if (String(dataUrl).length > 500000) {
      newUrl = String(dataUrl).slice(0, 100) + '…'; // no enviar gigante; usar hash path only
      return null;
    }

    const content = [
      {
        type: 'text',
        text: `Eres Angel IA de ESERCOM. Compara la FOTO NUEVA con fotos existentes del Catálogo G.
Responde SOLO JSON:
{"duplicada":true|false,"coincidencias":[{"codigo":"CATG-00001","motivo":"..."}],"mensaje":"alerta breve en español"}
Candidatos: ${candidates.map((c) => c.codigo).join(', ')}`
      },
      { type: 'text', text: 'FOTO NUEVA:' },
      { type: 'image_url', image_url: { url: newUrl } }
    ];

    for (const c of candidates.slice(0, 2)) {
      let url = c.foto;
      if (url && url.startsWith('/')) {
        const abs = path.join(config.publicDir, url.replace(/^\//, ''));
        if (!fs.existsSync(abs)) continue;
        const st = fs.statSync(abs);
        if (st.size > 900000) continue; // evita fotos enormes
        const buf = fs.readFileSync(abs);
        const ext = path.extname(abs).replace('.', '') || 'jpg';
        const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
        url = `data:${mime};base64,${buf.toString('base64')}`;
      }
      if (!url || !String(url).startsWith('data:image/')) continue;
      if (String(url).length > 700000) continue;
      content.push({ type: 'text', text: `ARTÍCULO ${c.codigo}:` });
      content.push({ type: 'image_url', image_url: { url } });
    }

    if (content.length < 5) return null;

    const resp = await client.chat.completions.create({
      model: model || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 250,
      messages: [{ role: 'user', content }]
    });
    const raw = String(resp.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      duplicada: !!parsed.duplicada,
      coincidencias: Array.isArray(parsed.coincidencias) ? parsed.coincidencias : [],
      mensaje: parsed.mensaje || null,
      fuente: 'angel'
    };
  };

  try {
    return await Promise.race([
      work(),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  } catch (err) {
    console.warn('[catalogo-g] angel foto check:', err.message);
    return null;
  }
}

/**
 * Angel lee la foto y sugiere nombre / marca / modelo.
 */
async function suggestFromCatalogoGPhoto(db, dataUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 12000;
  const tipo = opts.tipo === 'marca' ? 'marca' : 'articulo';
  parseDataUrl(dataUrl); // valida

  const work = async () => {
    const { getApiKey, getAngelModel, isAngelActive } = require('./angel');
    if (!(await isAngelActive(db))) {
      return { ok: false, message: 'Angel IA no está activo' };
    }
    const apiKey = await getApiKey(db);
    if (!apiKey) return { ok: false, message: 'Angel IA sin API key' };

    let url = dataUrl;
    if (String(url).length > 650000) {
      return { ok: false, message: 'Foto muy grande para análisis' };
    }

    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey, timeout: timeoutMs });
    const model = await getAngelModel(db);
    const foco = tipo === 'marca'
      ? 'Prioriza leer marca, logo, etiqueta, placa o modelo visibles en la imagen.'
      : 'Identifica el producto/artículo que se ve (herramienta, equipo, material, etc.).';

    const resp = await client.chat.completions.create({
      model: model || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 280,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Eres Angel IA de ESERCOM (inventario Catálogo G, Chile).
Analiza la foto y responde SOLO JSON válido:
{"descripcion":"nombre corto del producto en español","marca":"marca o vacío","modelo":"modelo/referencia o vacío","confianza":0.0,"nota":"frase breve"}
Reglas:
- descripcion: 3 a 12 palabras, clara para inventario (ej: "Taladro percutor inalámbrico").
- marca/modelo: solo si se ven o son evidentes; si no, "".
- ${foco}
- No inventes códigos ni precios.`
          },
          { type: 'image_url', image_url: { url } }
        ]
      }]
    });

    const raw = String(resp.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, message: 'Angel no pudo leer la foto' };
    const parsed = JSON.parse(jsonMatch[0]);
    const descripcion = String(parsed.descripcion || '').trim().slice(0, 200);
    const marca = String(parsed.marca || '').trim().slice(0, 120);
    const modelo = String(parsed.modelo || '').trim().slice(0, 120);
    if (!descripcion && !marca && !modelo) {
      return { ok: false, message: 'No se identificó el producto' };
    }
    return {
      ok: true,
      descripcion: descripcion || null,
      marca: marca || null,
      modelo: modelo || null,
      confianza: Number(parsed.confianza) || null,
      nota: parsed.nota || null,
      fuente: 'angel'
    };
  };

  try {
    return await Promise.race([
      work(),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, message: 'Angel tardó demasiado' }), timeoutMs + 500))
    ]);
  } catch (err) {
    console.warn('[catalogo-g] sugerir foto:', err.message);
    return { ok: false, message: err.message || 'Error Angel' };
  }
}

/**
 * Analiza foto. Por defecto SOLO hash (rápido). Angel opcional con timeout.
 */
async function analyzeCatalogoGPhoto(db, dataUrl, opts = {}) {
  const { buf, hash, ext } = parseDataUrl(dataUrl);
  let exact = [];
  try {
    exact = await findDuplicatesByHash(db, hash, opts.excludeId);
  } catch (_) {
    exact = [];
  }
  if (exact.length) {
    return {
      hash,
      ext,
      buf,
      alerta: true,
      nivel: 'exacta',
      mensaje: `Esta foto ya existe en ${exact.map((x) => x.codigo || ('#' + x.correlativo)).join(', ')}.`,
      duplicados: exact,
      fuente: 'hash'
    };
  }

  if (!opts.checkAngel) {
    return {
      hash, ext, buf,
      alerta: false, nivel: null, mensaje: null, duplicados: [], fuente: 'hash'
    };
  }

  let recent = [];
  try {
    recent = await db.prepare(`
      SELECT id, codigo, correlativo, descripcion, foto, foto_hash
      FROM ${TABLE}
      WHERE eliminado = 0 AND foto IS NOT NULL AND foto <> ''
        ${opts.excludeId ? 'AND id <> ?' : ''}
      ORDER BY id DESC
      LIMIT 4
    `).all(...(opts.excludeId ? [Number(opts.excludeId)] : []));
  } catch (_) {
    recent = [];
  }

  const angel = await analyzePhotoWithAngel(db, dataUrl, recent, opts.angelTimeoutMs || 8000);
  if (angel?.duplicada) {
    const codes = (angel.coincidencias || []).map((c) => c.codigo).filter(Boolean);
    const matched = recent.filter((r) => codes.includes(r.codigo));
    return {
      hash,
      ext,
      buf,
      alerta: true,
      nivel: 'similar',
      mensaje: angel.mensaje || `Angel detectó posible foto repetida${codes.length ? ' (' + codes.join(', ') + ')' : ''}.`,
      duplicados: matched.length ? matched : recent.slice(0, 3),
      coincidencias: angel.coincidencias || [],
      fuente: 'angel'
    };
  }

  return {
    hash, ext, buf,
    alerta: false, nivel: null, mensaje: null, duplicados: [],
    fuente: angel ? 'angel' : 'hash'
  };
}

async function listCatalogoG(db) {
  await ensureCatalogoGSchema(db);
  const nameExpr = (alias) => (db.driver === 'mysql'
    ? `TRIM(CONCAT(COALESCE(${alias}.nombre,''), ' ', COALESCE(${alias}.apellido,'')))`
    : `TRIM(COALESCE(${alias}.nombre,'') || ' ' || COALESCE(${alias}.apellido,''))`);
  const rows = await db.prepare(`
    SELECT c.*,
           ${nameExpr('u')} AS creador,
           ${nameExpr('a')} AS editor
    FROM ${TABLE} c
    LEFT JOIN usuarios u ON u.id = c.creado_por
    LEFT JOIN usuarios a ON a.id = c.actualizado_por
    WHERE c.eliminado = 0
    ORDER BY c.id DESC
  `).all();
  return rows.map((r) => {
    const fotos = normalizeFotosList(r.fotos, r.foto, r.foto_hash);
    const primary = primaryFoto(fotos, r.foto);
    return {
      ...r,
      fotos,
      foto: primary?.ruta || r.foto || null,
      foto_hash: primary?.hash || r.foto_hash || null,
      fotos_articulo: fotos.filter((f) => f.tipo === 'articulo'),
      fotos_marca: fotos.filter((f) => f.tipo === 'marca')
    };
  });
}

async function createCatalogoG(db, userId, body) {
  await ensureCatalogoGSchema(db);
  const empresa = String(body.empresa || '').trim();
  const descripcion = String(body.descripcion || '').trim();
  if (!empresa) {
    const err = new Error('Empresa requerida');
    err.status = 400;
    throw err;
  }
  if (!descripcion) {
    const err = new Error('Descripción del producto requerida');
    err.status = 400;
    throw err;
  }
  const correlativo = await nextCorrelativo(db);
  const codigo = formatCodigo(correlativo);
  const cantidad = Number(body.cantidad);
  const fotos = normalizeFotosList(body.fotos, body.foto, body.foto_hash);
  const primary = primaryFoto(fotos, body.foto);
  const foto = primary?.ruta || body.foto || null;
  const fotoHash = primary?.hash || body.foto_hash || null;
  const bodega = String(body.bodega || '').trim() || null;
  const marca = String(body.marca || '').trim() || null;
  const modelo = String(body.modelo || '').trim() || null;
  const observaciones = String(body.observaciones || '').trim() || null;
  const estado = normalizeEstado(body.estado);
  const cant = Number.isFinite(cantidad) ? cantidad : 0;
  const fotosJson = fotosToJson(fotos);

  try {
    const info = await db.prepare(`
      INSERT INTO ${TABLE}
        (codigo, correlativo, empresa, descripcion, cantidad, bodega, marca, modelo, observaciones, foto, foto_hash, fotos, estado, creado_por, actualizado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(codigo, correlativo, empresa, descripcion, cant, bodega, marca, modelo, observaciones, foto, fotoHash, fotosJson, estado, userId || null, userId || null);
    return { id: info.lastInsertRowid, codigo, correlativo };
  } catch (err) {
    if (!/Unknown column|no such column/i.test(String(err.message || ''))) throw err;
    try {
      const info = await db.prepare(`
        INSERT INTO ${TABLE}
          (codigo, correlativo, empresa, descripcion, cantidad, bodega, marca, modelo, foto, foto_hash, fotos, estado, creado_por, actualizado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(codigo, correlativo, empresa, descripcion, cant, bodega, marca, modelo, foto, fotoHash, fotosJson, estado, userId || null, userId || null);
      return { id: info.lastInsertRowid, codigo, correlativo };
    } catch (err2) {
      if (!/Unknown column|no such column/i.test(String(err2.message || ''))) throw err2;
      try {
        const info = await db.prepare(`
          INSERT INTO ${TABLE}
            (codigo, correlativo, empresa, descripcion, cantidad, bodega, foto, foto_hash, fotos, estado, creado_por, actualizado_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(codigo, correlativo, empresa, descripcion, cant, bodega, foto, fotoHash, fotosJson, estado, userId || null, userId || null);
        return { id: info.lastInsertRowid, codigo, correlativo };
      } catch (err3) {
        if (!/Unknown column|no such column/i.test(String(err3.message || ''))) throw err3;
        try {
          const info = await db.prepare(`
            INSERT INTO ${TABLE}
              (codigo, correlativo, empresa, descripcion, cantidad, bodega, foto, foto_hash, estado, creado_por, actualizado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(codigo, correlativo, empresa, descripcion, cant, bodega, foto, fotoHash, estado, userId || null, userId || null);
          return { id: info.lastInsertRowid, codigo, correlativo };
        } catch (err4) {
          if (!/Unknown column|no such column/i.test(String(err4.message || ''))) throw err4;
          const info = await db.prepare(`
            INSERT INTO ${TABLE}
              (codigo, empresa, descripcion, cantidad, bodega, foto, estado, creado_por, actualizado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(codigo, empresa, descripcion, cant, bodega, foto, estado, userId || null, userId || null);
          return { id: info.lastInsertRowid, codigo, correlativo };
        }
      }
    }
  }
}

async function updateCatalogoG(db, id, userId, body) {
  await ensureCatalogoGSchema(db);
  const cur = await db.prepare(`SELECT * FROM ${TABLE} WHERE id = ? AND eliminado = 0`).get(Number(id));
  if (!cur) {
    const err = new Error('Registro no encontrado');
    err.status = 404;
    throw err;
  }
  const empresa = body.empresa != null ? String(body.empresa).trim() : cur.empresa;
  const descripcion = body.descripcion != null ? String(body.descripcion).trim() : cur.descripcion;
  if (!empresa || !descripcion) {
    const err = new Error('Empresa y descripción son obligatorias');
    err.status = 400;
    throw err;
  }
  const cantidad = body.cantidad != null ? Number(body.cantidad) : Number(cur.cantidad);
  const fotos = body.fotos !== undefined
    ? normalizeFotosList(body.fotos, body.foto, body.foto_hash)
    : normalizeFotosList(cur.fotos, cur.foto, cur.foto_hash);
  const primary = primaryFoto(fotos, body.foto !== undefined ? body.foto : cur.foto);
  const foto = primary?.ruta || (body.foto !== undefined ? (body.foto || null) : cur.foto);
  const fotoHash = primary?.hash
    || (body.foto_hash !== undefined
      ? (body.foto_hash || null)
      : (body.foto !== undefined && body.foto !== cur.foto ? null : cur.foto_hash));
  let correlativo = cur.correlativo;
  let codigo = cur.codigo;
  if (!correlativo) {
    correlativo = Number(cur.id);
    codigo = formatCodigo(correlativo);
  }
  const fotosJson = fotosToJson(fotos);
  const marca = body.marca != null ? (String(body.marca).trim() || null) : cur.marca;
  const modelo = body.modelo != null ? (String(body.modelo).trim() || null) : cur.modelo;
  const observaciones = body.observaciones != null
    ? (String(body.observaciones).trim() || null)
    : cur.observaciones;
  try {
    await db.prepare(`
      UPDATE ${TABLE} SET
        codigo = ?, correlativo = ?, empresa = ?, descripcion = ?, cantidad = ?, bodega = ?,
        marca = ?, modelo = ?, observaciones = ?, foto = ?, foto_hash = ?, fotos = ?, estado = ?, actualizado_por = ?,
        fecha_actualizacion = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
      WHERE id = ?
    `).run(
      codigo,
      correlativo,
      empresa,
      descripcion,
      Number.isFinite(cantidad) ? cantidad : 0,
      body.bodega != null ? (String(body.bodega).trim() || null) : cur.bodega,
      marca,
      modelo,
      observaciones,
      foto,
      fotoHash,
      fotosJson,
      body.estado != null ? normalizeEstado(body.estado) : cur.estado,
      userId || null,
      Number(id)
    );
  } catch (err) {
    if (!/Unknown column|no such column/i.test(String(err.message || ''))) throw err;
    try {
      await db.prepare(`
        UPDATE ${TABLE} SET
          codigo = ?, correlativo = ?, empresa = ?, descripcion = ?, cantidad = ?, bodega = ?,
          marca = ?, modelo = ?, foto = ?, foto_hash = ?, fotos = ?, estado = ?, actualizado_por = ?,
          fecha_actualizacion = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
        WHERE id = ?
      `).run(
        codigo,
        correlativo,
        empresa,
        descripcion,
        Number.isFinite(cantidad) ? cantidad : 0,
        body.bodega != null ? (String(body.bodega).trim() || null) : cur.bodega,
        marca,
        modelo,
        foto,
        fotoHash,
        fotosJson,
        body.estado != null ? normalizeEstado(body.estado) : cur.estado,
        userId || null,
        Number(id)
      );
    } catch (err2) {
      if (!/Unknown column|no such column/i.test(String(err2.message || ''))) throw err2;
      try {
        await db.prepare(`
          UPDATE ${TABLE} SET
            codigo = ?, correlativo = ?, empresa = ?, descripcion = ?, cantidad = ?, bodega = ?,
            foto = ?, foto_hash = ?, fotos = ?, estado = ?, actualizado_por = ?,
            fecha_actualizacion = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
          WHERE id = ?
        `).run(
          codigo,
          correlativo,
          empresa,
          descripcion,
          Number.isFinite(cantidad) ? cantidad : 0,
          body.bodega != null ? (String(body.bodega).trim() || null) : cur.bodega,
          foto,
          fotoHash,
          fotosJson,
          body.estado != null ? normalizeEstado(body.estado) : cur.estado,
          userId || null,
          Number(id)
        );
      } catch (err3) {
        if (!/Unknown column|no such column/i.test(String(err3.message || ''))) throw err3;
        await db.prepare(`
          UPDATE ${TABLE} SET
            codigo = ?, correlativo = ?, empresa = ?, descripcion = ?, cantidad = ?, bodega = ?,
            foto = ?, foto_hash = ?, estado = ?, actualizado_por = ?,
            fecha_actualizacion = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
          WHERE id = ?
        `).run(
          codigo,
          correlativo,
          empresa,
          descripcion,
          Number.isFinite(cantidad) ? cantidad : 0,
          body.bodega != null ? (String(body.bodega).trim() || null) : cur.bodega,
          foto,
          fotoHash,
          body.estado != null ? normalizeEstado(body.estado) : cur.estado,
          userId || null,
          Number(id)
        );
      }
    }
  }
  return { id: Number(id), codigo, correlativo };
}

async function deleteCatalogoG(db, id, userId) {
  await ensureCatalogoGSchema(db);
  const info = await db.prepare(`
    UPDATE ${TABLE} SET eliminado = 1, actualizado_por = ?,
      fecha_actualizacion = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
    WHERE id = ? AND eliminado = 0
  `).run(userId || null, Number(id));
  if (!info.changes) {
    const err = new Error('Registro no encontrado');
    err.status = 404;
    throw err;
  }
}

function saveCatalogoGPhoto(dataUrl, analysis) {
  const parsed = analysis || parseDataUrl(dataUrl);
  const { ext, buf, hash } = parsed;
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `catg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { ruta: `/uploads/catalogo-g/${name}`, hash };
}

/** Bodegas del módulo Salida de Materiales (+ defaults). */
async function listBodegasCatalogoG(db) {
  try {
    const rows = await db.prepare(`
      SELECT id, codigo, nombre, ubicacion FROM bodegas
      WHERE activo = 1 OR activo IS NULL
      ORDER BY nombre
    `).all();
    if (rows && rows.length) {
      const have = new Set(rows.map((r) => String(r.nombre || '').toLowerCase()));
      const extra = BODEGAS_DEFAULT.filter((d) => !have.has(d.nombre.toLowerCase()));
      return [...rows, ...extra];
    }
  } catch (_) { /* tabla ausente */ }
  return BODEGAS_DEFAULT.slice();
}

function buildStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const porEstadoMap = new Map();
  const porBodegaMap = new Map();
  let totalCantidad = 0;

  for (const e of ESTADOS) {
    porEstadoMap.set(e, { estado: e, articulos: 0, cantidad: 0 });
  }

  for (const r of list) {
    const cant = Number(r.cantidad);
    const n = Number.isFinite(cant) ? cant : 0;
    totalCantidad += n;
    const estado = normalizeEstado(r.estado);
    const st = porEstadoMap.get(estado) || { estado, articulos: 0, cantidad: 0 };
    st.articulos += 1;
    st.cantidad += n;
    porEstadoMap.set(estado, st);

    const bodega = String(r.bodega || '').trim() || 'Sin bodega';
    const bd = porBodegaMap.get(bodega) || { bodega, articulos: 0, cantidad: 0 };
    bd.articulos += 1;
    bd.cantidad += n;
    porBodegaMap.set(bodega, bd);
  }

  return {
    total: list.length,
    total_cantidad: totalCantidad,
    por_estado: Array.from(porEstadoMap.values()),
    por_bodega: Array.from(porBodegaMap.values()).sort((a, b) => b.articulos - a.articulos)
  };
}

function cellText(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
  if (typeof val === 'object') {
    if (val.result != null) return cellText(val.result);
    if (val.text != null) return String(val.text).trim();
    if (val.richText) return val.richText.map((t) => t.text || '').join('').trim();
  }
  return String(val).trim();
}

function normHeader(value) {
  return String(cellText(value) || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function mapExcelHeader(cellValue) {
  const key = normHeader(cellValue);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(EXCEL_HEADER_MAP)) {
    if (aliases.includes(key) || aliases.some((a) => key === a || key.includes(a))) return field;
  }
  return null;
}

function decodeUploadBody(body) {
  const raw = body?.dataUrl || body?.base64 || body?.file;
  if (!raw) {
    const err = new Error('Archivo Excel requerido (dataUrl o base64)');
    err.status = 400;
    throw err;
  }
  const b64 = String(raw).includes(',') ? String(raw).split(',')[1] : String(raw);
  return Buffer.from(b64, 'base64');
}

async function buildPlantillaCatalogoG(bodegas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Catalogo G');
  ws.addRow(['Empresa', 'Descripcion', 'Cantidad', 'Bodega', 'Estado']);
  const bod = (bodegas && bodegas[0]?.nombre) || 'Bodega Conchalí';
  ws.addRow(['Global', 'Ejemplo producto acero', 10, bod, 'Nuevo']);
  ws.addRow(['Global', 'Ejemplo herramienta usada', 2, bod, 'Usado']);
  ws.getRow(1).font = { bold: true };
  ws.columns = [{ width: 18 }, { width: 36 }, { width: 12 }, { width: 22 }, { width: 16 }];

  const wsInfo = wb.addWorksheet('Estados y Bodegas');
  wsInfo.addRow(['Estados válidos']);
  ESTADOS.forEach((e) => wsInfo.addRow([e]));
  wsInfo.addRow([]);
  wsInfo.addRow(['Bodegas (Salida de Materiales)']);
  (bodegas || BODEGAS_DEFAULT).forEach((b) => wsInfo.addRow([b.nombre]));
  wsInfo.getColumn(1).width = 28;

  return wb.xlsx.writeBuffer();
}

function extractCatalogoRows(ws) {
  if (!ws || ws.rowCount < 1) return [];
  let headerRowNum = null;
  let colMap = {};

  for (let r = 1; r <= Math.min(ws.rowCount, 25); r++) {
    const row = ws.getRow(r);
    const trial = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const field = mapExcelHeader(cell.value);
      if (field) trial[col] = field;
    });
    const fields = Object.values(trial);
    if (fields.includes('descripcion') || fields.includes('empresa')) {
      headerRowNum = r;
      colMap = trial;
      break;
    }
  }
  if (!headerRowNum) return [];

  const out = [];
  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    Object.entries(colMap).forEach(([col, field]) => {
      obj[field] = cellText(row.getCell(Number(col)).value);
    });
    if (!obj.descripcion && !obj.empresa) continue;
    out.push(obj);
  }
  return out;
}

async function importCatalogoGExcel(db, buffer, userId, opts = {}) {
  await ensureCatalogoGSchema(db);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const byKey = new Map();
  for (const ws of wb.worksheets || []) {
    if (/estado|bodega/i.test(ws.name) && !/catalogo/i.test(ws.name)) continue;
    for (const row of extractCatalogoRows(ws)) {
      const desc = String(row.descripcion || '').trim();
      const emp = String(row.empresa || '').trim() || 'Global';
      if (!desc) continue;
      const key = `${emp}||${desc}||${row.bodega || ''}||${row.estado || ''}`;
      byKey.set(key, row);
    }
  }

  const rows = Array.from(byKey.values());
  if (!rows.length) {
    const err = new Error('No se encontraron filas. Use columnas: Empresa, Descripcion, Cantidad, Bodega, Estado');
    err.status = 400;
    throw err;
  }

  let created = 0;
  for (const row of rows) {
    const cantidad = Number(String(row.cantidad || '').replace(',', '.'));
    await createCatalogoG(db, userId, {
      empresa: row.empresa || 'Global',
      descripcion: row.descripcion,
      cantidad: Number.isFinite(cantidad) ? cantidad : 0,
      bodega: row.bodega || null,
      estado: row.estado || 'Nuevo',
      foto: null
    });
    created += 1;
  }

  return {
    total: created,
    archivo_nombre: String(opts.filename || 'catalogo_g.xlsx').slice(0, 255)
  };
}

module.exports = {
  ESTADOS,
  BODEGAS_DEFAULT,
  ensureCatalogoGSchema,
  ensureCatalogoGRole,
  listCatalogoG,
  listBodegasCatalogoG,
  buildStats,
  createCatalogoG,
  updateCatalogoG,
  deleteCatalogoG,
  saveCatalogoGPhoto,
  analyzeCatalogoGPhoto,
  suggestFromCatalogoGPhoto,
  findDuplicatesByHash,
  normalizeFotosList,
  primaryFoto,
  buildPlantillaCatalogoG,
  importCatalogoGExcel,
  decodeUploadBody
};
