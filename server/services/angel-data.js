/**
 * Contexto de datos de la empresa para Angel IA
 */
const { MODULE_CATALOG, listModules } = require('./angel-knowledge');

async function safeAll(db, sql, params = []) {
  try {
    return await db.prepare(sql).all(...params);
  } catch (err) {
    return { __error: err.message };
  }
}

function limitRows(n, fallback = 50) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return fallback;
  return Math.min(200, Math.max(1, Math.floor(x)));
}

function likeParam(q) {
  const s = String(q || '').trim();
  return s ? `%${s}%` : null;
}

async function getDashboardContext(db, company) {
  async function countOrZero(sql) {
    try {
      return Number((await db.prepare(sql).get())?.c || 0);
    } catch (_) {
      return 0;
    }
  }

  const pendientesMat = await countOrZero(`
    SELECT COUNT(*) AS c FROM solicitudes_materiales
    WHERE eliminado = 0 AND estado_id IN (1,2,3,4,5)
  `);

  const pendientesCompras = await countOrZero(`
    SELECT COUNT(*) AS c FROM solicitudes_compras
    WHERE eliminado = 0 AND estado IN ('Pendiente','En revisión')
  `);

  const ssggAbiertos = await countOrZero(`
    SELECT COUNT(*) AS c FROM servicios_generales
    WHERE eliminado = 0 AND estado IN ('Abierto','En proceso')
  `);

  const telecomPend = await countOrZero(`
    SELECT COUNT(*) AS c FROM requerimientos_telecom
    WHERE eliminado = 0 AND estado IN ('Pendiente','Asignado')
  `);

  const facturasPend = await countOrZero(`
    SELECT COUNT(*) AS c FROM aprobacion_facturas WHERE estado = 'Pendiente'
  `);

  const checklistPend = await countOrZero(`
    SELECT COUNT(*) AS c FROM checklist_flota
    WHERE COALESCE(anulado, 0) = 0 AND COALESCE(requiere_atencion, 0) = 1
  `);

  const agendaPend = await countOrZero(`
    SELECT COUNT(*) AS c FROM agenda_camion_pluma_v2
    WHERE COALESCE(eliminado, 0) = 0 AND estado IN ('Programado','Pendiente','En curso')
  `);

  const stockBajo = [];
  try {
    const rows = await db.prepare(`
      SELECT codigo, nombre, stock, unidad FROM materiales
      WHERE activo = 1 AND stock < 50
      ORDER BY stock ASC LIMIT 20
    `).all();
    stockBajo.push(...rows);
  } catch (_) { /* columna stock puede no existir */ }

  let porCeco = [];
  try {
    porCeco = await db.prepare(`
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
  } catch (_) {
    porCeco = [];
  }

  let recientes = [];
  try {
    recientes = await db.prepare(`
      SELECT s.codigo, s.numero_proyecto, e.nombre AS estado, s.fecha_solicitud,
             c.codigo AS ceco, u.nombre || ' ' || u.apellido AS solicitante
      FROM solicitudes_materiales s
      JOIN estados_solicitud e ON e.id = s.estado_id
      LEFT JOIN cecos c ON c.id = s.ceco_id
      JOIN usuarios u ON u.id = s.solicitante_id
      WHERE s.eliminado = 0
      ORDER BY s.id DESC LIMIT 15
    `).all();
  } catch (_) {
    recientes = [];
  }

  let materialesTop = [];
  try {
    materialesTop = await db.prepare(`
      SELECT m.codigo, m.nombre, SUM(d.cantidad) AS cantidad_solicitada, m.unidad
      FROM solicitudes_detalle d
      JOIN materiales m ON m.id = d.material_id
      JOIN solicitudes_materiales s ON s.id = d.solicitud_id
      WHERE s.eliminado = 0
      GROUP BY m.id
      ORDER BY cantidad_solicitada DESC
      LIMIT 15
    `).all();
  } catch (_) {
    materialesTop = [];
  }

  return {
    empresa: company.name,
    razonSocial: company.razonSocial,
    resumen: {
      solicitudes_materiales_activas: pendientesMat,
      compras_pendientes: pendientesCompras,
      ssgg_abiertos: ssggAbiertos,
      telecom_pendientes: telecomPend,
      facturas_pendientes: facturasPend,
      checklist_con_incidencias: checklistPend,
      agenda_camion_activas: agendaPend,
      materiales_stock_bajo: stockBajo.length
    },
    stock_bajo: stockBajo,
    por_ceco: porCeco,
    solicitudes_recientes: recientes,
    materiales_mas_solicitados: materialesTop,
    modulos_disponibles: listModules()
  };
}

async function getMovimientosSemana(db) {
  const isMysql = db.driver === 'mysql';
  const dateFilter = isMysql
    ? 's.fecha_solicitud >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)'
    : "date(s.fecha_solicitud) >= date('now', '-7 days')";
  try {
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
      WHERE s.eliminado = 0 AND ${dateFilter}
      ORDER BY c.codigo, s.fecha_solicitud DESC
    `).all();
  } catch (_) {
    return [];
  }
}

async function queryModule(db, modulo, opts = {}) {
  const mod = String(modulo || '').toLowerCase().trim();
  const limit = limitRows(opts.limite, 60);
  const q = likeParam(opts.buscar);
  const meta = MODULE_CATALOG[mod];
  if (!meta) {
    return {
      error: `Módulo desconocido: ${modulo}`,
      disponibles: listModules()
    };
  }

  let result;
  switch (mod) {
    case 'materiales':
      result = q
        ? await safeAll(db, `
            SELECT s.id, s.codigo, s.numero_proyecto, e.nombre AS estado, s.fecha_solicitud,
                   c.codigo AS ceco, u.nombre || ' ' || u.apellido AS solicitante
            FROM solicitudes_materiales s
            LEFT JOIN estados_solicitud e ON e.id = s.estado_id
            LEFT JOIN cecos c ON c.id = s.ceco_id
            LEFT JOIN usuarios u ON u.id = s.solicitante_id
            WHERE s.eliminado = 0 AND (s.codigo LIKE ? OR s.numero_proyecto LIKE ? OR c.codigo LIKE ?)
            ORDER BY s.id DESC LIMIT ${limit}
          `, [q, q, q])
        : await safeAll(db, `
            SELECT s.id, s.codigo, s.numero_proyecto, e.nombre AS estado, s.fecha_solicitud,
                   c.codigo AS ceco, u.nombre || ' ' || u.apellido AS solicitante
            FROM solicitudes_materiales s
            LEFT JOIN estados_solicitud e ON e.id = s.estado_id
            LEFT JOIN cecos c ON c.id = s.ceco_id
            LEFT JOIN usuarios u ON u.id = s.solicitante_id
            WHERE s.eliminado = 0
            ORDER BY s.id DESC LIMIT ${limit}
          `);
      break;

    case 'compras':
      result = q
        ? await safeAll(db, `
            SELECT id, numero_solicitud, fecha_solicitud, estado, observaciones
            FROM solicitudes_compras
            WHERE eliminado = 0 AND (numero_solicitud LIKE ? OR estado LIKE ?)
            ORDER BY id DESC LIMIT ${limit}
          `, [q, q])
        : await safeAll(db, `
            SELECT id, numero_solicitud, fecha_solicitud, estado, observaciones
            FROM solicitudes_compras WHERE eliminado = 0
            ORDER BY id DESC LIMIT ${limit}
          `);
      break;

    case 'ssgg':
      result = q
        ? await safeAll(db, `
            SELECT id, codigo, titulo, estado, fecha_creacion
            FROM servicios_generales WHERE eliminado = 0
              AND (codigo LIKE ? OR titulo LIKE ? OR estado LIKE ?)
            ORDER BY id DESC LIMIT ${limit}
          `, [q, q, q])
        : await safeAll(db, `
            SELECT id, codigo, titulo, estado, fecha_creacion
            FROM servicios_generales WHERE eliminado = 0
            ORDER BY id DESC LIMIT ${limit}
          `);
      break;

    case 'telecom':
      result = q
        ? await safeAll(db, `
            SELECT id, codigo, titulo, estado, fecha_creacion
            FROM requerimientos_telecom WHERE eliminado = 0
              AND (codigo LIKE ? OR titulo LIKE ? OR estado LIKE ?)
            ORDER BY id DESC LIMIT ${limit}
          `, [q, q, q])
        : await safeAll(db, `
            SELECT id, codigo, titulo, estado, fecha_creacion
            FROM requerimientos_telecom WHERE eliminado = 0
            ORDER BY id DESC LIMIT ${limit}
          `);
      break;

    case 'facturas':
      result = q
        ? await safeAll(db, `
            SELECT f.id, f.numero_factura, f.proveedor, f.monto, f.estado, l.codigo AS lote
            FROM aprobacion_facturas f
            LEFT JOIN aprobacion_facturas_lote l ON l.id = f.lote_id
            WHERE (f.numero_factura LIKE ? OR f.proveedor LIKE ? OR f.estado LIKE ?)
            ORDER BY f.id DESC LIMIT ${limit}
          `, [q, q, q])
        : await safeAll(db, `
            SELECT f.id, f.numero_factura, f.proveedor, f.monto, f.estado, l.codigo AS lote
            FROM aprobacion_facturas f
            LEFT JOIN aprobacion_facturas_lote l ON l.id = f.lote_id
            ORDER BY f.id DESC LIMIT ${limit}
          `);
      break;

    case 'checklist':
      result = q
        ? await safeAll(db, `
            SELECT id, codigo, patente, kilometraje,
                   COALESCE(fecha, fecha_inspeccion) AS fecha,
                   COALESCE(estado_general, estado) AS estado,
                   requiere_atencion, estado_seguimiento,
                   vehiculo_marca, vehiculo_modelo, observaciones
            FROM checklist_flota
            WHERE COALESCE(anulado, 0) = 0
              AND (patente LIKE ? OR codigo LIKE ? OR COALESCE(vehiculo_modelo,'') LIKE ?
                   OR COALESCE(propietario_nombre,'') LIKE ? OR COALESCE(observaciones,'') LIKE ?)
            ORDER BY id DESC LIMIT ${limit}
          `, [q, q, q, q, q])
        : await safeAll(db, `
            SELECT id, codigo, patente, kilometraje,
                   COALESCE(fecha, fecha_inspeccion) AS fecha,
                   COALESCE(estado_general, estado) AS estado,
                   requiere_atencion, estado_seguimiento,
                   vehiculo_marca, vehiculo_modelo, observaciones
            FROM checklist_flota
            WHERE COALESCE(anulado, 0) = 0
            ORDER BY id DESC LIMIT ${limit}
          `);
      break;

    case 'flota':
    case 'catalogo_flota':
    case 'catalogo-flota': {
      try {
        const { angelBuscarFlota } = require('./flota-catalogo');
        result = await angelBuscarFlota(db, opts.q || opts.buscar || '', limit);
        // angelBuscarFlota ya trae { data, total, ... }; queryModule espera array o lo envuelve
        if (result && Array.isArray(result.data)) {
          return {
            modulo: 'flota',
            label: 'Catálogo flota (Excel)',
            total: result.total,
            total_catalogo: result.total_catalogo,
            archivo: result.archivo,
            nota: result.nota,
            data: result.data
          };
        }
      } catch (e) {
        result = { __error: e.message };
      }
      break;
    }

    case 'inspeccion': {
      try {
        const { angelSummary } = require('./inspeccion');
        result = await angelSummary(db, { q: opts.q || '', limit });
      } catch (e) {
        result = { error: e.message };
      }
      break;
    }

    case 'agenda':
      result = q
        ? await safeAll(db, `
            SELECT id, codigo, fecha, estado, origen, destino, observaciones
            FROM agenda_camion_pluma_v2
            WHERE COALESCE(eliminado, 0) = 0
              AND (codigo LIKE ? OR origen LIKE ? OR destino LIKE ? OR estado LIKE ?)
            ORDER BY id DESC LIMIT ${limit}
          `, [q, q, q, q])
        : await safeAll(db, `
            SELECT id, codigo, fecha, estado, origen, destino, observaciones
            FROM agenda_camion_pluma_v2
            WHERE COALESCE(eliminado, 0) = 0
            ORDER BY id DESC LIMIT ${limit}
          `);
      break;

    case 'contratos':
      result = q
        ? await safeAll(db, `
            SELECT id, codigo, titulo, estado, fecha_creacion
            FROM seguimiento_contratos
            WHERE COALESCE(eliminado, 0) = 0
              AND (codigo LIKE ? OR titulo LIKE ? OR estado LIKE ?)
            ORDER BY id DESC LIMIT ${limit}
          `, [q, q, q])
        : await safeAll(db, `
            SELECT id, codigo, titulo, estado, fecha_creacion
            FROM seguimiento_contratos
            WHERE COALESCE(eliminado, 0) = 0
            ORDER BY id DESC LIMIT ${limit}
          `);
      break;

    case 'usuarios':
      result = q
        ? await safeAll(db, `
            SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, r.nombre AS rol, d.nombre AS departamento
            FROM usuarios u
            LEFT JOIN roles r ON r.id = u.rol_id
            LEFT JOIN departamentos d ON d.id = u.departamento_id
            WHERE u.activo = 1
              AND (u.nombre LIKE ? OR u.apellido LIKE ? OR u.email LIKE ? OR u.cargo LIKE ?)
            ORDER BY u.nombre, u.apellido LIMIT ${limit}
          `, [q, q, q, q])
        : await safeAll(db, `
            SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, r.nombre AS rol, d.nombre AS departamento
            FROM usuarios u
            LEFT JOIN roles r ON r.id = u.rol_id
            LEFT JOIN departamentos d ON d.id = u.departamento_id
            WHERE u.activo = 1
            ORDER BY u.nombre, u.apellido LIMIT ${limit}
          `);
      break;

    case 'cecos':
      result = q
        ? await safeAll(db, `
            SELECT c.id, c.codigo, c.nombre,
                   u.nombre || ' ' || u.apellido AS jefe_proyecto, u.email AS jefe_email
            FROM cecos c
            LEFT JOIN usuarios u ON u.id = c.jefe_proyecto_id
            WHERE c.activo = 1 AND (c.codigo LIKE ? OR c.nombre LIKE ?)
            ORDER BY c.codigo LIMIT ${limit}
          `, [q, q])
        : await safeAll(db, `
            SELECT c.id, c.codigo, c.nombre,
                   u.nombre || ' ' || u.apellido AS jefe_proyecto, u.email AS jefe_email
            FROM cecos c
            LEFT JOIN usuarios u ON u.id = c.jefe_proyecto_id
            WHERE c.activo = 1
            ORDER BY c.codigo LIMIT ${limit}
          `);
      break;

    case 'proveedores':
      result = q
        ? await safeAll(db, `
            SELECT id, COALESCE(razon_social, nombre) AS nombre, rut, email, telefono
            FROM proveedores
            WHERE (COALESCE(razon_social, nombre) LIKE ? OR rut LIKE ? OR email LIKE ?)
            ORDER BY id DESC LIMIT ${limit}
          `, [q, q, q])
        : await safeAll(db, `
            SELECT id, COALESCE(razon_social, nombre) AS nombre, rut, email, telefono
            FROM proveedores
            ORDER BY id DESC LIMIT ${limit}
          `);
      break;

    case 'inventario':
      result = q
        ? await safeAll(db, `
            SELECT codigo, nombre, unidad, stock, precio
            FROM materiales WHERE activo = 1 AND (codigo LIKE ? OR nombre LIKE ?)
            ORDER BY nombre LIMIT ${limit}
          `, [q, q])
        : await safeAll(db, `
            SELECT codigo, nombre, unidad, stock, precio
            FROM materiales WHERE activo = 1
            ORDER BY nombre LIMIT ${limit}
          `);
      break;

    case 'recetas': {
      const tipos = await safeAll(db, `
        SELECT id, nombre, descripcion FROM materiales_receta_tipos
        WHERE activo = 1 ORDER BY nombre LIMIT ${limit}
      `);
      const insumos = q
        ? await safeAll(db, `
            SELECT t.nombre AS tipo_obra, i.descripcion, i.cantidad AS cantidad_por_obra, i.unidad, i.categoria,
                   m.codigo AS material_codigo, m.nombre AS material_nombre
            FROM materiales_receta_insumos i
            JOIN materiales_receta_tipos t ON t.id = i.tipo_id
            LEFT JOIN materiales m ON m.id = i.material_id
            WHERE COALESCE(i.activo, 1) = 1
              AND (t.nombre LIKE ? OR i.descripcion LIKE ? OR COALESCE(m.nombre,'') LIKE ? OR COALESCE(m.codigo,'') LIKE ?)
            ORDER BY t.nombre, i.id LIMIT ${limit}
          `, [q, q, q, q])
        : await safeAll(db, `
            SELECT t.nombre AS tipo_obra, i.descripcion, i.cantidad AS cantidad_por_obra, i.unidad, i.categoria,
                   m.codigo AS material_codigo, m.nombre AS material_nombre
            FROM materiales_receta_insumos i
            JOIN materiales_receta_tipos t ON t.id = i.tipo_id
            LEFT JOIN materiales m ON m.id = i.material_id
            WHERE COALESCE(i.activo, 1) = 1
            ORDER BY t.nombre, i.id LIMIT ${limit}
          `);
      if (insumos && insumos.__error) {
        result = insumos;
      } else if (tipos && tipos.__error) {
        result = tipos;
      } else {
        result = Array.isArray(insumos) ? insumos : [];
        // Prefijo informativo en primera fila si hay tipos
        if (Array.isArray(tipos) && tipos.length && result.length) {
          result = [
            {
              nota: 'Recetas = tope por tipo de obra. Pedir con Salida por Actividad (cantidad_por_obra × obras).',
              tipos_disponibles: tipos.map((t) => t.nombre).join(', ')
            },
            ...result
          ];
        }
      }
      break;
    }

    default:
      return { error: 'Módulo no implementado', disponibles: listModules() };
  }

  if (result && result.__error) {
    return {
      modulo: mod,
      label: meta.label,
      error: result.__error,
      total: 0,
      data: []
    };
  }

  const rows = Array.isArray(result) ? result : [];
  return {
    modulo: mod,
    label: meta.label,
    total: rows.length,
    data: rows
  };
}

async function scanPendientes(db) {
  const alerts = [];

  let mat = [];
  try {
    mat = await db.prepare(`
      SELECT s.id, s.codigo, s.numero_proyecto, s.fecha_solicitud, s.solicitante_id,
             COALESCE(s.jefe_proyecto_id, c.jefe_proyecto_id) AS jefe_id,
             e.nombre AS estado
      FROM solicitudes_materiales s
      JOIN estados_solicitud e ON e.id = s.estado_id
      LEFT JOIN cecos c ON c.id = s.ceco_id
      WHERE s.eliminado = 0 AND s.estado_id IN (1, 2, 3, 4, 5)
      ORDER BY s.id DESC LIMIT 40
    `).all();
  } catch (_) { mat = []; }

  for (const r of mat) {
    const base = {
      tipo: 'actividad_solicitud',
      severidad: r.estado && String(r.estado).toLowerCase().includes('pendiente') ? 'alta' : 'media',
      titulo: `${r.codigo} · ${r.estado}`,
      mensaje: `Proyecto ${r.numero_proyecto || '—'} · ${r.fecha_solicitud}. Requiere tu atención.`,
      modulo: 'materiales',
      referencia: `solmat:${r.id}`
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

  let compras = [];
  try {
    compras = await db.prepare(`
      SELECT id, numero_solicitud, fecha_solicitud, solicitante_id, jefe_proyecto_id, estado
      FROM solicitudes_compras
      WHERE eliminado = 0 AND estado IN ('Pendiente', 'En revisión')
      LIMIT 30
    `).all();
  } catch (_) { compras = []; }

  for (const r of compras) {
    const item = {
      tipo: 'compra_pendiente',
      severidad: 'media',
      titulo: `Compra ${r.numero_solicitud} · ${r.estado}`,
      mensaje: `Solicitud de compra del ${r.fecha_solicitud} pendiente de gestión.`,
      modulo: 'compras',
      referencia: `compra:${r.id}`
    };
    if (r.solicitante_id) alerts.push({ ...item, usuario_id: r.solicitante_id });
    if (r.jefe_proyecto_id) alerts.push({ ...item, usuario_id: r.jefe_proyecto_id, severidad: 'alta' });
  }

  let stock = [];
  try {
    stock = await db.prepare(`
      SELECT codigo, nombre, stock FROM materiales WHERE activo = 1 AND stock <= 20 LIMIT 15
    `).all();
  } catch (_) { stock = []; }

  let destinatariosStock = [];
  try {
    destinatariosStock = await db.prepare(`
      SELECT id FROM usuarios WHERE activo = 1 AND rol_id IN (1, 4)
    `).all();
  } catch (_) { destinatariosStock = []; }

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

  let facturas = [];
  try {
    facturas = await db.prepare(`
      SELECT f.numero_factura, f.proveedor, f.monto, l.codigo AS lote, l.aprobador_id
      FROM aprobacion_facturas f
      JOIN aprobacion_facturas_lote l ON l.id = f.lote_id
      WHERE f.estado = 'Pendiente' LIMIT 20
    `).all();
  } catch (_) { facturas = []; }

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

  let ssgg = [];
  try {
    ssgg = await db.prepare(`
      SELECT codigo, titulo, estado, solicitante_id FROM servicios_generales
      WHERE eliminado = 0 AND estado IN ('Abierto', 'En proceso') LIMIT 20
    `).all();
  } catch (_) { ssgg = []; }

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
  scanPendientes,
  queryModule,
  listModules
};
