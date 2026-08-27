/**
 * Voz de Angel IA — STT (Whisper) + TTS (OpenAI Speech).
 * Por defecto: voz masculina (onyx) + español latino chileno.
 */
const OpenAI = require('openai');
const { toFile } = require('openai');
const { getApiKey, getConfig } = require('./angel');

const VOCES = [
  { id: 'onyx', label: 'Onyx — Angel (hombre, recomendada)', estilo: 'masculina' },
  { id: 'echo', label: 'Echo — hombre, grave', estilo: 'masculina' },
  { id: 'ash', label: 'Ash — hombre, directa', estilo: 'masculina' },
  { id: 'alloy', label: 'Alloy — neutra', estilo: 'neutra' },
  { id: 'sage', label: 'Sage — neutra', estilo: 'neutra' },
  { id: 'fable', label: 'Fable — narrativa', estilo: 'neutra' },
  { id: 'ballad', label: 'Ballad — expresiva', estilo: 'neutra' },
  { id: 'nova', label: 'Nova — femenina, clara', estilo: 'femenina' },
  { id: 'coral', label: 'Coral — femenina, cálida', estilo: 'femenina' },
  { id: 'shimmer', label: 'Shimmer — femenina, suave', estilo: 'femenina' }
];

const TTS_MODELS = [
  { id: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS (mejor español / instrucciones)' },
  { id: 'tts-1', label: 'TTS-1 (rápida)' },
  { id: 'tts-1-hd', label: 'TTS-1 HD (más calidad)' }
];

/** Presets de velocidad para el admin (OpenAI speed: 0.25–4.0) */
const SPEED_PRESETS = [
  { id: 'lenta', label: 'Lenta', speed: 0.9 },
  { id: 'natural', label: 'Natural', speed: 1.0 },
  { id: 'presentacion', label: 'Presentación', speed: 1.12 },
  { id: 'rapida', label: 'Rápida', speed: 1.25 }
];

const DEFAULT_VOICE = 'onyx';
const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_SPEED = 1.12;
const DEFAULT_INSTRUCTIONS = [
  'Eres Angel IA, un agente hombre chileno. Habla como una persona real presentando en vivo, no como un robot ni un locutor de call center.',
  'Voz masculina adulta, natural y confiada. Español de Chile (Santiago), sin acento de España ni mexicano exagerado.',
  'Ritmo de conversación humana: pausas breves entre ideas, énfasis en lo importante, tono cercano y profesional.',
  'Evita monotonía, lectura mecánica o exagerar la emoción. Suena como un colega explicando con claridad.'
].join(' ');

async function ensureColumn(db, col, mysqlDdl, sqliteDdl) {
  try {
    if (db.driver === 'mysql') {
      const row = await db.prepare(`
        SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'angel_ia_config' AND column_name = ?
      `).get(col);
      if (!row || Number(row.c) === 0) {
        await db.exec(`ALTER TABLE angel_ia_config ADD COLUMN \`${col}\` ${mysqlDdl}`);
      }
    } else {
      const cols = (await db.prepare('PRAGMA table_info(angel_ia_config)').all()).map((c) => c.name);
      if (!cols.includes(col)) {
        await db.exec(`ALTER TABLE angel_ia_config ADD COLUMN ${col} ${sqliteDdl}`);
      }
    }
  } catch (err) {
    if (!/duplicate column/i.test(String(err.message || ''))) {
      console.warn('[angel-voice] columna', col, err.message);
    }
  }
}

async function ensureVoiceSchema(db) {
  await ensureColumn(db, 'voz_activa', 'TINYINT NOT NULL DEFAULT 1', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'voz_tts_voice', 'VARCHAR(32) NULL', 'TEXT');
  await ensureColumn(db, 'voz_tts_model', 'VARCHAR(64) NULL', 'TEXT');
  await ensureColumn(db, 'voz_autoplay', 'TINYINT NOT NULL DEFAULT 1', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'voz_instrucciones', 'TEXT NULL', 'TEXT');
  await ensureColumn(db, 'voz_stt_model', 'VARCHAR(64) NULL', 'TEXT');
  await ensureColumn(db, 'voz_tts_speed', 'DECIMAL(4,2) NULL', 'REAL');

  // Angel IA = voz masculina: migrar default anterior (nova/femenina) o vacío → onyx
  try {
    const row = await db.prepare(
      'SELECT voz_tts_voice, voz_instrucciones FROM angel_ia_config WHERE id = 1'
    ).get();
    if (!row) return;
    const voice = String(row.voz_tts_voice || '').trim().toLowerCase();
    const femaleDefaults = !voice || voice === 'nova' || voice === 'coral' || voice === 'shimmer';
    if (!femaleDefaults) return;
    const instr = String(row.voz_instrucciones || '').trim();
    const shouldResetInstr = !instr || !/hombre|masculin/i.test(instr);
    await db.prepare(`
      UPDATE angel_ia_config SET
        voz_tts_voice = ?,
        voz_instrucciones = ?
      WHERE id = 1
    `).run(
      'onyx',
      shouldResetInstr ? DEFAULT_INSTRUCTIONS : instr
    );
  } catch (err) {
    console.warn('[angel-voice] migrate male voice:', err.message);
  }
}

function pickVoice(raw) {
  const id = String(raw || '').trim().toLowerCase();
  return VOCES.some((v) => v.id === id) ? id : DEFAULT_VOICE;
}

function pickTtsModel(raw) {
  const id = String(raw || '').trim().toLowerCase();
  return TTS_MODELS.some((m) => m.id === id) ? id : DEFAULT_TTS_MODEL;
}

function pickSpeed(raw) {
  if (raw == null || raw === '') return DEFAULT_SPEED;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SPEED;
  // OpenAI Speech API: 0.25–4.0
  return Math.min(4, Math.max(0.25, Math.round(n * 100) / 100));
}

async function getVoiceConfig(db) {
  await ensureVoiceSchema(db);
  const cfg = (await getConfig(db)) || {};
  return {
    voz_activa: cfg.voz_activa == null ? true : Number(cfg.voz_activa) !== 0,
    voz_tts_voice: pickVoice(cfg.voz_tts_voice),
    voz_tts_model: pickTtsModel(cfg.voz_tts_model),
    voz_tts_speed: pickSpeed(cfg.voz_tts_speed != null ? cfg.voz_tts_speed : DEFAULT_SPEED),
    voz_autoplay: cfg.voz_autoplay == null ? true : Number(cfg.voz_autoplay) !== 0,
    voz_instrucciones: String(cfg.voz_instrucciones || '').trim() || DEFAULT_INSTRUCTIONS,
    voz_stt_model: String(cfg.voz_stt_model || 'whisper-1').trim() || 'whisper-1',
    voces: VOCES,
    tts_modelos: TTS_MODELS,
    speed_presets: SPEED_PRESETS,
    instrucciones_default: DEFAULT_INSTRUCTIONS
  };
}

async function saveVoiceConfig(db, body = {}) {
  await ensureVoiceSchema(db);
  const current = await getVoiceConfig(db);
  const vozActiva = body.voz_activa === false || body.voz_activa === 0 || body.voz_activa === '0' ? 0 : 1;
  const vozAutoplay = body.voz_autoplay === false || body.voz_autoplay === 0 || body.voz_autoplay === '0' ? 0 : 1;
  const voice = pickVoice(body.voz_tts_voice ?? current.voz_tts_voice);
  const model = pickTtsModel(body.voz_tts_model ?? current.voz_tts_model);
  const speed = pickSpeed(
    body.voz_tts_speed != null ? body.voz_tts_speed : current.voz_tts_speed
  );
  let instrucciones = body.voz_instrucciones != null
    ? String(body.voz_instrucciones).trim()
    : current.voz_instrucciones;
  if (!instrucciones) instrucciones = DEFAULT_INSTRUCTIONS;
  if (instrucciones.length > 1500) instrucciones = instrucciones.slice(0, 1500);
  const stt = String(body.voz_stt_model || current.voz_stt_model || 'whisper-1').trim() || 'whisper-1';

  // Ensure row exists
  try {
    await db.prepare('INSERT IGNORE INTO angel_ia_config (id) VALUES (1)').run();
  } catch (_) {
    try {
      await db.prepare('INSERT OR IGNORE INTO angel_ia_config (id) VALUES (1)').run();
    } catch (__) { /* ok */ }
  }

  await db.prepare(`
    UPDATE angel_ia_config SET
      voz_activa = ?,
      voz_tts_voice = ?,
      voz_tts_model = ?,
      voz_tts_speed = ?,
      voz_autoplay = ?,
      voz_instrucciones = ?,
      voz_stt_model = ?
    WHERE id = 1
  `).run(vozActiva, voice, model, speed, vozAutoplay, instrucciones, stt);

  return getVoiceConfig(db);
}

function sniffAudioFormat(buf, declaredMime) {
  const mime = String(declaredMime || '').toLowerCase().split(';')[0].trim();
  if (buf.length >= 12) {
    // WebM / Matroska
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return { mimeType: 'audio/webm', filename: 'angel_voz.webm' };
    }
    // OGG
    if (buf.slice(0, 4).toString('ascii') === 'OggS') {
      return { mimeType: 'audio/ogg', filename: 'angel_voz.ogg' };
    }
    // WAV
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE') {
      return { mimeType: 'audio/wav', filename: 'angel_voz.wav' };
    }
    // MP4 / M4A / AAC in MP4
    const ftyp = buf.slice(4, 8).toString('ascii');
    if (ftyp === 'ftyp') {
      return { mimeType: 'audio/mp4', filename: 'angel_voz.m4a' };
    }
    // MP3 (ID3 or frame sync)
    if (buf.slice(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
      return { mimeType: 'audio/mpeg', filename: 'angel_voz.mp3' };
    }
    // FLAC
    if (buf.slice(0, 4).toString('ascii') === 'fLaC') {
      return { mimeType: 'audio/flac', filename: 'angel_voz.flac' };
    }
  }
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac') || mime.includes('caf')) {
    return { mimeType: 'audio/mp4', filename: 'angel_voz.m4a' };
  }
  if (mime.includes('mpeg') || mime.includes('mp3')) {
    return { mimeType: 'audio/mpeg', filename: 'angel_voz.mp3' };
  }
  if (mime.includes('wav')) return { mimeType: 'audio/wav', filename: 'angel_voz.wav' };
  if (mime.includes('ogg') || mime.includes('opus')) return { mimeType: 'audio/ogg', filename: 'angel_voz.ogg' };
  if (mime.includes('flac')) return { mimeType: 'audio/flac', filename: 'angel_voz.flac' };
  if (mime.includes('webm')) return { mimeType: 'audio/webm', filename: 'angel_voz.webm' };
  // Fallback seguro para móviles (iOS suele ser mp4 aunque el type venga vacío)
  return { mimeType: 'audio/mp4', filename: 'angel_voz.m4a' };
}

function decodeAudioPayload(body) {
  const raw = body?.audioBase64 || body?.audio || body?.dataUrl || body?.data_url;
  if (!raw || typeof raw !== 'string') {
    const err = new Error('Falta el audio (audioBase64)');
    err.status = 400;
    throw err;
  }
  let mime = String(body?.mimeType || body?.mime || '').split(';')[0].trim();
  let b64 = raw.trim();
  // data:[mime][;param=...]*;base64,<payload>  (codecs=opus rompe el regex simple)
  if (/^data:/i.test(b64)) {
    const comma = b64.indexOf(',');
    if (comma < 0) {
      const err = new Error('Audio en formato data-URL inválido');
      err.status = 400;
      throw err;
    }
    const header = b64.slice(5, comma); // sin "data:"
    const parts = header.split(';').map((p) => p.trim()).filter(Boolean);
    const mimePart = parts.find((p) => p.includes('/')) || parts[0] || '';
    if (mimePart && !/^base64$/i.test(mimePart)) mime = mimePart.split(';')[0].trim() || mime;
    b64 = b64.slice(comma + 1).replace(/\s+/g, '');
  }
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) {
    const err = new Error('Audio vacío o inválido');
    err.status = 400;
    throw err;
  }
  if (buf.length > 12 * 1024 * 1024) {
    const err = new Error('Audio demasiado grande (máx. 12 MB)');
    err.status = 400;
    throw err;
  }
  const sniffed = sniffAudioFormat(buf, mime);
  return { buffer: buf, mimeType: sniffed.mimeType, filename: sniffed.filename };
}

async function transcribeAudio(db, body) {
  const apiKey = await getApiKey(db);
  if (!apiKey) {
    const err = new Error('Angel IA sin API key. Configura OPENAI_API_KEY o la key en entrenamiento.');
    err.status = 400;
    throw err;
  }
  const cfg = await getVoiceConfig(db);
  if (!cfg.voz_activa) {
    const err = new Error('La voz de Angel está desactivada en la configuración.');
    err.status = 403;
    throw err;
  }
  const { buffer, mimeType, filename } = decodeAudioPayload(body);
  const client = new OpenAI({ apiKey, timeout: 90000 });
  const file = await toFile(buffer, filename, { type: mimeType });
  const result = await client.audio.transcriptions.create({
    file,
    model: cfg.voz_stt_model || 'whisper-1',
    language: 'es',
    prompt: 'Español de Chile. Transcribe exactamente lo dicho por el usuario en tono conversacional.'
  });
  const text = String(result?.text || '').trim();
  if (!text) {
    const err = new Error('No se pudo entender el audio. Intenta de nuevo.');
    err.status = 422;
    throw err;
  }
  return { text, mimeType, bytes: buffer.length };
}

function stripForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[*_#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4096);
}

async function synthesizeSpeech(db, text) {
  const apiKey = await getApiKey(db);
  if (!apiKey) {
    const err = new Error('Angel IA sin API key');
    err.status = 400;
    throw err;
  }
  const cfg = await getVoiceConfig(db);
  if (!cfg.voz_activa) {
    const err = new Error('La voz de Angel está desactivada');
    err.status = 403;
    throw err;
  }
  const input = stripForSpeech(text);
  if (!input) {
    const err = new Error('No hay texto para narrar');
    err.status = 400;
    throw err;
  }
  const client = new OpenAI({ apiKey, timeout: 90000 });
  const trySpeak = async (model) => {
    const payload = {
      model,
      voice: cfg.voz_tts_voice,
      input,
      response_format: 'mp3',
      speed: pickSpeed(cfg.voz_tts_speed)
    };
    if (String(model).includes('gpt-4o')) {
      payload.instructions = cfg.voz_instrucciones || DEFAULT_INSTRUCTIONS;
    }
    const response = await client.audio.speech.create(payload);
    const ab = await response.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      contentType: 'audio/mpeg',
      voice: cfg.voz_tts_voice,
      model
    };
  };
  try {
    return await trySpeak(cfg.voz_tts_model);
  } catch (err) {
    if (cfg.voz_tts_model !== 'tts-1') {
      console.warn('[angel-voice] TTS fallback tts-1:', err.message);
      return trySpeak('tts-1');
    }
    throw err;
  }
}

module.exports = {
  VOCES,
  TTS_MODELS,
  SPEED_PRESETS,
  DEFAULT_VOICE,
  DEFAULT_TTS_MODEL,
  DEFAULT_INSTRUCTIONS,
  ensureVoiceSchema,
  getVoiceConfig,
  saveVoiceConfig,
  transcribeAudio,
  synthesizeSpeech,
  stripForSpeech
};
