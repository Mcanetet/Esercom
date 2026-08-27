const OpenAI = require('openai');
const { encrypt, maskKey } = require('./crypto');
const { getConfig, getApiKey, getAngelModel, getAngelStatus } = require('./angel');

async function getApiConfigData(db) {
  const cfg = await getConfig(db);
  const status = await getAngelStatus(db);
  const { getVoiceConfig, ensureVoiceSchema } = require('./angel-voice');
  await ensureVoiceSchema(db);
  const voice = await getVoiceConfig(db);
  return {
    configurado: status.activo,
    env_configured: status.source === 'env',
    source: status.source,
    hint: status.hint,
    model: status.model,
    activo: status.activo,
    reporte_semanal: !!(cfg && cfg.reporte_semanal),
    dia_reporte: cfg?.dia_reporte ?? 1,
    hora_reporte: cfg?.hora_reporte || '08:00',
    voz: voice
  };
}

async function saveApiConfig(db, body, updatedBy = null) {
  const b = body || {};
  const current = (await getConfig(db)) || { id: 1 };

  let apiKeyEnc = current.api_key_enc || null;
  let hint = current.api_key_hint || null;

  if (b.api_key && String(b.api_key).trim()) {
    const key = String(b.api_key).trim();
    if (!key.startsWith('sk-')) {
      const err = new Error('La API key de OpenAI debe comenzar con sk-');
      err.status = 400;
      throw err;
    }
    apiKeyEnc = encrypt(key);
    hint = maskKey(key);
  }

  if (b.limpiar_api_key) {
    apiKeyEnc = null;
    hint = null;
  }

  const model = b.model || current.model || 'gpt-4o-mini';
  const activo = b.activo === false || b.activo === 0 ? 0 : 1;
  const reporteSemanal = b.reporte_semanal === false || b.reporte_semanal === 0 ? 0 : 1;
  const diaReporte = Number(b.dia_reporte ?? current.dia_reporte ?? 1);
  const horaReporte = b.hora_reporte || current.hora_reporte || '08:00';

  if (db.driver === 'mysql') {
    await db.prepare(`
      INSERT INTO angel_ia_config (
        id, api_key_enc, api_key_hint, model, activo, reporte_semanal,
        dia_reporte, hora_reporte, actualizado_por, actualizado_en
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        api_key_enc = VALUES(api_key_enc),
        api_key_hint = VALUES(api_key_hint),
        model = VALUES(model),
        activo = VALUES(activo),
        reporte_semanal = VALUES(reporte_semanal),
        dia_reporte = VALUES(dia_reporte),
        hora_reporte = VALUES(hora_reporte),
        actualizado_por = VALUES(actualizado_por),
        actualizado_en = VALUES(actualizado_en)
    `).run(apiKeyEnc, hint, model, activo, reporteSemanal, diaReporte, horaReporte, updatedBy);
  } else {
    await db.prepare(`
      INSERT INTO angel_ia_config (
        id, api_key_enc, api_key_hint, model, activo, reporte_semanal,
        dia_reporte, hora_reporte, actualizado_por, actualizado_en
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        api_key_enc = excluded.api_key_enc,
        api_key_hint = excluded.api_key_hint,
        model = excluded.model,
        activo = excluded.activo,
        reporte_semanal = excluded.reporte_semanal,
        dia_reporte = excluded.dia_reporte,
        hora_reporte = excluded.hora_reporte,
        actualizado_por = excluded.actualizado_por,
        actualizado_en = excluded.actualizado_en
    `).run(apiKeyEnc, hint, model, activo, reporteSemanal, diaReporte, horaReporte, updatedBy);
  }

  // Campos de voz (opcionales en el mismo guardado)
  let voice = null;
  if (
    b.voz_activa != null || b.voz_tts_voice != null || b.voz_tts_model != null
    || b.voz_tts_speed != null || b.voz_autoplay != null || b.voz_instrucciones != null || b.voz
  ) {
    const { saveVoiceConfig } = require('./angel-voice');
    const vozBody = b.voz && typeof b.voz === 'object' ? { ...b.voz } : {};
    if (b.voz_activa != null) vozBody.voz_activa = b.voz_activa;
    if (b.voz_tts_voice != null) vozBody.voz_tts_voice = b.voz_tts_voice;
    if (b.voz_tts_model != null) vozBody.voz_tts_model = b.voz_tts_model;
    if (b.voz_tts_speed != null) vozBody.voz_tts_speed = b.voz_tts_speed;
    if (b.voz_autoplay != null) vozBody.voz_autoplay = b.voz_autoplay;
    if (b.voz_instrucciones != null) vozBody.voz_instrucciones = b.voz_instrucciones;
    voice = await saveVoiceConfig(db, vozBody);
  } else {
    try {
      const { getVoiceConfig } = require('./angel-voice');
      voice = await getVoiceConfig(db);
    } catch (_) { /* ignore */ }
  }

  return { hint, activo: !!activo, model, reporte_semanal: !!reporteSemanal, voz: voice };
}

async function testApiConnection(db) {
  const apiKey = await getApiKey(db);
  if (!apiKey) {
    const err = new Error('No hay API key. Define OPENAI_API_KEY en el servidor o guárdala aquí.');
    err.status = 400;
    throw err;
  }
  const client = new OpenAI({ apiKey });
  const model = await getAngelModel(db);
  const r = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'Responde solo: OK Angel IA' }],
    max_tokens: 20
  });
  return { reply: r.choices[0]?.message?.content || 'OK', model };
}

module.exports = { getApiConfigData, saveApiConfig, testApiConnection };
