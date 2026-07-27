const express = require('express');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

function nextCodigo(db) {
  const row = db.prepare(`
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

router.get('/', (req, res) => {
  const { estado_id, q, ubicacion } = req.query;
  const params = [];
  let sql = `
    SELECT s.id, s.codigo, s.fecha_solicitud, s.fecha_requerida, s.ubicacion_entrega,
           s.bodega_nombre, s.numero_proyecto, s.quien_retira, s.observaciones,
           e.id AS estado_id, e.nombre AS estado, e.color AS estado_color,
           c.codigo AS ceco_codigo, c.nombre AS ceco_nombre,
           u.nombre || ' ' || u.apellido AS solicitante,
           jp.nombre || ' ' || jp.apellido AS jefe_proyecto
    FROM solicitudes_materiales s
    JOIN estados_solicitud e ON e.id = s.estado_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    JOIN usuarios u ON u.id = s.solicitante_id
    LEFT JOIN usuarios jp ON jp.id = s.jefe_proyecto_id
    WHERE s.eliminado = 0
  `;

  if (estado_id) {
    sql += ' AND s.estado_id = ?';
    params.push(Number(estado_id));
  }
  if (ubicacion) {
    sql += ' AND s.ubicacion_entrega = ?';
    params.push(ubicacion);
  }
  if (q) {
    sql += ' AND (s.codigo LIKE ? OR s.numero_proyecto LIKE ? OR u.nombre LIKE ? OR u.apellido LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  sql += ' ORDER BY s.id DESC LIMIT 200';
  const data = req.db.prepare(sql).all(...params);
  res.json({ success: true, data });
});

router.get('/:id', (req, res) => {
  const s = req.db.prepare(`
    SELECT s.*, e.nombre AS estado, e.color AS estado_color,
           c.codigo AS ceco_codigo, c.nombre AS ceco_nombre,
           u.nombre || ' ' || u.apellido AS solicitante, u.email AS solicitante_email,
           jp.nombre || ' ' || jp.apellido AS jefe_proyecto
    FROM solicitudes_materiales s
    JOIN estados_solicitud e ON e.id = s.estado_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    JOIN usuarios u ON u.id = s.solicitante_id
    LEFT JOIN usuarios jp ON jp.id = s.jefe_proyecto_id
    WHERE s.id = ? AND s.eliminado = 0
  `).get(Number(req.params.id));

  if (!s) {
    return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
  }

  const detalle = req.db.prepare(`
    SELECT d.*, m.codigo AS material_codigo, m.nombre AS material_nombre
    FROM solicitudes_detalle d
    JOIN materiales m ON m.id = d.material_id
    WHERE d.solicitud_id = ?
  `).all(s.id);

  const historial = req.db.prepare(`
    SELECT h.*, e.nombre AS estado, u.nombre || ' ' || u.apellido AS usuario
    FROM historial_solicitudes h
    LEFT JOIN estados_solicitud e ON e.id = h.estado_id
    LEFT JOIN usuarios u ON u.id = h.usuario_id
    WHERE h.solicitud_id = ?
    ORDER BY h.id ASC
  `).all(s.id);

  res.json({ success: true, data: { ...s, detalle, historial } });
});

router.post('/', (req, res) => {
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

  const ceco = req.db.prepare('SELECT id, jefe_proyecto_id FROM cecos WHERE id = ? AND activo = 1')
    .get(Number(body.ceco_id));
  if (!ceco) {
    return res.status(400).json({ success: false, message: 'CECO inválido' });
  }

  const codigo = nextCodigo(req.db);
  const ubicacion = body.ubicacion_entrega === 'directo-proveedor' ? 'directo-proveedor' : 'bodega';
  const estadoInicial = ubicacion === 'directo-proveedor' ? 1 : 1;

  const tx = req.db.transaction(() => {
    const info = req.db.prepare(`
      INSERT INTO solicitudes_materiales
        (codigo, ceco_id, estado_id, solicitante_id, jefe_proyecto_id, fecha_requerida,
         bodega_nombre, ubicacion_entrega, observaciones, quien_retira, quien_usa,
         numero_proyecto, forma_pedido, proveedor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    );

    const solicitudId = info.lastInsertRowid;
    const insertDet = req.db.prepare(`
      INSERT INTO solicitudes_detalle
        (solicitud_id, material_id, cantidad, unidad, cantidad_pendiente, precio_unitario, subtotal, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of materiales) {
      const mat = req.db.prepare('SELECT id, unidad, precio FROM materiales WHERE id = ? AND activo = 1')
        .get(Number(item.material_id));
      if (!mat) throw new Error(`Material inválido: ${item.material_id}`);
      const cantidad = Number(item.cantidad);
      if (!cantidad || cantidad <= 0) throw new Error('Cantidad inválida');
      const precio = Number(item.precio_unitario != null ? item.precio_unitario : mat.precio) || 0;
      insertDet.run(
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

    req.db.prepare(`
      INSERT INTO historial_solicitudes (solicitud_id, estado_id, usuario_id, accion, comentarios)
      VALUES (?, ?, ?, 'Creación', ?)
    `).run(solicitudId, estadoInicial, req.auth.userId, 'Solicitud creada');

    return solicitudId;
  });

  try {
    const id = tx();
    res.status(201).json({
      success: true,
      message: 'Solicitud creada correctamente',
      data: { id, codigo }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'No se pudo crear la solicitud' });
  }
});

router.post('/:id/aprobar', (req, res) => {
  const id = Number(req.params.id);
  const s = req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND eliminado = 0').get(id);
  if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
  if (s.estado_id !== 1) {
    return res.status(400).json({ success: false, message: 'La solicitud no está pendiente de aprobación' });
  }

  const nuevoEstado = s.ubicacion_entrega === 'directo-proveedor' ? 4 : 2;
  req.db.prepare(`
    UPDATE solicitudes_materiales
    SET estado_id = ?, fecha_actualizacion = datetime('now')
    WHERE id = ?
  `).run(nuevoEstado, id);

  req.db.prepare(`
    INSERT INTO historial_solicitudes (solicitud_id, estado_id, usuario_id, accion, comentarios)
    VALUES (?, ?, ?, 'Aprobación', ?)
  `).run(id, nuevoEstado, req.auth.userId, req.body?.comentarios || 'Aprobada');

  res.json({ success: true, message: 'Solicitud aprobada', estado_id: nuevoEstado });
});

router.post('/:id/rechazar', (req, res) => {
  const id = Number(req.params.id);
  const s = req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND eliminado = 0').get(id);
  if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
  if (![1, 4].includes(s.estado_id)) {
    return res.status(400).json({ success: false, message: 'No se puede rechazar en este estado' });
  }

  req.db.prepare(`
    UPDATE solicitudes_materiales SET estado_id = 7, fecha_actualizacion = datetime('now') WHERE id = ?
  `).run(id);

  req.db.prepare(`
    INSERT INTO historial_solicitudes (solicitud_id, estado_id, usuario_id, accion, comentarios)
    VALUES (?, 7, ?, 'Rechazo', ?)
  `).run(id, req.auth.userId, req.body?.comentarios || 'Rechazada');

  res.json({ success: true, message: 'Solicitud rechazada' });
});

router.post('/:id/anular', (req, res) => {
  const id = Number(req.params.id);
  const s = req.db.prepare('SELECT * FROM solicitudes_materiales WHERE id = ? AND eliminado = 0').get(id);
  if (!s) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });

  req.db.prepare(`
    UPDATE solicitudes_materiales SET estado_id = 8, eliminado = 1, fecha_actualizacion = datetime('now')
    WHERE id = ?
  `).run(id);

  req.db.prepare(`
    INSERT INTO historial_solicitudes (solicitud_id, estado_id, usuario_id, accion, comentarios)
    VALUES (?, 8, ?, 'Anulación', ?)
  `).run(id, req.auth.userId, req.body?.comentarios || 'Anulada');

  res.json({ success: true, message: 'Solicitud anulada' });
});

module.exports = router;
