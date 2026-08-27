const express = require('express');
const { authRequired } = require('../middleware/auth');
const { listAgendaCamion, saveAgendaCamion, deleteAgendaCamion, exportAgendaExcel } = require('../services/agenda-camion');
const {
  listChecklistFlota, getChecklistFlota, createChecklistFlota, assignChecklistFlota,
  anularChecklistFlota, updateChecklistFlota, saveChecklistPhoto, getInspectionCatalog, getPhotoCatalog
} = require('../services/checklist-flota');
const {
  buscarDirecciones, calcularDistancia, getTramosYPrecios, getRutas, calcularPrecioDesdeKm,
  saveTramosYPrecios, resetTramosDuplicados, restablecerTramosOficiales
} = require('../services/camion-pluma-geo');

const router = express.Router();
router.use(authRequired);

/** Envuelve GET: si la tabla/columna no existe en MySQL, no tumba la página */
const _get = router.get.bind(router);
router.get = (path, ...handlers) => {
  const last = handlers[handlers.length - 1];
  if (typeof last === 'function') {
    handlers[handlers.length - 1] = async (req, res, next) => {
      try {
        await last(req, res, next);
      } catch (err) {
        console.error(`[GET /api/modulos${path}]`, err.message);
        if (!res.headersSent) {
          res.json({ success: true, data: [], warning: err.message });
        }
      }
    };
  }
  return _get(path, ...handlers);
};

async function nextCode(db, table, column, prefix) {
  const row = await db.prepare(
    `SELECT ${column} AS c FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`);
  let n = 1;
  if (row && row.c) {
    const m = String(row.c).match(/(\d+)\s*$/);
    if (m) n = Number(m[1]) + 1;
  }
  return `${prefix}${String(n).padStart(5, '0')}`;
}

async function toTrash(db, userId, tipo, referenciaId, codigo, titulo, datos) {
  await db.prepare(`
    INSERT INTO papelera (tipo, referencia_id, codigo, titulo, datos_json, eliminado_por)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tipo, referenciaId, codigo || null, titulo || null, JSON.stringify(datos || {}), userId);
}

function isAdminUser(user) {
  if (!user) return false;
  if (user.rol_id === 1) return true;
  if (Array.isArray(user.rol_ids) && user.rol_ids.map(Number).includes(1)) return true;
  const names = [
    user.rol,
    ...(Array.isArray(user.roles) ? user.roles : [])
  ].join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return /\badmin|\badministrador|\bsubadmin|\bsubadministrador|\bsub-administrador/.test(names)
    || names.includes('admin');
}

function hasUserFlag(user, flag) {
  return !!user?.[flag] || isAdminUser(user);
}

function userHasPageAccess(user, pageKey) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  try {
    const { isModuleEnabledForUser } = require('../services/empresa-modulos');
    if (!isModuleEnabledForUser(user, pageKey)) return false;
  } catch (_) { /* schema opcional */ }
  let pages = user.paginas_permitidas;
  try {
    if (typeof pages === 'string') pages = JSON.parse(pages);
  } catch (_) {
    pages = [];
  }
  if (!Array.isArray(pages)) return false;
  if (pages.includes('*')) return true;
  const target = String(pageKey || '').replace(/^\//, '').toLowerCase();
  const targetBase = target.replace(/\.html$/i, '');
  return pages.some((p) => {
    const a = String(p || '').replace(/^\//, '').toLowerCase();
    return a === target || a.replace(/\.html$/i, '') === targetBase;
  });
}

async function hasPermisoEspecial(db, user, codigo) {
  if (isAdminUser(user)) return true;
  try {
    const { userHas } = require('../services/permisos-especiales');
    return await userHas(db, user.id, codigo);
  } catch (_) {
    return false;
  }
}

function denyUnlessFlag(req, res, flag, message) {
  if (hasUserFlag(req.auth?.user, flag)) return false;
  res.status(403).json({ success: false, message: message || 'No tienes permiso para esta acción' });
  return true;
}

/** Cualquier rol con ticket Checklist Flota (o atributo) puede generar inspecciones. */
function canCrearChecklistFlota(req) {
  const user = req.auth?.user;
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (hasUserFlag(user, 'flag_checklist')) return true;
  return userHasPageAccess(user, 'checklist-flota.html');
}

/** Quien tiene el módulo Agenda Camión Pluma (check del rol) puede pedir, guardar y editar. */
async function canGestionarAgendaCamion(req) {
  const user = req.auth?.user;
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (hasUserFlag(user, 'flag_camion_pluma')) return true;
  if (userHasPageAccess(user, 'agenda-camion-pluma.html')) return true;
  return await hasPermisoEspecial(req.db, user, 'camion_agenda_control');
}

/** Km/precios de venta: flag o permiso especial (no basta solo el check del módulo). */
async function canEditarPreciosCamion(req) {
  const user = req.auth?.user;
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (hasUserFlag(user, 'flag_camion_pluma')) return true;
  return await hasPermisoEspecial(req.db, user, 'camion_editar_km_precios');
}

function denyUnlessCrearChecklist(req, res, message) {
  if (canCrearChecklistFlota(req)) return false;
  res.status(403).json({
    success: false,
    message: message || 'No tienes acceso a Checklist Flota para registrar inspecciones'
  });
  return true;
}

/* ========== COMPRAS ========== */
router.get('/compras', async (req, res) => {
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
  res.json({ success: true, data: await req.db.prepare(sql).all(...params) });
});

router.get('/compras/:id', async (req, res) => {
  const s = await req.db.prepare(`
    SELECT s.*, u.nombre || ' ' || u.apellido AS solicitante, c.codigo AS ceco_codigo, c.nombre AS ceco_nombre
    FROM solicitudes_compras s
    JOIN usuarios u ON u.id = s.solicitante_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    WHERE s.id = ? AND s.eliminado = 0
  `).get(Number(req.params.id));
  if (!s) return res.status(404).json({ success: false, message: 'No encontrada' });
  const detalle = await req.db.prepare(`
    SELECT d.*, m.codigo AS material_codigo, m.nombre AS material_nombre
    FROM solicitudes_compras_detalle d
    LEFT JOIN materiales m ON m.id = d.material_id
    WHERE d.solicitud_id = ?
  `).all(s.id);
  res.json({ success: true, data: { ...s, detalle } });
});

router.post('/compras', async (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!b.ceco_id) return res.status(400).json({ success: false, message: 'CECO requerido' });
  if (!items.length) return res.status(400).json({ success: false, message: 'Agregue ítems' });
  const codigo = await nextCode(req.db, 'solicitudes_compras', 'numero_solicitud', 'SC-');
  const tx = req.db.transaction(async () => {
    const info = await req.db.prepare(`
      INSERT INTO solicitudes_compras
        (numero_solicitud, solicitante_id, ceco_id, jefe_proyecto_id, fecha_requerida, estado, observaciones)
      VALUES (?, ?, ?, ?, ?, 'Pendiente', ?)
    `).run(codigo, req.auth.userId, Number(b.ceco_id), b.jefe_proyecto_id || null, b.fecha_requerida || null, b.observaciones || null);
    const id = info.lastInsertRowid;
    const ins = await req.db.prepare(`
      INSERT INTO solicitudes_compras_detalle
        (solicitud_id, material_id, descripcion, cantidad, unidad, precio_estimado, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of items) {
      await ins.run(id, it.material_id || null, it.descripcion || '', Number(it.cantidad) || 1, it.unidad || 'UN', Number(it.precio_estimado) || 0, it.observaciones || null);
    }
    return id;
  });
  const id = await tx();
  res.status(201).json({ success: true, data: { id, numero_solicitud: codigo } });
});

router.post('/compras/:id/estado', async (req, res) => {
  const estado = req.body?.estado;
  if (!estado) return res.status(400).json({ success: false, message: 'Estado requerido' });
  await req.db.prepare(`UPDATE solicitudes_compras SET estado = ? WHERE id = ? AND eliminado = 0`)
    .run(estado, Number(req.params.id));
  res.json({ success: true, message: 'Estado actualizado' });
});

router.post('/compras/:id/eliminar', async (req, res) => {
  const id = Number(req.params.id);
  const s = await req.db.prepare(`SELECT * FROM solicitudes_compras WHERE id = ?`).get(id);
  if (!s) return res.status(404).json({ success: false, message: 'No encontrada' });
  await req.db.prepare(`UPDATE solicitudes_compras SET eliminado = 1 WHERE id = ?`).run(id);
  await toTrash(req.db, req.auth.userId, 'compras', id, s.numero_solicitud, s.observaciones, s);
  res.json({ success: true, message: 'Movida a papelera' });
});

/* ========== PORTAL PROVEEDORES ========== */
async function portalCaps(req) {
  const canValidateGuia = hasUserFlag(req.auth?.user, 'flag_aprobador_salida')
    || await hasPermisoEspecial(req.db, req.auth.user, 'guias_validador')
    || await hasPermisoEspecial(req.db, req.auth.user, 'validador_oc_supply_chain')
    || await hasPermisoEspecial(req.db, req.auth.user, 'materiales_super_aprobador');
  const canAprobarFactura = canValidateGuia
    || await hasPermisoEspecial(req.db, req.auth.user, 'facturas_aprobador');
  return { can_validate_guia: canValidateGuia, can_aprobar_factura: canAprobarFactura };
}

router.get('/portal', async (req, res) => {
  const caps = await portalCaps(req);
  try {
    const data = await req.db.prepare(`
      SELECT p.*, s.codigo AS solicitud_codigo, s.numero_proyecto,
             COALESCE(pr.razon_social, pr.nombre) AS proveedor_nombre, e.nombre AS solicitud_estado
      FROM portal_proveedor p
      JOIN solicitudes_materiales s ON s.id = p.solicitud_id
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      LEFT JOIN estados_solicitud e ON e.id = s.estado_id
      ORDER BY p.id DESC LIMIT 200
    `).all();
    return res.json({ success: true, data, ...caps });
  } catch (_) { /* fallback abajo */ }

  try {
    const data = await req.db.prepare(`
      SELECT p.*, s.codigo AS solicitud_codigo, s.numero_proyecto,
             pr.nombre AS proveedor_nombre, e.nombre AS solicitud_estado
      FROM portal_proveedor p
      JOIN solicitudes_materiales s ON s.id = p.solicitud_id
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      LEFT JOIN estados_solicitud e ON e.id = s.estado_id
      ORDER BY p.id DESC LIMIT 200
    `).all();
    return res.json({ success: true, data, ...caps });
  } catch (err) {
    // Productivo: portal embebido en solicitudes
    try {
      const data = await req.db.prepare(`
        SELECT s.id, s.id AS solicitud_id, s.codigo AS solicitud_codigo, s.numero_proyecto,
               s.portal_estado AS guia_estado, s.guia_proveedor_numero AS numero_guia,
               s.guia_proveedor_persona_retira AS persona_retira,
               COALESCE(pr.razon_social, pr.nombre) AS proveedor_nombre,
               e.nombre AS solicitud_estado
        FROM solicitudes_materiales s
        LEFT JOIN proveedores pr ON pr.id = s.proveedor_id
        LEFT JOIN estados_solicitud e ON e.id = s.estado_id
        WHERE s.eliminado = 0 AND (s.ubicacion_entrega = 'directo-proveedor' OR s.portal_estado IS NOT NULL)
        ORDER BY s.id DESC LIMIT 200
      `).all();
      return res.json({ success: true, data, ...caps });
    } catch (err2) {
      console.error('portal', err2.message);
      return res.json({ success: true, data: [], warning: err2.message, ...caps });
    }
  }
});

router.post('/portal/:id/guia', async (req, res) => {
  const b = req.body || {};
  await req.db.prepare(`
    UPDATE portal_proveedor
    SET numero_guia = ?, fecha_entrega = ?, persona_retira = ?, guia_estado = 'Subida', observaciones = ?
    WHERE id = ?
  `).run(b.numero_guia || null, b.fecha_entrega || null, b.persona_retira || null, b.observaciones || null, Number(req.params.id));
  res.json({ success: true, message: 'Guía registrada' });
});

router.post('/portal/:id/factura', async (req, res) => {
  const b = req.body || {};
  await req.db.prepare(`
    UPDATE portal_proveedor
    SET numero_factura = ?, monto_factura = ?, factura_estado = 'Subida'
    WHERE id = ?
  `).run(b.numero_factura || null, Number(b.monto_factura) || 0, Number(req.params.id));
  res.json({ success: true, message: 'Factura registrada' });
});

router.post('/portal/:id/validar-guia', async (req, res) => {
  const caps = await portalCaps(req);
  if (!caps.can_validate_guia) {
    return res.status(403).json({ success: false, message: 'Solo validadores de guía (permiso especial) pueden validar' });
  }
  const ok = req.body?.aprobar !== false;
  await req.db.prepare(`UPDATE portal_proveedor SET guia_estado = ? WHERE id = ?`)
    .run(ok ? 'Validada' : 'Rechazada', Number(req.params.id));
  res.json({ success: true, message: ok ? 'Guía validada' : 'Guía rechazada' });
});

router.post('/portal/:id/aprobar-factura', async (req, res) => {
  const caps = await portalCaps(req);
  if (!caps.can_aprobar_factura) {
    return res.status(403).json({ success: false, message: 'Solo aprobadores de factura (permiso especial) pueden aprobar' });
  }
  const ok = req.body?.aprobar !== false;
  await req.db.prepare(`UPDATE portal_proveedor SET factura_estado = ? WHERE id = ?`)
    .run(ok ? 'Aprobada' : 'Rechazada', Number(req.params.id));
  res.json({ success: true, message: ok ? 'Factura aprobada' : 'Factura rechazada' });
});

/* ========== RECETAS ========== */
router.get('/recetas', async (req, res) => {
  const tipos = await req.db.prepare(`SELECT * FROM materiales_receta_tipos WHERE activo = 1 ORDER BY nombre`).all();
  const insumos = await req.db.prepare(`
    SELECT i.*, m.codigo AS material_codigo, m.nombre AS material_nombre, t.nombre AS tipo_nombre
    FROM materiales_receta_insumos i
    JOIN materiales_receta_tipos t ON t.id = i.tipo_id
    LEFT JOIN materiales m ON m.id = i.material_id
    WHERE i.activo = 1
    ORDER BY t.nombre, i.id
  `).all();
  res.json({ success: true, data: { tipos, insumos } });
});

router.post('/recetas/tipos', async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ success: false, message: 'Nombre requerido' });
  const info = await req.db.prepare(`INSERT INTO materiales_receta_tipos (nombre, descripcion) VALUES (?, ?)`)
    .run(nombre, req.body?.descripcion || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/recetas/insumos', async (req, res) => {
  const b = req.body || {};
  if (!b.tipo_id || !b.descripcion) {
    return res.status(400).json({ success: false, message: 'tipo_id y descripción requeridos' });
  }
  const info = await req.db.prepare(`
    INSERT INTO materiales_receta_insumos (tipo_id, material_id, descripcion, cantidad, unidad, categoria)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(Number(b.tipo_id), b.material_id || null, b.descripcion, Number(b.cantidad) || 1, b.unidad || 'UN', b.categoria || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/recetas/calcular', async (req, res) => {
  const tipoId = Number(req.body?.tipo_id);
  const obras = Number(req.body?.cantidad_obras) || 1;
  const insumos = await req.db.prepare(`
    SELECT i.*, m.codigo AS material_codigo, m.nombre AS material_nombre
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
router.get('/salidas-actividad', async (req, res) => {
  const data = await req.db.prepare(`
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

router.post('/salidas-actividad', async (req, res) => {
  const b = req.body || {};
  if (!b.tipo_receta_id || !b.ceco_id) {
    return res.status(400).json({ success: false, message: 'Tipo de receta y CECO requeridos' });
  }
  const obras = Number(b.cantidad_obras) || 1;
  const codigo = await nextCode(req.db, 'salidas_actividad', 'codigo', 'SMA-');
  const insumos = await req.db.prepare(`
    SELECT * FROM materiales_receta_insumos WHERE tipo_id = ? AND activo = 1
  `).all(Number(b.tipo_receta_id));
  if (!insumos.length) {
    return res.status(400).json({ success: false, message: 'La receta no tiene insumos' });
  }
  const tx = req.db.transaction(async () => {
    const info = await req.db.prepare(`
      INSERT INTO salidas_actividad
        (codigo, tipo_receta_id, ceco_id, solicitante_id, cantidad_obras, numero_proyecto, estado, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?)
    `).run(codigo, Number(b.tipo_receta_id), Number(b.ceco_id), req.auth.userId, obras, b.numero_proyecto || null, b.observaciones || null);
    const id = info.lastInsertRowid;
    const ins = await req.db.prepare(`
      INSERT INTO salidas_actividad_detalle (salida_id, material_id, descripcion, cantidad, unidad)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const i of insumos) {
      await ins.run(id, i.material_id, i.descripcion, Number(i.cantidad) * obras, i.unidad);
    }
    return id;
  });
  const salidaId = await tx();
  res.status(201).json({ success: true, data: { id: salidaId, codigo } });
});

router.get('/salidas-actividad/:id', async (req, res) => {
  const s = await req.db.prepare(`
    SELECT s.*, t.nombre AS tipo_nombre, c.codigo AS ceco_codigo,
           u.nombre || ' ' || u.apellido AS solicitante
    FROM salidas_actividad s
    LEFT JOIN materiales_receta_tipos t ON t.id = s.tipo_receta_id
    LEFT JOIN cecos c ON c.id = s.ceco_id
    LEFT JOIN usuarios u ON u.id = s.solicitante_id
    WHERE s.id = ? AND s.eliminado = 0
  `).get(Number(req.params.id));
  if (!s) return res.status(404).json({ success: false, message: 'No encontrada' });
  const detalle = await req.db.prepare(`SELECT * FROM salidas_actividad_detalle WHERE salida_id = ?`).all(s.id);
  res.json({ success: true, data: { ...s, detalle } });
});

router.post('/salidas-actividad/:id/estado', async (req, res) => {
  await req.db.prepare(`UPDATE salidas_actividad SET estado = ? WHERE id = ?`)
    .run(req.body?.estado || 'Pendiente', Number(req.params.id));
  res.json({ success: true });
});

/* ========== DATOS MAESTROS ========== */
router.get('/datos-maestros', async (req, res) => {
  const data = await req.db.prepare(`
    SELECT d.*, u.nombre || ' ' || u.apellido AS solicitante
    FROM creacion_datos_maestros d
    LEFT JOIN usuarios u ON u.id = d.solicitante_id
    WHERE d.eliminado = 0 ORDER BY d.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/datos-maestros', async (req, res) => {
  const b = req.body || {};
  if (!b.descripcion) return res.status(400).json({ success: false, message: 'Descripción requerida' });
  const info = await req.db.prepare(`
    INSERT INTO creacion_datos_maestros
      (tipo, descripcion, unidad_medida, color, medida, inventariable, estado, solicitante_id, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
  `).run(
    b.tipo || 'Material', b.descripcion, b.unidad_medida || 'UN', b.color || null,
    b.medida || null, b.inventariable === false ? 0 : 1, req.auth.userId, b.observaciones || null
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/datos-maestros/:id', async (req, res) => {
  const b = req.body || {};
  await req.db.prepare(`
    UPDATE creacion_datos_maestros
    SET codigo = COALESCE(?, codigo), estado = COALESCE(?, estado),
        responsable = COALESCE(?, responsable), descripcion = COALESCE(?, descripcion),
        unidad_medida = COALESCE(?, unidad_medida)
    WHERE id = ? AND eliminado = 0
  `).run(b.codigo || null, b.estado || null, b.responsable || null, b.descripcion || null, b.unidad_medida || null, Number(req.params.id));
  res.json({ success: true, message: 'Actualizado' });
});

router.post('/datos-maestros/:id/eliminar', async (req, res) => {
  const id = Number(req.params.id);
  const row = await req.db.prepare(`SELECT * FROM creacion_datos_maestros WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ success: false, message: 'No encontrado' });
  await req.db.prepare(`UPDATE creacion_datos_maestros SET eliminado = 1 WHERE id = ?`).run(id);
  await toTrash(req.db, req.auth.userId, 'datos-maestros', id, row.codigo, row.descripcion, row);
  res.json({ success: true });
});

/* ========== TAREAS OPERATIVAS ========== */
router.get('/tareas', async (req, res) => {
  const data = await req.db.prepare(`
    SELECT t.*, c.codigo AS ceco_codigo, u.nombre || ' ' || u.apellido AS responsable
    FROM tareas_operativas t
    LEFT JOIN cecos c ON c.id = t.ceco_id
    LEFT JOIN usuarios u ON u.id = t.responsable_id
    WHERE t.eliminado = 0
    ORDER BY t.fecha DESC, t.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/tareas', async (req, res) => {
  const b = req.body || {};
  if (!b.area || !b.fecha || !b.descripcion) {
    return res.status(400).json({ success: false, message: 'Área, fecha y descripción requeridos' });
  }
  const info = await req.db.prepare(`
    INSERT INTO tareas_operativas
      (area, fecha, hora_inicio, hora_termino, camioneta, descripcion, ubicacion, ceco_id, horas_hombre, responsable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.area, b.fecha, b.hora_inicio || null, b.hora_termino || null, b.camioneta || null,
    b.descripcion, b.ubicacion || null, b.ceco_id || null, Number(b.horas_hombre) || 0, req.auth.userId
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/tareas/:id/eliminar', async (req, res) => {
  const id = Number(req.params.id);
  const row = await req.db.prepare(`SELECT * FROM tareas_operativas WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ success: false, message: 'No encontrada' });
  await req.db.prepare(`UPDATE tareas_operativas SET eliminado = 1 WHERE id = ?`).run(id);
  await toTrash(req.db, req.auth.userId, 'tareas', id, null, row.descripcion, row);
  res.json({ success: true });
});

/* ========== GRÁFICAS ========== */
router.get('/graficas', async (req, res) => {
  const data = await req.db.prepare(`
    SELECT g.*, c.codigo AS ceco_codigo, u.nombre || ' ' || u.apellido AS solicitante
    FROM solicitud_graficas g
    LEFT JOIN cecos c ON c.id = g.ceco_id
    LEFT JOIN usuarios u ON u.id = g.solicitante_id
    WHERE g.eliminado = 0 ORDER BY g.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/graficas', async (req, res) => {
  const b = req.body || {};
  const codigo = await nextCode(req.db, 'solicitud_graficas', 'codigo', 'SG-');
  const info = await req.db.prepare(`
    INSERT INTO solicitud_graficas (codigo, ceco_id, solicitante_id, fecha_requerida, observaciones, estado)
    VALUES (?, ?, ?, ?, ?, 'Pendiente Aprobación')
  `).run(codigo, b.ceco_id || null, req.auth.userId, b.fecha_requerida || null, b.observaciones || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, codigo } });
});

router.post('/graficas/:id/estado', async (req, res) => {
  const b = req.body || {};
  await req.db.prepare(`
    UPDATE solicitud_graficas
    SET estado = COALESCE(?, estado), ot_numero = COALESCE(?, ot_numero),
        oc_numero = COALESCE(?, oc_numero), tipo_entrega = COALESCE(?, tipo_entrega)
    WHERE id = ?
  `).run(b.estado || null, b.ot_numero || null, b.oc_numero || null, b.tipo_entrega || null, Number(req.params.id));
  res.json({ success: true });
});

/* ========== SERVICIOS GENERALES ========== */
router.get('/ssgg', async (req, res) => {
  const data = await req.db.prepare(`
    SELECT s.*, u.nombre || ' ' || u.apellido AS solicitante,
           a.nombre || ' ' || a.apellido AS asignado
    FROM servicios_generales s
    LEFT JOIN usuarios u ON u.id = s.solicitante_id
    LEFT JOIN usuarios a ON a.id = s.asignado_id
    WHERE s.eliminado = 0 ORDER BY s.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/ssgg', async (req, res) => {
  const b = req.body || {};
  if (!b.titulo || !b.categoria) {
    return res.status(400).json({ success: false, message: 'Título y categoría requeridos' });
  }
  const codigo = await nextCode(req.db, 'servicios_generales', 'codigo', 'SSGG-');
  const info = await req.db.prepare(`
    INSERT INTO servicios_generales
      (codigo, categoria, prioridad, titulo, descripcion, ubicacion, fecha_requerida, estado, solicitante_id, asignado_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierto', ?, ?)
  `).run(
    codigo, b.categoria, b.prioridad || 'Media', b.titulo, b.descripcion || null,
    b.ubicacion || null, b.fecha_requerida || null, req.auth.userId,
    b.asignado_id || null
  );
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, codigo } });
});

router.post('/ssgg/:id', async (req, res) => {
  if (denyUnlessFlag(req, res, 'flag_ssgg', 'Solo personal de Servicios Generales puede gestionar tickets')) return;
  const b = req.body || {};
  await req.db.prepare(`
    UPDATE servicios_generales
    SET estado = COALESCE(?, estado), fecha_inicio = COALESCE(?, fecha_inicio),
        fecha_termino_estimada = COALESCE(?, fecha_termino_estimada),
        fecha_termino_real = COALESCE(?, fecha_termino_real),
        prioridad = COALESCE(?, prioridad),
        asignado_id = COALESCE(?, asignado_id)
    WHERE id = ?
  `).run(
    b.estado || null, b.fecha_inicio || null, b.fecha_termino_estimada || null,
    b.fecha_termino_real || null, b.prioridad || null,
    b.asignado_id != null ? Number(b.asignado_id) : null,
    Number(req.params.id)
  );
  res.json({ success: true });
});

/* ========== AGENDA CAMIÓN PLUMA ========== */
async function agendaDb(req) {
  const { resolveModuleDb } = require('../services/modulos-compartidos');
  return resolveModuleDb(req, 'agenda-camion-pluma.html');
}

router.get('/agenda', async (req, res) => {
  const fechaDesde = req.query.fecha_desde || null;
  const fechaHasta = req.query.fecha_hasta || null;
  const dbMod = await agendaDb(req);
  const data = await listAgendaCamion(dbMod, { fechaDesde, fechaHasta });
  try { await permisosEsp.initPermisos(req.db); } catch (_) { /* ignore */ }
  const canEditAgenda = await canGestionarAgendaCamion(req);
  const canEditPrecios = await canEditarPreciosCamion(req);
  res.json({
    success: true,
    data,
    can_manage: canEditAgenda,
    can_edit_agenda: canEditAgenda,
    can_edit_precios: canEditPrecios,
    data_shared: dbMod !== req.db
  });
});

router.get('/agenda/reporte-excel', async (req, res) => {
  const can = await canGestionarAgendaCamion(req);
  if (!can) {
    return res.status(403).json({ success: false, message: 'Sin permiso para exportar la agenda' });
  }
  try {
    const fechaDesde = req.query.fecha_desde || null;
    const fechaHasta = req.query.fecha_hasta || null;
    const dbMod = await agendaDb(req);
    const result = await exportAgendaExcel(dbMod, {
      fechaDesde,
      fechaHasta,
      empresa: req.auth.empresa
    });
    const filename = `agenda_camion_pluma_${fechaDesde}_${fechaHasta}.xlsx`;
    res.download(result.fullPath, filename);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || 'No se pudo generar el Excel' });
  }
});

router.get('/agenda/direcciones', async (req, res) => {
  try {
    const dbMod = await agendaDb(req);
    const results = await buscarDirecciones(req.query.q, dbMod);
    res.json({ success: true, results });
  } catch (err) {
    console.warn('[agenda/direcciones]', err.message);
    res.status(500).json({ success: false, message: err.message, results: [] });
  }
});

router.get('/agenda/calcular-km', async (req, res) => {
  try {
    const dbMod = await agendaDb(req);
    const data = await calcularDistancia(req.query.origen, req.query.destino, dbMod, {
      origen_lat: req.query.origen_lat,
      origen_lon: req.query.origen_lon,
      destino_lat: req.query.destino_lat,
      destino_lon: req.query.destino_lon
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/agenda/tramos', async (req, res) => {
  const dbMod = await agendaDb(req);
  const data = await getTramosYPrecios(dbMod);
  res.json({ success: true, ...data });
});

router.get('/agenda/rutas', async (req, res) => {
  const dbMod = await agendaDb(req);
  const rutas = await getRutas(dbMod);
  res.json({ success: true, rutas });
});

router.post('/agenda/calcular-precio', async (req, res) => {
  const dbMod = await agendaDb(req);
  const km = Number(req.body?.km);
  const { tramos, precio_km_adicional } = await getTramosYPrecios(dbMod);
  const desc = Number(req.body?.descuento_porcentaje) || 0;
  const calc = calcularPrecioDesdeKm(km, tramos, precio_km_adicional);
  const total = Math.round(calc.subtotal * (1 - desc / 100));
  res.json({ success: true, ...calc, total, descuento_porcentaje: desc });
});

router.post('/agenda/precios', async (req, res) => {
  const can = await canEditarPreciosCamion(req);
  if (!can) {
    return res.status(403).json({ success: false, message: 'Solo usuarios con permiso especial pueden modificar precios' });
  }
  try {
    const dbMod = await agendaDb(req);
    await saveTramosYPrecios(dbMod, req.body || {});
    res.json({ success: true, message: 'Precios guardados' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/agenda/precios/reset-tramos', async (req, res) => {
  const can = await canEditarPreciosCamion(req);
  if (!can) {
    return res.status(403).json({ success: false, message: 'Sin permiso para modificar precios' });
  }
  try {
    const dbMod = await agendaDb(req);
    const result = await resetTramosDuplicados(dbMod);
    res.json({ success: true, message: 'Se dejaron solo 3 tramos', ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/agenda/precios/tramos-oficiales', async (req, res) => {
  const can = await canEditarPreciosCamion(req);
  if (!can) {
    return res.status(403).json({ success: false, message: 'Sin permiso para modificar precios' });
  }
  try {
    const dbMod = await agendaDb(req);
    await restablecerTramosOficiales(dbMod);
    res.json({
      success: true,
      message: 'Tramos oficiales restablecidos: Tramo 1 ($95.000), Tramo 2 ($140.000), Tramo 3 ($190.000).'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/agenda', async (req, res) => {
  const b = req.body || {};
  const can = await canGestionarAgendaCamion(req);
  if (!can) {
    return res.status(403).json({
      success: false,
      message: 'Sin permiso: active el módulo Agenda Camión Pluma en el rol del usuario'
    });
  }
  try {
    const dbMod = await agendaDb(req);
    const result = await saveAgendaCamion(dbMod, b, req.auth.userId);
    res.status(Number(b.id) ? 200 : 201).json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/agenda/:id/eliminar', async (req, res) => {
  const can = await canGestionarAgendaCamion(req);
  if (!can) {
    return res.status(403).json({
      success: false,
      message: 'Sin permiso: active el módulo Agenda Camión Pluma en el rol del usuario'
    });
  }
  try {
    const dbMod = await agendaDb(req);
    await deleteAgendaCamion(dbMod, Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/* ========== CHECKLIST FLOTA ========== */
/** Solo encargados (Martin Vera / Charly Machado) toman y editan el proceso. */
async function canGestionarIncidenciasFlota(req) {
  if (isAdminUser(req.auth?.user)) return true;
  return await hasPermisoEspecial(req.db, req.auth.user, 'flota_gestion_incidencias')
    || await hasPermisoEspecial(req.db, req.auth.user, 'flota_aprobador');
}

router.get('/checklist/validar-patente', async (req, res) => {
  try {
    const { validarPatente } = require('../services/patente-chile');
    const data = await validarPatente(req.db, req.query.patente, {
      usuarioId: req.auth?.userId,
      usuario: req.auth?.user
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/checklist/catalogo', async (req, res) => {
  try {
    const { getCatalogoInfo, listCatalogo, FLOTA_ALERT_EMAIL } = require('../services/flota-catalogo');
    const canManage = hasUserFlag(req.auth?.user, 'flag_checklist')
      || hasUserFlag(req.auth?.user, 'flag_flota')
      || await canGestionarIncidenciasFlota(req);
    const info = await getCatalogoInfo(req.db);
    const rows = req.query.list === '1'
      ? await listCatalogo(req.db, { q: req.query.q || '', limit: Number(req.query.limit) || 200 })
      : undefined;
    res.json({
      success: true,
      total: info.total,
      ultima_carga: info.ultima_carga,
      archivo_nombre: info.archivo_nombre,
      cargado_por_nombre: info.cargado_por_nombre,
      can_manage: canManage,
      alert_email: FLOTA_ALERT_EMAIL,
      ...(rows ? { data: rows } : {})
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/checklist/catalogo/plantilla', async (req, res) => {
  try {
    const { buildPlantillaBuffer } = require('../services/flota-catalogo');
    const buf = await buildPlantillaBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_flota_esercom.xlsx');
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/checklist/catalogo/import', async (req, res) => {
  const can = hasUserFlag(req.auth?.user, 'flag_checklist')
    || hasUserFlag(req.auth?.user, 'flag_flota')
    || await canGestionarIncidenciasFlota(req);
  if (!can) {
    return res.status(403).json({ success: false, message: 'No autorizado a cargar el catálogo de flota' });
  }
  try {
    const { importCatalogo, decodeUploadBody } = require('../services/flota-catalogo');
    const buffer = decodeUploadBody(req.body || {});
    const u = req.auth?.user || {};
    const userName = [u.nombre, u.apellido].filter(Boolean).join(' ').trim() || u.email || null;
    const result = await importCatalogo(req.db, buffer, {
      userId: req.auth.userId,
      userName,
      filename: req.body?.filename || req.body?.nombre || 'catalogo_flota.xlsx'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/checklist/catalogo/eliminar', async (req, res) => {
  const can = hasUserFlag(req.auth?.user, 'flag_checklist')
    || hasUserFlag(req.auth?.user, 'flag_flota')
    || await canGestionarIncidenciasFlota(req);
  if (!can) {
    return res.status(403).json({ success: false, message: 'No autorizado a eliminar el catálogo de flota' });
  }
  try {
    const { deleteCatalogo } = require('../services/flota-catalogo');
    const result = await deleteCatalogo(req.db);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/checklist/meta', async (req, res) => {
  res.json({
    success: true,
    items: getInspectionCatalog(),
    fotos: getPhotoCatalog()
  });
});

router.get('/checklist', async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const solo_incidencias = req.query.incidencias === '1';
  const q = req.query.q || '';
  const result = await listChecklistFlota(req.db, { page, limit, solo_incidencias, q });
  const canAssign = await canGestionarIncidenciasFlota(req);
  res.json({
    success: true,
    data: result.rows,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages
    },
    can_create: canCrearChecklistFlota(req),
    can_assign_flota: canAssign
  });
});

router.get('/checklist/:id', async (req, res) => {
  const data = await getChecklistFlota(req.db, Number(req.params.id));
  if (!data) return res.status(404).json({ success: false, message: 'Checklist no encontrado' });
  res.json({ success: true, data });
});

router.post('/checklist/upload-foto', async (req, res) => {
  if (denyUnlessCrearChecklist(req, res, 'Solo usuarios con acceso a Checklist Flota pueden subir fotos')) return;
  try {
    const { patente, tipo, dataUrl } = req.body || {};
    const ruta = await saveChecklistPhoto(patente, tipo, dataUrl, req.auth.empresa);
    res.json({ success: true, ruta });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/checklist/foto/:empresa/:file', async (req, res) => {
  try {
    const { resolveChecklistPhoto } = require('../services/checklist-flota');
    const full = resolveChecklistPhoto(req.params.empresa, req.params.file, req.auth.empresa);
    if (!full) return res.status(404).json({ success: false, message: 'Foto no encontrada' });
    res.sendFile(full);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/checklist', async (req, res) => {
  if (denyUnlessCrearChecklist(req, res, 'Solo usuarios con acceso a Checklist Flota pueden registrar inspecciones')) return;
  try {
    const data = await createChecklistFlota(req.db, req.auth.userId, req.body || {}, req.auth.empresa);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/checklist/:id/asignar', async (req, res) => {
  const can = await canGestionarIncidenciasFlota(req);
  if (!can) {
    return res.status(403).json({
      success: false,
      message: 'Solo encargados de flota autorizados (Martin Vera / Charly Machado) pueden tomar incidencias'
    });
  }
  try {
    const tecnicoId = req.body?.tecnico_asignado_id != null
      ? Number(req.body.tecnico_asignado_id)
      : req.auth.userId;
    await assignChecklistFlota(req.db, Number(req.params.id), tecnicoId);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put('/checklist/:id', async (req, res) => {
  const can = await canGestionarIncidenciasFlota(req);
  if (!can) {
    return res.status(403).json({
      success: false,
      message: 'Solo Martin Vera / Charly Machado pueden editar el proceso de requerimientos'
    });
  }
  try {
    await updateChecklistFlota(req.db, Number(req.params.id), req.body || {});
    const data = await getChecklistFlota(req.db, Number(req.params.id));
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/checklist/:id/anular', async (req, res) => {
  if (denyUnlessCrearChecklist(req, res, 'No autorizado a anular checklists')) return;
  try {
    await anularChecklistFlota(req.db, Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/* ========== TELECOM ========== */
router.get('/telecom', async (req, res) => {
  const data = await req.db.prepare(`
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

router.post('/telecom', async (req, res) => {
  const b = req.body || {};
  if (!b.tipo_solicitud) return res.status(400).json({ success: false, message: 'Tipo requerido' });
  const codigo = await nextCode(req.db, 'requerimientos_telecom', 'codigo', 'TEL-');
  const info = await req.db.prepare(`
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

router.post('/telecom/:id', async (req, res) => {
  const b = req.body || {};
  await req.db.prepare(`
    UPDATE requerimientos_telecom
    SET estado = COALESCE(?, estado), asignado_id = COALESCE(?, asignado_id)
    WHERE id = ?
  `).run(b.estado || null, b.asignado_id || null, Number(req.params.id));
  res.json({ success: true });
});

/* ========== CATÁLOGO G (solo empresa Global) ========== */
const {
  ESTADOS: CATALOGO_G_ESTADOS,
  listCatalogoG, listBodegasCatalogoG, buildStats,
  createCatalogoG, updateCatalogoG, deleteCatalogoG, saveCatalogoGPhoto,
  analyzeCatalogoGPhoto, findDuplicatesByHash, ensureCatalogoGSchema, normalizeFotosList,
  suggestFromCatalogoGPhoto,
  buildPlantillaCatalogoG, importCatalogoGExcel, decodeUploadBody: decodeCatalogoGUpload
} = require('../services/catalogo-g');

function denyUnlessGlobal(req, res) {
  if (String(req.auth?.empresa || '').toLowerCase() === 'global') return false;
  res.status(403).json({ success: false, message: 'Catálogo G solo está disponible para la empresa Global' });
  return true;
}

function isCatalogoGRole(user) {
  const names = [
    user?.rol,
    ...(Array.isArray(user?.roles) ? user.roles : [])
  ].join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return /catalogo\s*g/.test(names);
}

async function canEditCatalogoG(req) {
  const user = req.auth?.user;
  if (isAdminUser(user)) return true;
  if (isCatalogoGRole(user)) return true;
  return hasPermisoEspecial(req.db, user, 'catalogo_g_editor');
}

/** Resuelve fotos nuevas (dataUrl) + existentes a lista {ruta,hash,tipo}. */
async function resolveCatalogoGFotos(db, body, excludeId) {
  const force = !!body.forzar_foto_duplicada;
  let list = normalizeFotosList(body.fotos, body.foto, body.foto_hash);

  const pending = [];
  if (Array.isArray(body.dataUrls)) {
    for (const item of body.dataUrls) {
      if (!item) continue;
      if (typeof item === 'string') pending.push({ dataUrl: item, tipo: 'articulo' });
      else if (item.dataUrl) pending.push({ dataUrl: item.dataUrl, tipo: item.tipo === 'marca' ? 'marca' : 'articulo' });
    }
  } else if (body.dataUrl) {
    pending.push({ dataUrl: body.dataUrl, tipo: body.foto_tipo === 'marca' ? 'marca' : 'articulo' });
  }

  for (const p of pending.slice(0, 12)) {
    const analysis = await analyzeCatalogoGPhoto(db, p.dataUrl, {
      excludeId,
      checkAngel: false
    });
    if (analysis.alerta && analysis.nivel === 'exacta' && !force) {
      return {
        error: {
          success: false,
          code: 'FOTO_DUPLICADA',
          message: analysis.mensaje || 'Foto duplicada detectada',
          alerta_foto: true,
          nivel: analysis.nivel,
          duplicados: analysis.duplicados
        }
      };
    }
    const saved = saveCatalogoGPhoto(p.dataUrl, analysis);
    list.push({ ruta: saved.ruta, hash: saved.hash, tipo: p.tipo });
  }

  list = normalizeFotosList(list);
  const byTipo = { articulo: 0, marca: 0 };
  list = list.filter((f) => {
    byTipo[f.tipo] = (byTipo[f.tipo] || 0) + 1;
    return byTipo[f.tipo] <= 6;
  });
  return { list };
}

router.get('/catalogo-g', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  try {
    const data = await listCatalogoG(req.db);
    const bodegas = await listBodegasCatalogoG(req.db);
    const can_edit = await canEditCatalogoG(req);
    res.json({
      success: true,
      data,
      stats: buildStats(data),
      bodegas,
      can_edit,
      estados: CATALOGO_G_ESTADOS
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/catalogo-g/plantilla', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  try {
    const bodegas = await listBodegasCatalogoG(req.db);
    const buf = await buildPlantillaCatalogoG(bodegas);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_catalogo_g.xlsx');
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/catalogo-g/import-excel', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  if (!(await canEditCatalogoG(req))) {
    return res.status(403).json({ success: false, message: 'No autorizado a cargar inventario Excel' });
  }
  try {
    const buffer = decodeCatalogoGUpload(req.body || {});
    const result = await importCatalogoGExcel(req.db, buffer, req.auth.userId, {
      filename: req.body?.filename || req.body?.nombre || 'catalogo_g.xlsx'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/catalogo-g/upload-foto', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  if (!(await canEditCatalogoG(req))) {
    return res.status(403).json({ success: false, message: 'Solo analistas de compra autorizados pueden subir fotos' });
  }
  try {
    const excludeId = req.body?.exclude_id ? Number(req.body.exclude_id) : null;
    const checkAngel = req.body?.check_angel === true || req.body?.check_angel === 1 || req.body?.check_angel === '1';
    const analysis = await analyzeCatalogoGPhoto(req.db, req.body?.dataUrl, {
      excludeId,
      checkAngel,
      angelTimeoutMs: 8000
    });
    const saved = saveCatalogoGPhoto(req.body?.dataUrl, analysis);
    res.json({
      success: true,
      ruta: saved.ruta,
      hash: saved.hash,
      alerta_foto: !!analysis.alerta,
      nivel: analysis.nivel || null,
      mensaje: analysis.mensaje || null,
      duplicados: (analysis.duplicados || []).map((d) => ({
        id: d.id,
        codigo: d.codigo,
        correlativo: d.correlativo,
        descripcion: d.descripcion,
        foto: d.foto
      })),
      fuente: analysis.fuente || null
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/catalogo-g/sugerir-foto', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  if (!(await canEditCatalogoG(req))) {
    return res.status(403).json({ success: false, message: 'No autorizado' });
  }
  try {
    const dataUrl = req.body?.dataUrl;
    if (!dataUrl) {
      return res.status(400).json({ success: false, message: 'Falta la foto' });
    }
    const suggestion = await suggestFromCatalogoGPhoto(req.db, dataUrl, {
      tipo: req.body?.tipo === 'marca' ? 'marca' : 'articulo',
      timeoutMs: 12000
    });
    if (!suggestion?.ok) {
      return res.json({
        success: true,
        sugerido: false,
        message: suggestion?.message || 'Sin sugerencia'
      });
    }
    res.json({
      success: true,
      sugerido: true,
      descripcion: suggestion.descripcion,
      marca: suggestion.marca,
      modelo: suggestion.modelo,
      confianza: suggestion.confianza,
      nota: suggestion.nota
    });
  } catch (err) {
    console.error('[catalogo-g sugerir-foto]', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/catalogo-g/check-foto', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  if (!(await canEditCatalogoG(req))) {
    return res.status(403).json({ success: false, message: 'No autorizado' });
  }
  try {
    await ensureCatalogoGSchema(req.db);
    const excludeId = req.body?.exclude_id ? Number(req.body.exclude_id) : null;
    // Preferir hash liviano (evita 413 por foto grande)
    if (req.body?.hash && !req.body?.dataUrl) {
      const hash = String(req.body.hash).trim().toLowerCase();
      let duplicados = [];
      try {
        duplicados = await findDuplicatesByHash(req.db, hash, excludeId);
      } catch (_) {
        duplicados = [];
      }
      const alerta = duplicados.length > 0;
      return res.json({
        success: true,
        alerta_foto: alerta,
        nivel: alerta ? 'exacta' : null,
        mensaje: alerta
          ? `Artículo duplicado — revisar (${duplicados.map((d) => d.codigo || ('#' + d.correlativo)).join(', ')})`
          : 'OK',
        hash,
        duplicados: duplicados.map((d) => ({
          id: d.id,
          codigo: d.codigo,
          correlativo: d.correlativo,
          descripcion: d.descripcion,
          foto: d.foto
        })),
        fuente: 'hash'
      });
    }
    const analysis = await analyzeCatalogoGPhoto(req.db, req.body?.dataUrl, {
      excludeId,
      checkAngel: false,
      angelTimeoutMs: 8000
    });
    res.json({
      success: true,
      alerta_foto: !!analysis.alerta,
      nivel: analysis.nivel || null,
      mensaje: analysis.alerta
        ? (analysis.mensaje || 'Artículo duplicado — revisar')
        : 'OK',
      hash: analysis.hash,
      duplicados: (analysis.duplicados || []).map((d) => ({
        id: d.id,
        codigo: d.codigo,
        correlativo: d.correlativo,
        descripcion: d.descripcion,
        foto: d.foto
      })),
      fuente: analysis.fuente || null
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/catalogo-g', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  if (!(await canEditCatalogoG(req))) {
    return res.status(403).json({ success: false, message: 'Solo analistas de compra autorizados pueden crear ítems' });
  }
  try {
    const body = { ...(req.body || {}) };
    const fotos = await resolveCatalogoGFotos(req.db, body, null);
    if (fotos.error) {
      return res.status(409).json(fotos.error);
    }
    body.fotos = fotos.list;
    if (fotos.list.length) {
      body.foto = fotos.list.find((f) => f.tipo === 'articulo')?.ruta || fotos.list[0].ruta;
      body.foto_hash = fotos.list.find((f) => f.tipo === 'articulo')?.hash || fotos.list[0].hash;
    }
    const data = await createCatalogoG(req.db, req.auth.userId, body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('[catalogo-g POST]', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/catalogo-g/:id', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  if (!(await canEditCatalogoG(req))) {
    return res.status(403).json({ success: false, message: 'Solo analistas de compra autorizados pueden editar' });
  }
  try {
    const body = { ...(req.body || {}) };
    const id = Number(req.params.id);
    const fotos = await resolveCatalogoGFotos(req.db, body, id);
    if (fotos.error) {
      return res.status(409).json(fotos.error);
    }
    if (body.fotos !== undefined || body.dataUrls || body.dataUrl) {
      body.fotos = fotos.list;
      if (fotos.list.length) {
        body.foto = fotos.list.find((f) => f.tipo === 'articulo')?.ruta || fotos.list[0].ruta;
        body.foto_hash = fotos.list.find((f) => f.tipo === 'articulo')?.hash || fotos.list[0].hash;
      } else {
        body.foto = null;
        body.foto_hash = null;
      }
    }
    const data = await updateCatalogoG(req.db, id, req.auth.userId, body);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[catalogo-g POST :id]', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/catalogo-g/:id/eliminar', async (req, res) => {
  if (denyUnlessGlobal(req, res)) return;
  if (!(await canEditCatalogoG(req))) {
    return res.status(403).json({ success: false, message: 'Solo analistas de compra autorizados pueden eliminar' });
  }
  try {
    await deleteCatalogoG(req.db, Number(req.params.id), req.auth.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/* ========== CATÁLOGO S / N / T (por empresa) ========== */
const { registerCatalogoLetraRoutes } = require('./catalogo-letra-routes');
[
  { letter: 'S', slug: 'sercom' },
  { letter: 'N', slug: 'nexus' },
  { letter: 'T', slug: 'tactica' }
].forEach((cfg) => {
  registerCatalogoLetraRoutes(router, {
    ...cfg,
    isAdminUser,
    hasPermisoEspecial
  });
});

/* ========== CONTRATOS ========== */
router.get('/contratos', async (req, res) => {
  const data = await req.db.prepare(`
    SELECT c.*, u.nombre || ' ' || u.apellido AS creador
    FROM seguimiento_contratos c
    LEFT JOIN usuarios u ON u.id = c.creado_por
    WHERE c.eliminado = 0 ORDER BY c.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/contratos', async (req, res) => {
  const b = req.body || {};
  if (!b.descripcion) return res.status(400).json({ success: false, message: 'Descripción requerida' });
  const codigo = await nextCode(req.db, 'seguimiento_contratos', 'codigo', 'CTR-');
  const info = await req.db.prepare(`
    INSERT INTO seguimiento_contratos
      (codigo, proveedor_id, proveedor_nombre, descripcion, estado, creado_por)
    VALUES (?, ?, ?, ?, 'Borrador', ?)
  `).run(codigo, b.proveedor_id || null, b.proveedor_nombre || null, b.descripcion, req.auth.userId);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, codigo } });
});

router.post('/contratos/:id', async (req, res) => {
  const b = req.body || {};
  await req.db.prepare(`
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
router.get('/facturas', async (req, res) => {
  const lotes = await req.db.prepare(`
    SELECT l.*, c.nombre || ' ' || c.apellido AS creador,
           a.nombre || ' ' || a.apellido AS aprobador
    FROM aprobacion_facturas_lote l
    LEFT JOIN usuarios c ON c.id = l.creado_por
    LEFT JOIN usuarios a ON a.id = l.aprobador_id
    ORDER BY l.id DESC
  `).all();
  const items = await req.db.prepare(`SELECT * FROM aprobacion_facturas ORDER BY id`).all();
  res.json({ success: true, data: { lotes, items } });
});

router.post('/facturas/lotes', async (req, res) => {
  const b = req.body || {};
  const codigo = await nextCode(req.db, 'aprobacion_facturas_lote', 'codigo', 'LOTE-');
  const facturas = Array.isArray(b.facturas) ? b.facturas : [];
  const tx = req.db.transaction(async () => {
    const info = await req.db.prepare(`
      INSERT INTO aprobacion_facturas_lote (codigo, descripcion, creado_por, aprobador_id, estado)
      VALUES (?, ?, ?, ?, 'Pendiente')
    `).run(codigo, b.descripcion || null, req.auth.userId, b.aprobador_id || null);
    const loteId = info.lastInsertRowid;
    const ins = await req.db.prepare(`
      INSERT INTO aprobacion_facturas (lote_id, numero_factura, proveedor, monto, estado)
      VALUES (?, ?, ?, ?, 'Pendiente')
    `);
    for (const f of facturas) {
      await ins.run(loteId, f.numero_factura || null, f.proveedor || null, Number(f.monto) || 0);
    }
    return loteId;
  });
  const loteId = await tx();
  res.status(201).json({ success: true, data: { id: loteId, codigo } });
});

router.post('/facturas/:id/decidir', async (req, res) => {
  const ok = req.body?.aprobar !== false;
  await req.db.prepare(`
    UPDATE aprobacion_facturas
    SET estado = ?, observacion = ?, fecha_decision = datetime('now')
    WHERE id = ?
  `).run(ok ? 'Aprobada' : 'Rechazada', req.body?.observacion || null, Number(req.params.id));
  res.json({ success: true });
});

/* ========== CONFIGURACIONES ========== */
async function safeCount(db, sql) {
  try {
    const row = await db.prepare(sql).get();
    return Number(row?.c || 0);
  } catch (err) {
    console.error('[config/resumen]', err.message);
    return 0;
  }
}

router.get('/config/resumen', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        usuarios: await safeCount(req.db, `SELECT COUNT(*) AS c FROM usuarios WHERE activo = 1`),
        roles: await safeCount(req.db, `SELECT COUNT(*) AS c FROM roles`),
        cecos: await safeCount(req.db, `SELECT COUNT(*) AS c FROM cecos WHERE activo = 1`),
        materiales: await safeCount(req.db, `SELECT COUNT(*) AS c FROM materiales WHERE activo = 1`),
        proveedores: await safeCount(req.db, `SELECT COUNT(*) AS c FROM proveedores WHERE activo = 1`),
        bodegas: await safeCount(req.db, `SELECT COUNT(*) AS c FROM bodegas WHERE activo = 1`)
      }
    });
  } catch (err) {
    console.error('config/resumen', err);
    res.status(500).json({ success: false, message: err.message || 'Error al cargar resumen' });
  }
});

router.post('/config/materiales', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.codigo || !b.nombre) return res.status(400).json({ success: false, message: 'Código y nombre requeridos' });
    let info;
    try {
      info = await req.db.prepare(`
        INSERT INTO materiales (codigo, nombre, descripcion, unidad, precio, stock)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(b.codigo, b.nombre, b.descripcion || null, b.unidad || 'UN', Number(b.precio) || 0, Number(b.stock) || 0);
    } catch (_) {
      info = await req.db.prepare(`
        INSERT INTO materiales (codigo, nombre, descripcion, unidad)
        VALUES (?, ?, ?, ?)
      `).run(b.codigo, b.nombre, b.descripcion || null, b.unidad || 'UN');
    }
    res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo crear material' });
  }
});

/** Plantilla + import Excel de inventario (materiales) */
router.get('/config/materiales/plantilla', async (req, res) => {
  try {
    if (!isAdminUser(req.auth.user)) {
      return res.status(403).json({ success: false, message: 'Solo administradores' });
    }
    const { buildPlantillaMateriales } = require('../services/excel-import-config');
    const buf = await buildPlantillaMateriales();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_materiales.xlsx');
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/config/materiales/import-excel', async (req, res) => {
  try {
    if (!isAdminUser(req.auth.user)) {
      return res.status(403).json({ success: false, message: 'Solo administradores' });
    }
    const { decodeUploadBody, importMaterialesExcel } = require('../services/excel-import-config');
    const buffer = decodeUploadBody(req.body || {});
    const result = await importMaterialesExcel(req.db, buffer, {
      filename: req.body?.filename || 'materiales.xlsx'
    });
    res.json({ success: true, message: `Inventario: ${result.created} nuevos, ${result.updated} actualizados`, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/** Plantilla + import Excel de usuarios */
router.get('/config/usuarios/plantilla', async (req, res) => {
  try {
    if (!isAdminUser(req.auth.user)) {
      return res.status(403).json({ success: false, message: 'Solo administradores' });
    }
    const { buildPlantillaUsuarios } = require('../services/excel-import-config');
    const config = require('../config');
    let roles = [];
    try { roles = await req.db.prepare('SELECT id, nombre FROM roles ORDER BY id').all(); } catch (_) { roles = []; }
    const empresas = (config.companies || []).map((c) => ({ slug: c.slug, name: c.name }));
    const buf = await buildPlantillaUsuarios(roles, empresas);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_usuarios.xlsx');
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/config/usuarios/import-excel', async (req, res) => {
  try {
    if (!isAdminUser(req.auth.user)) {
      return res.status(403).json({ success: false, message: 'Solo administradores' });
    }
    const { decodeUploadBody, importUsuariosExcel } = require('../services/excel-import-config');
    const buffer = decodeUploadBody(req.body || {});
    const result = await importUsuariosExcel(req.db, buffer, {
      filename: req.body?.filename || 'usuarios.xlsx',
      sessionEmpresa: req.auth.empresa,
      defaultPassword: 'Cambiar123!'
    });
    res.json({
      success: true,
      message: `Usuarios: ${result.total} creados, ${result.skipped} omitidos`,
      ...result
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/config/proveedores', async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = b.razon_social || b.nombre;
    if (!nombre || !b.rut) return res.status(400).json({ success: false, message: 'Razón social y RUT requeridos' });
    let info;
    try {
      info = await req.db.prepare(`
        INSERT INTO proveedores (razon_social, rut, email, telefono, direccion)
        VALUES (?, ?, ?, ?, ?)
      `).run(nombre, b.rut, b.email || null, b.telefono || null, b.direccion || null);
    } catch (_) {
      info = await req.db.prepare(`
        INSERT INTO proveedores (nombre, rut, email, telefono, direccion)
        VALUES (?, ?, ?, ?, ?)
      `).run(nombre, b.rut, b.email || null, b.telefono || null, b.direccion || null);
    }
    res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo crear proveedor' });
  }
});

router.post('/config/cecos', async (req, res) => {
  const b = req.body || {};
  if (!b.codigo || !b.nombre) return res.status(400).json({ success: false, message: 'Código y nombre requeridos' });
  const info = await req.db.prepare(`
    INSERT INTO cecos (codigo, nombre, descripcion, jefe_proyecto_id)
    VALUES (?, ?, ?, ?)
  `).run(b.codigo, b.nombre, b.descripcion || null, b.jefe_proyecto_id || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

router.post('/config/usuarios', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { setUserRoles, normalizeRolIds } = require('../services/usuario-roles');
  const { normalizeEmpresasAcceso, syncUserAcrossEmpresas } = require('../services/usuario-empresas');
  const b = req.body || {};
  if (!b.nombre || !b.apellido || !b.email || !b.password) {
    return res.status(400).json({ success: false, message: 'Nombre, apellido, email y password requeridos' });
  }
  const hash = bcrypt.hashSync(b.password, 10);
  const flag = (v) => (v === true || v === 1 || v === '1' ? 1 : 0);
  const n = (v) => (v === undefined ? null : v);
  const rolIds = normalizeRolIds(b.rol_ids != null ? b.rol_ids : b.rol_id, 3);
  const primaryRol = rolIds[0] || 3;
  const sessionEmpresa = String(req.auth?.empresa || 'sercom').toLowerCase();
  const empresas = normalizeEmpresasAcceso(b.empresas_acceso || b.empresas, sessionEmpresa);

  try {
    // Intentos: con flags operativos → sin flag_chofer → mínimo (compatible MySQL legado)
    const attempts = [
      {
        sql: `INSERT INTO usuarios (
            nombre, apellido, email, password, cargo, rol_id, departamento_id, telefono,
            flag_checklist, flag_flota, flag_ssgg, flag_camion_pluma, flag_aprobador_salida, flag_chofer
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          b.nombre, b.apellido, b.email, hash, n(b.cargo) || null,
          primaryRol, b.departamento_id ? Number(b.departamento_id) : null, n(b.telefono) || null,
          flag(b.flag_checklist), flag(b.flag_flota), flag(b.flag_ssgg),
          flag(b.flag_camion_pluma), flag(b.flag_aprobador_salida), flag(b.flag_chofer)
        ]
      },
      {
        sql: `INSERT INTO usuarios (
            nombre, apellido, email, password, cargo, rol_id, departamento_id, telefono,
            flag_checklist, flag_flota, flag_ssgg, flag_camion_pluma, flag_aprobador_salida
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          b.nombre, b.apellido, b.email, hash, n(b.cargo) || null,
          primaryRol, b.departamento_id ? Number(b.departamento_id) : null, n(b.telefono) || null,
          flag(b.flag_checklist), flag(b.flag_flota), flag(b.flag_ssgg),
          flag(b.flag_camion_pluma), flag(b.flag_aprobador_salida)
        ]
      },
      {
        sql: `INSERT INTO usuarios (
            nombre, apellido, email, password, cargo, rol_id, departamento_id, telefono
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          b.nombre, b.apellido, b.email, hash, n(b.cargo) || null,
          primaryRol, b.departamento_id ? Number(b.departamento_id) : null, n(b.telefono) || null
        ]
      }
    ];

    let lastErr = null;
    let newId = null;
    for (const a of attempts) {
      try {
        const info = await req.db.prepare(a.sql).run(...a.params);
        newId = info.lastInsertRowid;
        try {
          await setUserRoles(req.db, newId, rolIds);
        } catch (e) {
          console.warn('[POST /config/usuarios] setUserRoles:', e.message);
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (String(err.message || '').includes('UNIQUE') || /Duplicate/i.test(err.message || '')) {
          return res.status(400).json({ success: false, message: 'El email ya existe' });
        }
        if (!/Unknown column|no such column/i.test(err.message || '')) break;
      }
    }
    if (!newId) throw lastErr || new Error('No se pudo crear el usuario');

    let sync = { empresas, synced: [sessionEmpresa] };
    try {
      sync = await syncUserAcrossEmpresas({
        sourceDb: req.db,
        sourceEmpresa: sessionEmpresa,
        email: b.email,
        profile: {
          nombre: b.nombre,
          apellido: b.apellido,
          cargo: b.cargo,
          telefono: b.telefono,
          departamento_id: b.departamento_id,
          rol_id: primaryRol,
          flag_checklist: b.flag_checklist,
          flag_flota: b.flag_flota,
          flag_ssgg: b.flag_ssgg,
          flag_camion_pluma: b.flag_camion_pluma,
          flag_aprobador_salida: b.flag_aprobador_salida
        },
        passwordHash: hash,
        rolIds,
        empresas,
        deactivateMissing: true
      });
    } catch (e) {
      console.warn('[POST /config/usuarios] sync empresas:', e.message);
    }

    return res.status(201).json({
      success: true,
      data: { id: newId, rol_ids: rolIds, empresas_acceso: sync.empresas || empresas, sync }
    });
  } catch (err) {
    console.error('[POST /config/usuarios]', err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || 'Error al crear usuario' });
  }
});

router.post('/config/usuarios/:id', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { setUserRoles, normalizeRolIds } = require('../services/usuario-roles');
  const b = req.body || {};
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID inválido' });

  try {
    const cur = await req.db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(id);
    if (!cur) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const flag = (v, fallback) => {
      if (v === undefined) return fallback == null ? 0 : Number(fallback) ? 1 : 0;
      return v === true || v === 1 || v === '1' ? 1 : 0;
    };
    const pick = (incoming, current) => {
      if (incoming === undefined) return current == null ? null : current;
      if (incoming === '') return null;
      return incoming;
    };

    let password = cur.password;
    if (b.password && String(b.password).trim()) {
      password = bcrypt.hashSync(String(b.password).trim(), 10);
    }

    const rolIds = (b.rol_ids != null || b.rol_id != null)
      ? normalizeRolIds(b.rol_ids != null ? b.rol_ids : b.rol_id, cur.rol_id)
      : null;
    const primaryRol = rolIds ? (rolIds[0] || cur.rol_id || 3) : (b.rol_id != null ? Number(b.rol_id) : (cur.rol_id ?? 3));

    const base = {
      nombre: b.nombre || cur.nombre,
      apellido: b.apellido || cur.apellido,
      email: b.email || cur.email,
      password,
      cargo: pick(b.cargo, cur.cargo),
      rol_id: primaryRol,
      departamento_id: b.departamento_id !== undefined
        ? (b.departamento_id ? Number(b.departamento_id) : null)
        : (cur.departamento_id ?? null),
      telefono: pick(b.telefono, cur.telefono),
      flag_checklist: flag(b.flag_checklist, cur.flag_checklist),
      flag_flota: flag(b.flag_flota, cur.flag_flota),
      flag_ssgg: flag(b.flag_ssgg, cur.flag_ssgg),
      flag_camion_pluma: flag(b.flag_camion_pluma, cur.flag_camion_pluma),
      flag_aprobador_salida: flag(b.flag_aprobador_salida, cur.flag_aprobador_salida),
      flag_chofer: flag(b.flag_chofer, cur.flag_chofer),
      activo: b.activo === 0 || b.activo === false ? 0 : 1
    };

    const attempts = [
      {
        sql: `UPDATE usuarios SET
          nombre = ?, apellido = ?, email = ?, password = ?, cargo = ?,
          rol_id = ?, departamento_id = ?, telefono = ?,
          flag_checklist = ?, flag_flota = ?, flag_ssgg = ?,
          flag_camion_pluma = ?, flag_aprobador_salida = ?, flag_chofer = ?,
          activo = ?
        WHERE id = ?`,
        params: [
          base.nombre, base.apellido, base.email, base.password, base.cargo,
          base.rol_id, base.departamento_id, base.telefono,
          base.flag_checklist, base.flag_flota, base.flag_ssgg,
          base.flag_camion_pluma, base.flag_aprobador_salida, base.flag_chofer,
          base.activo, id
        ]
      },
      {
        sql: `UPDATE usuarios SET
          nombre = ?, apellido = ?, email = ?, password = ?, cargo = ?,
          rol_id = ?, departamento_id = ?, telefono = ?,
          flag_checklist = ?, flag_flota = ?, flag_ssgg = ?,
          flag_camion_pluma = ?, flag_aprobador_salida = ?,
          activo = ?
        WHERE id = ?`,
        params: [
          base.nombre, base.apellido, base.email, base.password, base.cargo,
          base.rol_id, base.departamento_id, base.telefono,
          base.flag_checklist, base.flag_flota, base.flag_ssgg,
          base.flag_camion_pluma, base.flag_aprobador_salida,
          base.activo, id
        ]
      },
      {
        sql: `UPDATE usuarios SET
          nombre = ?, apellido = ?, email = ?, password = ?, cargo = ?,
          rol_id = ?, departamento_id = ?, telefono = ?, activo = ?
        WHERE id = ?`,
        params: [
          base.nombre, base.apellido, base.email, base.password, base.cargo,
          base.rol_id, base.departamento_id, base.telefono, base.activo, id
        ]
      },
      {
        sql: `UPDATE usuarios SET
          nombre = ?, apellido = ?, email = ?, cargo = ?,
          rol_id = ?, departamento_id = ?, telefono = ?
        WHERE id = ?`,
        params: [
          base.nombre, base.apellido, base.email, base.cargo,
          base.rol_id, base.departamento_id, base.telefono, id
        ]
      }
    ];

    let lastErr = null;
    let updated = false;
    for (const a of attempts) {
      try {
        // mysql2 rechaza undefined
        const params = a.params.map((v) => (v === undefined ? null : v));
        await req.db.prepare(a.sql).run(...params);
        updated = true;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (String(err.message || '').includes('UNIQUE') || /Duplicate/i.test(err.message || '')) {
          return res.status(400).json({ success: false, message: 'El email ya existe' });
        }
        if (!/Unknown column|no such column/i.test(err.message || '')) break;
      }
    }
    if (!updated) throw lastErr || new Error('No se pudo actualizar el usuario');

    let savedIds = rolIds;
    if (rolIds) {
      try {
        savedIds = await setUserRoles(req.db, id, rolIds);
      } catch (e) {
        console.warn('[POST /config/usuarios/:id] setUserRoles:', e.message);
        return res.status(e.status || 500).json({
          success: false,
          message: e.message || 'No se pudieron guardar los roles'
        });
      }
    }

    const { normalizeEmpresasAcceso, parseEmpresasAcceso, syncUserAcrossEmpresas } = require('../services/usuario-empresas');
    const sessionEmpresa = String(req.auth?.empresa || 'sercom').toLowerCase();
    const empresas = (b.empresas_acceso != null || b.empresas != null)
      ? normalizeEmpresasAcceso(b.empresas_acceso != null ? b.empresas_acceso : b.empresas, sessionEmpresa)
      : normalizeEmpresasAcceso(parseEmpresasAcceso(cur.empresas_acceso), sessionEmpresa);

    let sync = { empresas };
    try {
      sync = await syncUserAcrossEmpresas({
        sourceDb: req.db,
        sourceEmpresa: sessionEmpresa,
        email: base.email,
        profile: {
          nombre: base.nombre,
          apellido: base.apellido,
          cargo: base.cargo,
          telefono: base.telefono,
          departamento_id: base.departamento_id,
          rol_id: base.rol_id,
          flag_checklist: base.flag_checklist,
          flag_flota: base.flag_flota,
          flag_ssgg: base.flag_ssgg,
          flag_camion_pluma: base.flag_camion_pluma,
          flag_aprobador_salida: base.flag_aprobador_salida
        },
        passwordHash: (b.password && String(b.password).trim()) ? password : null,
        rolIds: savedIds || (cur.rol_id ? [cur.rol_id] : [3]),
        empresas,
        deactivateMissing: true
      });
    } catch (e) {
      console.warn('[POST /config/usuarios/:id] sync empresas:', e.message);
    }

    return res.json({
      success: true,
      message: savedIds
        ? `Usuario actualizado (${savedIds.length} roles)`
        : 'Usuario actualizado',
      data: { rol_ids: savedIds || undefined, empresas_acceso: sync.empresas || empresas, sync }
    });
  } catch (err) {
    console.error('[POST /config/usuarios/:id]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Error al actualizar usuario' });
  }
});

router.post('/config/usuarios/:id/eliminar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID inválido' });
    if (id === req.auth.userId) {
      return res.status(400).json({ success: false, message: 'No puedes eliminar tu propio usuario' });
    }
    const existing = await req.db.prepare(`SELECT id, email, nombre, apellido FROM usuarios WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    // Soft delete (mantiene historial / FKs)
    try {
      await req.db.prepare(`UPDATE usuarios SET activo = 0 WHERE id = ?`).run(id);
    } catch (_) {
      await req.db.prepare(`DELETE FROM usuarios WHERE id = ?`).run(id);
    }
    try {
      await toTrash(req.db, req.auth.userId, 'usuario', id, existing.email, `${existing.nombre} ${existing.apellido}`, existing);
    } catch (_) { /* papelera opcional */ }

    res.json({ success: true, message: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo eliminar' });
  }
});

router.get('/config/roles', async (req, res) => {
  try {
    let data;
    try {
      data = await req.db.prepare(`SELECT * FROM roles WHERE activo = 1`).all();
    } catch (_) {
      data = await req.db.prepare(`SELECT * FROM roles`).all();
    }
    // Normaliza permisos → paginas_permitidas para el front
    data = (data || []).map((r) => ({
      ...r,
      paginas_permitidas: r.paginas_permitidas != null ? r.paginas_permitidas : r.permisos
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('config/roles', err);
    res.status(500).json({ success: false, message: err.message || 'No se pudieron cargar roles', data: [] });
  }
});

/** Módulos visibles de esta empresa (techo). GET: cualquier autenticado. POST: admin/subadmin. */
router.get('/config/modulos-empresa', async (req, res) => {
  try {
    const {
      getEmpresaModulos, DEFAULT_CATALOG, ensureWmsInRoles, syncCatalogIntoEmpresaModulos
    } = require('../services/empresa-modulos');
    const catalog = DEFAULT_CATALOG;
    await syncCatalogIntoEmpresaModulos(req.db, catalog);
    try { await ensureWmsInRoles(req.db); } catch (_) { /* opcional */ }
    const data = await getEmpresaModulos(req.db, catalog);
    res.json({
      success: true,
      data: {
        ...data,
        catalog: catalog.map((key) => ({
          key,
          always_on: data.always_on.includes(key),
          compartido: (data.compartidos || []).includes(key)
        })),
        can_edit: isAdminUser(req.auth.user)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/config/modulos-empresa', async (req, res) => {
  try {
    if (!isAdminUser(req.auth.user)) {
      return res.status(403).json({
        success: false,
        message: 'Solo administradores y subadministradores pueden definir módulos visibles'
      });
    }
    const { setEmpresaModulos, DEFAULT_CATALOG } = require('../services/empresa-modulos');
    const visibles = req.body?.visibles || req.body?.modulos || [];
    const data = await setEmpresaModulos(req.db, visibles, DEFAULT_CATALOG);
    res.json({
      success: true,
      message: 'Módulos de la empresa actualizados',
      data
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/** Módulos compartidos (data SERCOM + visibles en todas las empresas). Config en BD SERCOM. */
router.get('/config/modulos-compartidos', async (req, res) => {
  try {
    const { getModulosCompartidos } = require('../services/modulos-compartidos');
    const { DEFAULT_CATALOG } = require('../services/empresa-modulos');
    const data = await getModulosCompartidos(DEFAULT_CATALOG);
    const { SHARED_DATA_SUPPORTED } = require('../services/modulos-compartidos');
    res.json({
      success: true,
      data: {
        ...data,
        catalog: DEFAULT_CATALOG,
        data_sercom_supported: [...SHARED_DATA_SUPPORTED],
        can_edit: isAdminUser(req.auth.user),
        fuente: 'sercom'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/config/modulos-compartidos', async (req, res) => {
  try {
    if (!isAdminUser(req.auth.user)) {
      return res.status(403).json({
        success: false,
        message: 'Solo administradores y subadministradores pueden definir módulos compartidos'
      });
    }
    const { setModulosCompartidos } = require('../services/modulos-compartidos');
    const { DEFAULT_CATALOG, getEmpresaModulos } = require('../services/empresa-modulos');
    const { getAllCompanyDbs } = require('../db/tenants');
    const keys = req.body?.compartidos || req.body?.visibles || req.body?.modulos || [];
    const data = await setModulosCompartidos(keys, DEFAULT_CATALOG);
    // Forzar visibilidad en cada empresa ya configurada
    for (const { db } of getAllCompanyDbs()) {
      try {
        const cur = await getEmpresaModulos(db, DEFAULT_CATALOG);
        if (!cur.configured) continue;
        const merged = new Set([...(cur.visibles || []), ...(data.compartidos || [])]);
        const { setEmpresaModulos } = require('../services/empresa-modulos');
        await setEmpresaModulos(db, [...merged], DEFAULT_CATALOG);
      } catch (e) {
        console.warn('[modulos-compartidos] sync empresa:', e.message);
      }
    }
    res.json({
      success: true,
      message: 'Módulos compartidos actualizados (data SERCOM en todas las empresas)',
      data
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/config/notificaciones/catalogo', async (_req, res) => {
  try {
    const { catalogo } = require('../services/notificaciones-reglas');
    res.json({ success: true, data: catalogo() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/config/notificaciones/:rolId', async (req, res) => {
  try {
    const { listReglas, catalogo } = require('../services/notificaciones-reglas');
    const reglas = await listReglas(req.db, Number(req.params.rolId));
    res.json({ success: true, data: { reglas, catalogo: catalogo() } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/config/notificaciones/:rolId', async (req, res) => {
  try {
    const { saveReglasRol } = require('../services/notificaciones-reglas');
    const data = await saveReglasRol(req.db, Number(req.params.rolId), req.body?.reglas || []);
    res.json({ success: true, data, message: 'Alertas de notificación guardadas' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/config/roles', async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = String(b.nombre || '').trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'Nombre del rol requerido' });
    const descripcion = b.descripcion || null;
    const pages = Array.isArray(b.paginas_permitidas) ? b.paginas_permitidas : ['*'];
    const pagesJson = JSON.stringify(pages);

    let info;
    try {
      info = await req.db.prepare(`
        INSERT INTO roles (nombre, descripcion, paginas_permitidas, activo)
        VALUES (?, ?, ?, 1)
      `).run(nombre, descripcion, pagesJson);
    } catch (_) {
      info = await req.db.prepare(`
        INSERT INTO roles (nombre, descripcion, permisos)
        VALUES (?, ?, ?)
      `).run(nombre, descripcion, pagesJson);
    }
    res.status(201).json({ success: true, data: { id: info.lastInsertRowid }, message: 'Rol creado' });
  } catch (err) {
    if (String(err.message || '').toLowerCase().includes('unique') || String(err.message || '').includes('Duplicate')) {
      return res.status(400).json({ success: false, message: 'Ya existe un rol con ese nombre' });
    }
    res.status(500).json({ success: false, message: err.message || 'No se pudo crear el rol' });
  }
});

router.post('/config/roles/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const existing = await req.db.prepare(`SELECT * FROM roles WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Rol no encontrado' });

    const nombre = String(b.nombre || existing.nombre).trim();
    const descripcion = b.descripcion !== undefined ? b.descripcion : existing.descripcion;
    const pages = Array.isArray(b.paginas_permitidas)
      ? b.paginas_permitidas
      : (existing.paginas_permitidas || existing.permisos || ['*']);
    const pagesJson = typeof pages === 'string' ? pages : JSON.stringify(pages);

    try {
      await req.db.prepare(`
        UPDATE roles SET nombre = ?, descripcion = ?, paginas_permitidas = ? WHERE id = ?
      `).run(nombre, descripcion, pagesJson, id);
    } catch (_) {
      await req.db.prepare(`
        UPDATE roles SET nombre = ?, descripcion = ?, permisos = ? WHERE id = ?
      `).run(nombre, descripcion, pagesJson, id);
    }
    res.json({ success: true, message: 'Rol actualizado' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo actualizar el rol' });
  }
});

router.post('/config/roles/:id/eliminar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { countUsersWithRole } = require('../services/usuario-roles');
    const c = await countUsersWithRole(req.db, id);
    if (c > 0) {
      return res.status(400).json({
        success: false,
        message: `Hay ${c} usuario(s) con este rol. Reasígnarlos antes de eliminar.`
      });
    }
    try {
      await req.db.prepare(`UPDATE roles SET activo = 0 WHERE id = ?`).run(id);
    } catch (_) {
      await req.db.prepare(`DELETE FROM roles WHERE id = ?`).run(id);
    }
    res.json({ success: true, message: 'Rol eliminado' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo eliminar el rol' });
  }
});

/* ========== PERMISOS ESPECIALES (liberadores / aprobadores) ========== */
const permisosEsp = require('../services/permisos-especiales');

router.get('/config/permisos-especiales', async (req, res) => {
  try {
    try { await permisosEsp.initPermisos(req.db); } catch (err) {
      console.warn('permisos-especiales init:', err.message);
    }
    const data = await permisosEsp.listAll(req.db);
    res.json({ success: true, data });
  } catch (err) {
    console.error('permisos-especiales', err);
    const fallback = (permisosEsp.CATALOGO || []).map((c, i) => ({
      ...c,
      usuario_id: null,
      activo: 1,
      orden: (i + 1) * 10,
      usuarios: [],
      flag: permisosEsp.FLAG_BY_CODIGO?.[c.codigo] || null
    }));
    res.json({ success: true, data: fallback, warning: err.message });
  }
});

router.get('/config/permisos-especiales/mios', async (req, res) => {
  try {
    await permisosEsp.initPermisos(req.db);
    const permisos = await permisosEsp.userCodes(req.db, req.auth.userId);
    res.json({ success: true, data: { permisos } });
  } catch (err) {
    res.json({ success: true, data: { permisos: {} } });
  }
});

router.post('/config/permisos-especiales/:codigo/usuarios', async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim();
    const usuarioId = Number(req.body?.usuario_id);
    if (!usuarioId) return res.status(400).json({ success: false, message: 'usuario_id requerido' });
    await permisosEsp.initPermisos(req.db);
    await permisosEsp.addUser(req.db, codigo, usuarioId);
    res.json({ success: true, message: 'Usuario asignado al permiso' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo asignar' });
  }
});

router.post('/config/permisos-especiales/:codigo/usuarios/:userId/quitar', async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim();
    const usuarioId = Number(req.params.userId);
    await permisosEsp.initPermisos(req.db);
    await permisosEsp.removeUser(req.db, codigo, usuarioId);
    res.json({ success: true, message: 'Usuario quitado del permiso' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'No se pudo quitar' });
  }
});

router.get('/config/departamentos', async (req, res) => {
  try {
    let data;
    try {
      data = await req.db.prepare(`SELECT id, nombre FROM departamentos WHERE activo = 1 ORDER BY nombre`).all();
    } catch (_) {
      data = await req.db.prepare(`SELECT id, nombre FROM departamentos ORDER BY nombre`).all();
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('config/departamentos', err);
    res.json({ success: true, data: [] });
  }
});

/* ========== REPORTES ========== */
router.get('/reportes', async (req, res) => {
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
    const data = await req.db.prepare(`
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
    const data = await req.db.prepare(`
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
    const data = await req.db.prepare(`
      SELECT s.codigo, s.categoria, s.titulo, s.estado, s.prioridad, s.fecha_creacion
      FROM servicios_generales s WHERE s.eliminado = 0 ${f.clause}
      ORDER BY s.id DESC
    `).all(...f.params);
    return res.json({ success: true, data });
  }
  if (modulo === 'flota') {
    const f = dateFilter('c.fecha');
    const data = await req.db.prepare(`
      SELECT c.patente, c.kilometraje, c.fecha,
             COALESCE(c.estado_general, c.estado) AS estado_general, c.observaciones
      FROM checklist_flota c WHERE COALESCE(c.anulado, 0) = 0 ${f.clause}
      ORDER BY c.id DESC
    `).all(...f.params);
    return res.json({ success: true, data });
  }

  const f = dateFilter('s.fecha_solicitud');
  const data = await req.db.prepare(`
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
router.get('/papelera', async (req, res) => {
  const data = await req.db.prepare(`
    SELECT p.*, u.nombre || ' ' || u.apellido AS eliminado_por_nombre
    FROM papelera p
    LEFT JOIN usuarios u ON u.id = p.eliminado_por
    ORDER BY p.id DESC
  `).all();
  res.json({ success: true, data });
});

router.post('/papelera/:id/restaurar', async (req, res) => {
  const item = await req.db.prepare(`SELECT * FROM papelera WHERE id = ?`).get(Number(req.params.id));
  if (!item) return res.status(404).json({ success: false, message: 'No encontrado' });

  const map = {
    compras: 'UPDATE solicitudes_compras SET eliminado = 0 WHERE id = ?',
    'datos-maestros': 'UPDATE creacion_datos_maestros SET eliminado = 0 WHERE id = ?',
    tareas: 'UPDATE tareas_operativas SET eliminado = 0 WHERE id = ?',
    materiales: 'UPDATE solicitudes_materiales SET eliminado = 0 WHERE id = ?'
  };
  const sql = map[item.tipo];
  if (sql) await req.db.prepare(sql).run(item.referencia_id);
  await req.db.prepare(`DELETE FROM papelera WHERE id = ?`).run(item.id);
  res.json({ success: true, message: 'Restaurado' });
});

router.post('/papelera/:id/eliminar', async (req, res) => {
  await req.db.prepare(`DELETE FROM papelera WHERE id = ?`).run(Number(req.params.id));
  res.json({ success: true, message: 'Eliminado permanentemente' });
});

/* ---- Incidencias de soporte (foto + aviso a admin/subadmin) ---- */
router.get('/incidencias', async (req, res) => {
  try {
    const { listIncidencias } = require('../services/incidencias');
    const data = await listIncidencias(req.db, {
      user: req.auth.user,
      estado: req.query.estado || null,
      mias: req.query.mias === '1',
      q: req.query.q || null,
      limit: Number(req.query.limit) || 100
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/incidencias/upload-foto', async (req, res) => {
  try {
    const { saveIncidenciaPhoto } = require('../services/incidencias');
    const ruta = await saveIncidenciaPhoto(req.body?.dataUrl, req.auth.empresa);
    res.json({ success: true, ruta });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/incidencias/foto/:empresa/:file', async (req, res) => {
  try {
    const { resolveIncidenciaPhoto } = require('../services/incidencias');
    const full = resolveIncidenciaPhoto(req.params.empresa, req.params.file);
    if (!full) return res.status(404).json({ success: false, message: 'Foto no encontrada' });
    res.sendFile(full);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/incidencias', async (req, res) => {
  try {
    const { createIncidencia } = require('../services/incidencias');
    const b = req.body || {};
    const data = await createIncidencia(req.db, {
      userId: req.auth.userId,
      user: req.auth.user,
      titulo: b.titulo,
      descripcion: b.descripcion,
      fotoDataUrl: b.dataUrl || b.fotoDataUrl || null,
      fotoRuta: b.foto_ruta || b.fotoRuta || null,
      origen: b.origen || 'modulo',
      categoria: b.categoria || null,
      prioridad: b.prioridad || 'media',
      empresaSlug: req.auth.empresa
    });
    res.status(201).json({
      success: true,
      data,
      message: `Incidencia ${data.codigo} creada. Se avisó a administradores.`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/incidencias/:id', async (req, res) => {
  try {
    const { getIncidencia, isAdminOrSubadmin } = require('../services/incidencias');
    const row = await getIncidencia(req.db, Number(req.params.id));
    if (!row) return res.status(404).json({ success: false, message: 'Incidencia no encontrada' });
    const admin = isAdminOrSubadmin(req.auth.user);
    if (!admin && Number(row.solicitante_id) !== Number(req.auth.userId)) {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }
    res.json({ success: true, data: row, canManage: admin });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put('/incidencias/:id', async (req, res) => {
  try {
    const { updateIncidencia } = require('../services/incidencias');
    const data = await updateIncidencia(req.db, Number(req.params.id), {
      user: req.auth.user,
      ...(req.body || {})
    });
    res.json({ success: true, data, message: 'Incidencia actualizada' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});



/* ---- Inspección de fabricación ---- */
async function inspDb(req) {
  const { resolveModuleDb } = require('../services/modulos-compartidos');
  return resolveModuleDb(req, 'inspeccion.html');
}

function isInspeccionAdmin(user) {
  if (!user) return false;
  if (Number(user.rol_id) === 1) return true;
  if (Array.isArray(user.rol_ids) && user.rol_ids.map(Number).includes(1)) return true;
  const names = [user.rol, ...(Array.isArray(user.roles) ? user.roles : [])].join(' ').toLowerCase();
  return /admin|administrador|subadmin/.test(names);
}

router.get('/inspeccion/meta', async (req, res) => {
  try {
    const { ESTADOS, listPiezasCatalogo, ensureInspeccionSchema } = require('../services/inspeccion');
    const db = await inspDb(req);
    await ensureInspeccionSchema(db);
    const catalogo = await listPiezasCatalogo(db, req.query.q || '');
    const jefeExpr = db.driver === 'mysql'
      ? "TRIM(CONCAT(COALESCE(u.nombre,''), ' ', COALESCE(u.apellido,'')))"
      : "(COALESCE(u.nombre,'') || ' ' || COALESCE(u.apellido,''))";
    const cecos = await db.prepare(`
      SELECT c.id, c.codigo, c.nombre, c.jefe_proyecto_id,
             ${jefeExpr} AS jefe_proyecto
      FROM cecos c
      LEFT JOIN usuarios u ON u.id = c.jefe_proyecto_id
      ORDER BY c.codigo, c.nombre
    `).all();
    const usuarios = await db.prepare(`
      SELECT u.id, u.nombre, u.apellido, u.email, r.nombre AS rol
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      WHERE COALESCE(u.activo, 1) = 1
      ORDER BY u.nombre, u.apellido
      LIMIT 500
    `).all();
    const proveedoresCols = await (async () => {
      try {
        const rows = await db.prepare('SHOW COLUMNS FROM `proveedores`').all();
        return new Set(
          rows
            .map((r) => String(r.Field || r.field || r.COLUMN_NAME || '').toLowerCase())
            .filter(Boolean)
        );
      } catch (_) {
        try {
          const rows = await db.prepare(`
            SELECT COLUMN_NAME AS n FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'proveedores'
          `).all();
          return new Set(rows.map((r) => String(r.n || r.COLUMN_NAME || '').toLowerCase()).filter(Boolean));
        } catch (_2) {
          return new Set();
        }
      }
    })();
    const hasProvNombre = proveedoresCols.has('nombre');
    const hasProvRazon = proveedoresCols.has('razon_social');
    const provEmail = proveedoresCols.has('email')
      ? 'email'
      : (proveedoresCols.has('correo') ? 'correo AS email' : 'NULL AS email');
    const provTel = proveedoresCols.has('telefono') ? 'telefono' : 'NULL AS telefono';
    const provOrder = hasProvNombre ? 'nombre' : (hasProvRazon ? 'razon_social' : 'id');
    const provWhere = proveedoresCols.has('activo')
      ? 'WHERE (activo = 1 OR activo IS NULL)'
      : '';
    const provName = hasProvNombre && hasProvRazon
      ? 'COALESCE(NULLIF(TRIM(nombre),\'\'), razon_social) AS razon_social'
      : (hasProvNombre
        ? 'nombre AS razon_social'
        : (hasProvRazon ? 'razon_social' : 'CAST(id AS CHAR) AS razon_social'));
    let proveedores = [];
    try {
      proveedores = await db.prepare(`
        SELECT id, ${provName}, rut, ${provEmail}, ${provTel}
        FROM proveedores
        ${provWhere}
        ORDER BY ${provOrder}
        LIMIT 500
      `).all();
    } catch (e) {
      console.warn('[inspeccion meta] proveedores:', e.message);
      try {
        proveedores = await db.prepare(`
          SELECT id, nombre AS razon_social, rut, NULL AS email, NULL AS telefono
          FROM proveedores
          ORDER BY nombre
          LIMIT 500
        `).all();
      } catch (e2) {
        console.warn('[inspeccion meta] proveedores fallback:', e2.message);
        proveedores = [];
      }
    }
    res.json({
      success: true,
      data: {
        estados: ESTADOS,
        piezas_catalogo: catalogo,
        cecos,
        usuarios,
        proveedores,
        data_shared: db !== req.db
      }
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/inspeccion/piezas-catalogo', async (req, res) => {
  try {
    const { listPiezasCatalogo } = require('../services/inspeccion');
    const data = await listPiezasCatalogo(await inspDb(req), req.query.q || '');
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/inspeccion', async (req, res) => {
  try {
    const { listInspecciones } = require('../services/inspeccion');
    const result = await listInspecciones(await inspDb(req), {
      estado: req.query.estado || null,
      q: req.query.q || null,
      mias: req.query.mias === '1',
      userId: req.auth.userId,
      limit: Number(req.query.limit) || 80
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/inspeccion/upload', async (req, res) => {
  try {
    const { saveFile } = require('../services/inspeccion');
    const imagesOnly = req.body?.tipo === 'pieza' || req.body?.imagesOnly;
    const saved = await saveFile(req.body?.dataUrl, req.auth.empresa, req.body?.prefix || 'file', { imagesOnly: !!imagesOnly });
    res.json({ success: true, ruta: saved.ruta, filename: saved.filename });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/inspeccion/archivo/:empresa/:file', async (req, res) => {
  try {
    const { resolveFile } = require('../services/inspeccion');
    const full = resolveFile(req.params.empresa, req.params.file);
    if (!full) return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
    res.sendFile(full);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/inspeccion', async (req, res) => {
  try {
    const { createInspeccion } = require('../services/inspeccion');
    const data = await createInspeccion(await inspDb(req), {
      body: req.body || {},
      userId: req.auth.userId,
      empresaSlug: req.auth.empresa
    });
    res.status(201).json({ success: true, data, message: `Inspección ${data.codigo} creada` });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/inspeccion/:id', async (req, res) => {
  try {
    const { getInspeccion } = require('../services/inspeccion');
    const data = await getInspeccion(await inspDb(req), req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'No encontrada' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put('/inspeccion/:id', async (req, res) => {
  try {
    const { updateInspeccion } = require('../services/inspeccion');
    const data = await updateInspeccion(await inspDb(req), req.params.id, {
      body: req.body || {},
      userId: req.auth.userId,
      empresaSlug: req.auth.empresa,
      isAdmin: isInspeccionAdmin(req.auth.user)
    });
    res.json({ success: true, data, message: 'Inspección actualizada' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/inspeccion/:id/piezas', async (req, res) => {
  try {
    const { addPieza } = require('../services/inspeccion');
    const data = await addPieza(await inspDb(req), req.params.id, {
      ...req.body,
      userId: req.auth.userId,
      empresaSlug: req.auth.empresa
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put('/inspeccion/pieza/:piezaId', async (req, res) => {
  try {
    const { updatePieza } = require('../services/inspeccion');
    const data = await updatePieza(await inspDb(req), req.params.piezaId, {
      ...req.body,
      userId: req.auth.userId,
      empresaSlug: req.auth.empresa,
      isAdmin: isInspeccionAdmin(req.auth.user)
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/inspeccion/:id/chat', async (req, res) => {
  try {
    const { listChat } = require('../services/inspeccion');
    const data = await listChat(await inspDb(req), req.params.id, Number(req.query.limit) || 100);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/inspeccion/:id/chat', async (req, res) => {
  try {
    const { postChat } = require('../services/inspeccion');
    const data = await postChat(await inspDb(req), req.params.id, {
      mensaje: req.body?.mensaje,
      userId: req.auth.userId
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/inspeccion/:id/anular', async (req, res) => {
  try {
    const { softDeleteInspeccion } = require('../services/inspeccion');
    await softDeleteInspeccion(await inspDb(req), req.params.id, {
      userId: req.auth.userId,
      isAdmin: isInspeccionAdmin(req.auth.user)
    });
    res.json({ success: true, message: 'Inspección anulada' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/* ---- WMS: bodega caótica, layout, QR ingreso/salida ---- */
function requireWmsAccess(req, res) {
  if (!userHasPageAccess(req.auth.user, 'wms.html')) {
    res.status(403).json({ success: false, message: 'Sin acceso a WMS' });
    return false;
  }
  return true;
}

router.get('/wms/meta', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { getMeta, ensureWmsSchema } = require('../services/wms');
    await ensureWmsSchema(req.db);
    res.json({ success: true, data: getMeta() });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/bodegas', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { listBodegas } = require('../services/wms');
    const data = await listBodegas(req.db);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/bodegas', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { createBodega } = require('../services/wms');
    const data = await createBodega(req.db, {
      userId: req.auth.userId,
      empresaSlug: req.auth.empresa,
      body: req.body || {}
    });
    res.status(201).json({ success: true, data, message: `Bodega ${data.codigo} creada` });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/bodegas/:id', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { getBodega } = require('../services/wms');
    const data = await getBodega(req.db, req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Bodega no encontrada' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put('/wms/bodegas/:id', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { updateBodega } = require('../services/wms');
    const data = await updateBodega(req.db, req.params.id, {
      ...(req.body || {}),
      empresaSlug: req.auth.empresa
    });
    res.json({ success: true, data, message: 'Bodega actualizada' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/plano', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { savePlano } = require('../services/wms');
    const ruta = await savePlano(req.body?.dataUrl || req.body?.planoDataUrl, req.auth.empresa);
    res.json({ success: true, ruta });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/plano/:empresa/:file', async (req, res) => {
  try {
    const { resolvePlano } = require('../services/wms');
    const full = resolvePlano(req.params.empresa, req.params.file);
    if (!full) return res.status(404).json({ success: false, message: 'Plano no encontrado' });
    res.sendFile(full);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/wms/bodegas/:id/propuestas', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { listPropuestas } = require('../services/wms');
    const data = await listPropuestas(req.db, req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/bodegas/:id/propuestas', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { crearPropuesta } = require('../services/wms');
    const data = await crearPropuesta(req.db, {
      userId: req.auth.userId,
      bodegaId: req.params.id,
      body: req.body || {}
    });
    res.status(201).json({
      success: true,
      data,
      message: `Propuesta ${data.codigo}: ${data.total_posiciones} posiciones`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/propuestas/:id', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { getPropuesta } = require('../services/wms');
    const data = await getPropuesta(req.db, req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Propuesta no encontrada' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put('/wms/propuestas/:id', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { updatePropuestaLayout } = require('../services/wms');
    const data = await updatePropuestaLayout(req.db, req.params.id, req.body || {});
    res.json({ success: true, data, message: 'Propuesta actualizada' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/propuestas/:id/aprobar', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { aprobarPropuesta } = require('../services/wms');
    const data = await aprobarPropuesta(req.db, req.params.id, { userId: req.auth.userId });
    res.json({
      success: true,
      data,
      message: `Aprobada: se crearon ${data.creadas} posiciones con QR`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/bodegas/:id/inventario', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { listInventario } = require('../services/wms');
    const data = await listInventario(req.db, {
      bodegaId: req.params.id,
      q: req.query.q || null,
      posicionId: req.query.posicion_id || null
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/bodegas/:id/movimientos', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { listMovimientos } = require('../services/wms');
    const data = await listMovimientos(req.db, {
      bodegaId: req.params.id,
      limit: Number(req.query.limit) || 80
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/bodegas/:id/ubicaciones', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { buscarMaterialUbicaciones } = require('../services/wms');
    const data = await buscarMaterialUbicaciones(req.db, {
      bodegaId: req.params.id,
      materialCodigo: req.query.material_codigo || req.query.q
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/posiciones/lookup', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { findPosicion, sugerirPosicionLibre } = require('../services/wms');
    if (req.query.sugerir === '1' && req.query.bodega_id) {
      const data = await sugerirPosicionLibre(req.db, req.query.bodega_id);
      return res.json({ success: true, data });
    }
    const data = await findPosicion(req.db, {
      bodegaId: req.query.bodega_id,
      codigo: req.query.codigo,
      qrToken: req.query.qr || req.query.qr_token,
      id: req.query.id
    });
    if (!data) return res.status(404).json({ success: false, message: 'Posición no encontrada' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/ingreso', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { ingresoMaterial } = require('../services/wms');
    const data = await ingresoMaterial(req.db, { userId: req.auth.userId, body: req.body || {} });
    res.status(201).json({ success: true, data, message: data.mensaje });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/salida', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { salidaMaterial } = require('../services/wms');
    const data = await salidaMaterial(req.db, { userId: req.auth.userId, body: req.body || {} });
    res.status(201).json({ success: true, data, message: data.mensaje });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/traslado', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { trasladoMaterial } = require('../services/wms');
    const data = await trasladoMaterial(req.db, { userId: req.auth.userId, body: req.body || {} });
    res.status(201).json({ success: true, data, message: data.mensaje });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/posiciones/estado', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { setPosicionEstado } = require('../services/wms');
    const b = req.body || {};
    const data = await setPosicionEstado(req.db, {
      bodegaId: b.bodega_id,
      posicionId: b.posicion_id,
      codigo: b.posicion_codigo || b.codigo,
      qrToken: b.qr_token,
      estado: b.estado
    });
    res.json({ success: true, data, message: `Posición ${data.codigo} → ${data.estado}` });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/bodegas/:id/kpis', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { getBodegaKpis } = require('../services/wms');
    const data = await getBodegaKpis(req.db, req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

/* ---- Documentos de salida WMS ---- */
router.get('/wms/solicitudes-pendientes', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { listSolicitudesPendientesDespacho } = require('../services/wms');
    const data = await listSolicitudesPendientesDespacho(req.db, {
      q: req.query.q || null,
      limit: Number(req.query.limit) || 50
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/salidas', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { listSalidas } = require('../services/wms');
    const data = await listSalidas(req.db, {
      bodegaId: req.query.bodega_id || null,
      estado: req.query.estado || null,
      limit: Number(req.query.limit) || 80
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/wms/salidas/:id', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { getSalida } = require('../services/wms');
    const data = await getSalida(req.db, req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Salida no encontrada' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/salidas', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { createSalidaManual, createSalidaFromSolicitud } = require('../services/wms');
    const body = req.body || {};
    const data = body.solicitud_id
      ? await createSalidaFromSolicitud(req.db, { userId: req.auth.userId, body })
      : await createSalidaManual(req.db, { userId: req.auth.userId, body });
    res.status(201).json({
      success: true,
      data,
      message: `Salida ${data.codigo} creada (${(data.detalle || []).length} líneas)`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/salidas/:id/confirmar', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { confirmarSalida } = require('../services/wms');
    const data = await confirmarSalida(req.db, {
      userId: req.auth.userId,
      salidaId: req.params.id,
      body: req.body || {}
    });
    res.json({ success: true, data, message: data.mensaje });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/wms/salidas/:id/anular', async (req, res) => {
  try {
    if (!requireWmsAccess(req, res)) return;
    const { anularSalida } = require('../services/wms');
    const data = await anularSalida(req.db, {
      salidaId: req.params.id,
      userId: req.auth.userId
    });
    res.json({ success: true, data, message: `Salida ${data.codigo} anulada` });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

module.exports = router;
