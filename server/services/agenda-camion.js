/**
 * Agenda Camión Pluma — lectura/escritura unificada.
 * Producción MySQL usa `camion_pluma_servicios` (sistema PHP legacy).
 */

const PROD_TABLE = 'camion_pluma_servicios';
const { buildExcelReport } = require('./angel-excel');

const AGENDA_COLS_V2 = [
  ['empresa', 'VARCHAR(255) NULL'],
  ['hora_fin', 'VARCHAR(16) NULL'],
  ['solicitante', 'VARCHAR(255) NULL'],
  ['ceco_id', 'INT NULL'],
  ['proyecto', 'VARCHAR(255) NULL'],
  ['direccion', 'TEXT NULL'],
  ['contacto', 'VARCHAR(255) NULL'],
  ['telefono', 'VARCHAR(64) NULL'],
  ['kilometraje', 'DECIMAL(12,2) DEFAULT 0'],
  ['orden_compra', 'VARCHAR(128) NULL'],
  ['detalle_material', 'TEXT NULL'],
  ['observaciones', 'TEXT NULL'],
  ['es_bloqueo', 'TINYINT NOT NULL DEFAULT 0'],
  ['tipo_servicio', "VARCHAR(128) DEFAULT 'Servicio'"],
  ['origen', 'VARCHAR(255) NULL'],
  ['destino', 'VARCHAR(255) NULL'],
  ['chofer', 'VARCHAR(255) NULL']
];

const SQLITE_COLS = AGENDA_COLS_V2.map(([col, ddl]) => [
  col,
  ddl
    .replace(/VARCHAR\([^)]+\)/g, 'TEXT')
    .replace(/DECIMAL[^ ]+/, 'REAL')
    .replace(/TINYINT[^ ]+/, 'INTEGER')
]);

async function columnExists(db, table, col) {
  const cols = await getTableColumns(db, table);
  return cols.includes(col);
}

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

function formatDateValue(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function joinNombre(nombre, apellido) {
  return [nombre, apellido].filter(Boolean).join(' ').trim() || null;
}

function mapCamionPlumaRow(r) {
  const fecha = formatDateValue(r.fecha_servicio || r.fecha);
  const tipoReserva = r.tipo_reserva || '';
  const esBloqueo = tipoReserva === 'bloqueo' || Number(r.es_bloqueo) === 1;
  const solicitante = joinNombre(r.solicitante_nombre, r.solicitante_apellido) || r.solicitante || null;
  const chofer = joinNombre(r.chofer_nombre, r.chofer_apellido) || r.chofer || null;

  return {
    id: r.id,
    folio: r.folio || null,
    empresa: r.empresa || 'Sercom',
    fecha,
    fecha_servicio: fecha,
    hora_inicio: r.hora_inicio || null,
    hora_fin: r.hora_fin || null,
    tipo_servicio: r.tipo_servicio || (esBloqueo ? 'bloqueo' : 'operacion'),
    tipo_reserva: tipoReserva || (esBloqueo ? 'bloqueo' : 'servicio'),
    solicitante,
    solicitante_id: r.solicitante_id || null,
    chofer,
    chofer_id: r.chofer_id || null,
    ceco_id: r.centro_costo_id || r.ceco_id || null,
    ceco_codigo: r.ceco_codigo || null,
    ceco_nombre: r.ceco_nombre || null,
    proyecto: r.proyecto || r.tramo_nombre || null,
    origen: r.direccion_origen || r.origen || null,
    destino: r.direccion_destino || r.destino || null,
    comuna_destino: r.comuna_destino || null,
    kilometraje: r.kilometraje_estimado != null ? r.kilometraje_estimado : (r.kilometraje || 0),
    orden_compra: r.orden_compra || null,
    solicitud_material_id: r.solicitud_material_id || null,
    solicitud_material_codigo: r.solicitud_material_codigo || null,
    detalle_material: r.detalle_material || null,
    observaciones: r.notas_operacion || r.observaciones || null,
    motivo_bloqueo: r.motivo_bloqueo || null,
    estado: r.estado || 'pendiente',
    es_bloqueo: esBloqueo ? 1 : 0,
    precio_total_servicio: r.precio_total_servicio ?? null,
    tramo_nombre: r.tramo_nombre || null,
    _source: PROD_TABLE
  };
}

function mapLegacyV2Row(r) {
  const fecha = formatDateValue(r.fecha);
  const esBloqueo = Number(r.es_bloqueo) === 1 || String(r.tipo_servicio || '').toLowerCase() === 'bloqueo';
  return {
    id: r.id,
    folio: null,
    empresa: r.empresa || 'Sercom',
    fecha,
    fecha_servicio: fecha,
    hora_inicio: r.hora_inicio || null,
    hora_fin: r.hora_fin || null,
    tipo_servicio: r.tipo_servicio || 'Servicio',
    tipo_reserva: esBloqueo ? 'bloqueo' : 'servicio',
    solicitante: r.solicitante || null,
    solicitante_id: null,
    chofer: r.chofer || null,
    chofer_id: null,
    ceco_id: r.ceco_id || null,
    ceco_codigo: r.ceco_codigo || null,
    ceco_nombre: null,
    proyecto: r.proyecto || null,
    origen: r.origen || null,
    destino: r.destino || null,
    comuna_destino: null,
    kilometraje: r.kilometraje || 0,
    orden_compra: r.orden_compra || null,
    solicitud_material_id: null,
    solicitud_material_codigo: null,
    detalle_material: r.detalle_material || null,
    observaciones: r.observaciones || null,
    motivo_bloqueo: null,
    estado: r.estado || 'Programado',
    es_bloqueo: esBloqueo ? 1 : 0,
    precio_total_servicio: null,
    tramo_nombre: null,
    _source: 'agenda_camion_pluma_v2'
  };
}

async function ensureColumns(db, table, columns) {
  for (const [col, ddl] of columns) {
    if (await columnExists(db, table, col)) continue;
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
      console.log(`[agenda-camion] ${table}.${col} añadida`);
    } catch (err) {
      if (!/duplicate column/i.test(err.message || '')) {
        console.warn(`[agenda-camion] ${table}.${col}:`, err.message);
      }
    }
  }
}

async function ensureAgendaCamionSchema(db) {
  if (await tableExists(db, PROD_TABLE)) {
    await ensureColumns(db, PROD_TABLE, [
      ['orden_compra', db.driver === 'mysql' ? 'VARCHAR(128) NULL' : 'TEXT']
    ]);
  }
  if (!(await tableExists(db, 'agenda_camion_pluma_v2'))) return;
  const cols = db.driver === 'mysql' ? AGENDA_COLS_V2 : SQLITE_COLS;
  await ensureColumns(db, 'agenda_camion_pluma_v2', cols);

  if (db.driver === 'mysql') {
    const parts = [];
    if (await columnExists(db, 'agenda_camion_pluma_v2', 'cliente')) {
      parts.push("empresa = COALESCE(NULLIF(empresa,''), cliente)");
      parts.push("solicitante = COALESCE(NULLIF(solicitante,''), cliente)");
    }
    if (await columnExists(db, 'agenda_camion_pluma_v2', 'hora_termino')) {
      parts.push("hora_fin = COALESCE(NULLIF(hora_fin,''), hora_termino)");
    }
    if (await columnExists(db, 'agenda_camion_pluma_v2', 'numero_proyecto')) {
      parts.push("proyecto = COALESCE(NULLIF(proyecto,''), numero_proyecto)");
    }
    if (parts.length) {
      try {
        await db.exec(`UPDATE agenda_camion_pluma_v2 SET ${parts.join(', ')}`);
      } catch (err) {
        console.warn('[agenda-camion] backfill legacy:', err.message);
      }
    }
  }
}

async function listFromCamionPlumaServicios(db, fechaDesde, fechaHasta) {
  if (!(await tableExists(db, PROD_TABLE))) return null;

  const cols = await getTableColumns(db, PROD_TABLE);
  const colSet = new Set(cols);

  const extraSelect = [];
  if (colSet.has('tramo_nombre')) extraSelect.push('s.tramo_nombre');
  if (colSet.has('precio_total_servicio')) extraSelect.push('s.precio_total_servicio');
  if (colSet.has('solicitud_material_id')) extraSelect.push('s.solicitud_material_id');
  if (colSet.has('orden_compra')) extraSelect.push('s.orden_compra');

  const joinSolicitud = colSet.has('solicitud_material_id') && await tableExists(db, 'solicitudes_materiales')
    ? ' LEFT JOIN solicitudes_materiales sm ON sm.id = s.solicitud_material_id'
    : '';
  if (joinSolicitud) extraSelect.push('sm.codigo AS solicitud_material_codigo');

  const extra = extraSelect.length ? `, ${extraSelect.join(', ')}` : '';
  const fechaExpr = db.driver === 'mysql'
    ? "DATE_FORMAT(s.fecha_servicio, '%Y-%m-%d')"
    : "date(s.fecha_servicio)";
  const horaIniExpr = db.driver === 'mysql'
    ? "TIME_FORMAT(s.hora_inicio, '%H:%i')"
    : "substr(s.hora_inicio,1,5)";
  const horaFinExpr = db.driver === 'mysql'
    ? "TIME_FORMAT(s.hora_fin, '%H:%i')"
    : "substr(s.hora_fin,1,5)";

  const params = [];
  const whereParts = [];
  if (fechaDesde && fechaHasta) {
    whereParts.push('s.fecha_servicio BETWEEN ? AND ?');
    params.push(fechaDesde, fechaHasta);
  }
  if (colSet.has('deleted_at')) {
    whereParts.push("(s.deleted_at IS NULL OR s.deleted_at = '0000-00-00 00:00:00')");
  }
  const whereClause = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';

  const sql = `
    SELECT s.id, s.folio,
      ${fechaExpr} AS fecha_servicio,
      ${horaIniExpr} AS hora_inicio,
      ${horaFinExpr} AS hora_fin,
      s.tipo_reserva, s.tipo_servicio, s.estado,
      s.solicitante_id, s.chofer_id, s.centro_costo_id,
      s.empresa, s.empresa_otro,
      s.direccion_origen, s.direccion_destino, s.comuna_destino,
      s.kilometraje_estimado,
      s.detalle_material, s.notas_operacion, s.motivo_bloqueo,
      sol.nombre AS solicitante_nombre, sol.apellido AS solicitante_apellido,
      chofer.nombre AS chofer_nombre, chofer.apellido AS chofer_apellido,
      c.codigo AS ceco_codigo, c.nombre AS ceco_nombre
      ${extra}
    FROM ${PROD_TABLE} s
    LEFT JOIN usuarios sol ON sol.id = s.solicitante_id
    LEFT JOIN usuarios chofer ON chofer.id = s.chofer_id
    LEFT JOIN cecos c ON c.id = s.centro_costo_id
    ${joinSolicitud}
    ${whereClause}
    ORDER BY s.fecha_servicio DESC, s.hora_inicio
  `;

  const rows = await db.prepare(sql).all(...params);
  return rows.map(mapCamionPlumaRow);
}

async function listFromLegacyV2(db) {
  if (!(await tableExists(db, 'agenda_camion_pluma_v2'))) return [];

  const hasCliente = await columnExists(db, 'agenda_camion_pluma_v2', 'cliente');
  const sql = hasCliente ? `
    SELECT a.id,
      COALESCE(a.empresa, a.cliente) AS empresa,
      a.fecha,
      a.hora_inicio,
      COALESCE(a.hora_fin, a.hora_termino) AS hora_fin,
      COALESCE(a.tipo_servicio, 'Servicio') AS tipo_servicio,
      COALESCE(a.solicitante, a.cliente) AS solicitante,
      a.chofer,
      a.ceco_id,
      COALESCE(a.proyecto, a.numero_proyecto) AS proyecto,
      a.origen,
      a.destino,
      COALESCE(a.kilometraje, 0) AS kilometraje,
      a.orden_compra,
      a.detalle_material,
      a.observaciones,
      COALESCE(a.es_bloqueo, 0) AS es_bloqueo,
      COALESCE(a.estado, 'Programado') AS estado,
      c.codigo AS ceco_codigo
    FROM agenda_camion_pluma_v2 a
    LEFT JOIN cecos c ON c.id = a.ceco_id
    ORDER BY a.fecha DESC, a.hora_inicio
  ` : `
    SELECT a.*, c.codigo AS ceco_codigo
    FROM agenda_camion_pluma_v2 a
    LEFT JOIN cecos c ON c.id = a.ceco_id
    ORDER BY a.fecha DESC, a.hora_inicio
  `;

  try {
    const rows = await db.prepare(sql).all();
    return rows.map(mapLegacyV2Row);
  } catch (err) {
    console.warn('[agenda-camion] SELECT legacy v2:', err.message);
    return [];
  }
}

async function listAgendaCamion(db, opts = {}) {
  const { fechaDesde, fechaHasta } = opts;
  await ensureAgendaCamionSchema(db);

  const prodRows = await listFromCamionPlumaServicios(db, fechaDesde, fechaHasta);
  if (prodRows !== null) return prodRows;

  return listFromLegacyV2(db);
}

async function nextFolio(db, fechaServicio) {
  const prefix = `CP-${String(fechaServicio).replace(/-/g, '')}-`;
  const row = await db.prepare(`
    SELECT folio FROM ${PROD_TABLE}
    WHERE fecha_servicio = ? AND folio LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(fechaServicio, `${prefix}%`);
  let n = 1;
  if (row && row.folio) {
    const m = String(row.folio).match(/(\d+)\s*$/);
    if (m) n = Number(m[1]) + 1;
  }
  return `${prefix}${String(n).padStart(3, '0')}`;
}

async function saveAgendaCamion(db, body, userId) {
  const b = body || {};
  const id = Number(b.id) || 0;
  if (id > 0) return updateAgendaCamion(db, id, b, userId);

  const fecha = b.fecha || b.fecha_servicio;
  if (!fecha || !b.empresa) {
    const err = new Error('Empresa y fecha requeridos');
    err.status = 400;
    throw err;
  }

  if (await tableExists(db, PROD_TABLE)) {
    const esBloqueo = b.es_bloqueo || b.tipo_servicio === 'Bloqueo' || b.tipo_reserva === 'bloqueo';
    const tipoReserva = esBloqueo ? 'bloqueo' : 'servicio';
    const tipoServicio = ['operacion', 'traslado_proveedor', 'bodega_interno', 'externo'].includes(b.tipo_servicio)
      ? b.tipo_servicio
      : 'operacion';
    const folio = await nextFolio(db, fecha);
    const cols = await getTableColumns(db, PROD_TABLE);
    const colSet = new Set(cols);

    const insCols = [
      'folio', 'fecha_servicio', 'hora_inicio', 'hora_fin', 'tipo_reserva', 'tipo_servicio', 'estado',
      'solicitante_id', 'chofer_id', 'centro_costo_id', 'empresa', 'empresa_otro',
      'direccion_origen', 'direccion_destino', 'comuna_destino', 'kilometraje_estimado',
      'detalle_material', 'notas_operacion', 'motivo_bloqueo', 'created_by'
    ];
    const insVals = insCols.map(() => '?');
    const insParams = [
      folio, fecha, b.hora_inicio || null, b.hora_fin || null, tipoReserva, tipoServicio,
      b.estado || 'pendiente',
      b.solicitante_id || null, b.chofer_id || null, b.ceco_id || b.centro_costo_id || null,
      b.empresa, b.empresa_otro || null,
      b.origen || b.direccion_origen || null, b.destino || b.direccion_destino || null,
      b.comuna_destino || null, Number(b.kilometraje ?? b.kilometraje_estimado) || null,
      b.detalle_material || null, b.observaciones || b.notas_operacion || null,
      b.motivo_bloqueo || (esBloqueo ? b.observaciones : null) || null, userId || null
    ];

    if (colSet.has('tramo_nombre')) {
      insCols.push('tramo_nombre');
      insVals.push('?');
      insParams.push(b.tramo_nombre || null);
    }
    if (colSet.has('precio_total_servicio')) {
      insCols.push('precio_total_servicio');
      insVals.push('?');
      insParams.push(b.precio_total_servicio != null ? Number(b.precio_total_servicio) : null);
    }
    if (colSet.has('orden_compra')) {
      insCols.push('orden_compra');
      insVals.push('?');
      insParams.push((b.orden_compra && String(b.orden_compra).trim()) || null);
    }

    const info = await db.prepare(`
      INSERT INTO ${PROD_TABLE} (${insCols.join(', ')})
      VALUES (${insVals.join(', ')})
    `).run(...insParams);
    return { id: info.lastInsertRowid, folio };
  }

  const info = await db.prepare(`
    INSERT INTO agenda_camion_pluma_v2
      (empresa, fecha, hora_inicio, hora_fin, tipo_servicio, solicitante, chofer, ceco_id, proyecto,
       origen, destino, direccion, contacto, telefono, kilometraje, orden_compra, detalle_material,
       observaciones, es_bloqueo, estado, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.empresa, fecha, b.hora_inicio || null, b.hora_fin || null, b.tipo_servicio || 'Servicio',
    b.solicitante || null, b.chofer || null, b.ceco_id || null, b.proyecto || null,
    b.origen || null, b.destino || null, b.direccion || null, b.contacto || null, b.telefono || null,
    Number(b.kilometraje) || 0, b.orden_compra || null, b.detalle_material || null,
    b.observaciones || null, b.es_bloqueo ? 1 : 0, b.estado || 'Programado', userId || null
  );
  return { id: info.lastInsertRowid };
}

async function updateAgendaCamion(db, id, b, userId) {
  const fecha = b.fecha || b.fecha_servicio;
  if (!fecha || !b.empresa) {
    const err = new Error('Empresa y fecha requeridos');
    err.status = 400;
    throw err;
  }

  if (await tableExists(db, PROD_TABLE)) {
    const cols = await getTableColumns(db, PROD_TABLE);
    const colSet = new Set(cols);
    const esBloqueo = b.es_bloqueo || b.tipo_servicio === 'Bloqueo' || b.tipo_reserva === 'bloqueo';
    const tipoReserva = esBloqueo ? 'bloqueo' : 'servicio';
    const tipoServicio = ['operacion', 'traslado_proveedor', 'bodega_interno', 'externo'].includes(b.tipo_servicio)
      ? b.tipo_servicio
      : 'operacion';
    const estado = b.estado || (esBloqueo ? 'bloqueado' : 'pendiente');

    const sets = [
      'fecha_servicio = ?', 'hora_inicio = ?', 'hora_fin = ?',
      'tipo_reserva = ?', 'tipo_servicio = ?', 'estado = ?',
      'solicitante_id = ?', 'chofer_id = ?', 'centro_costo_id = ?',
      'empresa = ?', 'direccion_origen = ?', 'direccion_destino = ?',
      'comuna_destino = ?', 'kilometraje_estimado = ?',
      'notas_operacion = ?', 'motivo_bloqueo = ?'
    ];
    const params = [
      fecha, b.hora_inicio || null, b.hora_fin || null, tipoReserva, tipoServicio, estado,
      b.solicitante_id || null, b.chofer_id || null, b.ceco_id || b.centro_costo_id || null,
      b.empresa,
      b.origen || b.direccion_origen || null, b.destino || b.direccion_destino || null,
      b.comuna_destino || null, Number(b.kilometraje ?? b.kilometraje_estimado) || null,
      b.observaciones || b.notas_operacion || null,
      b.motivo_bloqueo || (esBloqueo ? b.observaciones : null) || null
    ];

    if (colSet.has('detalle_material')) {
      sets.push('detalle_material = ?');
      params.push(b.detalle_material || null);
    }
    if (colSet.has('tramo_nombre')) {
      sets.push('tramo_nombre = ?');
      params.push(b.tramo_nombre || null);
    }
    if (colSet.has('precio_total_servicio')) {
      sets.push('precio_total_servicio = ?');
      params.push(b.precio_total_servicio != null ? Number(b.precio_total_servicio) : null);
    }
    if (colSet.has('orden_compra')) {
      sets.push('orden_compra = ?');
      params.push((b.orden_compra && String(b.orden_compra).trim()) || null);
    }
    if (colSet.has('updated_by')) {
      sets.push('updated_by = ?');
      params.push(userId || null);
    }
    if (colSet.has('updated_at')) {
      sets.push('updated_at = NOW()');
    }

    let whereDeleted = '';
    if (colSet.has('deleted_at')) {
      whereDeleted = " AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')";
    }

    const info = await db.prepare(`
      UPDATE ${PROD_TABLE} SET ${sets.join(', ')} WHERE id = ?${whereDeleted}
    `).run(...params, id);

    if (!info.changes) {
      const err = new Error('No se encontró el servicio o ya fue eliminado');
      err.status = 404;
      throw err;
    }
    return { id };
  }

  const info = await db.prepare(`
    UPDATE agenda_camion_pluma_v2 SET
      empresa = ?, fecha = ?, hora_inicio = ?, hora_fin = ?, tipo_servicio = ?,
      solicitante = ?, chofer = ?, ceco_id = ?, origen = ?, destino = ?,
      kilometraje = ?, orden_compra = ?, observaciones = ?, es_bloqueo = ?, estado = ?
    WHERE id = ?
  `).run(
    b.empresa, fecha, b.hora_inicio || null, b.hora_fin || null, b.tipo_servicio || 'Servicio',
    b.solicitante || null, b.chofer || null, b.ceco_id || null,
    b.origen || null, b.destino || null, Number(b.kilometraje) || 0,
    (b.orden_compra && String(b.orden_compra).trim()) || null,
    b.observaciones || null, b.es_bloqueo ? 1 : 0, b.estado || 'Programado', id
  );
  if (!info.changes) {
    const err = new Error('No se encontró el servicio');
    err.status = 404;
    throw err;
  }
  return { id };
}

async function deleteAgendaCamion(db, id) {
  if (await tableExists(db, PROD_TABLE)) {
    const cols = await getTableColumns(db, PROD_TABLE);
    if (cols.includes('deleted_at')) {
      const info = await db.prepare(`
        UPDATE ${PROD_TABLE} SET deleted_at = NOW()
        WHERE id = ? AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')
      `).run(id);
      if (!info.changes) {
        const err = new Error('No se encontró el servicio o ya fue eliminado');
        err.status = 404;
        throw err;
      }
      return;
    }
  }
  await db.prepare(`DELETE FROM agenda_camion_pluma_v2 WHERE id = ?`).run(id);
}

const EXCEL_COLUMNS = [
  'Folio', 'Fecha', 'Hora inicio', 'Hora fin', 'Empresa', 'Tipo reserva', 'Tipo servicio',
  'Estado', 'Solicitante', 'Chofer', 'CECO', 'Proyecto', 'Origen', 'Destino', 'Comuna destino',
  'Kilometraje', 'Tramo', 'Precio IVA', 'Orden compra', 'Detalle material', 'Observaciones'
];

function mapAgendaExcelRow(r) {
  const esBloqueo = r.tipo_reserva === 'bloqueo' || Number(r.es_bloqueo) === 1;
  const ceco = r.ceco_codigo
    ? [r.ceco_codigo, r.ceco_nombre].filter(Boolean).join(' — ')
    : '';
  return {
    Folio: r.folio || '',
    Fecha: r.fecha_servicio || r.fecha || '',
    'Hora inicio': r.hora_inicio || '',
    'Hora fin': r.hora_fin || '',
    Empresa: r.empresa || '',
    'Tipo reserva': esBloqueo ? 'Bloqueo' : 'Servicio',
    'Tipo servicio': r.tipo_servicio || '',
    Estado: r.estado || '',
    Solicitante: r.solicitante || '',
    Chofer: r.chofer || '',
    CECO: ceco,
    Proyecto: r.proyecto || '',
    Origen: r.origen || '',
    Destino: r.destino || '',
    'Comuna destino': r.comuna_destino || '',
    Kilometraje: r.kilometraje != null && r.kilometraje !== '' ? Number(r.kilometraje) : '',
    Tramo: r.tramo_nombre || '',
    'Precio IVA': r.precio_total_servicio != null && r.precio_total_servicio !== ''
      ? Number(r.precio_total_servicio) : '',
    'Orden compra': r.orden_compra || '',
    'Detalle material': r.detalle_material || '',
    Observaciones: r.observaciones || r.motivo_bloqueo || ''
  };
}

async function exportAgendaExcel(db, opts = {}) {
  const fechaDesde = String(opts.fechaDesde || opts.fecha_desde || '').trim();
  const fechaHasta = String(opts.fechaHasta || opts.fecha_hasta || '').trim();
  if (!fechaDesde || !fechaHasta) {
    const err = new Error('Indique fecha desde y fecha hasta');
    err.status = 400;
    throw err;
  }
  if (fechaDesde > fechaHasta) {
    const err = new Error('La fecha desde no puede ser mayor que la fecha hasta');
    err.status = 400;
    throw err;
  }

  let rows = await listAgendaCamion(db, { fechaDesde, fechaHasta });
  rows = rows.filter((r) => {
    const f = r.fecha_servicio || r.fecha || '';
    return f && f >= fechaDesde && f <= fechaHasta;
  });
  rows.sort((a, b) => {
    const fa = a.fecha_servicio || a.fecha || '';
    const fb = b.fecha_servicio || b.fecha || '';
    if (fa !== fb) return fa.localeCompare(fb);
    return String(a.hora_inicio || '').localeCompare(String(b.hora_inicio || ''));
  });

  const excelRows = rows.length
    ? rows.map(mapAgendaExcelRow)
    : [{ Folio: 'Sin registros en el período seleccionado' }];
  return buildExcelReport({
    titulo: `agenda_camion_${fechaDesde}_${fechaHasta}`,
    empresa: opts.empresa || 'shared',
    sheets: [{
      name: 'Servicios',
      columns: EXCEL_COLUMNS,
      rows: excelRows
    }]
  });
}

module.exports = {
  ensureAgendaCamionSchema,
  listAgendaCamion,
  saveAgendaCamion,
  updateAgendaCamion,
  deleteAgendaCamion,
  exportAgendaExcel
};
