const OpenAI = require('openai');
const { emptyUsage, addUsage, finalizeUsage, ensureUsageColumns } = require('./angel-usage');
const appConfig = require('../config');
const { decrypt } = require('./crypto');
const { getDashboardContext, getMovimientosSemana, scanPendientes, queryModule, listModules } = require('./angel-data');
const { buildExcelReport } = require('./angel-excel');
const { getDefaultTrainingPack, DEFAULT_INSTRUCCIONES, DEFAULT_EJEMPLOS } = require('./angel-knowledge');
const {
  getDefaultSecurityConfig,
  buildSecurityPrompt,
  scanUserMessage,
  logSecurityIncident,
  getSecurityLog,
  parseSegEjemplos,
  BLOCKED_REPLY
} = require('./angel-security');

async function getConfig(db) {
  return db.prepare('SELECT * FROM angel_ia_config WHERE id = 1').get();
}

function getEnvApiKey() {
  const key = appConfig.openai?.apiKey || '';
  return key ? key : null;
}

async function getAngelModel(db) {
  const cfg = await getConfig(db);
  return appConfig.openai?.model || cfg?.model || 'gpt-4o-mini';
}

async function isAngelActive(db) {
  if (getEnvApiKey()) return true;
  const cfg = await getConfig(db);
  return !!(cfg && cfg.activo && cfg.api_key_enc);
}

async function getAngelStatus(db) {
  const envKey = getEnvApiKey();
  const cfg = await getConfig(db);
  const model = await getAngelModel(db);
  const activo = await isAngelActive(db);
  return {
    activo,
    model,
    source: envKey ? 'env' : (cfg?.api_key_enc ? 'db' : null),
    hint: envKey ? 'OPENAI_API_KEY (servidor)' : (cfg?.api_key_hint || null),
    reporte_semanal: !!(cfg && cfg.reporte_semanal)
  };
}

async function getApiKey(db) {
  const envKey = getEnvApiKey();
  if (envKey) return envKey;

  const cfg = await getConfig(db);
  if (!cfg || !cfg.activo || !cfg.api_key_enc) return null;
  try {
    return decrypt(cfg.api_key_enc);
  } catch {
    return null;
  }
}

async function createAlert(db, alert, userId = null) {
  const uid = alert.usuario_id != null ? alert.usuario_id : userId;
  return db.prepare(`
    INSERT INTO angel_ia_alertas (tipo, severidad, titulo, mensaje, modulo, referencia, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    alert.tipo,
    alert.severidad || 'media',
    alert.titulo,
    alert.mensaje,
    alert.modulo || null,
    alert.referencia || null,
    uid
  );
}

async function syncAlerts(db) {
  const found = await scanPendientes(db);
  let created = 0;
  for (const a of found) {
    // Si ya existió (leída o no), no volver a alertar: evita que la campana
    // regenere la misma alerta tras marcarla como revisada.
    const exists = await db.prepare(`
      SELECT id FROM angel_ia_alertas
      WHERE referencia = ? AND tipo = ? AND usuario_id = ?
      LIMIT 1
    `).get(a.referencia || '', a.tipo, a.usuario_id);
    if (!exists) {
      await createAlert(db, a);
      created++;
    }
  }
  return { scanned: found.length, created };
}

async function generateCecoExcel(db, company, generadoPor) {
  const movimientos = await getMovimientosSemana(db);
  const ctx = await getDashboardContext(db, company);

  const result = await buildExcelReport({
    titulo: `AngelIA_${company.slug}_semanal`,
    empresa: company.slug,
    sheets: [
      {
        name: 'Resumen CECO',
        rows: ctx.por_ceco
      },
      {
        name: 'Movimientos 7 dias',
        rows: movimientos
      },
      {
        name: 'Materiales top',
        rows: ctx.materiales_mas_solicitados
      },
      {
        name: 'Stock bajo',
        rows: ctx.stock_bajo
      }
    ]
  });

  const destinatarios = [...new Set(
    ctx.por_ceco.map((c) => c.jefe_email).filter(Boolean)
  )];

  const resumen = `Reporte semanal ${company.name}: ${ctx.resumen.solicitudes_materiales_activas} activas, ${movimientos.length} líneas de movimiento, ${ctx.resumen.materiales_stock_bajo} materiales con stock bajo. Destinatarios JP: ${destinatarios.join(', ') || 'sin emails'}.`;

  await db.prepare(`
    INSERT INTO angel_ia_reportes (tipo, titulo, archivo, destinatarios, resumen, generado_por)
    VALUES ('semanal_ceco', ?, ?, ?, ?, ?)
  `).run(
    `Reporte semanal CECO — ${company.name}`,
    result.relative,
    JSON.stringify(destinatarios),
    resumen,
    generadoPor || null
  );

  await createAlert(db, {
    tipo: 'reporte_semanal',
    severidad: 'baja',
    titulo: 'Reporte semanal Angel IA generado',
    mensaje: resumen,
    modulo: 'angel-ia',
    referencia: result.filename
  });

  return { ...result, resumen, destinatarios };
}

async function generateModuleExcel(db, company, generadoPor, modulo, titulo, opts = {}) {
  const mod = String(modulo || '').toLowerCase().trim();

  // Salida de materiales = mismo Excel línea a línea del módulo (descripcion, cantidades, montos…)
  if (['materiales', 'salida', 'salida_materiales', 'salida-materiales', 'solicitud-salida-materiales'].includes(mod)) {
    const { exportSolicitudesExcel } = require('../routes/solicitudes');
    const result = await exportSolicitudesExcel(db, {
      fecha_desde: opts.fecha_desde || null,
      fecha_hasta: opts.fecha_hasta || null,
      q: opts.buscar || null,
      estado_id: opts.estado_id || null,
      ceco_id: opts.ceco_id || null,
      empresa: company?.slug || 'shared'
    });
    const total = Number(result.totalFilas) || 0;
    const rango = `${result.fecha_desde || 'auto'} → ${result.fecha_hasta || 'auto'}`;
    const resumen = `Reporte salida de materiales (igual al módulo: código, material, descripción, cantidades, montos, CECO, etc.): ${total} líneas. Rango ${rango}. ${titulo || ''}`.trim();
    await db.prepare(`
      INSERT INTO angel_ia_reportes (tipo, titulo, archivo, destinatarios, resumen, generado_por)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'informe_materiales',
      titulo || `Reporte salida de materiales — ${company.name}`,
      result.relative,
      '[]',
      resumen,
      generadoPor || null
    );
    return {
      ok: true,
      ...result,
      resumen,
      total,
      modulo: 'materiales',
      label: 'Salida de materiales'
    };
  }

  const pack = await queryModule(db, modulo, { limite: 200, buscar: opts.buscar });
  if (pack.error) return { ok: false, error: pack.error, disponibles: pack.disponibles };
  const sheetName = String(pack.label || modulo).slice(0, 31);
  const rows = pack.data || [];
  const result = await buildExcelReport({
    titulo: `AngelIA_${company.slug}_${modulo}`,
    empresa: company.slug,
    sheets: [
      { name: sheetName, rows: rows.length ? rows : [{ info: 'Sin datos para este módulo' }] }
    ]
  });
  const resumen = `Informe ${pack.label}: ${rows.length} registros. ${titulo || ''}`.trim();
  await db.prepare(`
    INSERT INTO angel_ia_reportes (tipo, titulo, archivo, destinatarios, resumen, generado_por)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `informe_${modulo}`,
    titulo || `Informe ${pack.label} — ${company.name}`,
    result.relative,
    '[]',
    resumen,
    generadoPor || null
  );
  return { ok: true, ...result, resumen, total: rows.length, modulo, label: pack.label };
}

function parseReportDatesFromMessage(message) {
  const m = String(message || '');
  const iso = [...m.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((x) => x[1]);
  let fecha_desde = null;
  let fecha_hasta = null;
  if (iso.length >= 2) {
    fecha_desde = iso[0] <= iso[1] ? iso[0] : iso[1];
    fecha_hasta = iso[0] <= iso[1] ? iso[1] : iso[0];
  } else if (iso.length === 1) {
    fecha_hasta = iso[0];
    fecha_desde = iso[0];
  }
  // "últimos N días"
  const ult = m.match(/ultim[oa]s?\s+(\d{1,3})\s+d[ií]as?/i) || m.match(/last\s+(\d{1,3})\s+days?/i);
  if (ult && !fecha_desde) {
    const n = Math.min(Math.max(Number(ult[1]) || 30, 1), 730);
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - n * 86400000);
    const ymd = (d) => d.toISOString().slice(0, 10);
    fecha_hasta = ymd(hasta);
    fecha_desde = ymd(desde);
  }
  return { fecha_desde, fecha_hasta };
}

function wantsSalidaMaterialesReport(message) {
  const m = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!/(reporte|informe|excel|exportar|descarg)/i.test(m)) return false;
  return /(salida\s+de\s+materiales|solicitud(?:es)?\s+de\s+salida|reporte\s+de\s+materiales|excel\s+materiales|materiales\s+salida)/i.test(m)
    || (/\bmateriales\b/.test(m) && /(salida|solicitud)/i.test(m));
}

/** Preguntas de patente / auto / asignado a persona → catálogo flota Excel. */
function wantsFlotaCatalogQuery(message) {
  const m = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasVehicle = /\b(patente|patentes|flota|placa|vehicul|auto|camioneta|camion|moto)\b/.test(m)
    || /\basignad[oa]\b/.test(m)
    || /\b(chofer|conductor|responsable)\b/.test(m);
  const asksWhoOrWhich = /\b(quien|quién|que|qué|cual|cuál|corresponde|tiene|asignad)/.test(m);
  return hasVehicle && (asksWhoOrWhich || /\b[a-z]{2,4}\s*-?\s*\d{2,4}\b/.test(m));
}

function extractFlotaSearchQuery(message) {
  const raw = String(message || '');
  const plate = raw.match(/\b([A-Za-z]{2,4})\s*-?\s*(\d{2,4})\b/);
  if (plate) return `${plate[1]}${plate[2]}`.toUpperCase();
  const stop = new Set([
    'a', 'al', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'que', 'qué', 'cual', 'cuál',
    'auto', 'vehiculo', 'vehículo', 'patente', 'patentes', 'flota', 'asignado', 'asignada',
    'corresponde', 'dime', 'dame', 'buscar', 'consulta', 'tiene', 'tienen', 'quien', 'quién',
    'chofer', 'conductor', 'responsable', 'placa', 'camioneta', 'camion', 'camión', 'moto',
    'informacion', 'información', 'por', 'favor', 'me', 'puedes', 'decir', 'sabes'
  ]);
  const tokens = raw
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t.toLowerCase()));
  // Preferir nombres propios (capitalizados) si hay
  const caps = String(message || '').split(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/).filter((t) => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(t));
  if (caps.length >= 1) return caps.join(' ');
  return tokens.slice(0, 4).join(' ');
}

async function getFlotaPromptBlock(db, message) {
  if (!wantsFlotaCatalogQuery(message)) return '';
  try {
    const { angelBuscarFlota } = require('./flota-catalogo');
    const q = extractFlotaSearchQuery(message);
    const found = await angelBuscarFlota(db, q || message, 12);
    if (!found?.total_catalogo) {
      return '\n\nCATÁLOGO FLOTA: no hay Excel cargado en Configuraciones → Catálogo flota. Indica al usuario que flota debe subir el archivo.';
    }
    if (!found.total) {
      return `\n\nCATÁLOGO FLOTA (Excel "${found.archivo || 'flota'}", ${found.total_catalogo} vehículos): sin coincidencias para «${q || message}». Di que no aparece en el catálogo o pide otra forma del nombre / re-cargar Excel.`;
    }
    const lines = found.data.map((r) => {
      const quien = r.asignado_nombre || r.propietario_nombre || '—';
      return `• Patente ${r.patente} | Asignado/Propietario: ${quien} | ${[r.marca, r.modelo, r.tipo].filter(Boolean).join(' ')}`;
    });
    return `\n\nCATÁLOGO FLOTA (Excel de Configuraciones — fuente de verdad para patente ↔ persona):\n` +
      `Archivo: ${found.archivo || '—'} · Coincidencias para «${q}»:\n${lines.join('\n')}\n` +
      `Responde con la patente exacta y el nombre asignado de ESA fila. No inventes patentes.`;
  } catch (err) {
    console.warn('[angel] flota block:', err.message);
    return '';
  }
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'obtener_resumen_empresa',
      description: 'Resumen operativo: pendientes de materiales, compras, SSGG, telecom, facturas, checklist flota, agenda camión e inventario',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_modulos',
      description: 'Lista los módulos de ESERCOM que Angel puede consultar o exportar a Excel',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consultar_modulo',
      description: 'Consulta datos reales de un módulo (materiales, compras, checklist, flota/catálogo Excel de patentes y asignados, agenda, facturas, etc.)',
      parameters: {
        type: 'object',
        properties: {
          modulo: {
            type: 'string',
            description: 'ID del módulo: materiales|compras|ssgg|telecom|facturas|checklist|flota|agenda|contratos|usuarios|cecos|proveedores|inventario|recetas|inspeccion'
          },
          buscar: { type: 'string', description: 'Texto para filtrar: nombre de persona asignada, patente, código, etc.' },
          limite: { type: 'number', description: 'Máximo de filas (default 60, máx 200)' }
        },
        required: ['modulo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generar_alertas',
      description: 'Escanea pendientes y genera/sincroniza alertas para usuarios',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generar_excel_semanal',
      description: 'Genera Excel semanal de movimientos por CECO y materiales (últimos 7 días)',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generar_informe_excel',
      description: 'Genera un Excel descargable. Para «reporte/salida de materiales» usa modulo=materiales: sale el mismo reporte línea a línea del módulo (descripción material, cantidades solicitada/entregada/pendiente, montos, CECO, etc.).',
      parameters: {
        type: 'object',
        properties: {
          modulo: {
            type: 'string',
            description: 'Módulo: materiales (salida de materiales completo)|compras|ssgg|telecom|facturas|checklist|agenda|contratos|usuarios|cecos|proveedores|inventario|recetas'
          },
          titulo: { type: 'string', description: 'Título del informe' },
          buscar: { type: 'string', description: 'Filtro opcional' },
          fecha_desde: { type: 'string', description: 'YYYY-MM-DD (solo materiales; default último año)' },
          fecha_hasta: { type: 'string', description: 'YYYY-MM-DD (solo materiales)' }
        },
        required: ['modulo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consultar_web_empresa',
      description: 'Lee el sitio web oficial de una empresa del grupo Vertia (SERCOM, GLOBAL, TÁCTICA, INTERCANJE, NEXUS). Úsala también para correos/contacto oficiales publicados en la web.',
      parameters: {
        type: 'object',
        properties: {
          empresa: {
            type: 'string',
            description: 'Empresa o URL: SERCOM | GLOBAL | TACTICA | INTERCANJE | NEXUS | o https://www....'
          }
        },
        required: ['empresa']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reportar_incidencia',
      description: 'Crea una incidencia de soporte para administradores cuando el usuario tiene un problema con el sistema (pantalla, error, bug). Si el usuario adjuntó foto en el chat, ya se crea automáticamente; usa esta herramienta si reporta solo con texto.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Resumen corto del problema' },
          descripcion: { type: 'string', description: 'Detalle: qué pasó y en qué pantalla' },
          prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] }
        },
        required: ['titulo', 'descripcion']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_alertas',
      description: 'Lista alertas no leídas recientes',
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number' }
        }
      }
    }
  }
];

async function runTool(name, args, { db, company, userId, user }) {
  if (name === 'obtener_resumen_empresa') {
    return getDashboardContext(db, company);
  }
  if (name === 'listar_modulos') {
    return { modulos: listModules() };
  }
  if (name === 'consultar_modulo') {
    return queryModule(db, args?.modulo, { buscar: args?.buscar, limite: args?.limite });
  }
  if (name === 'generar_alertas') {
    return syncAlerts(db);
  }
  if (name === 'generar_excel_semanal') {
    const r = await generateCecoExcel(db, company, userId);
    return {
      ok: true,
      archivo: r.relative,
      download: `/api/angel/reportes/download/${pathBasename(r.filename)}`,
      resumen: r.resumen,
      destinatarios: r.destinatarios
    };
  }
  if (name === 'generar_informe_excel') {
    const dates = parseReportDatesFromMessage(args?.__message || '');
    const r = await generateModuleExcel(db, company, userId, args?.modulo, args?.titulo, {
      buscar: args?.buscar,
      fecha_desde: args?.fecha_desde || dates.fecha_desde,
      fecha_hasta: args?.fecha_hasta || dates.fecha_hasta,
      estado_id: args?.estado_id,
      ceco_id: args?.ceco_id
    });
    if (!r.ok) return r;
    return {
      ok: true,
      modulo: r.modulo,
      label: r.label,
      total: r.total,
      archivo: r.relative,
      download: `/api/angel/reportes/download/${pathBasename(r.filename)}`,
      resumen: r.resumen
    };
  }
  if (name === 'listar_alertas') {
    const limite = Number(args?.limite) || 15;
    return db.prepare(`
      SELECT id, tipo, severidad, titulo, mensaje, modulo, referencia, fecha_creacion
      FROM angel_ia_alertas WHERE leida = 0
      ORDER BY id DESC LIMIT ?
    `).all(limite);
  }
  if (name === 'consultar_web_empresa') {
    const { consultarWebEmpresa } = require('./angel-webs');
    return consultarWebEmpresa(db, args?.empresa || args?.url || '');
  }
  if (name === 'reportar_incidencia') {
    const { createIncidencia } = require('./incidencias');
    const data = await createIncidencia(db, {
      userId,
      user: user || null,
      titulo: args?.titulo,
      descripcion: args?.descripcion,
      fotoRuta: args?.foto_ruta || null,
      origen: 'angel',
      prioridad: args?.prioridad || 'media',
      empresaSlug: company?.slug || 'shared'
    });
    return {
      ok: true,
      codigo: data.codigo,
      id: data.id,
      estado: data.estado,
      foto: data.foto_ruta || null,
      notificacion: data.notificacion,
      message: `Incidencia ${data.codigo} creada. Administradores avisados. Ver /incidencias.html`
    };
  }
  return { error: 'Herramienta desconocida' };
}

function pathBasename(f) {
  return String(f).split(/[/\\]/).pop();
}

function parseEjemplos(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter((e) => e && e.pregunta && e.respuesta) : [];
  } catch {
    return [];
  }
}

async function getTrainingConfig(db) {
  const cfg = await getConfig(db);
  const defaults = getDefaultSecurityConfig();
  const pack = getDefaultTrainingPack();
  const segEjemplos = parseSegEjemplos(cfg?.ejemplos_seguridad);
  const instrucciones = String(cfg?.instrucciones_entrenamiento || '').trim() || pack.instrucciones;
  const ejemplosDb = parseEjemplos(cfg?.ejemplos_entrenamiento);
  return {
    instrucciones,
    ejemplos: ejemplosDb.length ? ejemplosDb : pack.ejemplos,
    usando_defaults: !String(cfg?.instrucciones_entrenamiento || '').trim(),
    modulos: pack.modulos,
    seguridad: {
      activa: cfg?.seguridad_activa == null ? true : !!cfg.seguridad_activa,
      prompt_base: defaults.prompt_base,
      prompt_personalizado: cfg?.prompt_seguridad || '',
      ejemplos: segEjemplos.length ? segEjemplos : defaults.ejemplos
    }
  };
}

async function saveTrainingConfig(db, body) {
  const instrucciones = String(body.instrucciones ?? body.instrucciones_entrenamiento ?? '').trim();
  let ejemplos = body.ejemplos ?? body.ejemplos_entrenamiento ?? [];
  if (typeof ejemplos === 'string') {
    try { ejemplos = JSON.parse(ejemplos); } catch { ejemplos = []; }
  }
  if (!Array.isArray(ejemplos)) ejemplos = [];
  const clean = ejemplos
    .map((e) => ({
      pregunta: String(e.pregunta || '').trim(),
      respuesta: String(e.respuesta || '').trim()
    }))
    .filter((e) => e.pregunta && e.respuesta)
    .slice(0, 40);

  const seg = body.seguridad || {};
  const promptSeg = String(seg.prompt_personalizado ?? body.prompt_seguridad ?? '').trim();
  const seguridadActiva = seg.activa === false || seg.activa === 0 ? 0 : 1;
  let segEjemplos = seg.ejemplos ?? body.ejemplos_seguridad ?? [];
  if (typeof segEjemplos === 'string') {
    try { segEjemplos = JSON.parse(segEjemplos); } catch { segEjemplos = []; }
  }
  const cleanSeg = parseSegEjemplos(JSON.stringify(Array.isArray(segEjemplos) ? segEjemplos : [])).slice(0, 30);

  const json = JSON.stringify(clean);
  const jsonSeg = JSON.stringify(cleanSeg);
  const driver = db.driver || 'sqlite';
  if (driver === 'mysql') {
    await db.prepare(`
      INSERT INTO angel_ia_config (
        id, instrucciones_entrenamiento, ejemplos_entrenamiento,
        prompt_seguridad, ejemplos_seguridad, seguridad_activa,
        model, activo, reporte_semanal, actualizado_en
      )
      VALUES (1, ?, ?, ?, ?, ?, 'gpt-4o-mini', 1, 1, NOW())
      ON DUPLICATE KEY UPDATE
        instrucciones_entrenamiento = VALUES(instrucciones_entrenamiento),
        ejemplos_entrenamiento = VALUES(ejemplos_entrenamiento),
        prompt_seguridad = VALUES(prompt_seguridad),
        ejemplos_seguridad = VALUES(ejemplos_seguridad),
        seguridad_activa = VALUES(seguridad_activa),
        actualizado_en = NOW()
    `).run(instrucciones, json, promptSeg, jsonSeg, seguridadActiva);
  } else {
    await db.prepare(`
      INSERT INTO angel_ia_config (
        id, instrucciones_entrenamiento, ejemplos_entrenamiento,
        prompt_seguridad, ejemplos_seguridad, seguridad_activa,
        model, activo, reporte_semanal, actualizado_en
      )
      VALUES (1, ?, ?, ?, ?, ?, 'gpt-4o-mini', 1, 1, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        instrucciones_entrenamiento = excluded.instrucciones_entrenamiento,
        ejemplos_entrenamiento = excluded.ejemplos_entrenamiento,
        prompt_seguridad = excluded.prompt_seguridad,
        ejemplos_seguridad = excluded.ejemplos_seguridad,
        seguridad_activa = excluded.seguridad_activa,
        actualizado_en = datetime('now')
    `).run(instrucciones, json, promptSeg, jsonSeg, seguridadActiva);
  }

  return {
    instrucciones,
    ejemplos: clean,
    seguridad: {
      activa: !!seguridadActiva,
      prompt_personalizado: promptSeg,
      ejemplos: cleanSeg
    }
  };
}

function buildAngelSystemPrompt({ company, user, ctx, training }) {
  const securityBlock = buildSecurityPrompt(training?.seguridad);
  const pack = getDefaultTrainingPack();
  const instrucciones = (training?.instrucciones || '').trim() || pack.instrucciones;
  const ejemplos = (training?.ejemplos && training.ejemplos.length) ? training.ejemplos : pack.ejemplos;

  let extra = `\n\nInstrucciones de entrenamiento (prioritarias):\n${instrucciones}`;
  if (ejemplos.length) {
    extra += `\n\nEjemplos de referencia:\n${ejemplos.map((e) => `P: ${e.pregunta}\nR: ${e.respuesta}`).join('\n\n')}`;
  }

  const mods = (ctx.modulos_disponibles || listModules())
    .map((m) => `${m.id}=${m.label}`)
    .join(', ');

  return `${securityBlock}

---

Eres Angel, compañero de trabajo digital de ESERCOM (${company.razonSocial} / ${company.name}).
Hablas como persona: natural, cercana, paciente y profesional en español chileno. No suenas a robot.
Usuario: ${user.nombreCompleto} (${user.rol}) — ${user.email}.

ORIENTACIÓN: Si preguntan qué se puede / no se puede, dónde hacer algo o cómo usar un módulo, explica con calma (página + pasos + límites). No finjas haber creado, aprobado ni guardado nada: esas acciones se hacen en las pantallas.

Contexto rápido (números reales): ${JSON.stringify(ctx.resumen)}.
Módulos consultables: ${mods}.

HERRAMIENTAS (úsalas siempre que necesites datos o archivos):
- obtener_resumen_empresa → panorama general
- listar_modulos → qué puedes consultar
- consultar_modulo → leer registros (checklist, flota/catálogo Excel patente↔asignado, compras, agenda, etc.)
  Si preguntan por patente de un auto/persona asignada (ej. «auto de José Jofré»), usa modulo=flota y buscar=nombre.
- generar_informe_excel → Excel de un módulo. Si piden reporte/salida de materiales → modulo=materiales (MISMO Excel del módulo: descripción, cantidades, montos, CECO, etc., una fila por material)
- generar_excel_semanal → Excel semanal CECO/movimientos 7 días (NO usarlo si piden el reporte de salida de materiales)
- consultar_web_empresa → lee sitios oficiales del grupo (SERCOM, GLOBAL, TÁCTICA, INTERCANJE, NEXUS) y sus correos de contacto
- reportar_incidencia → crea ticket de soporte para admin/subadmin (problemas del sistema)
- listar_alertas → pendientes y avisos

Si piden reporte/Excel de salida de materiales o solicitud de salida: SIEMPRE generar_informe_excel con modulo=materiales (no el semanal).
Si el usuario tiene un problema técnico / error / pantalla rota: usa reportar_incidencia (o confirma si ya se creó con foto). Indícale que también puede verla en /incidencias.html.
Si preguntan por una empresa del grupo o su web, usa consultar_web_empresa o el cerebro (tema Empresas del grupo).
Si piden correo / email / contacto de una empresa del grupo: usa consultar_web_empresa o el cerebro (Webs oficiales). Da los correos de contacto del sitio como canal oficial. No inventes correos personales de gerentes.
Si piden “un informe” sin especificar, genera el semanal CECO y ofrece otros módulos.
Nunca inventes datos: consulta primero.
Si en las instrucciones aparece el bloque «CEREBRO DE ANGEL», SÍ tienes el contenido de esos PDF/Word/Excel/notas: úsalo para responder (nombres, cargos, organigrama, reglas). Nunca digas que no tienes acceso a un archivo listado ahí.
ORGANIGRAMA: el grupo es VERTIA (holding). Nivel regional = VERTIA. Gerentes/directores van por empresa (SERCOM, GLOBAL, INTERCANJE, TÁCTICA, NEXUS, LAB64) y país. Roles TRANSVERSALES prestan servicios a TODAS las empresas del grupo. No digas que todos son de SERCOM ni de la empresa de esta sesión.
IMPORTANTE sobre Excel: cuando generes un informe, NO inventes ni pegues URLs (ni de esercom.cl ni de otros dominios). Di solo que el archivo está listo; la interfaz mostrará el botón Descargar.${extra}`;
}

function wantsReport(message) {
  return /informe|reporte|excel|exportar|descarg/i.test(String(message || ''));
}

function wantsCompanyWeb(message) {
  const m = String(message || '');
  return /\b(web|sitio|p[aá]gina oficial|serviciossercom|globalviapublica|tacticaooh|nexusmedialatam|intercanje\.(cl|com))\b/i.test(m)
    || /\b(qu[eé]\s+(es|hace|ofrece)|cuenta\s+(de|sobre)|info(?:rmaci[oó]n)?\s+(de|sobre))\s+(sercom|global|t[aá]ctica|intercanje|nexus)\b/i.test(m)
    || /\b(correo|email|e-?mail|mail|contacto)\b/i.test(m)
      && /\b(sercom|global|t[aá]ctica|intercanje|nexus|empresa|oficial|web|sitio|corporativo|comercial)\b/i.test(m);
}

function wantsIncidencia(message) {
  return /\b(incidencia|ticket|problema|error|bug|no\s+funciona|falla|se\s+cay[oó]|pantalla\s+rota|reportar\s+problema)\b/i.test(String(message || ''));
}

function extractDownloads(toolResults) {
  const out = [];
  for (const t of toolResults || []) {
    const r = t?.result;
    if (!r || !r.ok || !r.download) continue;
    const file = pathBasename(r.archivo || r.download);
    out.push({
      titulo: r.label || r.resumen || (t.name === 'generar_excel_semanal' ? 'Excel semanal CECO' : 'Informe Excel'),
      resumen: r.resumen || null,
      download: r.download.startsWith('/') ? r.download : `/api/angel/reportes/download/${file}`,
      archivo: file,
      total: r.total != null ? r.total : null
    });
  }
  return out;
}

function sanitizeAngelReply(text, downloads) {
  let reply = String(text || '').trim();
  // Defensa en profundidad: no dejar secretos si el modelo los alucina
  reply = reply
    .replace(/\bsk-[a-zA-Z0-9]{10,}\b/g, '[REDACTED]')
    .replace(/\b(api[_ -]?key|openai[_ -]?key)\s*[:=]\s*\S+/gi, '$1: [REDACTED]')
    .replace(/\b(ADMIN_PORTAL_PASSWORD|JWT_SECRET|ENCRYPTION_KEY)\s*[:=]?\s*\S+/gi, '[REDACTED]')
    .replace(/```[\s\S]{0,200}?(system\s*prompt|instrucciones\s+secretas)[\s\S]{0,800}?```/gi, '[contenido de sistema omitido]')
    // Quitar links markdown / URLs inventadas hacia reportes
    .replace(/\[[^\]]*\]\(\s*https?:\/\/[^)]*angel\/reportes[^)]*\)/gi, '')
    .replace(/https?:\/\/[^\s)]*angel\/reportes\/download\/[^\s)]+/gi, '')
    .replace(/https?:\/\/(?:www\.)?servicios?sercom\.cl[^\s)]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (downloads?.length) {
    const looksLikeLinkOnly = /descargarlo haciendo clic|siguiente botón|\[.*\]\(https?:\/\//i.test(reply)
      && reply.length < 320;
    if (!reply || looksLikeLinkOnly) {
      const names = downloads.map((d) => d.titulo).join(', ');
      reply = `Listo. Generé el Excel${names ? ` (${names})` : ''}. Usa el botón Descargar debajo de este mensaje.`;
    } else if (!/descargar|excel|informe|listo/i.test(reply)) {
      reply += '\n\nEl Excel está listo: usa el botón Descargar debajo.';
    }
  }
  return reply || 'Listo.';
}

async function handleSecurityScan({ db, company, user, message, training, persistTo, sandbox }) {
  const scan = scanUserMessage(message, { activa: training?.seguridad?.activa !== false });
  if (!scan.blocked) return null;

  const origen = sandbox ? 'entrenamiento' : 'produccion';
  await logSecurityIncident(db, {
    tipo: scan.tipo,
    severidad: scan.severidad,
    mensaje: message,
    usuario: user,
    bloqueado: true,
    detalle: { amenazas: scan.amenazas },
    origen
  });

  if (!sandbox && (scan.tipo === 'prompt_injection' || scan.severidad === 'alta')) {
    try {
      await createAlert(db, {
        tipo: 'seguridad_angel',
        severidad: scan.severidad || 'alta',
        titulo: 'Alerta: intento de manipulación en Angel IA',
        mensaje: `${user.nombreCompleto || user.email || 'Usuario'}: "${String(message).slice(0, 120)}…"`,
        modulo: 'angel-ia',
        referencia: scan.tipo,
        usuario_id: user.id || null
      });
    } catch (_) { /* no-op */ }
  }

  const reply = BLOCKED_REPLY;
  const meta = JSON.stringify({ security: scan, blocked: true });

  if (persistTo === 'train') {
    await db.prepare(`INSERT INTO angel_ia_train_mensajes (rol, contenido) VALUES ('user', ?)`).run(message);
    await db.prepare(`
      INSERT INTO angel_ia_train_mensajes (rol, contenido, meta_json) VALUES ('assistant', ?, ?)
    `).run(reply, meta);
  } else if (persistTo === 'prod' && user.id) {
    await db.prepare(`INSERT INTO angel_ia_mensajes (usuario_id, rol, contenido) VALUES (?, 'user', ?)`).run(user.id, message);
    await db.prepare(`
      INSERT INTO angel_ia_mensajes (usuario_id, rol, contenido, meta_json) VALUES (?, 'assistant', ?, ?)
    `).run(user.id, reply, meta);
  }

  return { reply, tools: [], security: scan, downloads: [] };
}

async function runAngelChat({ db, company, user, message, history, persistTo, sandbox, imageDataUrl, viaVoz }) {
  const training = await getTrainingConfig(db);
  const blocked = await handleSecurityScan({ db, company, user, message, training, persistTo, sandbox });
  if (blocked) return blocked;

  const apiKey = await getApiKey(db);
  if (!apiKey) {
    const err = new Error('Angel IA no está configurado. Define OPENAI_API_KEY en las variables del servidor.');
    err.code = 'NO_API_KEY';
    throw err;
  }

  // Foto adjunta → crear incidencia de soporte automáticamente (canal oficial a admin/subadmin)
  let incidenciaCreada = null;
  if (imageDataUrl && !sandbox) {
    try {
      const { createIncidencia } = require('./incidencias');
      const titulo = String(message || '').trim().slice(0, 120) || 'Problema reportado con foto';
      incidenciaCreada = await createIncidencia(db, {
        userId: user.id,
        user,
        titulo: titulo.length > 8 ? titulo : 'Problema reportado desde Angel IA',
        descripcion: String(message || '').trim() || 'El usuario adjuntó una captura/foto del problema.',
        fotoDataUrl: imageDataUrl,
        origen: 'angel',
        prioridad: 'media',
        empresaSlug: company?.slug || 'shared'
      });
    } catch (err) {
      console.warn('[angel] incidencia foto:', err.message);
    }
  }

  const model = await getAngelModel(db);
  const client = new OpenAI({ apiKey });
  const ctx = await getDashboardContext(db, company);
  let docsBlock = '';
  try {
    const { getDocsPromptBlock } = require('./angel-docs');
    docsBlock = await getDocsPromptBlock(db, message, { history });
  } catch (_) { /* ignore */ }
  let flotaBlock = '';
  try {
    flotaBlock = await getFlotaPromptBlock(db, message);
  } catch (_) { /* ignore */ }
  const trainingWithDocs = (docsBlock || flotaBlock)
    ? { ...training, instrucciones: `${training.instrucciones || ''}${docsBlock || ''}${flotaBlock || ''}` }
    : training;
  let system = buildAngelSystemPrompt({ company, user, ctx, training: trainingWithDocs });
  if (viaVoz) {
    system += `\n\nMODO VOZ: El usuario habló por micrófono. Responde en español chileno conversacional, claro y breve (ideal 2–5 oraciones), fácil de escuchar en voz alta. Evita listas largas, tablas, markdown y URLs; si hace falta un detalle, resume y ofrece ampliar.`;
  }
  if (incidenciaCreada) {
    system += `\n\nINCIDENCIA YA CREADA: ${incidenciaCreada.codigo} (id ${incidenciaCreada.id}). Confirma al usuario el código, que se avisó a administradores/subadministradores, y que puede seguirla en /incidencias.html. No vuelvas a crear otra incidencia.`;
  } else if (imageDataUrl && sandbox) {
    system += '\n\nEl usuario adjuntó una foto en modo entrenamiento: no crees incidencia real; solo simula la respuesta.';
  }

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-12).map((h) => ({ role: h.rol === 'assistant' ? 'assistant' : 'user', content: h.contenido })),
    { role: 'user', content: message }
  ];

  let response = await client.chat.completions.create({
    model,
    messages,
    tools: TOOLS,
    tool_choice: wantsSalidaMaterialesReport(message)
      ? { type: 'function', function: { name: 'generar_informe_excel' } }
      : (wantsFlotaCatalogQuery(message)
        ? { type: 'function', function: { name: 'consultar_modulo' } }
        : (wantsReport(message)
        ? 'required'
        : (wantsCompanyWeb(message)
          ? { type: 'function', function: { name: 'consultar_web_empresa' } }
          : (wantsIncidencia(message) && !incidenciaCreada
            ? { type: 'function', function: { name: 'reportar_incidencia' } }
            : 'auto')))),
    temperature: sandbox ? 0.55 : 0.45
  });

  let assistantMsg = response.choices[0].message;
  const toolResults = [];
  let usageAcc = emptyUsage(model);
  usageAcc = addUsage(usageAcc, response.usage, model);

  // Si forzamos informe genérico sin módulo, OpenAI a veces falla args; fallback semanal
  for (let i = 0; i < 5 && assistantMsg.tool_calls?.length; i++) {
    messages.push(assistantMsg);
    for (const call of assistantMsg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) { /* */ }
      args.__message = message;
      if (call.function.name === 'generar_informe_excel') {
        if (wantsSalidaMaterialesReport(message)) args.modulo = 'materiales';
        if (!args.modulo) {
          const m = String(message || '').toLowerCase();
          if (/flota|checklist|patente/.test(m)) args.modulo = wantsFlotaCatalogQuery(message) ? 'flota' : 'checklist';
          else if (/compra/.test(m)) args.modulo = 'compras';
          else if (/camion|pluma|agenda/.test(m)) args.modulo = 'agenda';
          else if (/factura/.test(m)) args.modulo = 'facturas';
          else if (/contrato/.test(m)) args.modulo = 'contratos';
          else if (/receta|tipo de obra|por actividad|paradero|insumo/.test(m)) args.modulo = 'recetas';
          else if (/salida\s+de\s+materiales|solicitud(?:es)?\s+de\s+salida|reporte\s+de\s+materiales/.test(m)) args.modulo = 'materiales';
          else if (/\bmateriales\b/.test(m) && /(salida|solicitud|reporte|informe|excel)/.test(m)) args.modulo = 'materiales';
          else if (/stock|inventario/.test(m) && !/solicitud|salida/.test(m)) args.modulo = 'inventario';
          else if (/ssgg|servicio general/.test(m)) args.modulo = 'ssgg';
          else if (/telecom/.test(m)) args.modulo = 'telecom';
          else if (/proveedor/.test(m)) args.modulo = 'proveedores';
          else if (/usuario|persona/.test(m)) args.modulo = 'usuarios';
          else if (/ceco/.test(m)) args.modulo = 'cecos';
          else {
            const result = await runTool('generar_excel_semanal', {}, { db, company, userId: user.id || 0, user });
            toolResults.push({ name: 'generar_excel_semanal', result });
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(result)
            });
            continue;
          }
        }
        if (!args.titulo && wantsSalidaMaterialesReport(message)) {
          args.titulo = 'Reporte salida de materiales';
        }
      }
      if (call.function.name === 'generar_excel_semanal' && wantsSalidaMaterialesReport(message)) {
        const dates = parseReportDatesFromMessage(message);
        const result = await runTool('generar_informe_excel', {
          modulo: 'materiales',
          titulo: 'Reporte salida de materiales',
          fecha_desde: dates.fecha_desde,
          fecha_hasta: dates.fecha_hasta,
          __message: message
        }, { db, company, userId: user.id || 0, user });
        toolResults.push({ name: 'generar_informe_excel', result });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
        continue;
      }
      if (call.function.name === 'consultar_modulo') {
        const m = String(message || '').toLowerCase();
        if (wantsFlotaCatalogQuery(message) || /catalogo\s*flota|excel\s*flota/.test(m)) {
          args.modulo = 'flota';
        } else if (!args.modulo && /flota|checklist|patente/.test(m)) {
          args.modulo = /asignad|responsable|chofer|conductor|\bauto\b|vehicul/.test(m) ? 'flota' : 'checklist';
        }
        if ((args.modulo === 'flota' || args.modulo === 'catalogo_flota') && !args.buscar) {
          args.buscar = extractFlotaSearchQuery(message);
        }
      }
      if (call.function.name === 'generar_informe_excel' && !args.modulo) {
        /* already handled above */
      } else if (call.function.name === 'generar_informe_excel' && /flota|patente|asignad/.test(String(message || '').toLowerCase()) && args.modulo === 'checklist') {
        args.modulo = wantsFlotaCatalogQuery(message) ? 'flota' : args.modulo;
      }
      const result = await runTool(call.function.name, args, { db, company, userId: user.id || 0, user });
      toolResults.push({ name: call.function.name, result });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
    response = await client.chat.completions.create({
      model,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: sandbox ? 0.55 : 0.45
    });
    assistantMsg = response.choices[0].message;
    usageAcc = addUsage(usageAcc, response.usage, model);
  }

  // Si pidió reporte de salida de materiales y no generó el Excel, forzar
  if (wantsSalidaMaterialesReport(message) && !toolResults.some((t) => t.name === 'generar_informe_excel')) {
    const dates = parseReportDatesFromMessage(message);
    const result = await runTool('generar_informe_excel', {
      modulo: 'materiales',
      titulo: 'Reporte salida de materiales',
      fecha_desde: dates.fecha_desde,
      fecha_hasta: dates.fecha_hasta,
      __message: message
    }, { db, company, userId: user.id || 0, user });
    toolResults.push({ name: 'generar_informe_excel', result });
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'forced_mat',
        type: 'function',
        function: { name: 'generar_informe_excel', arguments: JSON.stringify({ modulo: 'materiales' }) }
      }]
    });
    messages.push({
      role: 'tool',
      tool_call_id: 'forced_mat',
      content: JSON.stringify(result)
    });
    response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.45
    });
    assistantMsg = response.choices[0].message;
    usageAcc = addUsage(usageAcc, response.usage, model);
  }

  // Si pidió informe genérico y no usó tools, forzar semanal
  if (wantsReport(message) && !wantsSalidaMaterialesReport(message) && !toolResults.length) {
    const result = await runTool('generar_excel_semanal', {}, { db, company, userId: user.id || 0, user });
    toolResults.push({ name: 'generar_excel_semanal', result });
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'forced_semanal',
        type: 'function',
        function: { name: 'generar_excel_semanal', arguments: '{}' }
      }]
    });
    messages.push({
      role: 'tool',
      tool_call_id: 'forced_semanal',
      content: JSON.stringify(result)
    });
    response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.45
    });
    assistantMsg = response.choices[0].message;
    usageAcc = addUsage(usageAcc, response.usage, model);
  }

  if (wantsIncidencia(message) && !incidenciaCreada && !toolResults.some((t) => t.name === 'reportar_incidencia') && !sandbox) {
    try {
      const result = await runTool('reportar_incidencia', {
        titulo: String(message).trim().slice(0, 120) || 'Problema reportado',
        descripcion: String(message).trim(),
        prioridad: 'media'
      }, { db, company, userId: user.id || 0, user });
      toolResults.push({ name: 'reportar_incidencia', result });
      if (result?.ok) incidenciaCreada = { codigo: result.codigo, id: result.id, foto_ruta: result.foto };
    } catch (_) { /* ignore */ }
  }

  const downloads = extractDownloads(toolResults);
  let rawReply = assistantMsg.content || '';
  if (incidenciaCreada && !/INC-\d+/i.test(rawReply)) {
    rawReply = (rawReply ? `${rawReply}\n\n` : '')
      + `Quedó registrada la incidencia ${incidenciaCreada.codigo}. Ya avisamos a administradores y subadministradores. Puedes seguirla en Incidencias.`;
  }
  const reply = sanitizeAngelReply(rawReply, downloads);
  const usage = finalizeUsage(usageAcc, model);
  const meta = JSON.stringify({
    tools: toolResults.map((t) => t.name),
    downloads,
    incidencia: incidenciaCreada ? { codigo: incidenciaCreada.codigo, id: incidenciaCreada.id } : null,
    usage
  });

  const userPersist = imageDataUrl
    ? `${message}\n[Foto adjunta${incidenciaCreada ? ` → ${incidenciaCreada.codigo}` : ''}]`
    : message;

  if (persistTo === 'train') {
    await db.prepare(`INSERT INTO angel_ia_train_mensajes (rol, contenido) VALUES ('user', ?)`).run(userPersist);
    await db.prepare(`
      INSERT INTO angel_ia_train_mensajes (rol, contenido, meta_json) VALUES ('assistant', ?, ?)
    `).run(reply, meta);
  } else if (persistTo === 'prod' && user.id) {
    try { await ensureUsageColumns(db); } catch (_) { /* */ }
    await db.prepare(`INSERT INTO angel_ia_mensajes (usuario_id, rol, contenido) VALUES (?, 'user', ?)`).run(user.id, userPersist);
    try {
      await db.prepare(`
        INSERT INTO angel_ia_mensajes
          (usuario_id, rol, contenido, meta_json, prompt_tokens, completion_tokens, total_tokens, cost_usd, model)
        VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        reply,
        meta,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens,
        usage.cost_usd,
        usage.model
      );
    } catch (err) {
      console.warn('[angel] insert usage cols fallback:', err.message);
      await db.prepare(`
        INSERT INTO angel_ia_mensajes (usuario_id, rol, contenido, meta_json) VALUES (?, 'assistant', ?, ?)
      `).run(user.id, reply, meta);
    }
  }

  return { reply, tools: toolResults, downloads, incidencia: incidenciaCreada, usage };
}

async function clearTrainChat(db) {
  await db.prepare('DELETE FROM angel_ia_train_mensajes').run();
}

async function chatWithAngelTrain({ db, company, message, history = [] }) {
  const trainer = {
    id: 0,
    nombreCompleto: 'Entrenador Angel IA',
    rol: 'Entrenamiento',
    email: 'entrenamiento@esercom.internal'
  };
  const result = await runAngelChat({
    db,
    company,
    user: trainer,
    message,
    history,
    persistTo: 'train',
    sandbox: true
  });
  if (Array.isArray(result.downloads)) {
    result.downloads = result.downloads.map((d) => ({
      ...d,
      download: String(d.download || '').replace(
        /^\/api\/angel\/reportes\/download\//,
        '/api/angel/train/reportes/download/'
      )
    }));
  }
  return result;
}

async function chatWithAngel({ db, company, user, message, history = [], imageDataUrl = null, viaVoz = false }) {
  return runAngelChat({
    db,
    company,
    user,
    message,
    history,
    persistTo: 'prod',
    sandbox: false,
    imageDataUrl,
    viaVoz
  });
}

module.exports = {
  getConfig,
  getApiKey,
  getEnvApiKey,
  getAngelModel,
  isAngelActive,
  getAngelStatus,
  getTrainingConfig,
  saveTrainingConfig,
  clearTrainChat,
  syncAlerts,
  createAlert,
  generateCecoExcel,
  chatWithAngel,
  chatWithAngelTrain,
  getDashboardContext,
  getSecurityLog
};
