/**
 * Contexto de datos de la empresa para Angel IA
 */
async function getDashboardContext(db, company) {
  const pendientesMat = (await db.prepare(`
    SELECT COUNT(*) AS c FROM solicitudes_materiales
    WHERE eliminado = 0 AND estado_id IN (1,2,3,4,5)
  `).get()).c;

  const pendientesCompras = (await db.prepare(`
    SELECT COUNT(*) AS c FROM solicitudes_compras
    WHERE eliminado = 0 AND estado IN ('Pendiente','En revisión')
  `).get()).c;

  const ssggAbiertos = (await db.prepare(`
    SELECT COUNT(*) AS c FROM servicios_generales
    WHERE eliminado = 0 AND estado IN ('Abierto','En proceso')
  `).get()).c;

  const telecomPend = (await db.prepare(`
    SELECT COUNT(*) AS c FROM requerimientos_telecom
    WHERE eliminado = 0 AND estado IN ('Pendiente','Asignado')
  `).get()).c;

  const facturasPend = (await db.prepare(`
    SELECT COUNT(*) AS c FROM aprobacion_facturas WHERE estado = 'Pendiente'
  `).get()).c;

  const stockBajo = [];
  try {
    const rows = await db.prepare(`
      SELECT codigo, nombre, stock, unidad FROM materiales
      WHERE activo = 1 AND stock < 50
      ORDER BY stock ASC LIMIT 20
    `).all();
    stockBajo.push(...rows);
  } catch (_) { /* columna stock puede no existir en MySQL productivo */ }

  const porCeco = await db.prepare(`
    SELECT c.codigo, c.nombre,
           COUNT(s.id) AS solicitudes,
           SUM(CASE WHEN s.estado_id IN (1,2,3,4,5) THEN 1 ELSE 0 END) AS activas,
           u.nombre || ' ' || u.apellido AS jefe_proyecto,
           u.email AS jefe_email
    FROM cecos c
    LEFT JOIN solicitudes_materiales s ON s.ceco_id = c.id AND s.eliminado = 0
    LEFT JOIN usuarios u ON u.id = c.jefe_proyecto_id
    WHERE c.activo = 1
    GROUP BY c.id
    ORDER BY c.codigo
  `).all();

  const recientes = await db.prepare(`
    SELECT s.codigo, s.numero_proyecto, e.nombre AS estado, s.fecha_solicitud,
           c.codigo AS ceco, u.nombre || ' ' || u.apellido AS solicitante
    FROM solicitudes_materiales s
    JOIN estados_solicitud e ON e.id = s.estado_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    JOIN usuarios u ON u.id = s.solicitante_id
    WHERE s.eliminado = 0
    ORDER BY s.id DESC LIMIT 15
  `).all();

  const materialesTop = await db.prepare(`
    SELECT m.codigo, m.nombre, SUM(d.cantidad) AS cantidad_solicitada, m.unidad
    FROM solicitudes_detalle d
    JOIN materiales m ON m.id = d.material_id
    JOIN solicitudes_materiales s ON s.id = d.solicitud_id
    WHERE s.eliminado = 0
    GROUP BY m.id
    ORDER BY cantidad_solicitada DESC
    LIMIT 15
  `).all();

  return {
    empresa: company.name,
    razonSocial: company.razonSocial,
    resumen: {
      solicitudes_materiales_activas: pendientesMat,
      compras_pendientes: pendientesCompras,
      ssgg_abiertos: ssggAbiertos,
      telecom_pendientes: telecomPend,
      facturas_pendientes: facturasPend,
      materiales_stock_bajo: stockBajo.length
    },
    stock_bajo: stockBajo,
    por_ceco: porCeco,
    solicitudes_recientes: recientes,
    materiales_mas_solicitados: materialesTop
  };
}

async function getMovimientosSemana(db) {
  return await db.prepare(`
    SELECT s.codigo, s.numero_proyecto, s.fecha_solicitud, s.ubicacion_entrega,
           e.nombre AS estado, c.codigo AS ceco_codigo, c.nombre AS ceco_nombre,
           jp.nombre || ' ' || jp.apellido AS jefe_proyecto, jp.email AS jefe_email,
           u.nombre || ' ' || u.apellido AS solicitante,
           m.codigo AS material_codigo, m.nombre AS material_nombre,
           d.cantidad, d.unidad, d.precio_unitario, d.subtotal
    FROM solicitudes_materiales s
    JOIN estados_solicitud e ON e.id = s.estado_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    LEFT JOIN usuarios jp ON jp.id = COALESCE(s.jefe_proyecto_id, c.jefe_proyecto_id)
    JOIN usuarios u ON u.id = s.solicitante_id
    LEFT JOIN solicitudes_detalle d ON d.solicitud_id = s.id
    LEFT JOIN materiales m ON m.id = d.material_id
    WHERE s.eliminado = 0
      AND date(s.fecha_solicitud) >= date('now', '-7 days')
    ORDER BY c.codigo, s.fecha_solicitud DESC
  `).all();
}

/**
 * Genera alertas dirigidas a usuarios concretos (no al home).
 * usuario_id: destinatario de la alerta
 */
async function scanPendientes(db) {
  const alerts = [];

  // Solicitudes de materiales pendientes → aviso al JP y al solicitante
  const mat = await db.prepare(`
    SELECT s.id, s.codigo, s.numero_proyecto, s.fecha_solicitud, s.solicitante_id,
           COALESCE(s.jefe_proyecto_id, c.jefe_proyecto_id) AS jefe_id,
           e.nombre AS estado
    FROM solicitudes_materiales s
    JOIN estados_solicitud e ON e.id = s.estado_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    WHERE s.eliminado = 0 AND s.estado_id IN (1, 2, 3, 4, 5)
    ORDER BY s.id DESC LIMIT 40
  `).all();

  for (const r of mat) {
    const base = {
      tipo: 'actividad_solicitud',
      severidad: r.estado && String(r.estado).toLowerCase().includes('pendiente') ? 'alta' : 'media',
      titulo: `${r.codigo} · ${r.estado}`,
      mensaje: `Proyecto ${r.numero_proyecto || '—'} · ${r.fecha_solicitud}. Requiere tu atención.`,
      modulo: 'materiales',
      referencia: `${r.codigo}:${r.estado}`
    };
    if (r.jefe_id) alerts.push({ ...base, usuario_id: r.jefe_id, tipo: 'pendiente_aprobacion' });
    if (r.solicitante_id) {
      alerts.push({
        ...base,
        usuario_id: r.solicitante_id,
        tipo: 'actividad_propia',
        severidad: 'baja',
        titulo: `Tu solicitud ${r.codigo}`,
        mensaje: `Estado actual: ${r.estado}. Proyecto ${r.numero_proyecto || '—'}.`
      });
    }
  }

  // Compras pendientes → solicitante y jefe
  const compras = await db.prepare(`
    SELECT id, numero_solicitud, fecha_solicitud, solicitante_id, jefe_proyecto_id, estado
    FROM solicitudes_compras
    WHERE eliminado = 0 AND estado IN ('Pendiente', 'En revisión')
    LIMIT 30
  `).all();
  for (const r of compras) {
    const item = {
      tipo: 'compra_pendiente',
      severidad: 'media',
      titulo: `Compra ${r.numero_solicitud} · ${r.estado}`,
      mensaje: `Solicitud de compra del ${r.fecha_solicitud} pendiente de gestión.`,
      modulo: 'compras',
      referencia: r.numero_solicitud
    };
    if (r.solicitante_id) alerts.push({ ...item, usuario_id: r.solicitante_id });
    if (r.jefe_proyecto_id) alerts.push({ ...item, usuario_id: r.jefe_proyecto_id, severidad: 'alta' });
  }

  // Stock bajo → bodegueros y admins (roles 1 y 4)
  let stock = [];
  try {
    stock = await db.prepare(`
      SELECT codigo, nombre, stock FROM materiales WHERE activo = 1 AND stock <= 20 LIMIT 15
    `).all();
  } catch (_) {
    stock = [];
  }
  const destinatariosStock = await db.prepare(`
    SELECT id FROM usuarios WHERE activo = 1 AND rol_id IN (1, 4)
  `).all();
  for (const r of stock) {
    for (const u of destinatariosStock) {
      alerts.push({
        tipo: 'stock_bajo',
        severidad: r.stock <= 5 ? 'alta' : 'media',
        titulo: `Stock bajo: ${r.codigo}`,
        mensaje: `${r.nombre} tiene solo ${r.stock} unidades.`,
        modulo: 'inventario',
        referencia: r.codigo,
        usuario_id: u.id
      });
    }
  }

  // Facturas pendientes → aprobador del lote + admins
  const facturas = await db.prepare(`
    SELECT f.numero_factura, f.proveedor, f.monto, l.codigo AS lote, l.aprobador_id
    FROM aprobacion_facturas f
    JOIN aprobacion_facturas_lote l ON l.id = f.lote_id
    WHERE f.estado = 'Pendiente' LIMIT 20
  `).all();
  for (const r of facturas) {
    const item = {
      tipo: 'factura_pendiente',
      severidad: 'media',
      titulo: `Factura ${r.numero_factura || 's/n'} pendiente`,
      mensaje: `${r.proveedor || 'Proveedor'} · $${Number(r.monto || 0).toLocaleString('es-CL')} · lote ${r.lote}.`,
      modulo: 'facturas',
      referencia: `${r.lote}:${r.numero_factura || 'x'}`
    };
    if (r.aprobador_id) alerts.push({ ...item, usuario_id: r.aprobador_id });
  }

  // SSGG abiertos → solicitante
  const ssgg = await db.prepare(`
    SELECT codigo, titulo, estado, solicitante_id FROM servicios_generales
    WHERE eliminado = 0 AND estado IN ('Abierto', 'En proceso') LIMIT 20
  `).all();
  for (const r of ssgg) {
    if (!r.solicitante_id) continue;
    alerts.push({
      tipo: 'ssgg_abierto',
      severidad: 'media',
      titulo: `${r.codigo} · ${r.estado}`,
      mensaje: r.titulo,
      modulo: 'ssgg',
      referencia: r.codigo,
      usuario_id: r.solicitante_id
    });
  }

  return alerts.filter((a) => a.usuario_id);
}

module.exports = {
  getDashboardContext,
  getMovimientosSemana,
  scanPendientes
};
