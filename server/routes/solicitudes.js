const express = require('express');
const { authRequired } = require('../middleware/auth');
const { notifyMaterialesSolicitud, estadoMaterialesLabel } = require('../services/notificaciones-reglas');

const router = express.Router();
router.use(authRequired);

function actorDisplayName(user) {
  if (!user) return '';
  const n = [user.nombre, user.apellido].filter(Boolean).join(' ').trim();
  return n || user.email || user.usuario || '';
}

async function fireMaterialesNotif(db, payload) {
  try {
    await notifyMaterialesSolicitud(db, payload);
  } catch (err) {
    console.warn('[solicitudes] notif:', err.message);
  }
}

const columnCache = new Map();

async function dbSchemaKey(db) {
  if (db?._schemaKey) return db._schemaKey;
  let key = db?.driver === 'mysql' ? 'mysql' : 'sqlite';
  try {
    if (db?.driver === 'mysql') {
      const row = await db.prepare('SELECT DATABASE() AS n').get();
      key = `mysql:${String(row?.n || 'default')}`;
    } else if (db?.name) {
      key = `sqlite:${db.name}`;
    }
  } catch (_) { /* ignore */ }
  db._schemaKey = key;
  return key;
}

async function tableColumns(db, table) {
  const schema = await dbSchemaKey(db);
  const key = `${schema}:${table}`;
  if (columnCache.has(key)) return columnCache.get(key);
  let set = new Set();
  try {
    if (db.driver === 'mysql') {
      const rows = await db.prepare(`
        SELECT COLUMN_NAME AS n FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
      `).all(table);
      set = new Set(rows.map((r) => String(r.n || '').toLowerCase()).filter(Boolean));
    } else {
      const rows = await db.prepare(`PRAGMA table_info(${table})`).all();
      set = new Set(rows.map((r) => String(r.name || '').toLowerCase()).filter(Boolean));
    }
  } catch (_) { /* ignore */ }
  columnCache.set(key, set);
  return set;
}

/** Columna opcional: `s.col` o `NULL AS col`. */
function optCol(cols, name, tableAlias = 's') {
  return hasCol(cols, name)
    ? `${tableAlias}.${name}`
    : `NULL AS ${name}`;
}

function hasCol(cols, name) {
  // Sin schema conocido: asumir columna presente (comportamiento previo en SQLite).
  if (cols == null || cols.size === 0) return true;
  return cols.has(String(name).toLowerCase());
}

function isMysql(db) {
  return db?.driver === 'mysql';
}

/** Concatenación portable MySQL/SQLite (evita depender de PIPES_AS_CONCAT). */
function sqlConcat(db, parts) {
  const list = parts.filter((p) => p != null && p !== '');
  if (!list.length) return "''";
  if (list.length === 1) return list[0];
  if (isMysql(db)) return `CONCAT(${list.join(', ')})`;
  return list.join(' || ');
}

function historialStyle(estadoNombre, accion) {
  const est = `${estadoNombre || ''} ${accion || ''}`.toLowerCase();
  if (/rechaz|anul/.test(est)) return { color: '#dc2626', icono: 'fa-times' };
  if (/aprob/.test(est)) return { color: '#059669', icono: 'fa-check' };
  if (/entreg|gu[ií]a/.test(est)) return { color: '#0284c7', icono: 'fa-truck' };
  if (/bodeguer|asign/.test(est)) return { color: '#0891b2', icono: 'fa-user-cog' };
  if (/creaci|solicitud/.test(est)) return { color: '#2563eb', icono: 'fa-file-circle-plus' };
  if (/pendiente/.test(est)) return { color: '#d97706', icono: 'fa-clock' };
  return { color: '#64748b', icono: 'fa-circle' };
}

/** Inserta historial compatible con schema PHP (observaciones) y ESERCOM (accion/comentarios). */
async function insertHistorial(db, { solicitudId, estadoId, usuarioId, accion, detalle }) {
  const cols = await tableColumns(db, 'historial_solicitudes');
  const fields = ['solicitud_id', 'estado_id', 'usuario_id'];
  const vals = [solicitudId, estadoId ?? null, usuarioId ?? null];
  const texto = String(detalle || accion || '').trim() || null;
  if (hasCol(cols, 'accion')) {
    fields.push('accion');
    vals.push(String(accion || 'Cambio de estado').slice(0, 255));
  }
  if (hasCol(cols, 'observaciones')) {
    fields.push('observaciones');
    vals.push(texto);
  }
  if (hasCol(cols, 'comentarios')) {
    fields.push('comentarios');
    vals.push(texto);
  }
  const ph = fields.map(() => '?').join(', ');
  await db.prepare(`INSERT INTO historial_solicitudes (${fields.join(', ')}) VALUES (${ph})`).run(...vals);
}

/**
 * Timeline completo: filas de historial + hitos de creación (solicitante) y aprobación (jefe).
 * Misma lógica que php/get_historial_solicitud.php.
 */
async function buildHistorialTimeline(db, solicitudId, s = {}) {
  const colsH = await tableColumns(db, 'historial_solicitudes');
  const nombreU = sqlConcat(db, ['u.nombre', "' '", 'u.apellido']);
  const extras = [];
  if (hasCol(colsH, 'accion')) extras.push('h.accion');
  if (hasCol(colsH, 'comentarios')) extras.push('h.comentarios');
  if (hasCol(colsH, 'observaciones')) extras.push('h.observaciones');
  const extraSel = extras.length ? `, ${extras.join(', ')}` : '';

  let rows = [];
  try {
    rows = await db.prepare(`
      SELECT h.id, h.solicitud_id, h.estado_id, h.usuario_id, h.fecha_cambio
             ${extraSel},
             e.nombre AS estado,
             ${nombreU} AS usuario
      FROM historial_solicitudes h
      LEFT JOIN estados_solicitud e ON e.id = h.estado_id
      LEFT JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.solicitud_id = ?
      ORDER BY h.fecha_cambio ASC, h.id ASC
    `).all(solicitudId);
  } catch (err) {
    console.warn('[historial] query:', err.message);
    rows = [];
  }

  const items = rows.map((row) => {
    const accion = String(row.accion || row.estado || 'Cambio de estado').trim();
    const detalle = String(row.observaciones || row.comentarios || '').trim();
    const style = historialStyle(row.estado, accion);
    return {
      id: row.id,
      fecha_cambio: row.fecha_cambio,
      fecha: row.fecha_cambio,
      estado_id: row.estado_id,
      estado: row.estado || null,
      accion,
      usuario: String(row.usuario || '').trim() || 'Sistema',
      comentarios: detalle || null,
      detalle: detalle || null,
      color: style.color,
      icono: style.icono,
      sintetico: false
    };
  });

  const hasAccion = (patterns) => items.some((it) => {
    const a = String(it.accion || '').toLowerCase();
    return patterns.some((p) => a.includes(p));
  });

  const solicitante = String(s.solicitante || '').trim();
  const jefe = String(s.jefe_proyecto || '').trim();
  const aprobador = String(s.aprobado_por || jefe || '').trim();
  const fechaSol = s.fecha_solicitud || null;
  const fechaApr = s.fecha_aprobacion || null;
  const estadoId = Number(s.estado_id || 0);

  if (fechaSol && !hasAccion(['solicitud', 'creaci', 'cread'])) {
    const style = historialStyle('', 'Solicitud');
    items.push({
      id: null,
      fecha_cambio: fechaSol,
      fecha: fechaSol,
      estado_id: 1,
      estado: 'Pendiente Aprobación',
      accion: 'Solicitud',
      usuario: solicitante || 'Solicitante',
      comentarios: 'Solicitud creada',
      detalle: 'Solicitud creada',
      color: style.color,
      icono: style.icono,
      sintetico: true
    });
  }

  const aprobada = Boolean(fechaApr) || (estadoId > 0 && ![1, 7, 8].includes(estadoId));
  if (aprobada && !hasAccion(['aprob'])) {
    const style = historialStyle('', 'Aprobación');
    items.push({
      id: null,
      fecha_cambio: fechaApr || fechaSol,
      fecha: fechaApr || fechaSol,
      estado_id: s.estado_id,
      estado: s.estado || null,
      accion: 'Aprobación',
      usuario: aprobador || 'Jefe de proyecto',
      comentarios: 'Aprobación registrada por jefe de proyecto',
      detalle: 'Aprobación registrada por jefe de proyecto',
      color: style.color,
      icono: style.icono,
      sintetico: true
    });
  }

  items.sort((a, b) => {
    const ta = Date.parse(String(a.fecha_cambio || a.fecha || '')) || 0;
    const tb = Date.parse(String(b.fecha_cambio || b.fecha || '')) || 0;
    if (ta !== tb) return ta - tb;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  return items;
}

function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localYmd(dt);
}

async function nextCodigo(db) {
  const row = await db.prepare(`
    SELECT codigo FROM solicitudes_materiales
    WHERE codigo LIKE 'SOLMAT-%'
    ORDER BY id DESC LIMIT 1
  `).get();
  let n = 1;
  if (row && row.codigo) {
    const m = String(row.codigo).match(/SOLMAT-(\d+)/i);
    if (m) n = Number(m[1]) + 1;
  }
  return `SOLMAT-${String(n).padStart(5, '0')}`;
}

async function listSolicitudes(db, { estado_id, q, ubicacion, fecha_desde, fecha_hasta, limit } = {}) {
  const colsS = await tableColumns(db, 'solicitudes_materiales');
  const colsE = await tableColumns(db, 'estados_solicitud');

  const elim = hasCol(colsS, 'eliminado')
    ? '(COALESCE(s.eliminado, 0) = 0 OR s.estado_id = 8)'
    : '1=1';
  const bodega = optCol(colsS, 'bodega_nombre');
  const ubic = optCol(colsS, 'ubicacion_entrega');
  const fechaReq = optCol(colsS, 'fecha_requerida');
  const quien = optCol(colsS, 'quien_retira');
  const quienUsa = optCol(colsS, 'quien_usa');
  const obs = optCol(colsS, 'observaciones');
  const proyecto = optCol(colsS, 'numero_proyecto');
  const color = hasCol(colsE, 'color') ? 'e.color AS estado_color' : 'NULL AS estado_color';
  const guia = optCol(colsS, 'numero_guia_softland');
  const guiaAdj = optCol(colsS, 'guia_softland_adjunto');
  const guiasProv = optCol(colsS, 'guias_proveedor');
  const guiaProvArchivo = optCol(colsS, 'guia_proveedor_archivo');
  const guiaProvNumero = optCol(colsS, 'guia_proveedor_numero');
  const fotoEntrega = optCol(colsS, 'foto_entrega');

  const bodegueroId = optCol(colsS, 'bodeguero_id');
  const joinBodeguero = hasCol(colsS, 'bodeguero_id')
    ? 'LEFT JOIN usuarios bg ON bg.id = s.bodeguero_id'
    : '';
  const nombreSol = sqlConcat(db, ['u.nombre', "' '", 'u.apellido']);
  const nombreJp = sqlConcat(db, ['jp.nombre', "' '", 'jp.apellido']);
  const selBodeguero = hasCol(colsS, 'bodeguero_id')
    ? `${sqlConcat(db, ['bg.nombre', "' '", 'bg.apellido'])} AS bodeguero`
    : 'NULL AS bodeguero';
  const params = [];
  let sql = `
    SELECT s.id, s.codigo, s.fecha_solicitud, ${fechaReq}, ${ubic},
           ${bodega}, ${proyecto}, ${quien}, ${quienUsa}, ${obs},
           ${guia}, ${guiaAdj}, ${guiasProv}, ${guiaProvArchivo}, ${guiaProvNumero}, ${fotoEntrega},
           s.solicitante_id, ${bodegueroId},
           e.id AS estado_id, e.nombre AS estado, ${color},
           c.codigo AS ceco_codigo, c.nombre AS ceco_nombre,
           ${nombreSol} AS solicitante,
           ${nombreJp} AS jefe_proyecto,
           ${selBodeguero}
    FROM solicitudes_materiales s
    JOIN estados_solicitud e ON e.id = s.estado_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    JOIN usuarios u ON u.id = s.solicitante_id
    LEFT JOIN usuarios jp ON jp.id = s.jefe_proyecto_id
    ${joinBodeguero}
    WHERE ${elim}
  `;

  if (estado_id) {
    sql += ' AND s.estado_id = ?';
    params.push(Number(estado_id));
  }
  if (ubicacion && hasCol(colsS, 'ubicacion_entrega')) {
    sql += ' AND s.ubicacion_entrega = ?';
    params.push(ubicacion);
  }
  if (fecha_desde) {
    sql += ' AND DATE(s.fecha_solicitud) >= ?';
    params.push(String(fecha_desde).slice(0, 10));
  }
  if (fecha_hasta) {
    sql += ' AND DATE(s.fecha_solicitud) <= ?';
    params.push(String(fecha_hasta).slice(0, 10));
  }
  if (q) {
    const like = `%${q}%`;
    const parts = ['s.codigo LIKE ?', 'u.nombre LIKE ?', 'u.apellido LIKE ?'];
    params.push(like, like, like);
    if (hasCol(colsS, 'numero_proyecto')) {
      parts.push('s.numero_proyecto LIKE ?');
      params.push(like);
    }
    if (hasCol(colsS, 'numero_guia_softland')) {
      parts.push('s.numero_guia_softland LIKE ?');
      params.push(like);
    }
    if (hasCol(colsS, 'guia_proveedor_numero')) {
      parts.push('s.guia_proveedor_numero LIKE ?');
      params.push(like);
    }
    sql += ` AND (${parts.join(' OR ')})`;
  }

  const lim = Math.min(Math.max(Number(limit) || 200, 1), 5000);
  sql += ` ORDER BY s.id DESC LIMIT ${lim}`;
  return db.prepare(sql).all(...params);
}

function formatFechaCell(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    return new Date(v).toISOString().slice(0, 10);
  } catch (_) {
    return s;
  }
}

/**
 * Reporte línea a línea (como antiguo php/reporte_materiales.php):
 * una fila por material, con cantidades/montos y datos de la solicitud.
 */
async function exportSolicitudesExcel(db, opts = {}) {
  const fs = require('fs');
  const path = require('path');
  const config = require('../config');
  const { buildExcelReport } = require('../services/angel-excel');
  const colsS = await tableColumns(db, 'solicitudes_materiales');
  const colsD = await tableColumns(db, 'solicitudes_detalle');
  const colsM = await tableColumns(db, 'materiales');

  let fechaDesde = String(opts.fecha_desde || '').slice(0, 10);
  let fechaHasta = String(opts.fecha_hasta || '').slice(0, 10);
  // Si no vienen fechas, usar último año (la lista inicial no filtra por fecha).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
    fechaHasta = localYmd();
    fechaDesde = addDaysYmd(fechaHasta, -365);
  }
  if (fechaDesde > fechaHasta) {
    const err = new Error('fecha_desde no puede ser mayor que fecha_hasta');
    err.status = 400;
    throw err;
  }

  let fechaEntrega = 'NULL';
  if (hasCol(colsS, 'fecha_entrega_real') && hasCol(colsS, 'fecha_entrega')) {
    fechaEntrega = 'COALESCE(s.fecha_entrega_real, s.fecha_entrega)';
  } else if (hasCol(colsS, 'fecha_entrega_real')) {
    fechaEntrega = 's.fecha_entrega_real';
  } else if (hasCol(colsS, 'fecha_entrega')) {
    fechaEntrega = 's.fecha_entrega';
  }

  // Cantidad solicitada: schema productivo usa `cantidad`; algunos legados `cantidad_solicitada`.
  let cantSolExpr = '0';
  if (hasCol(colsD, 'cantidad')) cantSolExpr = 'COALESCE(sd.cantidad, 0)';
  else if (hasCol(colsD, 'cantidad_solicitada')) cantSolExpr = 'COALESCE(sd.cantidad_solicitada, 0)';

  const cantEntregada = hasCol(colsD, 'cantidad_entregada')
    ? 'COALESCE(sd.cantidad_entregada, 0)'
    : '0';
  const cantPendienteCol = `CASE WHEN (${cantSolExpr}) - (${cantEntregada}) > 0 THEN (${cantSolExpr}) - (${cantEntregada}) ELSE 0 END`;

  // Precio: maestro materiales, con fallback a línea de detalle.
  const precioParts = [];
  if (hasCol(colsM, 'precio_unitario')) precioParts.push('NULLIF(m.precio_unitario, 0)');
  if (hasCol(colsM, 'precio')) precioParts.push('NULLIF(m.precio, 0)');
  if (hasCol(colsM, 'costo_unitario')) precioParts.push('NULLIF(m.costo_unitario, 0)');
  if (hasCol(colsM, 'costo')) precioParts.push('NULLIF(m.costo, 0)');
  if (hasCol(colsD, 'precio_unitario')) precioParts.push('NULLIF(sd.precio_unitario, 0)');
  if (hasCol(colsD, 'precio')) precioParts.push('NULLIF(sd.precio, 0)');
  const precioExpr = precioParts.length ? `COALESCE(${precioParts.join(', ')}, 0)` : '0';

  const matCodigoParts = [];
  if (hasCol(colsM, 'codigo')) matCodigoParts.push('NULLIF(TRIM(m.codigo), \'\')');
  if (hasCol(colsD, 'codigo_material')) matCodigoParts.push('NULLIF(TRIM(sd.codigo_material), \'\')');
  if (hasCol(colsD, 'material_codigo')) matCodigoParts.push('NULLIF(TRIM(sd.material_codigo), \'\')');
  const matCodigoExpr = matCodigoParts.length ? `COALESCE(${matCodigoParts.join(', ')}, '')` : "''";

  const matNombreParts = [];
  if (hasCol(colsM, 'nombre')) matNombreParts.push('NULLIF(TRIM(m.nombre), \'\')');
  if (hasCol(colsM, 'descripcion')) matNombreParts.push('NULLIF(TRIM(m.descripcion), \'\')');
  if (hasCol(colsD, 'descripcion_material')) matNombreParts.push('NULLIF(TRIM(sd.descripcion_material), \'\')');
  if (hasCol(colsD, 'nombre_material')) matNombreParts.push('NULLIF(TRIM(sd.nombre_material), \'\')');
  const matNombreExpr = matNombreParts.length ? `COALESCE(${matNombreParts.join(', ')}, '')` : "''";

  const sel = {
    proyecto: hasCol(colsS, 'numero_proyecto') ? 's.numero_proyecto' : 'NULL',
    fechaReq: hasCol(colsS, 'fecha_requerida') ? 's.fecha_requerida' : 'NULL',
    quienRetira: hasCol(colsS, 'quien_retira') ? 's.quien_retira' : 'NULL',
    quienUsa: hasCol(colsS, 'quien_usa') ? 's.quien_usa' : 'NULL',
    bodega: hasCol(colsS, 'bodega_nombre') ? 's.bodega_nombre' : 'NULL',
    ordenCompra: hasCol(colsS, 'orden_compra')
      ? 's.orden_compra'
      : (hasCol(colsS, 'numero_orden_compra') ? 's.numero_orden_compra' : 'NULL'),
    guia: hasCol(colsS, 'numero_guia_softland') ? 's.numero_guia_softland' : 'NULL',
    ubicacion: hasCol(colsS, 'ubicacion_entrega') ? 's.ubicacion_entrega' : 'NULL',
    obs: hasCol(colsS, 'observaciones') ? 's.observaciones' : 'NULL',
    unidad: hasCol(colsD, 'unidad')
      ? 'sd.unidad'
      : (hasCol(colsD, 'unidad_medida')
        ? 'sd.unidad_medida'
        : (hasCol(colsM, 'unidad') ? 'm.unidad' : 'NULL')),
    conductor: hasCol(colsS, 'despacho_conductor') ? 's.despacho_conductor' : 'NULL',
    rut: hasCol(colsS, 'despacho_rut') ? 's.despacho_rut' : 'NULL',
    patente: hasCol(colsS, 'despacho_patente') ? 's.despacho_patente' : 'NULL',
    direccion: hasCol(colsS, 'despacho_direccion') ? 's.despacho_direccion' : 'NULL'
  };

  const joinBodeguero = hasCol(colsS, 'bodeguero_id')
    ? 'LEFT JOIN usuarios bg ON bg.id = s.bodeguero_id'
    : '';
  const selBodeguero = hasCol(colsS, 'bodeguero_id')
    ? `TRIM(${sqlConcat(db, ["COALESCE(bg.nombre, '')", "' '", "COALESCE(bg.apellido, '')"])})`
    : 'NULL';
  const selSolicitante = `TRIM(${sqlConcat(db, ["COALESCE(u.nombre, '')", "' '", "COALESCE(u.apellido, '')"])})`;
  const selCodigo = `COALESCE(s.codigo, ${sqlConcat(db, ["'SM-'", 's.id'])})`;

  const fechaFilter = `
      AND DATE(s.fecha_solicitud) >= ?
      AND DATE(s.fecha_solicitud) <= ?
  `;

  const params = [fechaDesde, fechaHasta];
  let sql = `
    SELECT
      s.id AS solicitud_id,
      ${selCodigo} AS codigo_solicitud,
      ${sel.proyecto} AS numero_proyecto,
      s.fecha_solicitud,
      ${sel.fechaReq} AS fecha_requerida,
      ${fechaEntrega} AS fecha_entrega,
      c.codigo AS ceco_codigo,
      c.nombre AS ceco_nombre,
      e.nombre AS estado_nombre,
      ${sel.quienRetira} AS quien_retira,
      ${sel.quienUsa} AS quien_usa,
      ${sel.bodega} AS bodega_nombre,
      ${selBodeguero} AS bodeguero_nombre,
      ${sel.ordenCompra} AS orden_compra,
      COALESCE(TRIM(${sel.guia}), '') AS guia_softland,
      ${selSolicitante} AS solicitante_nombre,
      ${sel.ubicacion} AS ubicacion_entrega,
      ${sel.obs} AS observaciones,
      ${sel.conductor} AS despacho_conductor,
      ${sel.rut} AS despacho_rut,
      ${sel.patente} AS despacho_patente,
      ${sel.direccion} AS despacho_direccion,
      ${matCodigoExpr} AS material_codigo,
      ${matNombreExpr} AS material_nombre,
      ${sel.unidad} AS unidad,
      (${cantSolExpr}) AS cantidad_solicitada,
      (${cantEntregada}) AS cantidad_entregada,
      (${cantPendienteCol}) AS cantidad_pendiente,
      (${precioExpr}) AS precio_unitario
    FROM solicitudes_materiales s
    INNER JOIN solicitudes_detalle sd ON sd.solicitud_id = s.id
    LEFT JOIN materiales m ON m.id = sd.material_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    LEFT JOIN estados_solicitud e ON e.id = s.estado_id
    LEFT JOIN usuarios u ON u.id = s.solicitante_id
    ${joinBodeguero}
    WHERE 1=1
      ${fechaFilter}
  `;

  if (opts.estado_id) {
    sql += ' AND s.estado_id = ?';
    params.push(Number(opts.estado_id));
  }
  if (opts.ceco_id) {
    sql += ' AND s.ceco_id = ?';
    params.push(Number(opts.ceco_id));
  }
  if (opts.q) {
    const like = `%${opts.q}%`;
    sql += ` AND (
      s.codigo LIKE ? OR COALESCE(s.numero_proyecto, '') LIKE ?
      OR COALESCE(u.nombre, '') LIKE ? OR COALESCE(u.apellido, '') LIKE ?
      OR COALESCE(m.codigo, '') LIKE ? OR COALESCE(m.nombre, '') LIKE ?
    )`;
    params.push(like, like, like, like, like, like);
  }

  sql += ' ORDER BY s.id DESC, sd.id ASC LIMIT 50000';

  let filas = [];
  let queryError = '';
  try {
    filas = await db.prepare(sql).all(...params);
  } catch (err) {
    queryError = err.message || String(err);
    console.error('[exportSolicitudesExcel]', queryError);
  }

  // Diagnóstico para saber por qué sale vacío (se escribe a disco y va en 2ª hoja).
  let diag = {
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    filas_reporte: filas.length,
    query_error: queryError || null,
    cols_detalle: colsD && colsD.size ? [...colsD].sort() : [],
    cols_materiales: colsM && colsM.size ? [...colsM].sort() : [],
    driver: db.driver || 'sqlite'
  };
  try {
    diag.total_solicitudes = Number((await db.prepare(
      'SELECT COUNT(*) AS c FROM solicitudes_materiales'
    ).get())?.c || 0);
    diag.total_detalle = Number((await db.prepare(
      'SELECT COUNT(*) AS c FROM solicitudes_detalle'
    ).get())?.c || 0);
    diag.solicitudes_en_rango = Number((await db.prepare(`
      SELECT COUNT(*) AS c FROM solicitudes_materiales s
      WHERE DATE(s.fecha_solicitud) >= ? AND DATE(s.fecha_solicitud) <= ?
    `).get(fechaDesde, fechaHasta))?.c || 0);
    diag.lineas_en_rango = Number((await db.prepare(`
      SELECT COUNT(*) AS c
      FROM solicitudes_materiales s
      INNER JOIN solicitudes_detalle sd ON sd.solicitud_id = s.id
      WHERE DATE(s.fecha_solicitud) >= ? AND DATE(s.fecha_solicitud) <= ?
    `).get(fechaDesde, fechaHasta))?.c || 0);
    const sample = await db.prepare(`
      SELECT s.id, s.codigo, s.fecha_solicitud,
             (SELECT COUNT(*) FROM solicitudes_detalle sd WHERE sd.solicitud_id = s.id) AS n_detalle
      FROM solicitudes_materiales s
      ORDER BY s.id DESC LIMIT 5
    `).all();
    diag.ultimas_solicitudes = sample;
  } catch (err) {
    diag.diag_error = err.message;
  }
  try {
    const dir = path.join(config.dataDir, 'reportes');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'last-excel-diag.json'), JSON.stringify(diag, null, 2));
  } catch (_) { /* ignore */ }

  if (queryError) {
    throw Object.assign(new Error('No se pudo armar el reporte de materiales: ' + queryError), { status: 500 });
  }

  // Columnas del PHP + extras útiles de la BD (despacho / ubicación).
  const columns = [
    'Solicitud',
    'Numero Proyecto',
    'Fecha Solicitud',
    'Fecha Requerida',
    'Fecha Entrega',
    'CECO',
    'Estado',
    'Ubicacion Entrega',
    'Quien Retira',
    'Quien Usa',
    'Bodega',
    'Bodeguero',
    'Orden de Compra',
    'Guia Softland',
    'Solicitante',
    'Conductor',
    'RUT Conductor',
    'Patente',
    'Direccion Despacho',
    'Codigo Material',
    'Descripcion Material',
    'Unidad',
    'Cantidad Solicitada',
    'Cantidad Entregada',
    'Cantidad Pendiente',
    'Precio Unitario',
    'Monto Solicitado',
    'Monto Entregado',
    'Monto Pendiente',
    'Observaciones'
  ];

  function cellFecha(v, keepTime) {
    if (v == null || v === '') return '';
    const s = String(v);
    if (keepTime) return s.length > 19 ? s.slice(0, 19) : s;
    return formatFechaCell(v);
  }

  const rows = filas.length
    ? filas.map((f) => {
      const cantSol = Number(f.cantidad_solicitada) || 0;
      const cantEnt = Number(f.cantidad_entregada) || 0;
      const cantPen = Number(f.cantidad_pendiente) || 0;
      const precio = Number(f.precio_unitario) || 0;
      return {
        Solicitud: f.codigo_solicitud || '',
        'Numero Proyecto': f.numero_proyecto || '',
        'Fecha Solicitud': cellFecha(f.fecha_solicitud, false),
        'Fecha Requerida': cellFecha(f.fecha_requerida, false),
        'Fecha Entrega': cellFecha(f.fecha_entrega, true),
        CECO: `${f.ceco_codigo || ''} ${f.ceco_nombre || ''}`.trim(),
        Estado: f.estado_nombre || '',
        'Ubicacion Entrega': f.ubicacion_entrega || '',
        'Quien Retira': f.quien_retira || '',
        'Quien Usa': f.quien_usa || '',
        Bodega: f.bodega_nombre || '',
        Bodeguero: String(f.bodeguero_nombre || '').trim(),
        'Orden de Compra': f.orden_compra || '',
        'Guia Softland': f.guia_softland || '',
        Solicitante: String(f.solicitante_nombre || '').trim(),
        Conductor: f.despacho_conductor || '',
        'RUT Conductor': f.despacho_rut || '',
        Patente: f.despacho_patente || '',
        'Direccion Despacho': f.despacho_direccion || '',
        'Codigo Material': f.material_codigo || '',
        'Descripcion Material': f.material_nombre || '',
        Unidad: f.unidad || '',
        'Cantidad Solicitada': cantSol,
        'Cantidad Entregada': cantEnt,
        'Cantidad Pendiente': cantPen,
        'Precio Unitario': precio,
        'Monto Solicitado': Math.round(cantSol * precio * 100) / 100,
        'Monto Entregado': Math.round(cantEnt * precio * 100) / 100,
        'Monto Pendiente': Math.round(cantPen * precio * 100) / 100,
        Observaciones: f.observaciones || ''
      };
    })
    : [{
      Solicitud: `Sin materiales entre ${fechaDesde} y ${fechaHasta}`,
      Observaciones: `Solicitudes en rango: ${diag.solicitudes_en_rango || 0}. Líneas detalle: ${diag.lineas_en_rango || 0}. Total detalle BD: ${diag.total_detalle || 0}. Amplía el filtro de fechas.`
    }];

  const diagRows = Object.keys(diag).map((k) => ({
    Campo: k,
    Valor: typeof diag[k] === 'object' ? JSON.stringify(diag[k]) : String(diag[k] ?? '')
  }));

  const excel = await buildExcelReport({
    titulo: `reporte_materiales_${fechaDesde}_${fechaHasta}`,
    empresa: opts.empresa || 'shared',
    sheets: [
      { name: 'Materiales', columns, rows },
      { name: 'Diagnostico', columns: ['Campo', 'Valor'], rows: diagRows }
    ]
  });
  const totalFilas = filas.length;
  return {
    ...excel,
    totalFilas,
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    columns
  };
}

router.get('/', async (req, res) => {
  try {
    const data = await listSolicitudes(req.db, req.query || {});
    res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /api/solicitudes]', err.message);
    // Fallback mínimo si el schema productivo difiere mucho
    try {
      const rows = await req.db.prepare(`
        SELECT s.id, s.codigo, s.fecha_solicitud, s.estado_id,
               e.nombre AS estado,
               u.nombre || ' ' || u.apellido AS solicitante
        FROM solicitudes_materiales s
        LEFT JOIN estados_solicitud e ON e.id = s.estado_id
        LEFT JOIN usuarios u ON u.id = s.solicitante_id
        ORDER BY s.id DESC LIMIT 200
      `).all();
      res.json({ success: true, data: rows, warning: err.message });
    } catch (err2) {
      console.error('[GET /api/solicitudes fallback]', err2.message);
      res.status(500).json({
        success: false,
        message: err2.message || err.message || 'Error al cargar solicitudes',
        data: []
      });
    }
  }
});

router.get('/reporte-excel', async (req, res) => {
  try {
    const result = await exportSolicitudesExcel(req.db, {
      estado_id: req.query.estado_id || '',
      q: req.query.q || '',
      ubicacion: req.query.ubicacion || '',
      fecha_desde: req.query.fecha_desde || '',
      fecha_hasta: req.query.fecha_hasta || '',
      empresa: req.auth.empresa
    });
    const desde = String(req.query.fecha_desde || 'todo').slice(0, 10);
    const hasta = String(req.query.fecha_hasta || 'todo').slice(0, 10);
    res.download(result.fullPath, `reporte_materiales_${desde}_${hasta}.xlsx`);
  } catch (err) {
    console.error('[GET /api/solicitudes/reporte-excel]', err.message);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'No se pudo generar el Excel'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID inválido' });

    const colsS = await tableColumns(req.db, 'solicitudes_materiales');
    const nombreSol = sqlConcat(req.db, ['u.nombre', "' '", 'u.apellido']);
    const nombreJp = sqlConcat(req.db, ['jp.nombre', "' '", 'jp.apellido']);
    const nombreApr = hasCol(colsS, 'aprobado_por_id')
      ? `${sqlConcat(req.db, ['ap.nombre', "' '", 'ap.apellido'])} AS aprobado_por`
      : 'NULL AS aprobado_por';
    const joinApr = hasCol(colsS, 'aprobado_por_id')
      ? 'LEFT JOIN usuarios ap ON ap.id = s.aprobado_por_id'
      : '';

    let s;
    try {
      s = await req.db.prepare(`
        SELECT s.*, e.nombre AS estado, e.color AS estado_color,
               c.codigo AS ceco_codigo, c.nombre AS ceco_nombre,
               ${nombreSol} AS solicitante, u.email AS solicitante_email,
               ${nombreJp} AS jefe_proyecto,
               ${nombreApr}
        FROM solicitudes_materiales s
        JOIN estados_solicitud e ON e.id = s.estado_id
        LEFT JOIN cecos c ON c.id = s.ceco_id
        JOIN usuarios u ON u.id = s.solicitante_id
        LEFT JOIN usuarios jp ON jp.id = COALESCE(s.jefe_proyecto_id, c.jefe_proyecto_id)
        ${joinApr}
        WHERE s.id = ? AND COALESCE(s.eliminado, 0) = 0
      `).get(id);
    } catch (_) {
      s = await req.db.prepare(`
        SELECT s.*, e.nombre AS estado,
               ${nombreSol} AS solicitante
        FROM solicitudes_materiales s
        LEFT JOIN estados_solicitud e ON e.id = s.estado_id
        LEFT JOIN usuarios u ON u.id = s.solicitante_id
        WHERE s.id = ?
      `).get(id);
    }

    if (!s) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
    }

    let detalle = [];
    try {
      detalle = await req.db.prepare(`
        SELECT d.*, m.codigo AS material_codigo, m.nombre AS material_nombre
        FROM solicitudes_detalle d
        JOIN materiales m ON m.id = d.material_id
        WHERE d.solicitud_id = ?
      `).all(s.id);
    } catch (_) { detalle = []; }

    const historial = await buildHistorialTimeline(req.db, s.id, s);

    res.json({ success: true, data: { ...s, detalle, historial } });
  } catch (err) {
    console.error('[GET /api/solicitudes/:id]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Error al cargar solicitud' });
  }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const materiales = Array.isArray(body.materiales) ? body.materiales : [];

  if (!body.numero_proyecto || !String(body.numero_proyecto).trim()) {
    return res.status(400).json({ success: false, message: 'Número de proyecto es requerido' });
  }
  if (!body.ceco_id) {
    return res.status(400).json({ success: false, message: 'CECO es requerido' });
  }
  if (materiales.length === 0) {
    return res.status(400).json({ success: false, message: 'Debe agregar al menos un material' });
  }

  const ceco = await (async () => {
    try {
      return await req.db.prepare('SELECT id, jefe_proyecto_id FROM cecos WHERE id = ? AND (activo = 1 OR activo IS NULL)')
        .get(Number(body.ceco_id));
    } catch (_) {
      return await req.db.prepare('SELECT id, jefe_proyecto_id FROM cecos WHERE id = ?')
        .get(Number(body.ceco_id));
    }
  })();
  if (!ceco) {
    return res.status(400).json({ success: false, message: 'CECO inválido' });
  }

  const codigo = await nextCodigo(req.db);
  const ubicacion = body.ubicacion_entrega === 'directo-proveedor' ? 'directo-proveedor' : 'bodega';
  const estadoInicial = 1;

  if (ubicacion === 'bodega') {
    if (!body.bodega_nombre || !String(body.bodega_nombre).trim()) {
      return res.status(400).json({ success: false, message: 'Seleccione la bodega de entrega' });
    }
    const missing = ['despacho_conductor', 'despacho_rut', 'despacho_patente', 'despacho_direccion']
      .filter((k) => !String(body[k] || '').trim());
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: 'Para guía de salida complete: conductor, RUT, patente y dirección'
      });
    }
  }

  const despacho = {
    conductor: String(body.despacho_conductor || '').trim() || null,
    rut: String(body.despacho_rut || '').trim() || null,
    patente: String(body.despacho_patente || '').trim().toUpperCase() || null,
    direccion: String(body.despacho_direccion || '').trim() || null
  };

  const tx = req.db.transaction(async () => {
    let solicitudId;
    const baseParams = [
      codigo,
      ceco.id,
      estadoInicial,
      req.auth.userId,
      body.jefe_proyecto_id || ceco.jefe_proyecto_id || null,
      body.fecha_requerida || null,
      body.bodega_nombre || null,
      ubicacion,
      body.observaciones || null,
      body.quien_retira || null,
      body.quien_usa || null,
      String(body.numero_proyecto).trim(),
      body.forma_pedido || 'normal',
      body.proveedor_id || null
    ].map((v) => (v === undefined ? null : v));

    try {
      const info = await req.db.prepare(`
        INSERT INTO solicitudes_materiales
          (codigo, ceco_id, estado_id, solicitante_id, jefe_proyecto_id, fecha_requerida,
           bodega_nombre, ubicacion_entrega, observaciones, quien_retira, quien_usa,
           numero_proyecto, forma_pedido, proveedor_id,
           despacho_conductor, despacho_rut, despacho_patente, despacho_direccion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ...baseParams,
        despacho.conductor, despacho.rut, despacho.patente, despacho.direccion
      );
      solicitudId = info.lastInsertRowid;
    } catch (err) {
      if (!/Unknown column|no such column/i.test(err.message || '')) throw err;
      const info = await req.db.prepare(`
        INSERT INTO solicitudes_materiales
          (codigo, ceco_id, estado_id, solicitante_id, jefe_proyecto_id, fecha_requerida,
           bodega_nombre, ubicacion_entrega, observaciones, quien_retira, quien_usa,
           numero_proyecto, forma_pedido, proveedor_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...baseParams);
      solicitudId = info.lastInsertRowid;
    }

    const insertDet = req.db.prepare(`
      INSERT INTO solicitudes_detalle
        (solicitud_id, material_id, cantidad, unidad, cantidad_pendiente, precio_unitario, subtotal, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of materiales) {
      let mat;
      try {
        mat = await req.db.prepare('SELECT id, unidad, precio FROM materiales WHERE id = ? AND (activo = 1 OR activo IS NULL)')
          .get(Number(item.material_id));
      } catch (_) {
        mat = await req.db.prepare('SELECT id, unidad FROM materiales WHERE id = ?')
          .get(Number(item.material_id));
        if (mat) mat.precio = 0;
      }
      if (!mat) throw new Error(`Material inválido: ${item.material_id}`);
      const cantidad = Number(item.cantidad);
      if (!cantidad || cantidad <= 0) throw new Error('Cantidad inválida');
      const precio = Number(item.precio_unitario != null ? item.precio_unitario : mat.precio) || 0;
      await insertDet.run(
        solicitudId,
        mat.id,
        cantidad,
        item.unidad || mat.unidad || 'UN',
        cantidad,
        precio,
        cantidad * precio,
        item.observaciones || null
      );
    }

    await insertHistorial(req.db, {
      solicitudId,
      estadoId: estadoInicial,
      usuarioId: req.auth.userId,
      accion: 'Solicitud',
      detalle: 'Solicitud creada'
    });

    return solicitudId;
  });

  try {
    const id = await tx();
    const jefeId = body.jefe_proyecto_id || ceco.jefe_proyecto_id || null;
    await fireMaterialesNotif(req.db, {
      accion: 'nueva',
      solicitud: {
        id,
        codigo,
        numero_proyecto: String(body.numero_proyecto).trim(),
        estado_id: estadoInicial,
        solicitante_id: req.auth.userId,
        jefe_proyecto_id: jefeId
      },
      actorId: req.auth.userId,
      actorNombre: actorDisplayName(req.auth.user),
      itemsCount: materiales.length,
      estadoNombre: 'Pendiente'
    });
    res.status(201).json({
      success: true,
      message: 'Solicitud creada correctamente',
      data: { id, codigo }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'No se pudo crear la solicitud' });
  }
});

router.post('/:id/aprobar', async (req, res) => {
  const user = req.auth?.user;
  const rol = String(user?.rol || '').toLowerCase();
  const esAdmin = user?.rol_id === 1 || rol.includes('admin');
  const { userHas } = require('../services/permisos-especiales');
  let especial = false;
  try {
    especial = await userHas(req.db, user.id, 'materiales_super_aprobador')
      || await userHas(req.db, user.id, 'materiales_usuario_especial')
      || await userHas(req.db, user.id, 'validador_oc_supply_chain');
  } catch (_) { /* ignore */ }
  if (!esAdmin && !user?.flag_aprobador_salida && !especial) {
    return res.status(403).json({
      success: false,
      message: 'Solo aprobadores de salida de materiales pueden aprobar'
    });
  }

  const id = Number(req.params.id);
  const s = await req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND eliminado = 0').get(id);
  if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
  if (s.estado_id !== 1) {
    return res.status(400).json({ success: false, message: 'La solicitud no está pendiente de aprobación' });
  }

  const nuevoEstado = s.ubicacion_entrega === 'directo-proveedor' ? 4 : 2;
  const colsS = await tableColumns(req.db, 'solicitudes_materiales');
  const sets = ['estado_id = ?', "fecha_actualizacion = datetime('now')"];
  const params = [nuevoEstado];
  if (hasCol(colsS, 'fecha_aprobacion')) {
    sets.push("fecha_aprobacion = datetime('now')");
  }
  if (hasCol(colsS, 'aprobado_por_id')) {
    sets.push('aprobado_por_id = ?');
    params.push(req.auth.userId);
  }
  params.push(id);
  await req.db.prepare(`
    UPDATE solicitudes_materiales
    SET ${sets.join(', ')}
    WHERE id = ?
  `).run(...params);

  await insertHistorial(req.db, {
    solicitudId: id,
    estadoId: nuevoEstado,
    usuarioId: req.auth.userId,
    accion: 'Aprobación',
    detalle: req.body?.comentarios || 'Aprobada por jefe de proyecto'
  });

  await fireMaterialesNotif(req.db, {
    accion: 'aprobada',
    solicitud: { ...s, estado_id: nuevoEstado },
    actorId: req.auth.userId,
    actorNombre: actorDisplayName(user),
    comentarios: req.body?.comentarios,
    estadoNombre: estadoMaterialesLabel(nuevoEstado, 'Aprobada')
  });

  res.json({ success: true, message: 'Solicitud aprobada', estado_id: nuevoEstado });
});

router.post('/:id/rechazar', async (req, res) => {
  const user = req.auth?.user;
  const rol = String(user?.rol || '').toLowerCase();
  const esAdmin = user?.rol_id === 1 || rol.includes('admin');
  const { userHas } = require('../services/permisos-especiales');
  let especial = false;
  try {
    especial = await userHas(req.db, user.id, 'materiales_super_aprobador')
      || await userHas(req.db, user.id, 'materiales_usuario_especial');
  } catch (_) { /* ignore */ }
  if (!esAdmin && !user?.flag_aprobador_salida && !especial) {
    return res.status(403).json({
      success: false,
      message: 'Solo aprobadores de salida de materiales pueden rechazar'
    });
  }

  const id = Number(req.params.id);
  const s = await req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND eliminado = 0').get(id);
  if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
  if (![1, 4].includes(s.estado_id)) {
    return res.status(400).json({ success: false, message: 'No se puede rechazar en este estado' });
  }

  await req.db.prepare(`
    UPDATE solicitudes_materiales SET estado_id = 7, fecha_actualizacion = datetime('now') WHERE id = ?
  `).run(id);

  await insertHistorial(req.db, {
    solicitudId: id,
    estadoId: 7,
    usuarioId: req.auth.userId,
    accion: 'Rechazo',
    detalle: req.body?.comentarios || 'Rechazada'
  });

  await fireMaterialesNotif(req.db, {
    accion: 'rechazada',
    solicitud: { ...s, estado_id: 7 },
    actorId: req.auth.userId,
    actorNombre: actorDisplayName(user),
    comentarios: req.body?.comentarios,
    estadoNombre: 'Rechazada'
  });

  res.json({ success: true, message: 'Solicitud rechazada' });
});

router.post('/:id/anular', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const s = await req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND COALESCE(eliminado, 0) = 0').get(id);
    if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });

    await req.db.prepare(`
      UPDATE solicitudes_materiales SET estado_id = 8, eliminado = 1, fecha_actualizacion = datetime('now')
      WHERE id = ?
    `).run(id);

    await insertHistorial(req.db, {
      solicitudId: id,
      estadoId: 8,
      usuarioId: req.auth.userId,
      accion: 'Anulación',
      detalle: req.body?.comentarios || 'Anulada'
    });

    await fireMaterialesNotif(req.db, {
      accion: 'anulada',
      solicitud: { ...s, estado_id: 8 },
      actorId: req.auth.userId,
      actorNombre: actorDisplayName(req.auth?.user),
      comentarios: req.body?.comentarios,
      estadoNombre: 'Cerrada'
    });

    res.json({ success: true, message: 'Solicitud anulada' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo anular' });
  }
});

async function isEspecialMat(db, user) {
  const rol = String(user?.rol || '').toLowerCase();
  if (user?.rol_id === 1 || rol.includes('admin')) return true;
  if (user?.flag_aprobador_salida) return true;
  try {
    const { userHas } = require('../services/permisos-especiales');
    return await userHas(db, user.id, 'materiales_super_aprobador')
      || await userHas(db, user.id, 'materiales_usuario_especial')
      || await userHas(db, user.id, 'validador_oc_supply_chain');
  } catch (_) {
    return false;
  }
}

/** Editar solicitud (cabecera + materiales) — pendiente o usuario especial */
router.post('/:id/actualizar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const s = await req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND COALESCE(eliminado, 0) = 0').get(id);
    if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });

    const especial = await isEspecialMat(req.db, req.auth.user);
    const propia = Number(s.solicitante_id) === Number(req.auth.userId);
    if (!(especial || (propia && Number(s.estado_id) === 1))) {
      return res.status(403).json({ success: false, message: 'No puedes modificar esta solicitud en su estado actual' });
    }

    const materiales = Array.isArray(body.materiales) ? body.materiales : null;
    const fields = [];
    const params = [];
    const setIf = (col, val) => {
      if (val === undefined) return;
      fields.push(`${col} = ?`);
      params.push(val === '' ? null : val);
    };
    setIf('numero_proyecto', body.numero_proyecto != null ? String(body.numero_proyecto).trim() : undefined);
    setIf('ceco_id', body.ceco_id != null ? Number(body.ceco_id) : undefined);
    setIf('jefe_proyecto_id', body.jefe_proyecto_id !== undefined ? (body.jefe_proyecto_id || null) : undefined);
    setIf('fecha_requerida', body.fecha_requerida !== undefined ? body.fecha_requerida : undefined);
    setIf('ubicacion_entrega', body.ubicacion_entrega);
    setIf('bodega_nombre', body.bodega_nombre !== undefined ? body.bodega_nombre : undefined);
    setIf('quien_retira', body.quien_retira !== undefined ? body.quien_retira : undefined);
    setIf('quien_usa', body.quien_usa !== undefined ? body.quien_usa : undefined);
    setIf('observaciones', body.observaciones !== undefined ? body.observaciones : undefined);
    setIf('despacho_conductor', body.despacho_conductor !== undefined ? body.despacho_conductor : undefined);
    setIf('despacho_rut', body.despacho_rut !== undefined ? body.despacho_rut : undefined);
    setIf('despacho_patente', body.despacho_patente !== undefined ? String(body.despacho_patente || '').toUpperCase() : undefined);
    setIf('despacho_direccion', body.despacho_direccion !== undefined ? body.despacho_direccion : undefined);

    const tx = req.db.transaction(async () => {
      if (fields.length) {
        fields.push(`fecha_actualizacion = datetime('now')`);
        params.push(id);
        try {
          await req.db.prepare(`UPDATE solicitudes_materiales SET ${fields.join(', ')} WHERE id = ?`).run(...params.map((v) => (v === undefined ? null : v)));
        } catch (err) {
          // Reintento sin columnas despacho si no existen
          if (!/Unknown column|no such column/i.test(err.message || '')) throw err;
          const safe = [];
          const safeParams = [];
          const map = {
            numero_proyecto: body.numero_proyecto,
            ceco_id: body.ceco_id,
            jefe_proyecto_id: body.jefe_proyecto_id,
            fecha_requerida: body.fecha_requerida,
            ubicacion_entrega: body.ubicacion_entrega,
            bodega_nombre: body.bodega_nombre,
            quien_retira: body.quien_retira,
            quien_usa: body.quien_usa,
            observaciones: body.observaciones
          };
          for (const [k, v] of Object.entries(map)) {
            if (v === undefined) continue;
            safe.push(`${k} = ?`);
            safeParams.push(v === '' ? null : v);
          }
          if (safe.length) {
            safe.push(`fecha_actualizacion = datetime('now')`);
            safeParams.push(id);
            await req.db.prepare(`UPDATE solicitudes_materiales SET ${safe.join(', ')} WHERE id = ?`).run(...safeParams);
          }
        }
      }

      if (materiales && (Number(s.estado_id) === 1 || especial)) {
        await req.db.prepare('DELETE FROM solicitudes_detalle WHERE solicitud_id = ?').run(id);
        const insertDet = req.db.prepare(`
          INSERT INTO solicitudes_detalle
            (solicitud_id, material_id, cantidad, unidad, cantidad_pendiente, precio_unitario, subtotal, observaciones)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of materiales) {
          const mat = await req.db.prepare('SELECT id, unidad FROM materiales WHERE id = ?').get(Number(item.material_id));
          if (!mat) throw new Error(`Material inválido: ${item.material_id}`);
          const cantidad = Number(item.cantidad);
          if (!cantidad || cantidad <= 0) throw new Error('Cantidad inválida');
          const precio = Number(item.precio_unitario) || 0;
          await insertDet.run(id, mat.id, cantidad, item.unidad || mat.unidad || 'UN', cantidad, precio, cantidad * precio, null);
        }
      }

      await insertHistorial(req.db, {
        solicitudId: id,
        estadoId: s.estado_id,
        usuarioId: req.auth.userId,
        accion: 'Edición',
        detalle: 'Solicitud modificada'
      });
    });

    await tx();
    res.json({ success: true, message: 'Solicitud actualizada' });
  } catch (err) {
    console.error('[POST /solicitudes/:id/actualizar]', err.message);
    res.status(400).json({ success: false, message: err.message || 'No se pudo actualizar' });
  }
});

/** Asignar bodeguero → pasa a En Entrega (3) */
router.post('/:id/asignar-bodeguero', async (req, res) => {
  try {
    if (!(await isEspecialMat(req.db, req.auth.user))) {
      return res.status(403).json({ success: false, message: 'Sin permiso para asignar bodeguero' });
    }
    const id = Number(req.params.id);
    const bodegueroId = Number(req.body?.bodeguero_id);
    if (!bodegueroId) return res.status(400).json({ success: false, message: 'Seleccione bodeguero' });
    const s = await req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND COALESCE(eliminado, 0) = 0').get(id);
    if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
    if (Number(s.estado_id) !== 2) {
      return res.status(400).json({ success: false, message: 'La solicitud debe estar en Asignar Bodeguero (apruebe primero)' });
    }
    const u = await req.db.prepare('SELECT id FROM usuarios WHERE id = ?').get(bodegueroId);
    if (!u) return res.status(400).json({ success: false, message: 'Bodeguero inválido' });

    try {
      await req.db.prepare(`
        UPDATE solicitudes_materiales
        SET bodeguero_id = ?, estado_id = 3, fecha_actualizacion = datetime('now')
        WHERE id = ?
      `).run(bodegueroId, id);
    } catch (err) {
      if (/Unknown column|no such column/i.test(err.message || '')) {
        await req.db.prepare(`
          UPDATE solicitudes_materiales SET estado_id = 3, fecha_actualizacion = datetime('now') WHERE id = ?
        `).run(id);
      } else throw err;
    }
    await insertHistorial(req.db, {
      solicitudId: id,
      estadoId: 3,
      usuarioId: req.auth.userId,
      accion: 'Asignar bodeguero',
      detalle: `Bodeguero #${bodegueroId}`
    });
    res.json({ success: true, message: 'Bodeguero asignado', estado_id: 3 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo asignar' });
  }
});

/** Registrar entrega → Guías pendientes (5) */
router.post('/:id/registrar-entrega', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const s = await req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND COALESCE(eliminado, 0) = 0').get(id);
    if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
    const especial = await isEspecialMat(req.db, req.auth.user);
    const esBodeguero = Number(s.bodeguero_id) === Number(req.auth.userId)
      || String(req.auth.user?.rol || '').toLowerCase().includes('bodega');
    if (!especial && !esBodeguero) {
      return res.status(403).json({ success: false, message: 'Solo el bodeguero asignado puede registrar la entrega' });
    }
    if (![2, 3].includes(Number(s.estado_id))) {
      return res.status(400).json({ success: false, message: 'La solicitud no está en etapa de entrega' });
    }
    await req.db.prepare(`
      UPDATE solicitudes_materiales
      SET estado_id = 5, fecha_entrega = datetime('now'), fecha_actualizacion = datetime('now')
      WHERE id = ?
    `).run(id);
    await insertHistorial(req.db, {
      solicitudId: id,
      estadoId: 5,
      usuarioId: req.auth.userId,
      accion: 'Entrega',
      detalle: req.body?.comentarios || 'Entrega registrada'
    });
    res.json({ success: true, message: 'Entrega registrada — pendiente guía Softland', estado_id: 5 });
  } catch (err) {
    // fecha_entrega puede no existir
    try {
      const id = Number(req.params.id);
      await req.db.prepare(`UPDATE solicitudes_materiales SET estado_id = 5, fecha_actualizacion = datetime('now') WHERE id = ?`).run(id);
      await insertHistorial(req.db, {
        solicitudId: id,
        estadoId: 5,
        usuarioId: req.auth.userId,
        accion: 'Entrega',
        detalle: req.body?.comentarios || 'Entrega registrada'
      });
      res.json({ success: true, message: 'Entrega registrada — pendiente guía Softland', estado_id: 5 });
    } catch (err2) {
      res.status(500).json({ success: false, message: err2.message || err.message });
    }
  }
});

/** Registrar guía Softland → Cerrado (6) */
router.post('/:id/guia-softland', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const numero = String(req.body?.numero_guia_softland || '').trim();
    if (!numero) return res.status(400).json({ success: false, message: 'Ingrese el N° de guía Softland' });
    const s = await req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND COALESCE(eliminado, 0) = 0').get(id);
    if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
    if (![3, 5].includes(Number(s.estado_id)) && !(await isEspecialMat(req.db, req.auth.user))) {
      return res.status(400).json({ success: false, message: 'La solicitud no está en etapa de guía' });
    }
    try {
      await req.db.prepare(`
        UPDATE solicitudes_materiales
        SET numero_guia_softland = ?, estado_id = 6, fecha_cierre = datetime('now'), fecha_actualizacion = datetime('now')
        WHERE id = ?
      `).run(numero, id);
    } catch (_) {
      await req.db.prepare(`
        UPDATE solicitudes_materiales
        SET numero_guia_softland = ?, estado_id = 6, fecha_actualizacion = datetime('now')
        WHERE id = ?
      `).run(numero, id);
    }
    await insertHistorial(req.db, {
      solicitudId: id,
      estadoId: 6,
      usuarioId: req.auth.userId,
      accion: 'Guía Softland',
      detalle: `Guía ${numero}`
    });
    res.json({ success: true, message: 'Guía Softland registrada y solicitud cerrada', estado_id: 6 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo registrar la guía' });
  }
});

/** Reactivar anulada */
router.post('/:id/reactivar', async (req, res) => {
  try {
    if (!(await isEspecialMat(req.db, req.auth.user))) {
      return res.status(403).json({ success: false, message: 'Sin permiso para reactivar' });
    }
    const id = Number(req.params.id);
    const s = await req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ?').get(id);
    if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
    if (Number(s.estado_id) !== 8 && !s.eliminado) {
      return res.status(400).json({ success: false, message: 'Solo se reactivan solicitudes anuladas' });
    }
    await req.db.prepare(`
      UPDATE solicitudes_materiales SET estado_id = 1, eliminado = 0, fecha_actualizacion = datetime('now') WHERE id = ?
    `).run(id);
    await insertHistorial(req.db, {
      solicitudId: id,
      estadoId: 1,
      usuarioId: req.auth.userId,
      accion: 'Reactivación',
      detalle: req.body?.comentarios || 'Reactivada'
    });
    res.json({ success: true, message: 'Solicitud reactivada', estado_id: 1 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo reactivar' });
  }
});

module.exports = router;
module.exports.exportSolicitudesExcel = exportSolicitudesExcel;
