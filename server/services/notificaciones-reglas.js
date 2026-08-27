/**
 * Reglas de alertas/notificación por rol y módulo.
 * Modo: siempre | nunca | seleccionar (filtros por estado, cantidad, tipo).
 */
const { sendMail, isConfigured } = require('./mailer');

const TABLE = 'notificacion_reglas';

const MODULOS_NOTIF = [
  {
    id: 'checklist-flota',
    label: 'Checklist Flota',
    estados: [
      { id: 'pendiente', label: 'Pendiente / requiere atención' },
      { id: 'sin_revisar', label: 'Sin revisar (OK)' },
      { id: 'en_proceso', label: 'En proceso' },
      { id: 'cerrado', label: 'Cerrado' },
      { id: 'Malo', label: 'Estado general: Malo' },
      { id: 'Regular', label: 'Estado general: Regular' },
      { id: 'Bueno', label: 'Estado general: Bueno' },
      { id: 'Excelente', label: 'Estado general: Excelente' }
    ],
    tipos: [
      { id: 'inspeccion_ok', label: 'Inspección sin fallas' },
      { id: 'con_fallas', label: 'Con fallas / observaciones' },
      { id: 'colision', label: 'Colisión (foto o registro)' },
      { id: 'siniestro', label: 'Siniestro / choque (texto)' }
    ],
    cantidades: [
      { id: '0', label: '0 fallas' },
      { id: '1-3', label: '1 a 3 fallas' },
      { id: '4-10', label: '4 a 10 fallas' },
      { id: '11+', label: 'Más de 10 fallas' }
    ]
  },
  {
    id: 'solicitud-salida-materiales',
    label: 'Salida de materiales',
    estados: [
      { id: 'Pendiente', label: 'Pendiente' },
      { id: 'Aprobada', label: 'Aprobada' },
      { id: 'Rechazada', label: 'Rechazada' },
      { id: 'Cerrada', label: 'Cerrada' }
    ],
    tipos: [
      { id: 'nueva', label: 'Nueva solicitud' },
      { id: 'cambio_estado', label: 'Cambio de estado' }
    ],
    cantidades: [
      { id: '1-5', label: '1 a 5 ítems' },
      { id: '6-20', label: '6 a 20 ítems' },
      { id: '21+', label: 'Más de 20 ítems' }
    ]
  },
  {
    id: 'solicitud-de-compras',
    label: 'Solicitud de compras',
    estados: [
      { id: 'Pendiente', label: 'Pendiente' },
      { id: 'Aprobada', label: 'Aprobada' },
      { id: 'Rechazada', label: 'Rechazada' }
    ],
    tipos: [
      { id: 'nueva', label: 'Nueva compra' },
      { id: 'cambio_estado', label: 'Cambio de estado' }
    ],
    cantidades: [
      { id: '1-5', label: '1 a 5 ítems' },
      { id: '6-20', label: '6 a 20 ítems' },
      { id: '21+', label: 'Más de 20 ítems' }
    ]
  },
  {
    id: 'agenda-camion-pluma',
    label: 'Agenda camión pluma',
    estados: [
      { id: 'Programado', label: 'Programado' },
      { id: 'Confirmado', label: 'Confirmado' },
      { id: 'Cancelado', label: 'Cancelado' },
      { id: 'Bloqueo', label: 'Bloqueo' }
    ],
    tipos: [
      { id: 'servicio', label: 'Servicio' },
      { id: 'bloqueo', label: 'Bloqueo' }
    ],
    cantidades: [
      { id: 'cualquier', label: 'Cualquier cantidad / evento' }
    ]
  },
  {
    id: 'catalogo-flota',
    label: 'Catálogo flota (patente no encontrada)',
    estados: [{ id: 'alerta', label: 'Alerta generada' }],
    tipos: [{ id: 'patente_faltante', label: 'Patente no está en Excel' }],
    cantidades: [{ id: 'cualquier', label: 'Siempre que ocurra' }]
  }
];

async function ensureNotifSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rol_id INT NOT NULL,
        modulo VARCHAR(64) NOT NULL,
        modo VARCHAR(20) NOT NULL DEFAULT 'nunca',
        filtros_json LONGTEXT NULL,
        canal VARCHAR(20) NOT NULL DEFAULT 'ambos',
        activo TINYINT NOT NULL DEFAULT 1,
        actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_rol_mod (rol_id, modulo)
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rol_id INTEGER NOT NULL,
        modulo TEXT NOT NULL,
        modo TEXT NOT NULL DEFAULT 'nunca',
        filtros_json TEXT,
        canal TEXT NOT NULL DEFAULT 'ambos',
        activo INTEGER NOT NULL DEFAULT 1,
        actualizado_en TEXT DEFAULT (datetime('now')),
        UNIQUE(rol_id, modulo)
      )
    `);
  }
}

function catalogo() {
  return MODULOS_NOTIF;
}

function parseFiltros(raw) {
  try {
    if (!raw) return { estados: [], tipos: [], cantidades: [] };
    if (typeof raw === 'object') return normalizeFiltros(raw);
    return normalizeFiltros(JSON.parse(raw));
  } catch (_) {
    return { estados: [], tipos: [], cantidades: [] };
  }
}

function normalizeFiltros(f) {
  return {
    estados: Array.isArray(f.estados) ? f.estados.map(String) : [],
    tipos: Array.isArray(f.tipos) ? f.tipos.map(String) : [],
    cantidades: Array.isArray(f.cantidades) ? f.cantidades.map(String) : []
  };
}

async function listReglas(db, rolId) {
  await ensureNotifSchema(db);
  const rows = await db.prepare(`
    SELECT id, rol_id, modulo, modo, filtros_json, canal, activo
    FROM ${TABLE}
    WHERE rol_id = ?
    ORDER BY modulo
  `).all(Number(rolId));
  return rows.map((r) => ({
    ...r,
    filtros: parseFiltros(r.filtros_json)
  }));
}

async function getAllReglasMap(db) {
  await ensureNotifSchema(db);
  const rows = await db.prepare(`
    SELECT id, rol_id, modulo, modo, filtros_json, canal, activo
    FROM ${TABLE}
    WHERE activo = 1
  `).all();
  return rows.map((r) => ({ ...r, filtros: parseFiltros(r.filtros_json) }));
}

async function saveReglasRol(db, rolId, reglas) {
  await ensureNotifSchema(db);
  const rid = Number(rolId);
  if (!rid) {
    const err = new Error('Rol requerido');
    err.status = 400;
    throw err;
  }
  const list = Array.isArray(reglas) ? reglas : [];
  for (const item of list) {
    const modulo = String(item.modulo || '').trim();
    if (!MODULOS_NOTIF.some((m) => m.id === modulo)) continue;
    const modo = ['siempre', 'nunca', 'seleccionar'].includes(item.modo) ? item.modo : 'nunca';
    const canal = ['email', 'alerta', 'ambos'].includes(item.canal) ? item.canal : 'ambos';
    const filtros = normalizeFiltros(item.filtros || {});
    const filtrosJson = JSON.stringify(filtros);
    const existing = await db.prepare(`
      SELECT id FROM ${TABLE} WHERE rol_id = ? AND modulo = ?
    `).get(rid, modulo);
    if (existing) {
      await db.prepare(`
        UPDATE ${TABLE}
        SET modo = ?, filtros_json = ?, canal = ?, activo = 1,
            actualizado_en = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"}
        WHERE id = ?
      `).run(modo, filtrosJson, canal, existing.id);
    } else {
      await db.prepare(`
        INSERT INTO ${TABLE} (rol_id, modulo, modo, filtros_json, canal, activo)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(rid, modulo, modo, filtrosJson, canal);
    }
  }
  return listReglas(db, rid);
}

function cantidadBucket(n) {
  const x = Number(n) || 0;
  if (x <= 0) return '0';
  if (x <= 3) return '1-3';
  if (x <= 10) return '4-10';
  return '11+';
}

function matchCantidad(selected, value) {
  if (!selected?.length) return true;
  if (selected.includes('cualquier')) return true;
  const bucket = typeof value === 'string' && value.includes('-') ? value : cantidadBucket(value);
  // también rangos compras 1-5, 6-20, 21+
  if (selected.includes(bucket)) return true;
  const n = Number(value) || 0;
  for (const s of selected) {
    if (s === '1-5' && n >= 1 && n <= 5) return true;
    if (s === '6-20' && n >= 6 && n <= 20) return true;
    if (s === '21+' && n >= 21) return true;
    if (s === '11+' && n >= 11) return true;
  }
  return false;
}

function ruleMatches(rule, event) {
  if (!rule || Number(rule.activo) === 0) return false;
  if (rule.modulo !== event.modulo) return false;
  if (rule.modo === 'nunca') return false;
  if (rule.modo === 'siempre') return true;
  // seleccionar: cada dimensión con valores actúa como filtro (AND entre dims, OR dentro)
  const f = rule.filtros || parseFiltros(rule.filtros_json);
  const hasAny = (f.estados?.length || 0) + (f.tipos?.length || 0) + (f.cantidades?.length || 0) > 0;
  if (!hasAny) return false;
  if (f.estados?.length) {
    const estados = [event.estado, event.estado_general, event.estado_seguimiento].filter(Boolean).map(String);
    if (!f.estados.some((e) => estados.includes(String(e)))) return false;
  }
  if (f.tipos?.length) {
    const tipos = Array.isArray(event.tipos) ? event.tipos : [event.tipo].filter(Boolean);
    if (!f.tipos.some((t) => tipos.map(String).includes(String(t)))) return false;
  }
  if (f.cantidades?.length) {
    if (!matchCantidad(f.cantidades, event.cantidad)) return false;
  }
  return true;
}

async function usersByRolIds(db, rolIds) {
  const ids = [...new Set((rolIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  // usuarios con rol principal o en usuarios_roles
  let rows = [];
  try {
    rows = await db.prepare(`
      SELECT DISTINCT u.id, u.nombre, u.apellido, u.email, u.rol_id
      FROM usuarios u
      WHERE u.activo = 1 AND u.email IS NOT NULL AND u.email != ''
        AND (
          u.rol_id IN (${placeholders})
          OR u.id IN (
            SELECT usuario_id FROM usuarios_roles WHERE rol_id IN (${placeholders})
          )
        )
    `).all(...ids, ...ids);
  } catch (_) {
    rows = await db.prepare(`
      SELECT u.id, u.nombre, u.apellido, u.email, u.rol_id
      FROM usuarios u
      WHERE u.activo = 1 AND u.email IS NOT NULL AND u.email != ''
        AND u.rol_id IN (${placeholders})
    `).all(...ids);
  }
  return rows;
}

async function usersByIds(db, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  try {
    return await db.prepare(`
      SELECT id, nombre, apellido, email, rol_id
      FROM usuarios
      WHERE activo = 1 AND id IN (${placeholders})
    `).all(...ids);
  } catch (_) {
    return [];
  }
}

/**
 * Evalúa reglas y notifica (email + alerta in-app).
 * event: { modulo, estado, estado_general, estado_seguimiento, tipo|tipos[], cantidad, titulo, mensaje, referencia }
 * opts: { extraUserIds[], excludeUserId, forceAlert, forceEmail, severidad }
 */
async function dispatchNotificaciones(db, event, opts = {}) {
  await ensureNotifSchema(db);
  const rules = await getAllReglasMap(db);
  const matching = rules.filter((r) => ruleMatches(r, event));
  const extraIds = (opts.extraUserIds || []).map(Number).filter(Boolean);

  if (!matching.length && !extraIds.length && event.modulo === 'checklist-flota') {
    const tipos = Array.isArray(event.tipos) ? event.tipos : [event.tipo];
    if (tipos.some((t) => t === 'colision' || t === 'siniestro')) {
      return dispatchLegacyFlota(db, event);
    }
    return { sent: 0, reason: 'sin_reglas' };
  }
  if (!matching.length && !extraIds.length) return { sent: 0, reason: 'sin_match' };

  const rolIds = matching.map((r) => Number(r.rol_id));
  const byId = new Map();
  for (const u of await usersByRolIds(db, rolIds)) byId.set(Number(u.id), u);
  for (const u of await usersByIds(db, extraIds)) byId.set(Number(u.id), u);
  if (opts.excludeUserId) byId.delete(Number(opts.excludeUserId));

  const users = [...byId.values()];
  if (!users.length) return { sent: 0, reason: 'sin_destinatarios' };

  const wantEmail = opts.forceEmail
    || matching.some((r) => r.canal === 'email' || r.canal === 'ambos');
  const wantAlert = opts.forceAlert !== false && (
    opts.forceAlert
    || !!extraIds.length
    || matching.some((r) => r.canal === 'alerta' || r.canal === 'ambos')
    || (!matching.length && extraIds.length)
  );

  let emails = 0;
  let alerts = 0;
  const severidad = opts.severidad
    || ((event.tipos || [event.tipo]).some((t) => /colision|siniestro|rechaz/i.test(String(t))) ? 'alta' : 'media');

  if (wantAlert) {
    try {
      const { createAlert } = require('./angel');
      for (const u of users) {
        await createAlert(db, {
          tipo: `notif_${event.modulo}`,
          severidad,
          titulo: event.titulo || 'Nueva alerta',
          mensaje: event.mensaje || '',
          modulo: event.modulo,
          referencia: event.referencia || null,
          usuario_id: u.id
        });
        alerts += 1;
      }
    } catch (err) {
      console.warn('[notificaciones] alerta:', err.message);
    }
  }

  if (wantEmail) {
    const to = [...new Set(users.map((u) => u.email).filter(Boolean))];
    if (to.length) {
      const r = await sendMail({
        to: to.join(','),
        subject: `[ESERCOM] ${event.titulo || 'Notificación'}`,
        text: event.mensaje || event.titulo || '',
        html: `<p>${String(event.mensaje || event.titulo || '').replace(/\n/g, '<br>')}</p>`,
        db
      });
      if (r.sent) emails = to.length;
      else console.warn('[notificaciones] email:', r.reason);
    }
  }

  return { sent: emails + alerts, emails, alerts, destinatarios: users.length };
}

function estadoMaterialesLabel(estadoId, fallback) {
  const map = {
    1: 'Pendiente',
    2: 'Aprobada',
    3: 'En bodega',
    4: 'Aprobada',
    5: 'En proceso',
    6: 'Cerrada',
    7: 'Rechazada',
    8: 'Cerrada'
  };
  return fallback || map[Number(estadoId)] || 'Pendiente';
}

function buildMaterialesEvent({ accion, solicitud, itemsCount, actorNombre, comentarios, estadoNombre }) {
  const codigo = solicitud.codigo || `SM-${solicitud.id}`;
  const proyecto = solicitud.numero_proyecto || '—';
  const estado = estadoNombre || estadoMaterialesLabel(solicitud.estado_id);
  const tipo = accion === 'nueva' ? 'nueva' : 'cambio_estado';
  const titulos = {
    nueva: `Nueva solicitud ${codigo}`,
    aprobada: `Solicitud ${codigo} aprobada`,
    rechazada: `Solicitud ${codigo} rechazada`,
    anulada: `Solicitud ${codigo} anulada`,
    cambio_estado: `Solicitud ${codigo}: ${estado}`
  };
  const mensajes = {
    nueva: `${actorNombre || 'Un usuario'} creó ${codigo} (proyecto ${proyecto}). Requiere aprobación.`,
    aprobada: `${actorNombre || 'Un aprobador'} aprobó ${codigo} (proyecto ${proyecto}).`,
    rechazada: `${actorNombre || 'Un aprobador'} rechazó ${codigo} (proyecto ${proyecto}).${comentarios ? ` Motivo: ${String(comentarios).slice(0, 160)}` : ''}`,
    anulada: `${actorNombre || 'Un usuario'} anuló ${codigo} (proyecto ${proyecto}).`,
    cambio_estado: `${codigo} pasó a «${estado}» (proyecto ${proyecto}).`
  };
  return {
    modulo: 'solicitud-salida-materiales',
    estado,
    tipo,
    tipos: [tipo],
    cantidad: Number(itemsCount) || 1,
    titulo: titulos[accion] || titulos.cambio_estado,
    mensaje: mensajes[accion] || mensajes.cambio_estado,
    referencia: `solmat:${solicitud.id}:${accion}:${Date.now()}`
  };
}

/**
 * Notifica crear/aprobar/rechazar/anular salida de materiales.
 * Siempre alerta a involucrados directos (JP / aprobadores / solicitante),
 * además de las reglas por rol configuradas.
 */
async function notifyMaterialesSolicitud(db, opts = {}) {
  const accion = String(opts.accion || 'cambio_estado');
  const solicitud = opts.solicitud || {};
  const actorId = opts.actorId != null ? Number(opts.actorId) : null;
  const event = buildMaterialesEvent({
    accion,
    solicitud,
    itemsCount: opts.itemsCount,
    actorNombre: opts.actorNombre,
    comentarios: opts.comentarios,
    estadoNombre: opts.estadoNombre
  });

  const extra = new Set();
  if (accion === 'nueva') {
    if (solicitud.jefe_proyecto_id) extra.add(Number(solicitud.jefe_proyecto_id));
    try {
      const apr = await db.prepare(`
        SELECT id FROM usuarios
        WHERE activo = 1 AND COALESCE(flag_aprobador_salida, 0) = 1
      `).all();
      for (const u of apr) extra.add(Number(u.id));
    } catch (_) { /* flag puede no existir en schemas viejos */ }
  } else {
    if (solicitud.solicitante_id) extra.add(Number(solicitud.solicitante_id));
    if (solicitud.jefe_proyecto_id) extra.add(Number(solicitud.jefe_proyecto_id));
  }

  const severidad = (accion === 'nueva' || accion === 'rechazada') ? 'alta' : 'media';
  try {
    return await dispatchNotificaciones(db, event, {
      extraUserIds: [...extra],
      excludeUserId: actorId,
      forceAlert: true,
      severidad
    });
  } catch (err) {
    console.warn('[notificaciones] materiales:', err.message);
    return { sent: 0, reason: err.message };
  }
}

async function dispatchLegacyFlota(db, event) {
  let users = [];
  try {
    users = await db.prepare(`
      SELECT id, nombre, apellido, email FROM usuarios
      WHERE activo = 1 AND email IS NOT NULL AND email != ''
        AND (flag_flota = 1 OR flag_checklist = 1)
    `).all();
  } catch (_) {
    users = [];
  }
  if (!users.length) {
    const fallback = process.env.FLOTA_ALERT_EMAIL || 'flota@serviciossercom.cl';
    const r = await sendMail({
      to: fallback,
      subject: `[ESERCOM] ${event.titulo}`,
      text: event.mensaje,
      db
    });
    return { sent: r.sent ? 1 : 0, emails: r.sent ? 1 : 0, alerts: 0, legacy: true, to: fallback, reason: r.reason };
  }
  try {
    const { createAlert } = require('./angel');
    for (const u of users) {
      await createAlert(db, {
        tipo: 'checklist_colision',
        severidad: 'alta',
        titulo: event.titulo,
        mensaje: event.mensaje,
        modulo: 'checklist-flota',
        referencia: event.referencia,
        usuario_id: u.id
      });
    }
  } catch (_) { /* */ }
  await sendMail({
    to: users.map((u) => u.email).join(','),
    subject: `[ESERCOM] ${event.titulo}`,
    text: event.mensaje,
    db
  });
  return { sent: users.length, legacy: true };
}

function buildChecklistEvent(fields, stats, body) {
  const fotos = body?.fotos || {};
  const obs = String(fields.observaciones || body?.observaciones || '');
  const aceite = String(fields.nivel_aceite || body?.nivel_aceite || '').trim();
  // En UI, nivel_aceite = «¿Choque o colisión?» → valor malo = 'Falla'
  const choqueMarcado = /^falla$/i.test(aceite) || aceite === '0' || /^malo$/i.test(aceite);
  const hasFotoColision = !!(fields.foto_colision || fotos.foto_colision);
  const hasColision = choqueMarcado || hasFotoColision;
  const hasSiniestro = /siniestro|choque|colisi[oó]n|accidente/i.test(obs) || choqueMarcado;
  const tipos = [];
  if (hasColision) tipos.push('colision');
  if (hasSiniestro) tipos.push('siniestro');
  if (stats.items_malos > 0 && !hasColision) tipos.push('con_fallas');
  else if (stats.items_malos > 0 && hasColision) tipos.push('con_fallas');
  if (!tipos.length) tipos.push('inspeccion_ok');

  const estadoSeg = fields.estado_seguimiento || (stats.items_malos > 0 ? 'pendiente' : 'sin_revisar');
  const estadoGen = fields.estado_general || fields.estado || '';

  return {
    modulo: 'checklist-flota',
    estado: estadoSeg,
    estado_seguimiento: estadoSeg,
    estado_general: estadoGen,
    tipo: tipos[0],
    tipos,
    cantidad: stats.items_malos,
    titulo: hasColision || hasSiniestro
      ? `Checklist flota: colisión/siniestro — ${fields.patente || ''}`
      : `Checklist flota — ${fields.patente || ''}`,
    mensaje: [
      `Patente: ${fields.patente || '-'}`,
      `Código: ${fields.codigo || '-'}`,
      `Estado seguimiento: ${estadoSeg}`,
      `Estado general: ${estadoGen || '-'}`,
      `Fallas: ${stats.items_malos}/${stats.items_total}`,
      choqueMarcado ? 'Choque/colisión marcado en la inspección (Sí).' : null,
      hasFotoColision ? 'Incluye foto de colisión.' : null,
      obs ? `Observación: ${obs.slice(0, 240)}` : null
    ].filter(Boolean).join('\n'),
    referencia: fields.codigo || String(fields.patente || '')
  };
}

module.exports = {
  MODULOS_NOTIF,
  catalogo,
  ensureNotifSchema,
  listReglas,
  saveReglasRol,
  dispatchNotificaciones,
  buildChecklistEvent,
  buildMaterialesEvent,
  notifyMaterialesSolicitud,
  estadoMaterialesLabel,
  ruleMatches,
  cantidadBucket
};
