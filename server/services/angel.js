const OpenAI = require('openai');
const { decrypt } = require('./crypto');
const { getDashboardContext, getMovimientosSemana, scanPendientes } = require('./angel-data');
const { buildExcelReport } = require('./angel-excel');

async function getConfig(db) {
  return db.prepare('SELECT * FROM angel_ia_config WHERE id = 1').get();
}

async function getApiKey(db) {
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
    const exists = await db.prepare(`
      SELECT id FROM angel_ia_alertas
      WHERE referencia = ? AND tipo = ? AND usuario_id = ? AND leida = 0
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

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'obtener_resumen_empresa',
      description: 'Obtiene resumen operativo de la empresa: pendientes, CECOs, stock y solicitudes recientes',
      parameters: { type: 'object', properties: {} }
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
      description: 'Genera Excel de movimientos por CECO y materiales de los últimos 7 días para jefes de proyecto',
      parameters: { type: 'object', properties: {} }
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

async function runTool(name, args, { db, company, userId }) {
  if (name === 'obtener_resumen_empresa') {
    return getDashboardContext(db, company);
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
  if (name === 'listar_alertas') {
    const limite = Number(args?.limite) || 15;
    return db.prepare(`
      SELECT id, tipo, severidad, titulo, mensaje, modulo, referencia, fecha_creacion
      FROM angel_ia_alertas WHERE leida = 0
      ORDER BY id DESC LIMIT ?
    `).all(limite);
  }
  return { error: 'Herramienta desconocida' };
}

function pathBasename(f) {
  return String(f).split(/[/\\]/).pop();
}

async function chatWithAngel({ db, company, user, message, history = [] }) {
  const apiKey = await getApiKey(db);
  if (!apiKey) {
    const err = new Error('Angel IA no está configurado. Un administrador debe ingresar la API key en Seguridad Angel IA.');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const cfg = await getConfig(db);
  const client = new OpenAI({ apiKey });
  const ctx = await getDashboardContext(db, company);

  const system = `Eres Angel IA, asistente inteligente de ESERCOM para la empresa ${company.razonSocial} (${company.name}).
Ayudas a revisar el sistema, detectar pendientes, generar reportes Excel y alertar a usuarios.
Responde en español, claro y concreto.
Usuario actual: ${user.nombreCompleto} (${user.rol}) — ${user.email}.
Contexto rápido: ${JSON.stringify(ctx.resumen)}.
Cuando te pidan reportes o Excel, usa la herramienta generar_excel_semanal.
Cuando pregunten por pendientes o alertas, usa generar_alertas o listar_alertas.
Para análisis general usa obtener_resumen_empresa.`;

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-12).map((h) => ({ role: h.rol === 'assistant' ? 'assistant' : 'user', content: h.contenido })),
    { role: 'user', content: message }
  ];

  let response = await client.chat.completions.create({
    model: cfg.model || 'gpt-4o-mini',
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: 0.3
  });

  let assistantMsg = response.choices[0].message;
  const toolResults = [];

  // Hasta 3 rondas de tools
  for (let i = 0; i < 3 && assistantMsg.tool_calls?.length; i++) {
    messages.push(assistantMsg);
    for (const call of assistantMsg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) { /* */ }
      const result = await runTool(call.function.name, args, { db, company, userId: user.id });
      toolResults.push({ name: call.function.name, result });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
    response = await client.chat.completions.create({
      model: cfg.model || 'gpt-4o-mini',
      messages,
      tools: TOOLS,
      temperature: 0.3
    });
    assistantMsg = response.choices[0].message;
  }

  const reply = assistantMsg.content || 'Listo. Revisé la información solicitada.';

  await db.prepare(`
    INSERT INTO angel_ia_mensajes (usuario_id, rol, contenido) VALUES (?, 'user', ?)
  `).run(user.id, message);
  await db.prepare(`
    INSERT INTO angel_ia_mensajes (usuario_id, rol, contenido, meta_json) VALUES (?, 'assistant', ?, ?)
  `).run(user.id, reply, JSON.stringify({ tools: toolResults.map((t) => t.name) }));

  return { reply, tools: toolResults };
}

module.exports = {
  getConfig,
  getApiKey,
  syncAlerts,
  createAlert,
  generateCecoExcel,
  chatWithAngel,
  getDashboardContext
};
