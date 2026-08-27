/**
 * Uso de Angel IA: tokens, costo estimado y listado de conversaciones (admin).
 * Precios aproximados USD / 1M tokens (ajustables en PRICE_PER_MILLION).
 */
const PRICE_PER_MILLION = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'o4-mini': { input: 1.1, output: 4.4 },
  default: { input: 0.15, output: 0.6 }
};

function pricesForModel(model) {
  const id = String(model || '').toLowerCase().trim();
  if (PRICE_PER_MILLION[id]) return PRICE_PER_MILLION[id];
  if (id.includes('4o-mini') || id.includes('4.1-mini') || id.includes('mini')) {
    return PRICE_PER_MILLION['gpt-4o-mini'];
  }
  if (id.includes('4o') || id.includes('4.1')) return PRICE_PER_MILLION['gpt-4o'];
  return PRICE_PER_MILLION.default;
}

function emptyUsage(model) {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    model: model || null,
    calls: 0
  };
}

function addUsage(acc, usage, model) {
  if (!acc) acc = emptyUsage(model);
  if (!usage) return acc;
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const total = Number(usage.total_tokens) || (prompt + completion);
  acc.prompt_tokens += prompt;
  acc.completion_tokens += completion;
  acc.total_tokens += total;
  acc.calls += 1;
  if (model) acc.model = model;
  const prices = pricesForModel(acc.model || model);
  acc.cost_usd += (prompt / 1e6) * prices.input + (completion / 1e6) * prices.output;
  return acc;
}

function finalizeUsage(acc, model) {
  const u = acc || emptyUsage(model);
  const m = u.model || model || null;
  const prices = pricesForModel(m);
  // Recalcular costo limpio por si se acumuló con varios modelos
  const cost = (u.prompt_tokens / 1e6) * prices.input + (u.completion_tokens / 1e6) * prices.output;
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.total_tokens || (u.prompt_tokens + u.completion_tokens),
    cost_usd: Math.round((u.cost_usd || cost) * 1e6) / 1e6,
    model: m,
    calls: u.calls || 0,
    estimated: false,
    prices
  };
}

/** Estimación gruesa cuando no hay usage guardado (mensajes antiguos). */
function estimateTokensFromText(text) {
  const s = String(text || '');
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

async function ensureUsageColumns(db) {
  const cols = [
    ['prompt_tokens', 'INT NULL', 'INTEGER'],
    ['completion_tokens', 'INT NULL', 'INTEGER'],
    ['total_tokens', 'INT NULL', 'INTEGER'],
    ['cost_usd', 'DECIMAL(12,6) NULL', 'REAL'],
    ['model', 'VARCHAR(64) NULL', 'TEXT']
  ];
  for (const [col, mysqlDdl, sqliteDdl] of cols) {
    try {
      if (db.driver === 'mysql') {
        const row = await db.prepare(`
          SELECT COUNT(*) AS c FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'angel_ia_mensajes' AND column_name = ?
        `).get(col);
        if (!row || Number(row.c) === 0) {
          await db.exec(`ALTER TABLE angel_ia_mensajes ADD COLUMN \`${col}\` ${mysqlDdl}`);
        }
      } else {
        const existing = (await db.prepare('PRAGMA table_info(angel_ia_mensajes)').all()).map((c) => c.name);
        if (!existing.includes(col)) {
          await db.exec(`ALTER TABLE angel_ia_mensajes ADD COLUMN ${col} ${sqliteDdl}`);
        }
      }
    } catch (err) {
      if (!/duplicate column/i.test(String(err.message || ''))) {
        console.warn('[angel-usage] columna', col, err.message);
      }
    }
  }
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch (_) {
    return {};
  }
}

function usageFromRow(row, defaultModel) {
  const meta = parseMeta(row.meta_json);
  const fromMeta = meta.usage || null;
  let prompt = Number(row.prompt_tokens);
  let completion = Number(row.completion_tokens);
  let total = Number(row.total_tokens);
  let cost = Number(row.cost_usd);
  let model = row.model || fromMeta?.model || defaultModel || null;
  let estimated = false;

  if (!Number.isFinite(prompt) || prompt < 0) prompt = Number(fromMeta?.prompt_tokens) || 0;
  if (!Number.isFinite(completion) || completion < 0) completion = Number(fromMeta?.completion_tokens) || 0;
  if (!Number.isFinite(total) || total <= 0) total = Number(fromMeta?.total_tokens) || (prompt + completion);
  if (!Number.isFinite(cost) || cost < 0) cost = Number(fromMeta?.cost_usd);

  if ((!total || total <= 0) && row.rol === 'assistant') {
    const estOut = estimateTokensFromText(row.contenido);
    const estIn = Math.round(estOut * 2.5);
    prompt = estIn;
    completion = estOut;
    total = estIn + estOut;
    estimated = true;
  }
  if (!Number.isFinite(cost) || cost < 0) {
    const prices = pricesForModel(model);
    cost = (prompt / 1e6) * prices.input + (completion / 1e6) * prices.output;
    if (estimated) cost = Math.round(cost * 1e6) / 1e6;
  }

  return {
    prompt_tokens: prompt || 0,
    completion_tokens: completion || 0,
    total_tokens: total || 0,
    cost_usd: Math.round((cost || 0) * 1e6) / 1e6,
    model,
    estimated: estimated || !!fromMeta?.estimated
  };
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 1e4) / 1e4;
}

/**
 * Resumen + conversaciones agrupadas por usuario (producción).
 */
async function getUsageReport(db, opts = {}) {
  await ensureUsageColumns(db);
  const limit = Math.min(Math.max(Number(opts.limit) || 80, 1), 300);
  const usuarioId = opts.usuario_id ? Number(opts.usuario_id) : null;
  const q = String(opts.q || '').trim().toLowerCase();
  const desde = opts.desde ? String(opts.desde).slice(0, 10) : null;
  const hasta = opts.hasta ? String(opts.hasta).slice(0, 10) : null;

  let sql = `
    SELECT m.id, m.usuario_id, m.rol, m.contenido, m.meta_json, m.fecha_creacion,
           m.prompt_tokens, m.completion_tokens, m.total_tokens, m.cost_usd, m.model,
           u.nombre AS usuario_nombre, u.apellido AS usuario_apellido, u.email AS usuario_email
    FROM angel_ia_mensajes m
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE 1=1
  `;
  const params = [];
  if (usuarioId) {
    sql += ' AND m.usuario_id = ?';
    params.push(usuarioId);
  }
  if (desde) {
    sql += ' AND DATE(m.fecha_creacion) >= ?';
    params.push(desde);
  }
  if (hasta) {
    sql += ' AND DATE(m.fecha_creacion) <= ?';
    params.push(hasta);
  }
  sql += ' ORDER BY m.id DESC LIMIT ?';
  params.push(Math.min(limit * 40, 4000));

  const rows = await db.prepare(sql).all(...params);

  const byUser = new Map();
  let sumPrompt = 0;
  let sumCompletion = 0;
  let sumTotal = 0;
  let sumCost = 0;
  let assistantTurns = 0;
  let estimatedTurns = 0;

  for (const row of rows) {
    const usage = usageFromRow(row);
    if (row.rol === 'assistant') {
      sumPrompt += usage.prompt_tokens;
      sumCompletion += usage.completion_tokens;
      sumTotal += usage.total_tokens;
      sumCost += usage.cost_usd;
      assistantTurns += 1;
      if (usage.estimated) estimatedTurns += 1;
    }

    const uid = row.usuario_id;
    if (!byUser.has(uid)) {
      const nombre = [row.usuario_nombre, row.usuario_apellido].filter(Boolean).join(' ').trim()
        || row.usuario_email
        || `Usuario #${uid}`;
      byUser.set(uid, {
        usuario_id: uid,
        usuario_nombre: nombre,
        usuario_email: row.usuario_email || null,
        mensajes: 0,
        turnos: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        primera: row.fecha_creacion,
        ultima: row.fecha_creacion,
        preview: [],
        _msgs: []
      });
    }
    const g = byUser.get(uid);
    g.mensajes += 1;
    g.primera = row.fecha_creacion < g.primera ? row.fecha_creacion : g.primera;
    g.ultima = row.fecha_creacion > g.ultima ? row.fecha_creacion : g.ultima;
    if (row.rol === 'assistant') {
      g.turnos += 1;
      g.prompt_tokens += usage.prompt_tokens;
      g.completion_tokens += usage.completion_tokens;
      g.total_tokens += usage.total_tokens;
      g.cost_usd += usage.cost_usd;
    }
    g._msgs.push({
      id: row.id,
      rol: row.rol,
      contenido: row.contenido,
      fecha_creacion: row.fecha_creacion,
      usage
    });
  }

  let conversaciones = Array.from(byUser.values()).map((g) => {
    const msgs = g._msgs.slice().sort((a, b) => a.id - b.id);
    const lastUser = [...msgs].reverse().find((m) => m.rol === 'user');
    const preview = (lastUser?.contenido || msgs[msgs.length - 1]?.contenido || '').slice(0, 140);
    return {
      usuario_id: g.usuario_id,
      usuario_nombre: g.usuario_nombre,
      usuario_email: g.usuario_email,
      mensajes: g.mensajes,
      turnos: g.turnos,
      prompt_tokens: g.prompt_tokens,
      completion_tokens: g.completion_tokens,
      total_tokens: g.total_tokens,
      cost_usd: roundMoney(g.cost_usd),
      primera: g.primera,
      ultima: g.ultima,
      preview,
      mensajes_detalle: msgs.slice(-80)
    };
  });

  if (q) {
    conversaciones = conversaciones.filter((c) => {
      const blob = `${c.usuario_nombre} ${c.usuario_email || ''} ${c.preview}`.toLowerCase();
      return blob.includes(q);
    });
  }

  conversaciones.sort((a, b) => String(b.ultima).localeCompare(String(a.ultima)));
  conversaciones = conversaciones.slice(0, limit);

  return {
    resumen: {
      conversaciones: conversaciones.length,
      turnos: assistantTurns,
      prompt_tokens: sumPrompt,
      completion_tokens: sumCompletion,
      total_tokens: sumTotal,
      cost_usd: roundMoney(sumCost),
      estimated_turns: estimatedTurns,
      moneda: 'USD',
      nota: estimatedTurns
        ? 'Algunos turnos antiguos no tenían tokens guardados: el costo se estimó por longitud del texto.'
        : 'Costos estimados según tarifas públicas de OpenAI (pueden variar).',
      precios: PRICE_PER_MILLION
    },
    conversaciones
  };
}

async function getConversationDetail(db, usuarioId, opts = {}) {
  await ensureUsageColumns(db);
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  const rows = (await db.prepare(`
    SELECT m.id, m.usuario_id, m.rol, m.contenido, m.meta_json, m.fecha_creacion,
           m.prompt_tokens, m.completion_tokens, m.total_tokens, m.cost_usd, m.model,
           u.nombre AS usuario_nombre, u.apellido AS usuario_apellido, u.email AS usuario_email
    FROM angel_ia_mensajes m
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.usuario_id = ?
    ORDER BY m.id DESC
    LIMIT ?
  `).all(usuarioId, limit)).reverse();

  let sumCost = 0;
  let sumTokens = 0;
  const mensajes = rows.map((row) => {
    const usage = usageFromRow(row);
    if (row.rol === 'assistant') {
      sumCost += usage.cost_usd;
      sumTokens += usage.total_tokens;
    }
    return {
      id: row.id,
      rol: row.rol,
      contenido: row.contenido,
      fecha_creacion: row.fecha_creacion,
      usage
    };
  });

  const u0 = rows[0];
  const nombre = u0
    ? ([u0.usuario_nombre, u0.usuario_apellido].filter(Boolean).join(' ').trim() || u0.usuario_email || `Usuario #${usuarioId}`)
    : `Usuario #${usuarioId}`;

  return {
    usuario_id: Number(usuarioId),
    usuario_nombre: nombre,
    usuario_email: u0?.usuario_email || null,
    total_tokens: sumTokens,
    cost_usd: roundMoney(sumCost),
    mensajes
  };
}

module.exports = {
  PRICE_PER_MILLION,
  pricesForModel,
  emptyUsage,
  addUsage,
  finalizeUsage,
  ensureUsageColumns,
  getUsageReport,
  getConversationDetail,
  estimateTokensFromText
};
