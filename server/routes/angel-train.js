const express = require('express');
const path = require('path');
const fs = require('fs');
const { angelTrainRequired } = require('../middleware/angel-train');
const {
  getTrainingConfig,
  saveTrainingConfig,
  chatWithAngelTrain,
  clearTrainChat,
  getSecurityLog
} = require('../services/angel');
const { getApiConfigData, saveApiConfig, testApiConnection } = require('../services/angel-api-config');
const {
  scanUserMessage,
  getDefaultSecurityConfig
} = require('../services/angel-security');
const config = require('../config');

const router = express.Router();
router.use(angelTrainRequired);

router.get('/config', async (req, res) => {
  try {
    const data = await getTrainingConfig(req.db);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/config', async (req, res) => {
  try {
    const data = await saveTrainingConfig(req.db, req.body || {});
    res.json({ success: true, data, message: 'Entrenamiento y seguridad guardados. Angel IA ya los aplica.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/api-config', async (req, res) => {
  try {
    const data = await getApiConfigData(req.db);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/api-config', async (req, res) => {
  try {
    const data = await saveApiConfig(req.db, req.body || {}, null);
    res.json({ success: true, data, message: 'Configuración API guardada' });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
});

router.post('/api-config/probar', async (req, res) => {
  try {
    const data = await testApiConnection(req.db);
    res.json({ success: true, message: 'Conexión OpenAI correcta', data });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
});

router.post('/api-config/probar-voz', async (req, res) => {
  try {
    const { synthesizeSpeech, getVoiceConfig, saveVoiceConfig } = require('../services/angel-voice');
    if (req.body && (req.body.voz_tts_voice || req.body.voz_tts_model || req.body.voz_instrucciones || req.body.voz_tts_speed != null)) {
      await saveVoiceConfig(req.db, req.body);
    }
    const cfg = await getVoiceConfig(req.db);
    const sample = String(req.body?.text || '').trim()
      || 'Hola, soy Angel IA. En esta presentación te muestro cómo ESERCOM facilita el trabajo del equipo, de forma clara y natural.';
    const result = await synthesizeSpeech(req.db, sample);
    res.setHeader('Content-Type', result.contentType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Angel-Voice', cfg.voz_tts_voice || '');
    res.setHeader('X-Angel-Voice-Speed', String(cfg.voz_tts_speed || ''));
    res.send(result.buffer);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message });
  }
});

router.get('/seguridad/log', async (req, res) => {
  try {
    const data = await getSecurityLog(req.db, Number(req.query.limit) || 50);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/seguridad/escanear', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ success: false, message: 'Escribe un mensaje para escanear' });
    }
    const cfg = await getTrainingConfig(req.db);
    const scan = scanUserMessage(message, { activa: cfg.seguridad?.activa !== false });
    res.json({ success: true, data: scan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/seguridad/restaurar', async (req, res) => {
  try {
    const defaults = getDefaultSecurityConfig();
    const current = await getTrainingConfig(req.db);
    const data = await saveTrainingConfig(req.db, {
      instrucciones: current.instrucciones,
      ejemplos: current.ejemplos,
      seguridad: {
        activa: true,
        prompt_personalizado: '',
        ejemplos: defaults.ejemplos
      }
    });
    res.json({
      success: true,
      data,
      message: 'Reglas de seguridad base restauradas'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/restaurar', async (req, res) => {
  try {
    const { getDefaultTrainingPack } = require('../services/angel-knowledge');
    const defaults = getDefaultSecurityConfig();
    const pack = getDefaultTrainingPack();
    const data = await saveTrainingConfig(req.db, {
      instrucciones: pack.instrucciones,
      ejemplos: pack.ejemplos,
      seguridad: {
        activa: true,
        prompt_personalizado: '',
        ejemplos: defaults.ejemplos
      }
    });
    res.json({
      success: true,
      data,
      message: 'Conocimiento humano de Angel cargado (instrucciones + ejemplos + seguridad base)'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/conocimiento/docs', async (req, res) => {
  try {
    const { listAngelDocs, getAngelDocsResumen, listCategorias } = require('../services/angel-docs');
    const data = await listAngelDocs(req.db);
    const resumen = await getAngelDocsResumen(req.db);
    res.json({ success: true, data, resumen, categorias: listCategorias() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/conocimiento/docs/:id', async (req, res) => {
  try {
    const { getAngelDoc } = require('../services/angel-docs');
    const data = await getAngelDoc(req.db, Number(req.params.id));
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/docs/upload', async (req, res) => {
  try {
    const { uploadAngelDoc } = require('../services/angel-docs');
    const data = await uploadAngelDoc(req.db, {
      dataUrl: req.body?.dataUrl,
      filename: req.body?.filename,
      titulo: req.body?.titulo,
      categoria: req.body?.categoria,
      userId: req.trainAuth?.userId || null,
      empresa: req.trainAuth?.empresa
    });
    res.status(201).json({
      success: true,
      data,
      message: data.tipo === 'excel'
        ? `Excel indexado con ${data.filas || 0} registros (campos por fila). Angel ya puede cruzar patente, costo, marca, etc.`
        : `Cerebro actualizado (${data.tipo}). Angel ya puede usarlo.`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/docs/reprocesar-excel', async (req, res) => {
  try {
    const { reprocessAllExcelDocs } = require('../services/angel-docs');
    const data = await reprocessAllExcelDocs(req.db);
    const ok = (data.results || []).filter((r) => r.ok).length;
    res.json({
      success: true,
      data,
      message: `Reprocesados ${ok}/${data.total} Excel/CSV con campos estructurados`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/docs/reprocesar-pdf', async (req, res) => {
  try {
    const { reprocessAllPdfDocs } = require('../services/angel-docs');
    const data = await reprocessAllPdfDocs(req.db);
    const ok = (data.results || []).filter((r) => r.ok).length;
    res.json({
      success: true,
      data,
      message: `Reindexados ${ok}/${data.total} PDF (texto + OCR de imágenes si aplica)`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/conocimiento/webs', async (req, res) => {
  try {
    const { listCompanyWebs, DEFAULT_COMPANY_WEBS } = require('../services/angel-webs');
    const data = await listCompanyWebs(req.db);
    res.json({
      success: true,
      data: {
        empresas: data,
        defaults: DEFAULT_COMPANY_WEBS
      }
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/webs', async (req, res) => {
  try {
    const { saveCompanyWebs } = require('../services/angel-webs');
    const empresas = req.body?.empresas;
    const data = await saveCompanyWebs(req.db, empresas);
    res.json({
      success: true,
      data,
      message: `Guardadas ${data.total} empresa(s) con sus webs. Usa «Sincronizar webs» para reindexar el contenido.`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/docs/sincronizar-webs', async (req, res) => {
  try {
    const { syncCompanyWebsToBrain, listCompanyWebs } = require('../services/angel-webs');
    const data = await syncCompanyWebsToBrain(req.db, {
      userId: req.trainAuth?.userId || null,
      fetchContent: req.body?.fetchContent !== false
    });
    const catalogo = await listCompanyWebs(req.db);
    const ok = (data.results || []).filter((r) => r.ok).length;
    res.json({
      success: true,
      data: { ...data, catalogo },
      message: `Webs sincronizadas al cerebro (${ok} ítems). Tema: Empresas del grupo.`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/docs/:id/reprocesar', async (req, res) => {
  try {
    const { reprocessAngelDoc } = require('../services/angel-docs');
    const data = await reprocessAngelDoc(req.db, Number(req.params.id));
    res.json({
      success: true,
      data,
      message: `Reprocesado: ${data.filas || 0} registros / ${data.chunks || 0} fragmentos`
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/docs/texto', async (req, res) => {
  try {
    const { addAngelTextNote } = require('../services/angel-docs');
    const data = await addAngelTextNote(req.db, {
      titulo: req.body?.titulo,
      texto: req.body?.texto,
      categoria: req.body?.categoria,
      userId: req.trainAuth?.userId || null
    });
    res.status(201).json({
      success: true,
      data,
      message: 'Nota de texto agregada al cerebro'
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/docs/:id/actualizar', async (req, res) => {
  try {
    const { updateAngelDoc } = require('../services/angel-docs');
    const data = await updateAngelDoc(req.db, Number(req.params.id), {
      nombre: req.body?.nombre,
      texto: req.body?.texto,
      categoria: req.body?.categoria,
      tabla: req.body?.tabla
    });
    const msg = data.hojas_activas != null
      ? `Guardado: Angel usará ${data.hojas_activas} hoja(s) activa(s)`
      : 'Archivo actualizado en el cerebro';
    res.json({
      success: true,
      data,
      message: msg
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.post('/conocimiento/docs/:id/eliminar', async (req, res) => {
  try {
    const { deleteAngelDoc } = require('../services/angel-docs');
    await deleteAngelDoc(req.db, Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get('/reportes/download/:file', async (req, res) => {
  const { resolveReportFile } = require('../services/angel-excel');
  const file = path.basename(req.params.file);
  const resolved = resolveReportFile(req.trainAuth.empresa, file);
  if (!resolved) {
    return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
  }
  res.download(resolved.full, file);
});

router.get('/chat/historial', async (req, res) => {
  const rows = (await req.db.prepare(`
    SELECT id, rol, contenido, meta_json, fecha_creacion
    FROM angel_ia_train_mensajes
    ORDER BY id DESC LIMIT 40
  `).all()).reverse();
  const data = rows.map((m) => {
    let downloads = [];
    let security = null;
    try {
      const meta = m.meta_json ? JSON.parse(m.meta_json) : null;
      if (Array.isArray(meta?.downloads)) downloads = meta.downloads;
      if (meta?.security || meta?.blocked) security = meta.security || { blocked: true };
    } catch (_) { /* ignore */ }
    downloads = downloads.map((d) => ({
      ...d,
      download: String(d.download || '').replace(
        /^\/api\/angel\/reportes\/download\//,
        '/api/angel/train/reportes/download/'
      )
    }));
    return {
      id: m.id,
      rol: m.rol,
      contenido: m.contenido,
      fecha_creacion: m.fecha_creacion,
      downloads,
      security
    };
  });
  res.json({ success: true, data });
});

router.post('/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ success: false, message: 'Escribe un mensaje de prueba' });
    }
    const history = (await req.db.prepare(`
      SELECT rol, contenido FROM angel_ia_train_mensajes ORDER BY id DESC LIMIT 12
    `).all()).reverse();

    // "guarda esto", "aprende que…": la corrección se guarda como conocimiento.
    const { procesarAprendizaje } = require('../services/angel-aprendizaje');
    const aprendizaje = await procesarAprendizaje(req.db, {
      message,
      history,
      userId: req.trainAuth?.userId || null
    });
    if (aprendizaje) {
      await req.db.prepare(
        `INSERT INTO angel_ia_train_mensajes (rol, contenido) VALUES ('user', ?)`
      ).run(message);
      await req.db.prepare(
        `INSERT INTO angel_ia_train_mensajes (rol, contenido) VALUES ('assistant', ?)`
      ).run(aprendizaje.reply);
      return res.json({
        success: true,
        data: {
          reply: aprendizaje.reply,
          downloads: [],
          aprendizaje
        }
      });
    }

    const result = await chatWithAngelTrain({
      db: req.db,
      company: req.trainAuth.company,
      message,
      history
    });
    res.json({ success: true, data: result });
  } catch (err) {
    const status = err.code === 'NO_API_KEY' ? 503 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.delete('/chat', async (req, res) => {
  try {
    await clearTrainChat(req.db);
    res.json({ success: true, message: 'Historial de prueba borrado' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ---- Uso / conversaciones producción (tokens + costo) ---- */
router.get('/uso', async (req, res) => {
  try {
    const { getUsageReport } = require('../services/angel-usage');
    const data = await getUsageReport(req.db, {
      q: req.query.q,
      desde: req.query.desde,
      hasta: req.query.hasta,
      usuario_id: req.query.usuario_id,
      limit: req.query.limit
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[angel-train uso]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/uso/conversacion/:usuarioId', async (req, res) => {
  try {
    const { getConversationDetail } = require('../services/angel-usage');
    const data = await getConversationDetail(req.db, req.params.usuarioId, {
      limit: req.query.limit
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
