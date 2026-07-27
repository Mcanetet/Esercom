const express = require('express');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

function nextCode(db, table, column, prefix) {
  const row = db.prepare(`SELECT ${column} AS c FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${prefix}%`);
  let n = 1;
  if (row && row.c) {
    const m = String(row.c).match(/(\d+)\s*$/);
    if (m) n = Number(m[1]) + 1;
  }
  return `${prefix}${String(n).padStart(5, '0')}`;
}

function toTrash(db, userId, tipo, referenciaId, codigo, titulo, datos) {
  db.prepare(`
    INSERT INTO papelera (tipo, referencia_id, codigo, titulo, datos_json, eliminado_por)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tipo, referenciaId, codigo || null, titulo || null, JSON.stringify(datos || {}), userId);
}

/* ========== COMPRAS ========== */
router.get('/compras', (req, res) => {
  const q = String(req.query.q || '').trim();
  let sql = `
    SELECT s.*, u.nombre || ' ' || u.apellido AS solicitante, c.codigo AS ceco_codigo
    FROM solicitudes_compras s
    JOIN usuarios u ON u.id = s.solicitante_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    WHERE s.eliminado = 0`;
  const params = [];
  if (q) {
    sql += ` AND (s.numero_solicitud LIKE ? OR s.observaciones LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY s.id DESC LIMIT 200';
  res.json({ success: true, data: req.db.prepare(sql).all(...params) });
});

router.get('/compras/:id', (req, res) => {
  const s = req.db.prepare(`
    SELECT s.*, u.nombre || ' ' || u.apellido AS solicitante, c.codigo AS ceco_codigo, c.nombre AS ceco_nombre
    FROM solicitudes_compras s
    JOIN usuarios u ON u.id = s.solicitante_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    WHERE s.id = ? AND s.eliminado = 0
  `).get(Number(req.params.id));
  if (!s) return res.status(404).json({ success: false, message: 'No encontrada' });
  const detalle = req.db.prepare(`
    SELECT d.*, m.codigo AS material_codigo, m.nombre AS material_nombre
    FROM solicitudes_compras_detalle d
    LEFT JOIN materiales m ON m.id = d.material_id
    WHERE d.solicitud_id = ?
  `).all(s.id);
  res.json({ success: true, data: { ...s, detalle } });
});

router.post('/compras', (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!b.ceco_id) return res.status(400).json({ success: false, message: 'CECO requerido' });
  if (!items.length) return res.status(400).json({ success: false, message: 'Agregue ítems' });
  const codigo = nextCode(req.db, 'solicitudes_compras', 'numero_solicitud', 'SC-');
  const tx = req.db.transaction(() => {
    const info = req.db.prepare(`
      INSERT INTO solicitudes_compras
        (numero_solicitud, solicitante_id, ceco_id, jefe_proyecto_id, fecha_requerida, estado, observaciones)
      VALUES (?, ?, ?, ?, ?, 'Pendiente', ?)
    `).run(codigo, req.auth.userId, Number(b.ceco_id), b.jefe_proyecto_id || null, b.fecha_requerida || null, b.observaciones || null);
    const id = info.lastInsertRowid;
    const ins = req.db.prepare(`
      INSERT INTO solicitudes_compras_detalle
        (solicitud_id, material_id, descripcion, cantidad, unidad, precio_estimado, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of items) {
      ins.run(id, it.material_id || null, it.descripcion || '', Number(it.cantidad) || 1, it.unidad || 'UN', Number(it.precio_estimado) || 0, it.observaciones || null);
    }
    return id;
  });
  const id = tx();
  res.status(201).json({ success: true, data: { id, numero_solicitud: codigo } });
});

router.post('/compras/:id/estado', (req, res) => {
  const estado = req.body?.estado;
  if (!estado) return res.status(400).json({ success: false, message: 'Estado requerido' });
  req.db.prepare(`UPDATE solicitudes_compras SET estado = ? WHERE id = ? AND eliminado = 0`)
    .run(estado, Number(req.params.id));
  res.json({ success: true, message: 'Estado actualizado' });
});

router.post('/compras/:id/eliminar', (req, res) => {
  const id = Number(req.params.id);
  const s = req.db.prepare(`SELECT * FROM solicitudes_compras WHERE id = ?`).get(id);
  if (!s) return res.status(404).json({ success: false, message: 'No encontrada' });
  req.db.prepare(`UPDATE solicitudes_compras SET eliminado = 1 WHERE id = ?`).run(id);
  toTrash(req.db, req.auth.userId, 'compras', id, s.numero_solicitud, s.observaciones, s);
  res.json({ success: true, message: 'Movida a papelera' });
});

/* ========== PORTAL PROVEEDORES ========== */
router.get('/portal', (req, res) => {
  const data = req.db.prepare(`
    SELECT p.*, s.codigo AS solicitud_codigo, s.numero_proyecto,
           pr.razon_social AS proveedor_nombre, e.nombre AS solicitud_estado
    FROM portal_proveedor p
    JOIN solicitudes_materiales s ON s.id = p.solicitud_id
    LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
    LEFT JOIN estados_solicitud e ON e.id = s.estado_id
    ORDER BY p.id DESC LIMIT 200
  `).all();
  res.json({ success: true, data });
});

router.post('/portal/:id/guia', (req, res) => {
  const b = req.body || {};
  req.db.prepare(`
    UPDATE portal_proveedor
    SET numero_guia = ?, fecha_entrega = ?, persona_retira = ?, guia_estado = 'Subida', observaciones = ?
    WHERE id = ?
  `).run(b.numero_guia || null, b.fecha_entrega || null, b.persona_retira || null, b.observaciones || null, Number(req.params.id));
  res.json({ success: true, message: 'Guía registrada' });
});

router.post('/portal/:id/factura', (req, res) => {
  const b = req.body || {};
  req.db.prepare(`
    UPDATE portal_proveedor
    SET numero_factura = ?, monto_factura = ?, factura_estado = 'Subida'
    WHERE id = ?
  `).run(b.numero_factura || null, Number(b.monto_factura) || 0, Number(req.params.id));
  res.json({ success: true, message: 'Factura registrada' });
});

router.post('/portal/:id/validar-guia', (req, res) => {
  const ok = req.body?.aprobar !== false;
  req.db.prepare(`UPDATE portal_proveedor SET guia_estado = ? WHERE id = ?`)
    .run(ok ? 'Validada' : 'Rechazada', Number(req.params.id));
  res.json({ success: true, message: ok ? 'Guía validada' : 'Guía rechazada' });
});

router.post('/portal/:id/aprobar-factura', (req, res) => {
  const ok = req.body?.aprobar !== false;
  req.db.prepare(`UPDATE portal_proveedor SET factura_estado = ? WHERE id = ?`)
    .run(ok ? 'Aprobada' : 'Rechazada', Number(req.params.id));
  res.json({ success: true, message: ok ? 'Factura aprobada' : 'Factura rechazada' });
});

/* ========== RECETAS ========== */
router.get('/recetas', (req, res) => {
  const tipos = req.db.prepare(`SELECT * FROM materiales_receta_tipos WHERE activo = 1 ORDER BY nombre`).all();
  const insumos = req.db.prepare(`
    SELECT i.*, m.codigo AS material_codigo, m.nombre AS material_nombre, t.nombre AS tipo_nombre
    FROM materiales_receta_insumos i
    JOIN materiales_receta_tipos t ON t.id = i.tipo_id
    LEFT JOIN materiales m ON m.id = i.material_id
    WHERE i.activo = 1
    ORDER BY t.nombre, i.id
  `).all();
  res.json({ success: true, data: { tipos, insumos } });
});

router.post('/recetas/tipos', (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ success: false, message: 'Nombre requerido' });
  const info = req.db.prepare(`INSERT INTO materiales_receta_tipos (nombre, descripcion) VALUES (?, ?)`)
    .run(nombre, req.body?.descripcion || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/recetas/insumos', (req, res) => {
  const b = req.body || {};
  if (!b.tipo_id || !b.descripcion) {
    return res.status(400).json({ success: false, message: 'tipo_id y descripción requeridos' });
  }
  const info = req.db.prepare(`
    INSERT INTO materiales_receta_insumos (tipo_id, material_id, descripcion, cantidad, unidad, categoria)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(Number(b.tipo_id), b.material_id || null, b.descripcion, Number(b.cantidad) || 1, b.unidad || 'UN', b.categoria || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/recetas/calcular', (req, res) => {
  const tipoId = Number(req.body?.tipo_id);
  const obras = Number(req.body?.cantidad_obras) || 1;
  const insumos = req.db.prepare(`
    SELECT i.*, m.codigo AS material_codigo, m.nombre AS material_nombre, m.stock
    FROM materiales_receta_insumos i
    LEFT JOIN materiales m ON m.id = i.material_id
    WHERE i.tipo_id = ? AND i.activo = 1
  `).all(tipoId).map((i) => ({
    ...i,
    cantidad_total: Number(i.cantidad) * obras
  }));
  res.json({ success: true, data: insumos });
});

/* ========== SALIDA POR ACTIVIDAD ========== */
router.get('/salidas-actividad', (req, res) => {
  const data = req.db.prepare(`
    SELECT s.*, t.nombre AS tipo_nombre, c.codigo AS ceco_codigo,
           u.nombre || ' ' || u.apellido AS solicitante
    FROM salidas_actividad s
    LEFT JOIN materiales_receta_tipos t ON t.id = s.tipo_receta_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    LEFT JOIN usuarios u ON u.id = s.solicitante_id
    WHERE s.eliminado = 0
    ORDER BY s.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/salidas-actividad', (req, res) => {
  const b = req.body || {};
  if (!b.tipo_receta_id || !b.ceco_id) {
    return res.status(400).json({ success: false, message: 'Tipo de receta y CECO requeridos' });
  }
  const obras = Number(b.cantidad_obras) || 1;
  const codigo = nextCode(req.db, 'salidas_actividad', 'codigo', 'SMA-');
  const insumos = req.db.prepare(`
    SELECT * FROM materiales_receta_insumos WHERE tipo_id = ? AND activo = 1
  `).all(Number(b.tipo_receta_id));
  if (!insumos.length) {
    return res.status(400).json({ success: false, message: 'La receta no tiene insumos' });
  }
  const tx = req.db.transaction(() => {
    const info = req.db.prepare(`
      INSERT INTO salidas_actividad
        (codigo, tipo_receta_id, ceco_id, solicitante_id, cantidad_obras, numero_proyecto, estado, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?)
    `).run(codigo, Number(b.tipo_receta_id), Number(b.ceco_id), req.auth.userId, obras, b.numero_proyecto || null, b.observaciones || null);
    const id = info.lastInsertRowid;
    const ins = req.db.prepare(`
      INSERT INTO salidas_actividad_detalle (salida_id, material_id, descripcion, cantidad, unidad)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const i of insumos) {
      ins.run(id, i.material_id, i.descripcion, Number(i.cantidad) * obras, i.unidad);
    }
    return id;
  });
  res.status(201).json({ success: true, data: { id: tx(), codigo } });
});

router.get('/salidas-actividad/:id', (req, res) => {
  const s = req.db.prepare(`
    SELECT s.*, t.nombre AS tipo_nombre, c.codigo AS ceco_codigo,
           u.nombre || ' ' || u.apellido AS solicitante
    FROM salidas_actividad s
    LEFT JOIN materiales_receta_tipos t ON t.id = s.tipo_receta_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    LEFT JOIN usuarios u ON u.id = s.solicitante_id
    WHERE s.id = ? AND s.eliminado = 0
  `).get(Number(req.params.id));
  if (!s) return res.status(404).json({ success: false, message: 'No encontrada' });
  const detalle = req.db.prepare(`SELECT * FROM salidas_actividad_detalle WHERE salida_id = ?`).all(s.id);
  res.json({ success: true, data: { ...s, detalle } });
});

router.post('/salidas-actividad/:id/estado', (req, res) => {
  req.db.prepare(`UPDATE salidas_actividad SET estado = ? WHERE id = ?`)
    .run(req.body?.estado || 'Pendiente', Number(req.params.id));
  res.json({ success: true });
});

/* ========== DATOS MAESTROS ========== */
router.get('/datos-maestros', (req, res) => {
  const data = req.db.prepare(`
    SELECT d.*, u.nombre || ' ' || u.apellido AS solicitante
    FROM creacion_datos_maestros d
    LEFT JOIN usuarios u ON u.id = d.solicitante_id
    WHERE d.eliminado = 0 ORDER BY d.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/datos-maestros', (req, res) => {
  const b = req.body || {};
  if (!b.descripcion) return res.status(400).json({ success: false, message: 'Descripción requerida' });
  const info = req.db.prepare(`
    INSERT INTO creacion_datos_maestros
      (tipo, descripcion, unidad_medida, color, medida, inventariable, estado, solicitante_id, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
  `).run(
    b.tipo || 'Material', b.descripcion, b.unidad_medida || 'UN', b.color || null,
    b.medida || null, b.inventariable === false ? 0 : 1, req.auth.userId, b.observaciones || null
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/datos-maestros/:id', (req, res) => {
  const b = req.body || {};
  req.db.prepare(`
    UPDATE creacion_datos_maestros
    SET codigo = COALESCE(?, codigo), estado = COALESCE(?, estado),
        responsable = COALESCE(?, responsable), descripcion = COALESCE(?, descripcion),
        unidad_medida = COALESCE(?, unidad_medida)
    WHERE id = ? AND eliminado = 0
  `).run(b.codigo || null, b.estado || null, b.responsable || null, b.descripcion || null, b.unidad_medida || null, Number(req.params.id));
  res.json({ success: true, message: 'Actualizado' });
});

router.post('/datos-maestros/:id/eliminar', (req, res) => {
  const id = Number(req.params.id);
  const row = req.db.prepare(`SELECT * FROM creacion_datos_maestros WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ success: false, message: 'No encontrado' });
  req.db.prepare(`UPDATE creacion_datos_maestros SET eliminado = 1 WHERE id = ?`).run(id);
  toTrash(req.db, req.auth.userId, 'datos-maestros', id, row.codigo, row.descripcion, row);
  res.json({ success: true });
});

/* ========== TAREAS OPERATIVAS ========== */
router.get('/tareas', (req, res) => {
  const data = req.db.prepare(`
    SELECT t.*, c.codigo AS ceco_codigo, u.nombre || ' ' || u.apellido AS responsable
    FROM tareas_operativas t
    LEFT JOIN cecos c ON c.id = t.ceco_id
    LEFT JOIN usuarios u ON u.id = t.responsable_id
    WHERE t.eliminado = 0
    ORDER BY t.fecha DESC, t.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/tareas', (req, res) => {
  const b = req.body || {};
  if (!b.area || !b.fecha || !b.descripcion) {
    return res.status(400).json({ success: false, message: 'Área, fecha y descripción requeridos' });
  }
  const info = req.db.prepare(`
    INSERT INTO tareas_operativas
      (area, fecha, hora_inicio, hora_termino, camioneta, descripcion, ubicacion, ceco_id, horas_hombre, responsable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.area, b.fecha, b.hora_inicio || null, b.hora_termino || null, b.camioneta || null,
    b.descripcion, b.ubicacion || null, b.ceco_id || null, Number(b.horas_hombre) || 0, req.auth.userId
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/tareas/:id/eliminar', (req, res) => {
  const id = Number(req.params.id);
  const row = req.db.prepare(`SELECT * FROM tareas_operativas WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ success: false, message: 'No encontrada' });
  req.db.prepare(`UPDATE tareas_operativas SET eliminado = 1 WHERE id = ?`).run(id);
  toTrash(req.db, req.auth.userId, 'tareas', id, null, row.descripcion, row);
  res.json({ success: true });
});

/* ========== GRÁFICAS ========== */
router.get('/graficas', (req, res) => {
  const data = req.db.prepare(`
    SELECT g.*, c.codigo AS ceco_codigo, u.nombre || ' ' || u.apellido AS solicitante
    FROM solicitud_graficas g
    LEFT JOIN cecos c ON c.id = g.ceco_id
    LEFT JOIN usuarios u ON u.id = g.solicitante_id
    WHERE g.eliminado = 0 ORDER BY g.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/graficas', (req, res) => {
  const b = req.body || {};
  const codigo = nextCode(req.db, 'solicitud_graficas', 'codigo', 'SG-');
  const info = req.db.prepare(`
    INSERT INTO solicitud_graficas (codigo, ceco_id, solicitante_id, fecha_requerida, observaciones, estado)
    VALUES (?, ?, ?, ?, ?, 'Pendiente Aprobación')
  `).run(codigo, b.ceco_id || null, req.auth.userId, b.fecha_requerida || null, b.observaciones || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, codigo } });
});

router.post('/graficas/:id/estado', (req, res) => {
  const b = req.body || {};
  req.db.prepare(`
    UPDATE solicitud_graficas
    SET estado = COALESCE(?, estado), ot_numero = COALESCE(?, ot_numero),
        oc_numero = COALESCE(?, oc_numero), tipo_entrega = COALESCE(?, tipo_entrega)
    WHERE id = ?
  `).run(b.estado || null, b.ot_numero || null, b.oc_numero || null, b.tipo_entrega || null, Number(req.params.id));
  res.json({ success: true });
});

/* ========== SERVICIOS GENERALES ========== */
router.get('/ssgg', (req, res) => {
  const data = req.db.prepare(`
    SELECT s.*, u.nombre || ' ' || u.apellido AS solicitante
    FROM servicios_generales s
    LEFT JOIN usuarios u ON u.id = s.solicitante_id
    WHERE s.eliminado = 0 ORDER BY s.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/ssgg', (req, res) => {
  const b = req.body || {};
  if (!b.titulo || !b.categoria) {
    return res.status(400).json({ success: false, message: 'Título y categoría requeridos' });
  }
  const codigo = nextCode(req.db, 'servicios_generales', 'codigo', 'SSGG-');
  const info = req.db.prepare(`
    INSERT INTO servicios_generales
      (codigo, categoria, prioridad, titulo, descripcion, ubicacion, fecha_requerida, estado, solicitante_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierto', ?)
  `).run(
    codigo, b.categoria, b.prioridad || 'Media', b.titulo, b.descripcion || null,
    b.ubicacion || null, b.fecha_requerida || null, req.auth.userId
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, codigo } });
});

router.post('/ssgg/:id', (req, res) => {
  const b = req.body || {};
  req.db.prepare(`
    UPDATE servicios_generales
    SET estado = COALESCE(?, estado), fecha_inicio = COALESCE(?, fecha_inicio),
        fecha_termino_estimada = COALESCE(?, fecha_termino_estimada),
        fecha_termino_real = COALESCE(?, fecha_termino_real),
        prioridad = COALESCE(?, prioridad)
    WHERE id = ?
  `).run(b.estado || null, b.fecha_inicio || null, b.fecha_termino_estimada || null, b.fecha_termino_real || null, b.prioridad || null, Number(req.params.id));
  res.json({ success: true });
});

/* ========== AGENDA CAMIÓN PLUMA ========== */
router.get('/agenda', (req, res) => {
  const data = req.db.prepare(`
    SELECT a.*, c.codigo AS ceco_codigo
    FROM agenda_camion_pluma_v2 a
    LEFT JOIN cecos c ON c.id = a.ceco_id
    ORDER BY a.fecha DESC, a.hora_inicio
  `).all();
  res.json({ success: true, data });
});

router.post('/agenda', (req, res) => {
  const b = req.body || {};
  if (!b.fecha || !b.empresa) {
    return res.status(400).json({ success: false, message: 'Empresa y fecha requeridos' });
  }
  const info = req.db.prepare(`
    INSERT INTO agenda_camion_pluma_v2
      (empresa, fecha, hora_inicio, hora_fin, tipo_servicio, solicitante, chofer, ceco_id, proyecto,
       origen, destino, direccion, contacto, telefono, kilometraje, orden_compra, detalle_material,
       observaciones, es_bloqueo, estado, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.empresa, b.fecha, b.hora_inicio || null, b.hora_fin || null, b.tipo_servicio || 'Servicio',
    b.solicitante || null, b.chofer || null, b.ceco_id || null, b.proyecto || null,
    b.origen || null, b.destino || null, b.direccion || null, b.contacto || null, b.telefono || null,
    Number(b.kilometraje) || 0, b.orden_compra || null, b.detalle_material || null,
    b.observaciones || null, b.es_bloqueo ? 1 : 0, b.estado || 'Programado', req.auth.userId
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/agenda/:id/eliminar', (req, res) => {
  req.db.prepare(`DELETE FROM agenda_camion_pluma_v2 WHERE id = ?`).run(Number(req.params.id));
  res.json({ success: true });
});

/* ========== CHECKLIST FLOTA ========== */
router.get('/checklist', (req, res) => {
  const data = req.db.prepare(`
    SELECT c.*, u.nombre || ' ' || u.apellido AS conductor
    FROM checklist_flota c
    LEFT JOIN usuarios u ON u.id = c.conductor_id
    WHERE c.anulado = 0 ORDER BY c.fecha DESC, c.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/checklist', (req, res) => {
  const b = req.body || {};
  if (!b.patente) return res.status(400).json({ success: false, message: 'Patente requerida' });
  const info = req.db.prepare(`
    INSERT INTO checklist_flota
      (patente, kilometraje, fecha, conductor_id, estado_general, neumaticos, luces, frenos, aceite, documentos, observaciones)
    VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.patente.toUpperCase(), Number(b.kilometraje) || 0, b.fecha || null, req.auth.userId,
    b.estado_general || 'OK', b.neumaticos || 'OK', b.luces || 'OK', b.frenos || 'OK',
    b.aceite || 'OK', b.documentos || 'OK', b.observaciones || null
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/checklist/:id/anular', (req, res) => {
  req.db.prepare(`UPDATE checklist_flota SET anulado = 1 WHERE id = ?`).run(Number(req.params.id));
  res.json({ success: true });
});

/* ========== TELECOM ========== */
router.get('/telecom', (req, res) => {
  const data = req.db.prepare(`
    SELECT t.*, c.codigo AS ceco_codigo,
           u.nombre || ' ' || u.apellido AS solicitante,
           a.nombre || ' ' || a.apellido AS asignado
    FROM requerimientos_telecom t
    LEFT JOIN cecos c ON c.id = t.ceco_id
    LEFT JOIN usuarios u ON u.id = t.solicitante_id
    LEFT JOIN usuarios a ON a.id = t.asignado_id
    WHERE t.eliminado = 0 ORDER BY t.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/telecom', (req, res) => {
  const b = req.body || {};
  if (!b.tipo_solicitud) return res.status(400).json({ success: false, message: 'Tipo requerido' });
  const codigo = nextCode(req.db, 'requerimientos_telecom', 'codigo', 'TEL-');
  const info = req.db.prepare(`
    INSERT INTO requerimientos_telecom
      (codigo, tipo_solicitud, ceco_id, tipo_equipo, numero_linea, direccion_instalacion,
       fecha_requerida, descripcion, estado, solicitante_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?)
  `).run(
    codigo, b.tipo_solicitud, b.ceco_id || null, b.tipo_equipo || null, b.numero_linea || null,
    b.direccion_instalacion || null, b.fecha_requerida || null, b.descripcion || null, req.auth.userId
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, codigo } });
});

router.post('/telecom/:id', (req, res) => {
  const b = req.body || {};
  req.db.prepare(`
    UPDATE requerimientos_telecom
    SET estado = COALESCE(?, estado), asignado_id = COALESCE(?, asignado_id)
    WHERE id = ?
  `).run(b.estado || null, b.asignado_id || null, Number(req.params.id));
  res.json({ success: true });
});

/* ========== CONTRATOS ========== */
router.get('/contratos', (req, res) => {
  const data = req.db.prepare(`
    SELECT c.*, u.nombre || ' ' || u.apellido AS creador
    FROM seguimiento_contratos c
    LEFT JOIN usuarios u ON u.id = c.creado_por
    WHERE c.eliminado = 0 ORDER BY c.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/contratos', (req, res) => {
  const b = req.body || {};
  if (!b.descripcion) return res.status(400).json({ success: false, message: 'Descripción requerida' });
  const codigo = nextCode(req.db, 'seguimiento_contratos', 'codigo', 'CTR-');
  const info = req.db.prepare(`
    INSERT INTO seguimiento_contratos
      (codigo, proveedor_id, proveedor_nombre, descripcion, estado, creado_por)
    VALUES (?, ?, ?, ?, 'Borrador', ?)
  `).run(codigo, b.proveedor_id || null, b.proveedor_nombre || null, b.descripcion, req.auth.userId);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, codigo } });
});

router.post('/contratos/:id', (req, res) => {
  const b = req.body || {};
  req.db.prepare(`
    UPDATE seguimiento_contratos
    SET estado = COALESCE(?, estado), descripcion = COALESCE(?, descripcion),
        versiones = COALESCE(?, versiones), garantias = COALESCE(?, garantias)
    WHERE id = ?
  `).run(
    b.estado || null, b.descripcion || null,
    b.versiones ? JSON.stringify(b.versiones) : null,
    b.garantias ? JSON.stringify(b.garantias) : null,
    Number(req.params.id)
  );
  res.json({ success: true });
});

/* ========== APROBACIÓN FACTURAS ========== */
router.get('/facturas', (req, res) => {
  const lotes = req.db.prepare(`
    SELECT l.*, c.nombre || ' ' || c.apellido AS creador,
           a.nombre || ' ' || a.apellido AS aprobador
    FROM aprobacion_facturas_lote l
    LEFT JOIN usuarios c ON c.id = l.creado_por
    LEFT JOIN usuarios a ON a.id = l.aprobador_id
    ORDER BY l.id DESC
  `).all();
  const items = req.db.prepare(`SELECT * FROM aprobacion_facturas ORDER BY id`).all();
  res.json({ success: true, data: { lotes, items } });
});

router.post('/facturas/lotes', (req, res) => {
  const b = req.body || {};
  const codigo = nextCode(req.db, 'aprobacion_facturas_lote', 'codigo', 'LOTE-');
  const facturas = Array.isArray(b.facturas) ? b.facturas : [];
  const tx = req.db.transaction(() => {
    const info = req.db.prepare(`
      INSERT INTO aprobacion_facturas_lote (codigo, descripcion, creado_por, aprobador_id, estado)
      VALUES (?, ?, ?, ?, 'Pendiente')
    `).run(codigo, b.descripcion || null, req.auth.userId, b.aprobador_id || null);
    const loteId = info.lastInsertRowid;
    const ins = req.db.prepare(`
      INSERT INTO aprobacion_facturas (lote_id, numero_factura, proveedor, monto, estado)
      VALUES (?, ?, ?, ?, 'Pendiente')
    `);
    for (const f of facturas) {
      ins.run(loteId, f.numero_factura || null, f.proveedor || null, Number(f.monto) || 0);
    }
    return loteId;
  });
  res.status(201).json({ success: true, data: { id: tx(), codigo } });
});

router.post('/facturas/:id/decidir', (req, res) => {
  const ok = req.body?.aprobar !== false;
  req.db.prepare(`
    UPDATE aprobacion_facturas
    SET estado = ?, observacion = ?, fecha_decision = datetime('now')
    WHERE id = ?
  `).run(ok ? 'Aprobada' : 'Rechazada', req.body?.observacion || null, Number(req.params.id));
  res.json({ success: true });
});

/* ========== CONFIGURACIONES ========== */
router.get('/config/resumen', (req, res) => {
  res.json({
    success: true,
    data: {
      usuarios: req.db.prepare(`SELECT COUNT(*) AS c FROM usuarios WHERE activo = 1`).get().c,
      roles: req.db.prepare(`SELECT COUNT(*) AS c FROM roles WHERE activo = 1`).get().c,
      cecos: req.db.prepare(`SELECT COUNT(*) AS c FROM cecos WHERE activo = 1`).get().c,
      materiales: req.db.prepare(`SELECT COUNT(*) AS c FROM materiales WHERE activo = 1`).get().c,
      proveedores: req.db.prepare(`SELECT COUNT(*) AS c FROM proveedores WHERE activo = 1`).get().c,
      bodegas: req.db.prepare(`SELECT COUNT(*) AS c FROM bodegas WHERE activo = 1`).get().c
    }
  });
});

router.post('/config/materiales', (req, res) => {
  const b = req.body || {};
  if (!b.codigo || !b.nombre) return res.status(400).json({ success: false, message: 'Código y nombre requeridos' });
  const info = req.db.prepare(`
    INSERT INTO materiales (codigo, nombre, descripcion, unidad, precio, stock)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(b.codigo, b.nombre, b.descripcion || null, b.unidad || 'UN', Number(b.precio) || 0, Number(b.stock) || 0);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/config/proveedores', (req, res) => {
  const b = req.body || {};
  if (!b.razon_social || !b.rut) return res.status(400).json({ success: false, message: 'Razón social y RUT requeridos' });
  const info = req.db.prepare(`
    INSERT INTO proveedores (razon_social, rut, email, telefono, direccion)
    VALUES (?, ?, ?, ?, ?)
  `).run(b.razon_social, b.rut, b.email || null, b.telefono || null, b.direccion || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/config/cecos', (req, res) => {
  const b = req.body || {};
  if (!b.codigo || !b.nombre) return res.status(400).json({ success: false, message: 'Código y nombre requeridos' });
  const info = req.db.prepare(`
    INSERT INTO cecos (codigo, nombre, descripcion, jefe_proyecto_id)
    VALUES (?, ?, ?, ?)
  `).run(b.codigo, b.nombre, b.descripcion || null, b.jefe_proyecto_id || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/config/usuarios', (req, res) => {
  const bcrypt = require('bcryptjs');
  const b = req.body || {};
  if (!b.nombre || !b.apellido || !b.email || !b.password) {
    return res.status(400).json({ success: false, message: 'Nombre, apellido, email y password requeridos' });
  }
  const hash = bcrypt.hashSync(b.password, 10);
  const info = req.db.prepare(`
    INSERT INTO usuarios (nombre, apellido, email, password, cargo, rol_id, departamento_id, telefono)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.nombre, b.apellido, b.email, hash, b.cargo || null, b.rol_id || 3, b.departamento_id || null, b.telefono || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.get('/config/roles', (req, res) => {
  res.json({ success: true, data: req.db.prepare(`SELECT * FROM roles WHERE activo = 1`).all() });
});

/* ========== REPORTES ========== */
router.get('/reportes', (req, res) => {
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const modulo = req.query.modulo || 'materiales';

  const dateFilter = (col) => {
    const parts = [];
    const params = [];
    if (desde) { parts.push(`${col} >= ?`); params.push(desde); }
    if (hasta) { parts.push(`${col} <= ?`); params.push(hasta + ' 23:59:59'); }
    return { clause: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
  };

  if (modulo === 'compras') {
    const f = dateFilter('s.fecha_solicitud');
    const data = req.db.prepare(`
      SELECT s.numero_solicitud AS codigo, s.estado, s.fecha_solicitud, s.observaciones,
             u.nombre || ' ' || u.apellido AS solicitante
      FROM solicitudes_compras s
      JOIN usuarios u ON u.id = s.solicitante_id
      WHERE s.eliminado = 0 ${f.clause}
      ORDER BY s.id DESC
    `).all(...f.params);
    return res.json({ success: true, data });
  }
  if (modulo === 'telecom') {
    const f = dateFilter('t.fecha_creacion');
    const data = req.db.prepare(`
      SELECT t.codigo, t.tipo_solicitud, t.estado, t.fecha_creacion,
             u.nombre || ' ' || u.apellido AS solicitante
      FROM requerimientos_telecom t
      LEFT JOIN usuarios u ON u.id = t.solicitante_id
      WHERE t.eliminado = 0 ${f.clause}
      ORDER BY t.id DESC
    `).all(...f.params);
    return res.json({ success: true, data });
  }
  if (modulo === 'ssgg') {
    const f = dateFilter('s.fecha_creacion');
    const data = req.db.prepare(`
      SELECT s.codigo, s.categoria, s.titulo, s.estado, s.prioridad, s.fecha_creacion
      FROM servicios_generales s WHERE s.eliminado = 0 ${f.clause}
      ORDER BY s.id DESC
    `).all(...f.params);
    return res.json({ success: true, data });
  }
  if (modulo === 'flota') {
    const f = dateFilter('c.fecha');
    const data = req.db.prepare(`
      SELECT c.patente, c.kilometraje, c.fecha, c.estado_general, c.observaciones
      FROM checklist_flota c WHERE c.anulado = 0 ${f.clause}
      ORDER BY c.id DESC
    `).all(...f.params);
    return res.json({ success: true, data });
  }

  const f = dateFilter('s.fecha_solicitud');
  const data = req.db.prepare(`
    SELECT s.codigo, s.numero_proyecto, e.nombre AS estado, s.fecha_solicitud,
           u.nombre || ' ' || u.apellido AS solicitante, s.ubicacion_entrega
    FROM solicitudes_materiales s
    JOIN estados_solicitud e ON e.id = s.estado_id
    JOIN usuarios u ON u.id = s.solicitante_id
    WHERE s.eliminado = 0 ${f.clause}
    ORDER BY s.id DESC
  `).all(...f.params);
  res.json({ success: true, data });
});

/* ========== PAPELERA ========== */
router.get('/papelera', (req, res) => {
  const data = req.db.prepare(`
    SELECT p.*, u.nombre || ' ' || u.apellido AS eliminado_por_nombre
    FROM papelera p
    LEFT JOIN usuarios u ON u.id = p.eliminado_por
    ORDER BY p.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/papelera/:id/restaurar', (req, res) => {
  const item = req.db.prepare(`SELECT * FROM papelera WHERE id = ?`).get(Number(req.params.id));
  if (!item) return res.status(404).json({ success: false, message: 'No encontrado' });

  const map = {
    compras: 'UPDATE solicitudes_compras SET eliminado = 0 WHERE id = ?',
    'datos-maestros': 'UPDATE creacion_datos_maestros SET eliminado = 0 WHERE id = ?',
    tareas: 'UPDATE tareas_operativas SET eliminado = 0 WHERE id = ?',
    materiales: 'UPDATE solicitudes_materiales SET eliminado = 0 WHERE id = ?'
  };
  const sql = map[item.tipo];
  if (sql) req.db.prepare(sql).run(item.referencia_id);
  req.db.prepare(`DELETE FROM papelera WHERE id = ?`).run(item.id);
  res.json({ success: true, message: 'Restaurado' });
});

router.post('/papelera/:id/eliminar', (req, res) => {
  req.db.prepare(`DELETE FROM papelera WHERE id = ?`).run(Number(req.params.id));
  res.json({ success: true, message: 'Eliminado permanentemente' });
});

module.exports = router;
