/**
 * WMS — Warehouse Management System (modelo caótico).
 * Flujo: dimensionar bodega → proponer posiciones (rack/piso) → aprobar →
 * ingreso/salida por QR o posición manual.
 */
const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data', 'wms');

const MERCADOS = {
  chile: {
    label: 'Chile / LatAm',
    zona_ingreso: 'INGRESO',
    zona_despacho: 'DESPACHO',
    zona_almacen: 'ALMACENAJE',
    zona_cuarentena: 'CUARENTENA',
    zona_devolucion: 'DEVOLUCION',
    pasillo_min_m: 2.5,
    muelle_ingreso_m: 4,
    muelle_despacho_m: 4,
    etiqueta_pos: 'POS',
    unidad_dim: 'm'
  },
  mexico: {
    label: 'México',
    zona_ingreso: 'RECEPCION',
    zona_despacho: 'EMBARQUE',
    zona_almacen: 'ALMACEN',
    zona_cuarentena: 'CUARENTENA',
    zona_devolucion: 'DEVOLUCIONES',
    pasillo_min_m: 2.8,
    muelle_ingreso_m: 4.5,
    muelle_despacho_m: 4.5,
    etiqueta_pos: 'UBI',
    unidad_dim: 'm'
  },
  usa: {
    label: 'USA / Internacional',
    zona_ingreso: 'RECEIVING',
    zona_despacho: 'SHIPPING',
    zona_almacen: 'STORAGE',
    zona_cuarentena: 'HOLD',
    zona_devolucion: 'RETURNS',
    pasillo_min_m: 3.0,
    muelle_ingreso_m: 5,
    muelle_despacho_m: 5,
    etiqueta_pos: 'LOC',
    unidad_dim: 'm'
  }
};

const TIPOS_ALMACENAJE = ['rack', 'piso', 'mixto'];
const ESTADOS_PROPUESTA = ['borrador', 'pendiente', 'aprobada', 'rechazada'];
const ESTADOS_POSICION = ['libre', 'ocupada', 'bloqueada', 'reserva'];
const TIPOS_MOV = ['ingreso', 'salida', 'ajuste', 'traslado'];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function nowSql(db) {
  return db.driver === 'mysql' ? 'NOW()' : "datetime('now')";
}

async function ensureWmsSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_bodegas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(32) NOT NULL,
        nombre VARCHAR(160) NOT NULL,
        mercado VARCHAR(32) NOT NULL DEFAULT 'chile',
        largo_m DECIMAL(10,2) NOT NULL DEFAULT 0,
        ancho_m DECIMAL(10,2) NOT NULL DEFAULT 0,
        alto_m DECIMAL(10,2) NOT NULL DEFAULT 0,
        tipo_almacenaje VARCHAR(16) NOT NULL DEFAULT 'mixto',
        plano_ruta VARCHAR(512) NULL,
        parametros_json LONGTEXT NULL,
        estado VARCHAR(32) NOT NULL DEFAULT 'activa',
        eliminado TINYINT NOT NULL DEFAULT 0,
        creado_por INT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME NULL,
        UNIQUE KEY uk_wms_bod_cod (codigo)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_zonas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bodega_id INT NOT NULL,
        codigo VARCHAR(48) NOT NULL,
        nombre VARCHAR(120) NOT NULL,
        tipo VARCHAR(32) NOT NULL,
        x_m DECIMAL(10,2) DEFAULT 0,
        y_m DECIMAL(10,2) DEFAULT 0,
        largo_m DECIMAL(10,2) DEFAULT 0,
        ancho_m DECIMAL(10,2) DEFAULT 0,
        color VARCHAR(16) DEFAULT '#64748b',
        orden INT DEFAULT 0,
        activo TINYINT NOT NULL DEFAULT 1,
        INDEX idx_wms_zona_bod (bodega_id)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_propuestas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(32) NOT NULL,
        bodega_id INT NOT NULL,
        tipo_almacenaje VARCHAR(16) NOT NULL,
        pos_largo_m DECIMAL(10,2) NOT NULL,
        pos_ancho_m DECIMAL(10,2) NOT NULL,
        pos_alto_m DECIMAL(10,2) NOT NULL,
        niveles INT NOT NULL DEFAULT 1,
        pasillo_m DECIMAL(10,2) NOT NULL DEFAULT 2.5,
        layout_json LONGTEXT NOT NULL,
        total_posiciones INT NOT NULL DEFAULT 0,
        estado VARCHAR(32) NOT NULL DEFAULT 'borrador',
        notas TEXT NULL,
        creado_por INT NULL,
        aprobado_por INT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_aprobacion DATETIME NULL,
        UNIQUE KEY uk_wms_prop_cod (codigo),
        INDEX idx_wms_prop_bod (bodega_id)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_posiciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bodega_id INT NOT NULL,
        zona_id INT NULL,
        codigo VARCHAR(64) NOT NULL,
        qr_token VARCHAR(96) NOT NULL,
        tipo VARCHAR(16) NOT NULL DEFAULT 'piso',
        fila VARCHAR(16) NULL,
        columna VARCHAR(16) NULL,
        nivel INT NOT NULL DEFAULT 1,
        largo_m DECIMAL(10,2) NOT NULL DEFAULT 1,
        ancho_m DECIMAL(10,2) NOT NULL DEFAULT 1,
        alto_m DECIMAL(10,2) NOT NULL DEFAULT 1,
        x_m DECIMAL(10,2) DEFAULT 0,
        y_m DECIMAL(10,2) DEFAULT 0,
        capacidad_kg DECIMAL(12,2) NULL,
        estado VARCHAR(16) NOT NULL DEFAULT 'libre',
        activo TINYINT NOT NULL DEFAULT 1,
        eliminado TINYINT NOT NULL DEFAULT 0,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wms_pos_cod (bodega_id, codigo),
        UNIQUE KEY uk_wms_pos_qr (qr_token),
        INDEX idx_wms_pos_bod (bodega_id),
        INDEX idx_wms_pos_est (estado)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_inventario (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bodega_id INT NOT NULL,
        posicion_id INT NOT NULL,
        material_codigo VARCHAR(64) NOT NULL,
        material_nombre VARCHAR(255) NULL,
        lote VARCHAR(64) NULL,
        cantidad DECIMAL(14,3) NOT NULL DEFAULT 0,
        unidad VARCHAR(16) NOT NULL DEFAULT 'UN',
        fecha_ingreso DATETIME NULL,
        fecha_vencimiento DATE NULL,
        observaciones TEXT NULL,
        actualizado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wms_inv (posicion_id, material_codigo, lote),
        INDEX idx_wms_inv_mat (material_codigo),
        INDEX idx_wms_inv_bod (bodega_id)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_movimientos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(32) NOT NULL,
        bodega_id INT NOT NULL,
        tipo VARCHAR(16) NOT NULL,
        material_codigo VARCHAR(64) NOT NULL,
        material_nombre VARCHAR(255) NULL,
        lote VARCHAR(64) NULL,
        cantidad DECIMAL(14,3) NOT NULL,
        unidad VARCHAR(16) NOT NULL DEFAULT 'UN',
        posicion_id INT NULL,
        posicion_codigo VARCHAR(64) NULL,
        posicion_destino_id INT NULL,
        modo_captura VARCHAR(16) NOT NULL DEFAULT 'manual',
        documento_ref VARCHAR(64) NULL,
        usuario_id INT NULL,
        observaciones TEXT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wms_mov_cod (codigo),
        INDEX idx_wms_mov_bod (bodega_id),
        INDEX idx_wms_mov_mat (material_codigo)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_salidas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(32) NOT NULL,
        bodega_id INT NOT NULL,
        solicitud_id INT NULL,
        solicitud_codigo VARCHAR(64) NULL,
        estado VARCHAR(32) NOT NULL DEFAULT 'borrador',
        origen VARCHAR(32) NOT NULL DEFAULT 'manual',
        quien_retira VARCHAR(160) NULL,
        despacho_conductor VARCHAR(120) NULL,
        despacho_rut VARCHAR(32) NULL,
        despacho_patente VARCHAR(32) NULL,
        despacho_direccion VARCHAR(255) NULL,
        documento_ref VARCHAR(64) NULL,
        observaciones TEXT NULL,
        creado_por INT NULL,
        confirmado_por INT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_confirmacion DATETIME NULL,
        UNIQUE KEY uk_wms_sal_cod (codigo),
        INDEX idx_wms_sal_bod (bodega_id),
        INDEX idx_wms_sal_est (estado)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_salidas_detalle (
        id INT AUTO_INCREMENT PRIMARY KEY,
        salida_id INT NOT NULL,
        solicitud_detalle_id INT NULL,
        material_codigo VARCHAR(64) NOT NULL,
        material_nombre VARCHAR(255) NULL,
        cantidad_solicitada DECIMAL(14,3) NOT NULL DEFAULT 0,
        cantidad_despachada DECIMAL(14,3) NOT NULL DEFAULT 0,
        unidad VARCHAR(16) NOT NULL DEFAULT 'UN',
        posicion_id INT NULL,
        posicion_codigo VARCHAR(64) NULL,
        lote VARCHAR(64) NULL,
        estado VARCHAR(32) NOT NULL DEFAULT 'pendiente',
        observaciones TEXT NULL,
        INDEX idx_wms_sal_det (salida_id)
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_bodegas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        mercado TEXT NOT NULL DEFAULT 'chile',
        largo_m REAL NOT NULL DEFAULT 0,
        ancho_m REAL NOT NULL DEFAULT 0,
        alto_m REAL NOT NULL DEFAULT 0,
        tipo_almacenaje TEXT NOT NULL DEFAULT 'mixto',
        plano_ruta TEXT,
        parametros_json TEXT,
        estado TEXT NOT NULL DEFAULT 'activa',
        eliminado INTEGER NOT NULL DEFAULT 0,
        creado_por INTEGER,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
        fecha_actualizacion TEXT
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_zonas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bodega_id INTEGER NOT NULL,
        codigo TEXT NOT NULL,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL,
        x_m REAL DEFAULT 0,
        y_m REAL DEFAULT 0,
        largo_m REAL DEFAULT 0,
        ancho_m REAL DEFAULT 0,
        color TEXT DEFAULT '#64748b',
        orden INTEGER DEFAULT 0,
        activo INTEGER NOT NULL DEFAULT 1
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_propuestas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        bodega_id INTEGER NOT NULL,
        tipo_almacenaje TEXT NOT NULL,
        pos_largo_m REAL NOT NULL,
        pos_ancho_m REAL NOT NULL,
        pos_alto_m REAL NOT NULL,
        niveles INTEGER NOT NULL DEFAULT 1,
        pasillo_m REAL NOT NULL DEFAULT 2.5,
        layout_json TEXT NOT NULL,
        total_posiciones INTEGER NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'borrador',
        notas TEXT,
        creado_por INTEGER,
        aprobado_por INTEGER,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
        fecha_aprobacion TEXT
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_posiciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bodega_id INTEGER NOT NULL,
        zona_id INTEGER,
        codigo TEXT NOT NULL,
        qr_token TEXT NOT NULL UNIQUE,
        tipo TEXT NOT NULL DEFAULT 'piso',
        fila TEXT,
        columna TEXT,
        nivel INTEGER NOT NULL DEFAULT 1,
        largo_m REAL NOT NULL DEFAULT 1,
        ancho_m REAL NOT NULL DEFAULT 1,
        alto_m REAL NOT NULL DEFAULT 1,
        x_m REAL DEFAULT 0,
        y_m REAL DEFAULT 0,
        capacidad_kg REAL,
        estado TEXT NOT NULL DEFAULT 'libre',
        activo INTEGER NOT NULL DEFAULT 1,
        eliminado INTEGER NOT NULL DEFAULT 0,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (bodega_id, codigo)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_inventario (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bodega_id INTEGER NOT NULL,
        posicion_id INTEGER NOT NULL,
        material_codigo TEXT NOT NULL,
        material_nombre TEXT,
        lote TEXT,
        cantidad REAL NOT NULL DEFAULT 0,
        unidad TEXT NOT NULL DEFAULT 'UN',
        fecha_ingreso TEXT,
        fecha_vencimiento TEXT,
        observaciones TEXT,
        actualizado TEXT DEFAULT (datetime('now')),
        UNIQUE (posicion_id, material_codigo, lote)
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_movimientos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        bodega_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        material_codigo TEXT NOT NULL,
        material_nombre TEXT,
        lote TEXT,
        cantidad REAL NOT NULL,
        unidad TEXT NOT NULL DEFAULT 'UN',
        posicion_id INTEGER,
        posicion_codigo TEXT,
        posicion_destino_id INTEGER,
        modo_captura TEXT NOT NULL DEFAULT 'manual',
        documento_ref TEXT,
        usuario_id INTEGER,
        observaciones TEXT,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_salidas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        bodega_id INTEGER NOT NULL,
        solicitud_id INTEGER,
        solicitud_codigo TEXT,
        estado TEXT NOT NULL DEFAULT 'borrador',
        origen TEXT NOT NULL DEFAULT 'manual',
        quien_retira TEXT,
        despacho_conductor TEXT,
        despacho_rut TEXT,
        despacho_patente TEXT,
        despacho_direccion TEXT,
        documento_ref TEXT,
        observaciones TEXT,
        creado_por INTEGER,
        confirmado_por INTEGER,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
        fecha_confirmacion TEXT
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS wms_salidas_detalle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        salida_id INTEGER NOT NULL,
        solicitud_detalle_id INTEGER,
        material_codigo TEXT NOT NULL,
        material_nombre TEXT,
        cantidad_solicitada REAL NOT NULL DEFAULT 0,
        cantidad_despachada REAL NOT NULL DEFAULT 0,
        unidad TEXT NOT NULL DEFAULT 'UN',
        posicion_id INTEGER,
        posicion_codigo TEXT,
        lote TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        observaciones TEXT
      )
    `);
  }
}

async function nextCodigo(db, table, prefix) {
  const row = await db.prepare(
    `SELECT codigo AS c FROM ${table} WHERE codigo LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`);
  let n = 1;
  if (row?.c) {
    const m = String(row.c).match(/(\d+)\s*$/);
    if (m) n = Number(m[1]) + 1;
  }
  return `${prefix}${String(n).padStart(5, '0')}`;
}

function qrToken() {
  return `WMS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

function defaultParametros(mercadoKey) {
  const m = MERCADOS[mercadoKey] || MERCADOS.chile;
  return {
    mercado: mercadoKey || 'chile',
    modelo: 'caotico',
    descripcion_modelo:
      'Almacenamiento caótico: el material puede ubicarse en cualquier posición libre. El sistema registra SKU↔posición.',
    pasillo_min_m: m.pasillo_min_m,
    muelle_ingreso_m: m.muelle_ingreso_m,
    muelle_despacho_m: m.muelle_despacho_m,
    fifo_opcional: false,
    fefo_opcional: false,
    permitir_multi_sku_posicion: true,
    sugerir_posicion_libre: true,
    exigir_escaneo_confirmacion: false,
    unidad_peso: 'kg',
    capacidad_default_kg: 1000,
    etiqueta_pos: m.etiqueta_pos,
    zonas_flujo: [
      { tipo: 'ingreso', codigo: m.zona_ingreso, color: '#0284c7' },
      { tipo: 'almacen', codigo: m.zona_almacen, color: '#0f766e' },
      { tipo: 'despacho', codigo: m.zona_despacho, color: '#c2410c' },
      { tipo: 'cuarentena', codigo: m.zona_cuarentena, color: '#a16207' },
      { tipo: 'devolucion', codigo: m.zona_devolucion, color: '#64748b' }
    ]
  };
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

async function savePlano(dataUrl, empresaSlug = 'shared') {
  if (!dataUrl) return null;
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:image\/([a-z0-9+.-]+)(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) fail('Formato de imagen inválido. Usa JPG, PNG o WEBP.');
  const kind = String(match[1] || '').toLowerCase();
  if (/heic|heif|tiff|tif|svg/.test(kind)) fail('Formato no soportado. Usa JPEG, PNG o WEBP.');
  const ext = kind === 'jpeg' || kind === 'jpg' ? 'jpg' : (kind === 'png' ? 'png' : (kind === 'webp' ? 'webp' : 'jpg'));
  let buf;
  try {
    buf = Buffer.from(match[2], 'base64');
  } catch (_) {
    fail('No se pudo decodificar la imagen');
  }
  if (!buf.length) fail('Imagen vacía');
  if (buf.length > 12 * 1024 * 1024) fail('La imagen supera 12 MB');

  const slug = String(empresaSlug || 'shared').replace(/[^a-z0-9_-]/gi, '') || 'shared';
  const filename = `plano_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir = path.join(DATA_ROOT, slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buf);
  return `/api/modulos/wms/plano/${slug}/${filename}`;
}

function resolvePlano(empresaParam, filename) {
  const slug = String(empresaParam || '').replace(/[^a-z0-9_-]/gi, '');
  const file = path.basename(String(filename || ''));
  if (!slug || !file || !/\.(jpe?g|png|webp|gif)$/i.test(file)) return null;
  const full = path.resolve(path.join(DATA_ROOT, slug, file));
  const root = path.resolve(DATA_ROOT);
  if (!full.startsWith(root + path.sep)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  return null;
}

/**
 * Genera grilla de posiciones según dimensiones de bodega y posición.
 * Reserva franjas de ingreso (frente) y despacho (fondo) según mercado.
 */
function generarLayoutPropuesta({
  bodega,
  tipoAlmacenaje,
  posLargo,
  posAncho,
  posAlto,
  niveles,
  pasillo,
  parametros
}) {
  const largo = Number(bodega.largo_m) || 0;
  const ancho = Number(bodega.ancho_m) || 0;
  if (largo <= 0 || ancho <= 0) fail('La bodega debe tener largo y ancho > 0');
  if (posLargo <= 0 || posAncho <= 0 || posAlto <= 0) fail('Dimensiones de posición inválidas');

  const params = parametros || defaultParametros(bodega.mercado);
  const muelleIn = Number(params.muelle_ingreso_m) || 4;
  const muelleOut = Number(params.muelle_despacho_m) || 4;
  const pas = Math.max(Number(pasillo) || params.pasillo_min_m || 2.5, 1.5);
  const niv = Math.max(1, Math.min(12, Number(niveles) || 1));
  const tipoBase = tipoAlmacenaje === 'mixto' ? 'rack' : tipoAlmacenaje;
  const nivelesEfectivos = tipoBase === 'piso' ? 1 : niv;

  // Eje Y: ingreso (y=0) → almacén → despacho (y=largo)
  const yStoreStart = muelleIn;
  const yStoreEnd = Math.max(yStoreStart + posAncho, largo - muelleOut);
  const usableY = Math.max(0, yStoreEnd - yStoreStart);
  const usableX = ancho;

  const stepX = posLargo + pas * 0.15; // separación lateral mínima
  const stepY = posAncho + pas * 0.35; // pasillo entre filas

  const cols = Math.max(1, Math.floor((usableX + pas * 0.1) / stepX));
  const rows = Math.max(1, Math.floor((usableY + pas * 0.1) / stepY));

  const etiqueta = params.etiqueta_pos || 'POS';
  const posiciones = [];
  let seq = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let n = 1; n <= nivelesEfectivos; n++) {
        seq += 1;
        const fila = String.fromCharCode(65 + (r % 26)) + (r >= 26 ? String(Math.floor(r / 26)) : '');
        const col = String(c + 1).padStart(2, '0');
        const codigo = `${etiqueta}-${fila}${col}-N${n}`;
        const tipo =
          tipoAlmacenaje === 'mixto'
            ? (n === 1 && r % 3 === 0 ? 'piso' : 'rack')
            : tipoBase;
        posiciones.push({
          codigo,
          tipo,
          fila,
          columna: col,
          nivel: n,
          largo_m: posLargo,
          ancho_m: posAncho,
          alto_m: tipo === 'piso' ? Math.min(posAlto, bodega.alto_m || posAlto) : posAlto,
          x_m: Number((c * stepX).toFixed(2)),
          y_m: Number((yStoreStart + r * stepY).toFixed(2)),
          capacidad_kg: params.capacidad_default_kg || 1000,
          zona_tipo: 'almacen',
          estado: 'libre'
        });
      }
    }
  }

  const mercado = MERCADOS[bodega.mercado] || MERCADOS.chile;
  const zonas = [
    {
      codigo: mercado.zona_ingreso,
      nombre: 'Zona de ingreso / recepción',
      tipo: 'ingreso',
      x_m: 0,
      y_m: 0,
      largo_m: ancho,
      ancho_m: muelleIn,
      color: '#0284c7',
      orden: 1
    },
    {
      codigo: mercado.zona_almacen,
      nombre: 'Zona de almacenaje (modelo caótico)',
      tipo: 'almacen',
      x_m: 0,
      y_m: yStoreStart,
      largo_m: ancho,
      ancho_m: usableY,
      color: '#0f766e',
      orden: 2
    },
    {
      codigo: mercado.zona_despacho,
      nombre: 'Zona de despacho / embarque',
      tipo: 'despacho',
      x_m: 0,
      y_m: Math.max(0, largo - muelleOut),
      largo_m: ancho,
      ancho_m: muelleOut,
      color: '#c2410c',
      orden: 3
    },
    {
      codigo: mercado.zona_cuarentena,
      nombre: 'Cuarentena / hold',
      tipo: 'cuarentena',
      x_m: Math.max(0, ancho - Math.min(4, ancho * 0.2)),
      y_m: yStoreStart,
      largo_m: Math.min(4, ancho * 0.2),
      ancho_m: Math.min(4, usableY * 0.25),
      color: '#a16207',
      orden: 4
    }
  ];

  return {
    posiciones,
    zonas,
    meta: {
      filas: rows,
      columnas: cols,
      niveles: nivelesEfectivos,
      total: posiciones.length,
      usable_x_m: usableX,
      usable_y_m: usableY,
      pasillo_m: pas,
      modelo: 'caotico',
      advertencia:
        posiciones.length === 0
          ? 'Espacio insuficiente para generar posiciones con esas dimensiones.'
          : null
    }
  };
}

async function listBodegas(db) {
  await ensureWmsSchema(db);
  const rows = await db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM wms_posiciones p WHERE p.bodega_id = b.id AND p.eliminado = 0 AND p.activo = 1) AS total_posiciones,
      (SELECT COUNT(*) FROM wms_posiciones p WHERE p.bodega_id = b.id AND p.eliminado = 0 AND p.estado = 'libre') AS posiciones_libres,
      (SELECT COUNT(*) FROM wms_inventario i WHERE i.bodega_id = b.id AND i.cantidad > 0) AS lineas_stock
    FROM wms_bodegas b
    WHERE b.eliminado = 0
    ORDER BY b.id DESC
  `).all();
  return (rows || []).map((r) => ({
    ...r,
    parametros: parseJson(r.parametros_json, defaultParametros(r.mercado))
  }));
}

async function getBodega(db, id) {
  await ensureWmsSchema(db);
  const row = await db.prepare('SELECT * FROM wms_bodegas WHERE id = ? AND eliminado = 0').get(Number(id));
  if (!row) return null;
  const zonas = await db.prepare(
    'SELECT * FROM wms_zonas WHERE bodega_id = ? AND activo = 1 ORDER BY orden, id'
  ).all(row.id);
  const posiciones = await db.prepare(`
    SELECT p.*,
      COALESCE((SELECT SUM(i.cantidad) FROM wms_inventario i WHERE i.posicion_id = p.id), 0) AS stock_total
    FROM wms_posiciones p
    WHERE p.bodega_id = ? AND p.eliminado = 0
    ORDER BY p.codigo
  `).all(row.id);
  return {
    ...row,
    parametros: parseJson(row.parametros_json, defaultParametros(row.mercado)),
    zonas: zonas || [],
    posiciones: posiciones || []
  };
}

async function createBodega(db, { userId, empresaSlug, body }) {
  await ensureWmsSchema(db);
  const nombre = String(body.nombre || '').trim();
  if (!nombre) fail('Nombre de bodega requerido');
  const mercado = String(body.mercado || 'chile').toLowerCase();
  if (!MERCADOS[mercado]) fail('Mercado no soportado');
  const largo = Number(body.largo_m);
  const ancho = Number(body.ancho_m);
  const alto = Number(body.alto_m);
  if (!(largo > 0) || !(ancho > 0) || !(alto > 0)) fail('Indica largo, ancho y alto de la bodega (> 0)');

  const tipo = String(body.tipo_almacenaje || 'mixto').toLowerCase();
  if (!TIPOS_ALMACENAJE.includes(tipo)) fail('Tipo de almacenaje inválido (rack, piso, mixto)');

  const codigo = body.codigo ? String(body.codigo).trim().toUpperCase() : await nextCodigo(db, 'wms_bodegas', 'BOD-');
  let planoRuta = body.plano_ruta || null;
  if (body.planoDataUrl || body.dataUrl) {
    planoRuta = await savePlano(body.planoDataUrl || body.dataUrl, empresaSlug);
  }

  const params = {
    ...defaultParametros(mercado),
    ...(body.parametros && typeof body.parametros === 'object' ? body.parametros : {})
  };

  const r = await db.prepare(`
    INSERT INTO wms_bodegas
      (codigo, nombre, mercado, largo_m, ancho_m, alto_m, tipo_almacenaje, plano_ruta, parametros_json, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    codigo,
    nombre,
    mercado,
    largo,
    ancho,
    alto,
    tipo,
    planoRuta,
    JSON.stringify(params),
    userId || null
  );

  const bodegaId = r.lastInsertRowid || r.insertId;
  const m = MERCADOS[mercado];
  const zonasSeed = [
    [m.zona_ingreso, 'Zona de ingreso', 'ingreso', 0, 0, ancho, params.muelle_ingreso_m, '#0284c7', 1],
    [m.zona_almacen, 'Zona de almacenaje', 'almacen', 0, params.muelle_ingreso_m, ancho,
      Math.max(0, largo - params.muelle_ingreso_m - params.muelle_despacho_m), '#0f766e', 2],
    [m.zona_despacho, 'Zona de despacho', 'despacho', 0, Math.max(0, largo - params.muelle_despacho_m),
      ancho, params.muelle_despacho_m, '#c2410c', 3]
  ];
  for (const z of zonasSeed) {
    await db.prepare(`
      INSERT INTO wms_zonas (bodega_id, codigo, nombre, tipo, x_m, y_m, largo_m, ancho_m, color, orden)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bodegaId, ...z);
  }

  return getBodega(db, bodegaId);
}

async function updateBodega(db, id, body) {
  await ensureWmsSchema(db);
  const existing = await db.prepare('SELECT * FROM wms_bodegas WHERE id = ? AND eliminado = 0').get(Number(id));
  if (!existing) fail('Bodega no encontrada', 404);

  const nombre = body.nombre != null ? String(body.nombre).trim() : existing.nombre;
  const largo = body.largo_m != null ? Number(body.largo_m) : Number(existing.largo_m);
  const ancho = body.ancho_m != null ? Number(body.ancho_m) : Number(existing.ancho_m);
  const alto = body.alto_m != null ? Number(body.alto_m) : Number(existing.alto_m);
  const tipo = body.tipo_almacenaje != null
    ? String(body.tipo_almacenaje).toLowerCase()
    : existing.tipo_almacenaje;
  if (!TIPOS_ALMACENAJE.includes(tipo)) fail('Tipo de almacenaje inválido');

  let plano = existing.plano_ruta;
  if (body.planoDataUrl || body.dataUrl) {
    plano = await savePlano(body.planoDataUrl || body.dataUrl, body.empresaSlug || 'shared');
  } else if (body.plano_ruta !== undefined) {
    plano = body.plano_ruta;
  }

  let params = parseJson(existing.parametros_json, defaultParametros(existing.mercado));
  if (body.parametros && typeof body.parametros === 'object') {
    params = { ...params, ...body.parametros };
  }

  await db.prepare(`
    UPDATE wms_bodegas SET
      nombre = ?, largo_m = ?, ancho_m = ?, alto_m = ?, tipo_almacenaje = ?,
      plano_ruta = ?, parametros_json = ?, fecha_actualizacion = ${nowSql(db)}
    WHERE id = ?
  `).run(nombre, largo, ancho, alto, tipo, plano, JSON.stringify(params), Number(id));

  return getBodega(db, id);
}

async function crearPropuesta(db, { userId, bodegaId, body }) {
  await ensureWmsSchema(db);
  const bodega = await getBodega(db, bodegaId);
  if (!bodega) fail('Bodega no encontrada', 404);

  const tipo = String(body.tipo_almacenaje || bodega.tipo_almacenaje || 'mixto').toLowerCase();
  if (!TIPOS_ALMACENAJE.includes(tipo)) fail('¿Habrá rack, piso o mixto? Tipo inválido.');

  const posLargo = Number(body.pos_largo_m);
  const posAncho = Number(body.pos_ancho_m);
  const posAlto = Number(body.pos_alto_m);
  if (!(posLargo > 0) || !(posAncho > 0) || !(posAlto > 0)) {
    fail('Indica largo, ancho y alto de cada posición');
  }
  if (posAlto > Number(bodega.alto_m)) fail('El alto de posición no puede superar el alto de la bodega');

  const niveles = Number(body.niveles) || (tipo === 'piso' ? 1 : 3);
  const pasillo = Number(body.pasillo_m) || bodega.parametros?.pasillo_min_m || 2.5;

  const layout = generarLayoutPropuesta({
    bodega,
    tipoAlmacenaje: tipo,
    posLargo,
    posAncho,
    posAlto,
    niveles,
    pasillo,
    parametros: bodega.parametros
  });

  if (Array.isArray(body.posiciones_override) && body.posiciones_override.length) {
    layout.posiciones = body.posiciones_override;
    layout.meta.total = layout.posiciones.length;
  }

  const codigo = await nextCodigo(db, 'wms_propuestas', 'PROP-');
  const r = await db.prepare(`
    INSERT INTO wms_propuestas
      (codigo, bodega_id, tipo_almacenaje, pos_largo_m, pos_ancho_m, pos_alto_m,
       niveles, pasillo_m, layout_json, total_posiciones, estado, notas, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)
  `).run(
    codigo,
    bodega.id,
    tipo,
    posLargo,
    posAncho,
    posAlto,
    niveles,
    pasillo,
    JSON.stringify(layout),
    layout.posiciones.length,
    body.notas || null,
    userId || null
  );

  const id = r.lastInsertRowid || r.insertId;
  return getPropuesta(db, id);
}

async function getPropuesta(db, id) {
  await ensureWmsSchema(db);
  const row = await db.prepare('SELECT * FROM wms_propuestas WHERE id = ?').get(Number(id));
  if (!row) return null;
  return { ...row, layout: parseJson(row.layout_json, { posiciones: [], zonas: [], meta: {} }) };
}

async function listPropuestas(db, bodegaId) {
  await ensureWmsSchema(db);
  const rows = await db.prepare(`
    SELECT id, codigo, bodega_id, tipo_almacenaje, pos_largo_m, pos_ancho_m, pos_alto_m,
           niveles, pasillo_m, total_posiciones, estado, notas, creado_por,
           aprobado_por, fecha_creacion, fecha_aprobacion
    FROM wms_propuestas
    WHERE bodega_id = ?
    ORDER BY id DESC
  `).all(Number(bodegaId));
  return rows || [];
}

async function updatePropuestaLayout(db, id, body) {
  await ensureWmsSchema(db);
  const prop = await getPropuesta(db, id);
  if (!prop) fail('Propuesta no encontrada', 404);
  if (prop.estado === 'aprobada') fail('La propuesta ya fue aprobada; no se puede editar');

  const layout = prop.layout || { posiciones: [], zonas: [], meta: {} };
  if (Array.isArray(body.posiciones)) {
    layout.posiciones = body.posiciones.map((p, i) => ({
      codigo: String(p.codigo || `POS-${i + 1}`).toUpperCase(),
      tipo: ['rack', 'piso'].includes(p.tipo) ? p.tipo : 'piso',
      fila: p.fila || null,
      columna: p.columna || null,
      nivel: Number(p.nivel) || 1,
      largo_m: Number(p.largo_m) || Number(prop.pos_largo_m),
      ancho_m: Number(p.ancho_m) || Number(prop.pos_ancho_m),
      alto_m: Number(p.alto_m) || Number(prop.pos_alto_m),
      x_m: Number(p.x_m) || 0,
      y_m: Number(p.y_m) || 0,
      capacidad_kg: Number(p.capacidad_kg) || 1000,
      zona_tipo: p.zona_tipo || 'almacen',
      estado: 'libre'
    }));
    layout.meta = { ...(layout.meta || {}), total: layout.posiciones.length };
  }
  if (Array.isArray(body.zonas)) layout.zonas = body.zonas;

  await db.prepare(`
    UPDATE wms_propuestas SET layout_json = ?, total_posiciones = ?, notas = COALESCE(?, notas)
    WHERE id = ?
  `).run(JSON.stringify(layout), layout.posiciones.length, body.notas ?? null, Number(id));

  return getPropuesta(db, id);
}

async function aprobarPropuesta(db, id, { userId }) {
  await ensureWmsSchema(db);
  const prop = await getPropuesta(db, id);
  if (!prop) fail('Propuesta no encontrada', 404);
  if (prop.estado === 'aprobada') fail('Ya está aprobada');

  const layout = prop.layout || {};
  const posiciones = layout.posiciones || [];
  if (!posiciones.length) fail('La propuesta no tiene posiciones');

  // Reemplazar zonas
  await db.prepare('DELETE FROM wms_zonas WHERE bodega_id = ?').run(prop.bodega_id);
  const zonaIds = {};
  for (const z of layout.zonas || []) {
    const r = await db.prepare(`
      INSERT INTO wms_zonas (bodega_id, codigo, nombre, tipo, x_m, y_m, largo_m, ancho_m, color, orden)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      prop.bodega_id,
      z.codigo,
      z.nombre || z.codigo,
      z.tipo || 'almacen',
      Number(z.x_m) || 0,
      Number(z.y_m) || 0,
      Number(z.largo_m) || 0,
      Number(z.ancho_m) || 0,
      z.color || '#64748b',
      Number(z.orden) || 0
    );
    zonaIds[z.tipo || z.codigo] = r.lastInsertRowid || r.insertId;
  }

  // Soft-delete posiciones anteriores sin stock
  const prev = await db.prepare(
    'SELECT id FROM wms_posiciones WHERE bodega_id = ? AND eliminado = 0'
  ).all(prop.bodega_id);
  for (const p of prev || []) {
    const stock = await db.prepare(
      'SELECT COALESCE(SUM(cantidad),0) AS t FROM wms_inventario WHERE posicion_id = ?'
    ).get(p.id);
    if (Number(stock?.t || 0) <= 0) {
      await db.prepare('UPDATE wms_posiciones SET eliminado = 1, activo = 0 WHERE id = ?').run(p.id);
    }
  }

  const created = [];
  for (const p of posiciones) {
    const zonaId = zonaIds[p.zona_tipo] || zonaIds.almacen || null;
    const token = qrToken();
    try {
      const r = await db.prepare(`
        INSERT INTO wms_posiciones
          (bodega_id, zona_id, codigo, qr_token, tipo, fila, columna, nivel,
           largo_m, ancho_m, alto_m, x_m, y_m, capacidad_kg, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'libre')
      `).run(
        prop.bodega_id,
        zonaId,
        String(p.codigo).toUpperCase(),
        token,
        p.tipo || 'piso',
        p.fila || null,
        p.columna || null,
        Number(p.nivel) || 1,
        Number(p.largo_m),
        Number(p.ancho_m),
        Number(p.alto_m),
        Number(p.x_m) || 0,
        Number(p.y_m) || 0,
        Number(p.capacidad_kg) || 1000
      );
      created.push({ id: r.lastInsertRowid || r.insertId, codigo: p.codigo, qr_token: token });
    } catch (err) {
      // Si código duplicado (posición con stock conservada), omitir
      if (!/unique|duplicate/i.test(String(err.message || ''))) throw err;
    }
  }

  await db.prepare(`
    UPDATE wms_propuestas SET estado = 'aprobada', aprobado_por = ?, fecha_aprobacion = ${nowSql(db)}
    WHERE id = ?
  `).run(userId || null, Number(id));

  await db.prepare(`
    UPDATE wms_bodegas SET tipo_almacenaje = ?, fecha_actualizacion = ${nowSql(db)} WHERE id = ?
  `).run(prop.tipo_almacenaje, prop.bodega_id);

  return {
    propuesta: await getPropuesta(db, id),
    creadas: created.length,
    posiciones: created
  };
}

async function findPosicion(db, { bodegaId, codigo, qrToken: token, id }) {
  await ensureWmsSchema(db);
  if (id) {
    return db.prepare(
      'SELECT * FROM wms_posiciones WHERE id = ? AND eliminado = 0'
    ).get(Number(id));
  }
  if (token) {
    return db.prepare(
      'SELECT * FROM wms_posiciones WHERE qr_token = ? AND eliminado = 0'
    ).get(String(token).trim());
  }
  if (codigo && bodegaId) {
    return db.prepare(
      'SELECT * FROM wms_posiciones WHERE bodega_id = ? AND codigo = ? AND eliminado = 0'
    ).get(Number(bodegaId), String(codigo).trim().toUpperCase());
  }
  return null;
}

async function sugerirPosicionLibre(db, bodegaId) {
  await ensureWmsSchema(db);
  // Caótico: cualquier libre; prioriza menos ocupación y luego aleatorio suave por id
  const row = await db.prepare(`
    SELECT p.* FROM wms_posiciones p
    LEFT JOIN (
      SELECT posicion_id, SUM(cantidad) AS qty FROM wms_inventario GROUP BY posicion_id
    ) i ON i.posicion_id = p.id
    WHERE p.bodega_id = ? AND p.eliminado = 0 AND p.activo = 1
      AND p.estado IN ('libre', 'ocupada')
    ORDER BY COALESCE(i.qty, 0) ASC, p.id ASC
    LIMIT 1
  `).get(Number(bodegaId));
  return row || null;
}

async function listInventario(db, { bodegaId, q, posicionId } = {}) {
  await ensureWmsSchema(db);
  let sql = `
    SELECT i.*, p.codigo AS posicion_codigo, p.tipo AS posicion_tipo, p.qr_token
    FROM wms_inventario i
    JOIN wms_posiciones p ON p.id = i.posicion_id
    WHERE i.cantidad > 0 AND i.bodega_id = ?
  `;
  const args = [Number(bodegaId)];
  if (posicionId) {
    sql += ' AND i.posicion_id = ?';
    args.push(Number(posicionId));
  }
  if (q) {
    sql += ' AND (i.material_codigo LIKE ? OR i.material_nombre LIKE ? OR p.codigo LIKE ? OR i.lote LIKE ?)';
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  sql += ' ORDER BY i.material_codigo, p.codigo';
  return (await db.prepare(sql).all(...args)) || [];
}

async function listMovimientos(db, { bodegaId, limit = 80 } = {}) {
  await ensureWmsSchema(db);
  return (await db.prepare(`
    SELECT * FROM wms_movimientos
    WHERE bodega_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(Number(bodegaId), Number(limit) || 80)) || [];
}

async function refreshPosicionEstado(db, posicionId) {
  const stock = await db.prepare(
    'SELECT COALESCE(SUM(cantidad),0) AS t FROM wms_inventario WHERE posicion_id = ?'
  ).get(posicionId);
  const estado = Number(stock?.t || 0) > 0 ? 'ocupada' : 'libre';
  await db.prepare('UPDATE wms_posiciones SET estado = ? WHERE id = ?').run(estado, posicionId);
}

async function ingresoMaterial(db, { userId, body }) {
  await ensureWmsSchema(db);
  const bodegaId = Number(body.bodega_id);
  if (!bodegaId) fail('bodega_id requerido');
  const matCod = String(body.material_codigo || '').trim().toUpperCase();
  if (!matCod) fail('Código de material requerido');
  const cantidad = Number(body.cantidad);
  if (!(cantidad > 0)) fail('Cantidad debe ser > 0');

  let pos = null;
  if (body.posicion_id || body.posicion_codigo || body.qr_token) {
    pos = await findPosicion(db, {
      bodegaId,
      id: body.posicion_id,
      codigo: body.posicion_codigo,
      qrToken: body.qr_token
    });
    if (!pos) fail('Posición no encontrada. Escanea QR o escribe el código.', 404);
    if (Number(pos.bodega_id) !== bodegaId) fail('La posición no pertenece a esta bodega');
    if (pos.estado === 'bloqueada') fail('Posición bloqueada');
  } else {
    pos = await sugerirPosicionLibre(db, bodegaId);
    if (!pos) fail('No hay posiciones libres. Aprueba un layout primero.');
  }

  const lote = body.lote != null ? String(body.lote).trim() : '';
  const unidad = String(body.unidad || 'UN').trim() || 'UN';
  const nombre = body.material_nombre ? String(body.material_nombre).trim() : null;

  const existing = await db.prepare(`
    SELECT * FROM wms_inventario
    WHERE posicion_id = ? AND material_codigo = ? AND COALESCE(lote,'') = ?
  `).get(pos.id, matCod, lote);

  if (existing) {
    await db.prepare(`
      UPDATE wms_inventario SET cantidad = cantidad + ?, material_nombre = COALESCE(?, material_nombre),
        actualizado = ${nowSql(db)}
      WHERE id = ?
    `).run(cantidad, nombre, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO wms_inventario
        (bodega_id, posicion_id, material_codigo, material_nombre, lote, cantidad, unidad, fecha_ingreso, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${nowSql(db)}, ?)
    `).run(
      bodegaId,
      pos.id,
      matCod,
      nombre,
      lote || null,
      cantidad,
      unidad,
      body.observaciones || null
    );
  }

  await refreshPosicionEstado(db, pos.id);
  const movCod = await nextCodigo(db, 'wms_movimientos', 'MOV-');
  await db.prepare(`
    INSERT INTO wms_movimientos
      (codigo, bodega_id, tipo, material_codigo, material_nombre, lote, cantidad, unidad,
       posicion_id, posicion_codigo, modo_captura, documento_ref, usuario_id, observaciones)
    VALUES (?, ?, 'ingreso', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movCod,
    bodegaId,
    matCod,
    nombre,
    lote || null,
    cantidad,
    unidad,
    pos.id,
    pos.codigo,
    body.modo_captura || (body.qr_token ? 'qr' : 'manual'),
    body.documento_ref || null,
    userId || null,
    body.observaciones || null
  );

  return {
    movimiento: movCod,
    posicion: { id: pos.id, codigo: pos.codigo, qr_token: pos.qr_token },
    material_codigo: matCod,
    cantidad,
    mensaje: `Ingreso en ${pos.codigo} (modelo caótico)`
  };
}

async function salidaMaterial(db, { userId, body }) {
  await ensureWmsSchema(db);
  const bodegaId = Number(body.bodega_id);
  if (!bodegaId) fail('bodega_id requerido');
  const matCod = String(body.material_codigo || '').trim().toUpperCase();
  if (!matCod) fail('Código de material requerido');
  const cantidad = Number(body.cantidad);
  if (!(cantidad > 0)) fail('Cantidad debe ser > 0');

  let pos = null;
  if (body.posicion_id || body.posicion_codigo || body.qr_token) {
    pos = await findPosicion(db, {
      bodegaId,
      id: body.posicion_id,
      codigo: body.posicion_codigo,
      qrToken: body.qr_token
    });
    if (!pos) fail('Posición no encontrada', 404);
  }

  // Buscar stock: si no hay posición, toma la primera ubicación del SKU (caótico)
  let inv;
  if (pos) {
    inv = await db.prepare(`
      SELECT * FROM wms_inventario
      WHERE bodega_id = ? AND posicion_id = ? AND material_codigo = ? AND cantidad > 0
      ORDER BY id ASC LIMIT 1
    `).get(bodegaId, pos.id, matCod);
  } else {
    inv = await db.prepare(`
      SELECT * FROM wms_inventario
      WHERE bodega_id = ? AND material_codigo = ? AND cantidad > 0
      ORDER BY fecha_ingreso ASC, id ASC LIMIT 1
    `).get(bodegaId, matCod);
  }
  if (!inv) fail('No hay stock de ese material' + (pos ? ` en ${pos.codigo}` : ''), 404);
  if (Number(inv.cantidad) < cantidad) {
    fail(`Stock insuficiente en posición (disponible: ${inv.cantidad})`);
  }

  const nueva = Number(inv.cantidad) - cantidad;
  if (nueva <= 0) {
    await db.prepare('DELETE FROM wms_inventario WHERE id = ?').run(inv.id);
  } else {
    await db.prepare(`UPDATE wms_inventario SET cantidad = ?, actualizado = ${nowSql(db)} WHERE id = ?`)
      .run(nueva, inv.id);
  }

  const posRow = await findPosicion(db, { id: inv.posicion_id });
  await refreshPosicionEstado(db, inv.posicion_id);

  const movCod = await nextCodigo(db, 'wms_movimientos', 'MOV-');
  await db.prepare(`
    INSERT INTO wms_movimientos
      (codigo, bodega_id, tipo, material_codigo, material_nombre, lote, cantidad, unidad,
       posicion_id, posicion_codigo, modo_captura, documento_ref, usuario_id, observaciones)
    VALUES (?, ?, 'salida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movCod,
    bodegaId,
    matCod,
    inv.material_nombre,
    inv.lote,
    cantidad,
    inv.unidad || 'UN',
    inv.posicion_id,
    posRow?.codigo || null,
    body.modo_captura || (body.qr_token ? 'qr' : 'manual'),
    body.documento_ref || null,
    userId || null,
    body.observaciones || null
  );

  return {
    movimiento: movCod,
    posicion: posRow ? { id: posRow.id, codigo: posRow.codigo, qr_token: posRow.qr_token } : null,
    material_codigo: matCod,
    cantidad,
    mensaje: `Salida desde ${posRow?.codigo || 'posición'}`
  };
}

async function buscarMaterialUbicaciones(db, { bodegaId, materialCodigo }) {
  await ensureWmsSchema(db);
  const cod = String(materialCodigo || '').trim().toUpperCase();
  if (!cod) fail('material_codigo requerido');
  return (await db.prepare(`
    SELECT i.*, p.codigo AS posicion_codigo, p.qr_token, p.tipo AS posicion_tipo, p.fila, p.columna, p.nivel
    FROM wms_inventario i
    JOIN wms_posiciones p ON p.id = i.posicion_id
    WHERE i.bodega_id = ? AND i.material_codigo = ? AND i.cantidad > 0
    ORDER BY i.fecha_ingreso ASC, p.codigo
  `).all(Number(bodegaId), cod)) || [];
}

/**
 * Traslado interno (modelo caótico): mueve stock de una posición a otra.
 */
async function trasladoMaterial(db, { userId, body }) {
  await ensureWmsSchema(db);
  const bodegaId = Number(body.bodega_id);
  if (!bodegaId) fail('bodega_id requerido');
  const matCod = String(body.material_codigo || '').trim().toUpperCase();
  if (!matCod) fail('Código de material requerido');
  const cantidad = Number(body.cantidad);
  if (!(cantidad > 0)) fail('Cantidad debe ser > 0');

  const origen = await findPosicion(db, {
    bodegaId,
    id: body.posicion_origen_id,
    codigo: body.posicion_origen_codigo || body.posicion_codigo,
    qrToken: body.qr_origen || body.qr_token
  });
  if (!origen) fail('Posición origen no encontrada', 404);
  if (Number(origen.bodega_id) !== bodegaId) fail('Origen no pertenece a la bodega');

  let destino = await findPosicion(db, {
    bodegaId,
    id: body.posicion_destino_id,
    codigo: body.posicion_destino_codigo,
    qrToken: body.qr_destino
  });
  if (!destino && body.sugerir_destino) {
    destino = await sugerirPosicionLibre(db, bodegaId);
  }
  if (!destino) fail('Posición destino requerida (QR, código o sugerir)');
  if (Number(destino.bodega_id) !== bodegaId) fail('Destino no pertenece a la bodega');
  if (destino.estado === 'bloqueada') fail('Posición destino bloqueada');
  if (Number(origen.id) === Number(destino.id)) fail('Origen y destino son la misma posición');

  const lote = body.lote != null ? String(body.lote).trim() : '';
  let inv;
  if (lote) {
    inv = await db.prepare(`
      SELECT * FROM wms_inventario
      WHERE bodega_id = ? AND posicion_id = ? AND material_codigo = ? AND COALESCE(lote,'') = ? AND cantidad > 0
      LIMIT 1
    `).get(bodegaId, origen.id, matCod, lote);
  } else {
    inv = await db.prepare(`
      SELECT * FROM wms_inventario
      WHERE bodega_id = ? AND posicion_id = ? AND material_codigo = ? AND cantidad > 0
      ORDER BY id ASC LIMIT 1
    `).get(bodegaId, origen.id, matCod);
  }
  if (!inv) fail(`No hay stock de ${matCod} en ${origen.codigo}`, 404);
  if (Number(inv.cantidad) < cantidad) fail(`Stock insuficiente (disponible: ${inv.cantidad})`);

  const nuevaOrigen = Number(inv.cantidad) - cantidad;
  if (nuevaOrigen <= 0) {
    await db.prepare('DELETE FROM wms_inventario WHERE id = ?').run(inv.id);
  } else {
    await db.prepare(`UPDATE wms_inventario SET cantidad = ?, actualizado = ${nowSql(db)} WHERE id = ?`)
      .run(nuevaOrigen, inv.id);
  }

  const loteVal = inv.lote || null;
  const destInv = await db.prepare(`
    SELECT * FROM wms_inventario
    WHERE posicion_id = ? AND material_codigo = ? AND COALESCE(lote,'') = ?
  `).get(destino.id, matCod, loteVal || '');

  if (destInv) {
    await db.prepare(`
      UPDATE wms_inventario SET cantidad = cantidad + ?, actualizado = ${nowSql(db)} WHERE id = ?
    `).run(cantidad, destInv.id);
  } else {
    await db.prepare(`
      INSERT INTO wms_inventario
        (bodega_id, posicion_id, material_codigo, material_nombre, lote, cantidad, unidad, fecha_ingreso, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${nowSql(db)}, ?)
    `).run(
      bodegaId,
      destino.id,
      matCod,
      inv.material_nombre,
      loteVal,
      cantidad,
      inv.unidad || 'UN',
      body.observaciones || `Traslado desde ${origen.codigo}`
    );
  }

  await refreshPosicionEstado(db, origen.id);
  await refreshPosicionEstado(db, destino.id);

  const movCod = await nextCodigo(db, 'wms_movimientos', 'MOV-');
  await db.prepare(`
    INSERT INTO wms_movimientos
      (codigo, bodega_id, tipo, material_codigo, material_nombre, lote, cantidad, unidad,
       posicion_id, posicion_codigo, posicion_destino_id, modo_captura, documento_ref, usuario_id, observaciones)
    VALUES (?, ?, 'traslado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movCod,
    bodegaId,
    matCod,
    inv.material_nombre,
    loteVal,
    cantidad,
    inv.unidad || 'UN',
    origen.id,
    origen.codigo,
    destino.id,
    body.modo_captura || 'manual',
    body.documento_ref || null,
    userId || null,
    body.observaciones || `${origen.codigo} → ${destino.codigo}`
  );

  return {
    movimiento: movCod,
    origen: { id: origen.id, codigo: origen.codigo },
    destino: { id: destino.id, codigo: destino.codigo, qr_token: destino.qr_token },
    material_codigo: matCod,
    cantidad,
    mensaje: `Traslado ${origen.codigo} → ${destino.codigo}`
  };
}

async function setPosicionEstado(db, { bodegaId, posicionId, codigo, qrToken, estado }) {
  await ensureWmsSchema(db);
  const est = String(estado || '').toLowerCase();
  if (!['libre', 'ocupada', 'bloqueada', 'reserva'].includes(est)) {
    fail('Estado inválido (libre, ocupada, bloqueada, reserva)');
  }
  const pos = await findPosicion(db, { bodegaId, id: posicionId, codigo, qrToken });
  if (!pos) fail('Posición no encontrada', 404);
  if (Number(pos.bodega_id) !== Number(bodegaId)) fail('Posición de otra bodega');

  if (est === 'libre' || est === 'ocupada') {
    // Recalcular según stock real
    await refreshPosicionEstado(db, pos.id);
    const updated = await findPosicion(db, { id: pos.id });
    return updated;
  }

  await db.prepare('UPDATE wms_posiciones SET estado = ? WHERE id = ?').run(est, pos.id);
  return findPosicion(db, { id: pos.id });
}

async function getBodegaKpis(db, bodegaId) {
  await ensureWmsSchema(db);
  const id = Number(bodegaId);
  const tot = await db.prepare(`
    SELECT COUNT(*) AS c FROM wms_posiciones WHERE bodega_id = ? AND eliminado = 0 AND activo = 1
  `).get(id);
  const libres = await db.prepare(`
    SELECT COUNT(*) AS c FROM wms_posiciones
    WHERE bodega_id = ? AND eliminado = 0 AND activo = 1 AND estado = 'libre'
  `).get(id);
  const ocupadas = await db.prepare(`
    SELECT COUNT(*) AS c FROM wms_posiciones
    WHERE bodega_id = ? AND eliminado = 0 AND activo = 1 AND estado = 'ocupada'
  `).get(id);
  const bloqueadas = await db.prepare(`
    SELECT COUNT(*) AS c FROM wms_posiciones
    WHERE bodega_id = ? AND eliminado = 0 AND activo = 1 AND estado = 'bloqueada'
  `).get(id);
  const skus = await db.prepare(`
    SELECT COUNT(DISTINCT material_codigo) AS c FROM wms_inventario WHERE bodega_id = ? AND cantidad > 0
  `).get(id);
  const qty = await db.prepare(`
    SELECT COALESCE(SUM(cantidad),0) AS c FROM wms_inventario WHERE bodega_id = ? AND cantidad > 0
  `).get(id);
  const movHoy = await db.prepare(`
    SELECT COUNT(*) AS c FROM wms_movimientos
    WHERE bodega_id = ? AND fecha_creacion >= ${db.driver === 'mysql' ? 'CURDATE()' : "date('now')"}
  `).get(id);
  const salPend = await db.prepare(`
    SELECT COUNT(*) AS c FROM wms_salidas WHERE bodega_id = ? AND estado IN ('borrador','parcial')
  `).get(id);

  const total = Number(tot?.c || 0);
  const libresN = Number(libres?.c || 0);
  const ocupadasN = Number(ocupadas?.c || 0);
  return {
    total_posiciones: total,
    libres: libresN,
    ocupadas: ocupadasN,
    bloqueadas: Number(bloqueadas?.c || 0),
    ocupacion_pct: total ? Math.round((ocupadasN / total) * 1000) / 10 : 0,
    skus_distintos: Number(skus?.c || 0),
    unidades_stock: Number(qty?.c || 0),
    movimientos_hoy: Number(movHoy?.c || 0),
    salidas_pendientes: Number(salPend?.c || 0)
  };
}

/* ---- Documentos de salida WMS ---- */

async function listSolicitudesPendientesDespacho(db, { q, limit = 50 } = {}) {
  await ensureWmsSchema(db);
  // Estados 2 Asignar Bodeguero / 3 En Entrega
  let sql = `
    SELECT s.id, s.codigo, s.estado_id, s.bodega_nombre, s.bodega_id, s.numero_proyecto,
           s.quien_retira, s.despacho_conductor, s.despacho_rut, s.despacho_patente,
           s.despacho_direccion, s.fecha_solicitud, s.observaciones,
           e.nombre AS estado_nombre,
           (SELECT COUNT(*) FROM solicitudes_detalle d WHERE d.solicitud_id = s.id) AS n_lineas
    FROM solicitudes_materiales s
    LEFT JOIN estados_solicitud e ON e.id = s.estado_id
    WHERE COALESCE(s.eliminado, 0) = 0
      AND s.estado_id IN (2, 3)
  `;
  const args = [];
  if (q) {
    sql += ` AND (s.codigo LIKE ? OR COALESCE(s.numero_proyecto,'') LIKE ? OR COALESCE(s.bodega_nombre,'') LIKE ?)`;
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  sql += ` ORDER BY s.id DESC LIMIT ?`;
  args.push(Number(limit) || 50);
  try {
    return (await db.prepare(sql).all(...args)) || [];
  } catch (_) {
    return [];
  }
}

async function getSalida(db, id) {
  await ensureWmsSchema(db);
  const row = await db.prepare('SELECT * FROM wms_salidas WHERE id = ?').get(Number(id));
  if (!row) return null;
  const detalle = await db.prepare(`
    SELECT * FROM wms_salidas_detalle WHERE salida_id = ? ORDER BY id
  `).all(row.id);
  const movimientos = await db.prepare(`
    SELECT * FROM wms_movimientos WHERE documento_ref = ? ORDER BY id
  `).all(row.codigo);
  return { ...row, detalle: detalle || [], movimientos: movimientos || [] };
}

async function listSalidas(db, { bodegaId, estado, limit = 80 } = {}) {
  await ensureWmsSchema(db);
  let sql = `
    SELECT s.*,
      (SELECT COUNT(*) FROM wms_salidas_detalle d WHERE d.salida_id = s.id) AS n_lineas,
      (SELECT COALESCE(SUM(d.cantidad_despachada),0) FROM wms_salidas_detalle d WHERE d.salida_id = s.id) AS total_despachado
    FROM wms_salidas s
    WHERE 1=1
  `;
  const args = [];
  if (bodegaId) {
    sql += ' AND s.bodega_id = ?';
    args.push(Number(bodegaId));
  }
  if (estado) {
    sql += ' AND s.estado = ?';
    args.push(String(estado));
  }
  sql += ' ORDER BY s.id DESC LIMIT ?';
  args.push(Number(limit) || 80);
  return (await db.prepare(sql).all(...args)) || [];
}

async function createSalidaManual(db, { userId, body }) {
  await ensureWmsSchema(db);
  const bodegaId = Number(body.bodega_id);
  if (!bodegaId) fail('bodega_id requerido');
  const bod = await db.prepare('SELECT id FROM wms_bodegas WHERE id = ? AND eliminado = 0').get(bodegaId);
  if (!bod) fail('Bodega WMS no encontrada', 404);

  const lineas = Array.isArray(body.lineas) ? body.lineas : [];
  if (!lineas.length) fail('Agrega al menos una línea de material');

  const codigo = await nextCodigo(db, 'wms_salidas', 'SAL-');
  const r = await db.prepare(`
    INSERT INTO wms_salidas
      (codigo, bodega_id, solicitud_id, solicitud_codigo, estado, origen,
       quien_retira, despacho_conductor, despacho_rut, despacho_patente, despacho_direccion,
       documento_ref, observaciones, creado_por)
    VALUES (?, ?, NULL, NULL, 'borrador', 'manual', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    codigo,
    bodegaId,
    body.quien_retira || null,
    body.despacho_conductor || null,
    body.despacho_rut || null,
    body.despacho_patente || null,
    body.despacho_direccion || null,
    body.documento_ref || null,
    body.observaciones || null,
    userId || null
  );
  const salidaId = r.lastInsertRowid || r.insertId;

  for (const ln of lineas) {
    const mat = String(ln.material_codigo || '').trim().toUpperCase();
    const cant = Number(ln.cantidad);
    if (!mat || !(cant > 0)) continue;
    await db.prepare(`
      INSERT INTO wms_salidas_detalle
        (salida_id, material_codigo, material_nombre, cantidad_solicitada, unidad,
         posicion_codigo, lote, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      salidaId,
      mat,
      ln.material_nombre || null,
      cant,
      ln.unidad || 'UN',
      ln.posicion_codigo || null,
      ln.lote || null,
      ln.observaciones || null
    );
  }

  return getSalida(db, salidaId);
}

async function createSalidaFromSolicitud(db, { userId, body }) {
  await ensureWmsSchema(db);
  const bodegaId = Number(body.bodega_id);
  const solicitudId = Number(body.solicitud_id);
  if (!bodegaId || !solicitudId) fail('bodega_id y solicitud_id requeridos');

  const bod = await db.prepare('SELECT id FROM wms_bodegas WHERE id = ? AND eliminado = 0').get(bodegaId);
  if (!bod) fail('Bodega WMS no encontrada', 404);

  const sol = await db.prepare(`
    SELECT * FROM solicitudes_materiales WHERE id = ? AND COALESCE(eliminado, 0) = 0
  `).get(solicitudId);
  if (!sol) fail('Solicitud no encontrada', 404);
  if (![2, 3].includes(Number(sol.estado_id))) {
    fail('La solicitud debe estar en Asignar Bodeguero o En Entrega');
  }

  const existente = await db.prepare(`
    SELECT id, codigo, estado FROM wms_salidas
    WHERE solicitud_id = ? AND estado IN ('borrador','parcial')
    ORDER BY id DESC LIMIT 1
  `).get(solicitudId);
  if (existente) {
    return getSalida(db, existente.id);
  }

  let detalle = [];
  try {
    detalle = await db.prepare(`
      SELECT d.*, m.codigo AS material_codigo, m.nombre AS material_nombre, m.unidad AS mat_unidad
      FROM solicitudes_detalle d
      JOIN materiales m ON m.id = d.material_id
      WHERE d.solicitud_id = ?
    `).all(solicitudId);
  } catch (_) {
    detalle = await db.prepare(`
      SELECT d.*, m.codigo AS material_codigo, m.nombre AS material_nombre
      FROM solicitudes_detalle d
      JOIN materiales m ON m.id = d.material_id
      WHERE d.solicitud_id = ?
    `).all(solicitudId);
  }
  if (!detalle.length) fail('La solicitud no tiene líneas');

  const codigo = await nextCodigo(db, 'wms_salidas', 'SAL-');
  const r = await db.prepare(`
    INSERT INTO wms_salidas
      (codigo, bodega_id, solicitud_id, solicitud_codigo, estado, origen,
       quien_retira, despacho_conductor, despacho_rut, despacho_patente, despacho_direccion,
       documento_ref, observaciones, creado_por)
    VALUES (?, ?, ?, ?, 'borrador', 'solicitud', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    codigo,
    bodegaId,
    solicitudId,
    sol.codigo,
    sol.quien_retira || null,
    sol.despacho_conductor || null,
    sol.despacho_rut || null,
    sol.despacho_patente || null,
    sol.despacho_direccion || null,
    sol.codigo,
    body.observaciones || sol.observaciones || null,
    userId || null
  );
  const salidaId = r.lastInsertRowid || r.insertId;

  for (const d of detalle) {
    const pedida = Number(d.cantidad) || 0;
    const entregada = Number(d.cantidad_entregada) || 0;
    const pendiente = Math.max(0, pedida - entregada);
    if (pendiente <= 0) continue;
    await db.prepare(`
      INSERT INTO wms_salidas_detalle
        (salida_id, solicitud_detalle_id, material_codigo, material_nombre,
         cantidad_solicitada, unidad, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      salidaId,
      d.id,
      String(d.material_codigo || '').toUpperCase(),
      d.material_nombre || null,
      pendiente,
      d.unidad || d.mat_unidad || 'UN',
      d.observaciones || null
    );
  }

  const sal = await getSalida(db, salidaId);
  if (!sal.detalle.length) fail('No hay cantidades pendientes por despachar en la solicitud');
  return sal;
}

/**
 * Despacha líneas: descuenta inventario caótico (split multi-posición) y confirma salida.
 * Si viene de solicitud, actualiza cantidad_entregada y pasa a estado 5.
 */
async function confirmarSalida(db, { userId, salidaId, body = {} }) {
  await ensureWmsSchema(db);
  const sal = await getSalida(db, salidaId);
  if (!sal) fail('Salida no encontrada', 404);
  if (sal.estado === 'confirmada') fail('La salida ya está confirmada');
  if (sal.estado === 'anulada') fail('La salida está anulada');

  const overrides = Array.isArray(body.lineas) ? body.lineas : [];
  const overrideById = new Map(overrides.map((o) => [Number(o.id), o]));

  const picks = [];
  const errores = [];

  for (const ln of sal.detalle) {
    if (ln.estado === 'despachado') continue;
    const ov = overrideById.get(Number(ln.id)) || {};
    const qtyWant = ov.cantidad != null ? Number(ov.cantidad) : Number(ln.cantidad_solicitada) - Number(ln.cantidad_despachada || 0);
    if (!(qtyWant > 0)) continue;

    const mat = String(ln.material_codigo).toUpperCase();
    let remaining = qtyWant;
    const prevDesp = Number(ln.cantidad_despachada) || 0;
    let despachadaLinea = prevDesp;
    let usedForced = false;

    // Posición forzada (QR/manual) o auto FIFO caótico
    const forcedCodigo = ov.posicion_codigo || ln.posicion_codigo || null;
    const forcedQr = ov.qr_token || null;

    while (remaining > 0.0001) {
      let pos = null;
      let inv = null;

      if (!usedForced && (forcedCodigo || forcedQr)) {
        usedForced = true;
        pos = await findPosicion(db, {
          bodegaId: sal.bodega_id,
          codigo: forcedCodigo,
          qrToken: forcedQr
        });
        if (!pos) {
          errores.push(`${mat}: posición ${forcedCodigo || forcedQr} no encontrada`);
          break;
        }
        inv = await db.prepare(`
          SELECT * FROM wms_inventario
          WHERE bodega_id = ? AND posicion_id = ? AND material_codigo = ? AND cantidad > 0
          ORDER BY id ASC LIMIT 1
        `).get(sal.bodega_id, pos.id, mat);
      } else {
        inv = await db.prepare(`
          SELECT i.*, p.codigo AS posicion_codigo, p.qr_token, p.estado AS pos_estado
          FROM wms_inventario i
          JOIN wms_posiciones p ON p.id = i.posicion_id
          WHERE i.bodega_id = ? AND i.material_codigo = ? AND i.cantidad > 0
            AND p.eliminado = 0 AND p.activo = 1 AND p.estado != 'bloqueada'
          ORDER BY i.fecha_ingreso ASC, i.id ASC
          LIMIT 1
        `).get(sal.bodega_id, mat);
        if (inv) {
          pos = { id: inv.posicion_id, codigo: inv.posicion_codigo, qr_token: inv.qr_token };
        }
      }

      if (!inv || !pos) {
        errores.push(`${mat}: stock insuficiente (faltan ${remaining})`);
        break;
      }

      const take = Math.min(remaining, Number(inv.cantidad));
      const mov = await salidaMaterial(db, {
        userId,
        body: {
          bodega_id: sal.bodega_id,
          material_codigo: mat,
          cantidad: take,
          posicion_id: pos.id,
          documento_ref: sal.codigo,
          modo_captura: forcedQr ? 'qr' : (forcedCodigo ? 'manual' : 'auto'),
          observaciones: `Salida ${sal.codigo}` + (sal.solicitud_codigo ? ` / ${sal.solicitud_codigo}` : '')
        }
      });

      picks.push({
        linea_id: ln.id,
        material_codigo: mat,
        cantidad: take,
        posicion: mov.posicion,
        movimiento: mov.movimiento
      });

      remaining -= take;
      despachadaLinea += take;
    }

    const estadoLn = remaining <= 0.0001
      ? 'despachado'
      : (despachadaLinea > prevDesp ? 'parcial' : 'pendiente');
    await db.prepare(`
      UPDATE wms_salidas_detalle
      SET cantidad_despachada = ?, estado = ?,
          posicion_codigo = COALESCE(?, posicion_codigo)
      WHERE id = ?
    `).run(
      despachadaLinea,
      estadoLn,
      picks.filter((p) => p.linea_id === ln.id).slice(-1)[0]?.posicion?.codigo || null,
      ln.id
    );

    // Actualizar solicitud_detalle si aplica
    const delta = despachadaLinea - prevDesp;
    if (ln.solicitud_detalle_id && delta > 0) {
      try {
        await db.prepare(`
          UPDATE solicitudes_detalle
          SET cantidad_entregada = COALESCE(cantidad_entregada, 0) + ?
          WHERE id = ?
        `).run(delta, ln.solicitud_detalle_id);
      } catch (_) { /* columna puede faltar */ }
    }
  }

  const updated = await getSalida(db, salidaId);
  const allDone = (updated.detalle || []).every((d) => d.estado === 'despachado');
  const anyDone = (updated.detalle || []).some((d) => Number(d.cantidad_despachada) > 0);
  const nuevoEstado = allDone ? 'confirmada' : (anyDone ? 'parcial' : 'borrador');

  await db.prepare(`
    UPDATE wms_salidas SET
      estado = ?,
      confirmado_por = CASE WHEN ? = 'confirmada' THEN ? ELSE confirmado_por END,
      fecha_confirmacion = CASE WHEN ? = 'confirmada' THEN ${nowSql(db)} ELSE fecha_confirmacion END,
      quien_retira = COALESCE(?, quien_retira),
      despacho_conductor = COALESCE(?, despacho_conductor),
      despacho_rut = COALESCE(?, despacho_rut),
      despacho_patente = COALESCE(?, despacho_patente),
      despacho_direccion = COALESCE(?, despacho_direccion),
      observaciones = COALESCE(?, observaciones)
    WHERE id = ?
  `).run(
    nuevoEstado,
    nuevoEstado,
    userId || null,
    nuevoEstado,
    body.quien_retira ?? null,
    body.despacho_conductor ?? null,
    body.despacho_rut ?? null,
    body.despacho_patente ?? null,
    body.despacho_direccion ?? null,
    body.observaciones ?? null,
    Number(salidaId)
  );

  // Si confirmada y viene de solicitud → Guías pendientes (5)
  if (nuevoEstado === 'confirmada' && sal.solicitud_id) {
    try {
      try {
        await db.prepare(`
          UPDATE solicitudes_materiales
          SET estado_id = 5, fecha_entrega = ${nowSql(db)}, fecha_actualizacion = ${nowSql(db)}
          WHERE id = ? AND estado_id IN (2, 3)
        `).run(sal.solicitud_id);
      } catch (_) {
        await db.prepare(`
          UPDATE solicitudes_materiales SET estado_id = 5 WHERE id = ? AND estado_id IN (2, 3)
        `).run(sal.solicitud_id);
      }
      try {
        await db.prepare(`
          INSERT INTO historial_solicitudes (solicitud_id, estado_id, usuario_id, accion, comentarios)
          VALUES (?, 5, ?, 'Despacho WMS', ?)
        `).run(
          sal.solicitud_id,
          userId || null,
          `Salida ${sal.codigo} confirmada · ${picks.length} pick(s)`
        );
      } catch (_) { /* historial opcional */ }
    } catch (_) { /* no bloquear salida */ }
  }

  const final = await getSalida(db, salidaId);
  return {
    salida: final,
    picks,
    errores,
    mensaje: nuevoEstado === 'confirmada'
      ? `Salida ${sal.codigo} confirmada (${picks.length} picks)`
      : (errores.length
        ? `Salida parcial con alertas: ${errores.join('; ')}`
        : `Salida ${sal.codigo} en estado ${nuevoEstado}`)
  };
}

async function anularSalida(db, { salidaId, userId }) {
  await ensureWmsSchema(db);
  const sal = await getSalida(db, salidaId);
  if (!sal) fail('Salida no encontrada', 404);
  if (sal.estado === 'confirmada') fail('No se puede anular una salida ya confirmada (haga ajuste/ingreso)');
  await db.prepare(`UPDATE wms_salidas SET estado = 'anulada' WHERE id = ?`).run(Number(salidaId));
  return getSalida(db, salidaId);
}

function getMeta() {
  return {
    mercados: Object.entries(MERCADOS).map(([k, v]) => ({ key: k, ...v })),
    tipos_almacenaje: TIPOS_ALMACENAJE,
    estados_propuesta: ESTADOS_PROPUESTA,
    estados_posicion: ESTADOS_POSICION,
    tipos_movimiento: TIPOS_MOV,
    estados_salida: ['borrador', 'parcial', 'confirmada', 'anulada'],
    modelo: 'caotico',
    flujo: [
      '1. Crear bodega con dimensiones y mercado (define zonas ingreso/despacho)',
      '2. Subir plano/foto opcional y elegir rack, piso o mixto',
      '3. Indicar largo × ancho × alto de posición → generar propuesta',
      '4. Editar posiciones en la propuesta y aprobar → crea espacios + QR',
      '5. Ingreso: material + QR/manual de cualquier posición libre',
      '6. Salidas: desde solicitud (En Entrega) o manual → pick caótico → confirma y baja stock',
      '7. Traslado interno entre posiciones; bloqueo de posiciones dañadas/cuarentena'
    ]
  };
}

module.exports = {
  MERCADOS,
  ensureWmsSchema,
  getMeta,
  defaultParametros,
  listBodegas,
  getBodega,
  createBodega,
  updateBodega,
  crearPropuesta,
  getPropuesta,
  listPropuestas,
  updatePropuestaLayout,
  aprobarPropuesta,
  findPosicion,
  sugerirPosicionLibre,
  listInventario,
  listMovimientos,
  ingresoMaterial,
  salidaMaterial,
  trasladoMaterial,
  setPosicionEstado,
  getBodegaKpis,
  buscarMaterialUbicaciones,
  listSolicitudesPendientesDespacho,
  listSalidas,
  getSalida,
  createSalidaManual,
  createSalidaFromSolicitud,
  confirmarSalida,
  anularSalida,
  savePlano,
  resolvePlano,
  generarLayoutPropuesta
};
