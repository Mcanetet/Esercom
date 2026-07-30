const express = require('express');
const path = require('path');
const fs = require('fs');
const { authRequired } = require('../middleware/auth');
const { adminRequired } = require('../middleware/admin');
const { encrypt, decrypt, maskKey } = require('../services/crypto');
const config = require('../config');
const {
  getConfig,
  syncAlerts,
  generateCecoExcel,
  chatWithAngel,
  getDashboardContext
} = require('../services/angel');

const router = express.Router();
router.use(authRequired);

/* ---- Estado general (cualquier usuario autenticado) ---- */
router.get('/status', async (req, res) => {
  const cfg = await getConfig(req.db);
  res.json({
    success: true,
    data: {
      activo: !!(cfg && cfg.activo && cfg.api_key_enc),
      model: cfg?.model || 'gpt-4o-mini',
      reporte_semanal: !!(cfg && cfg.reporte_semanal),
      hint: cfg?.api_key_hint || null
    }
  });
});

router.get('/contexto', async (req, res) => {
  res.json({
    success: true,
    data: await getDashboardContext(req.db, req.auth.company)
  });
});

/* ---- Chat Angel IA ---- */
router.get('/chat/historial', async (req, res) => {
  const rows = (await req.db.prepare(`
    SELECT id, rol, contenido, fecha_creacion
    FROM angel_ia_mensajes
    WHERE usuario_id = ?
    ORDER BY id DESC LIMIT 40
  `).all(req.auth.userId)).reverse();
  res.json({ success: true, data: rows });
});

router.post('/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ success: false, message: 'Escribe una pregunta' });
    }
    const history = (await req.db.prepare(`
      SELECT rol, contenido FROM angel_ia_mensajes
      WHERE usuario_id = ? ORDER BY id DESC LIMIT 12
    `).all(req.auth.userId)).reverse();

    const result = await chatWithAngel({
      db: req.db,
      company: req.auth.company,
      user: req.auth.user,
      message,
      history
    });

    res.json({ success: true, data: result });
  } catch (err) {
    const status = err.code === 'NO_API_KEY' ? 503 : 500;
    console.error('Angel chat error', err.message);
    res.status(status).json({
      success: false,
      message: err.message || 'Error al consultar Angel IA'
    });
  }
});

/* ---- Alertas (por usuario) ---- */
router.get('/alertas', async (req, res) => {
  const onlyUnread = req.query.unread !== '0';
  // Al entrar, sincroniza pendientes dirigidos al usuario/empresa
  try { await syncAlerts(req.db); } catch (_) { /* no-op */ }

  const rows = await req.db.prepare(`
    SELECT * FROM angel_ia_alertas
    WHERE usuario_id = ?
      ${onlyUnread ? 'AND leida = 0' : ''}
    ORDER BY
      CASE severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
      id DESC
    LIMIT 100
  `).all(req.auth.userId);
  res.json({ success: true, data: rows, count: rows.length });
});

router.get('/alertas/count', async (req, res) => {
  try { await syncAlerts(req.db); } catch (_) { /* no-op */ }
  const c = (await req.db.prepare(`
    SELECT COUNT(*) AS c FROM angel_ia_alertas
    WHERE usuario_id = ? AND leida = 0
  `).get(req.auth.userId)).c;
  res.json({ success: true, data: { count: c } });
});

router.post('/alertas/sincronizar', async (req, res) => {
  const result = await syncAlerts(req.db);
  res.json({ success: true, data: result, message: `Alertas sincronizadas: ${result.created} nuevas` });
});

router.post('/alertas/:id/leer', async (req, res) => {
  await req.db.prepare(`
    UPDATE angel_ia_alertas SET leida = 1
    WHERE id = ? AND usuario_id = ?
  `).run(Number(req.params.id), req.auth.userId);
  res.json({ success: true });
});

router.post('/alertas/leer-todas', async (req, res) => {
  await req.db.prepare(`
    UPDATE angel_ia_alertas SET leida = 1
    WHERE leida = 0 AND usuario_id = ?
  `).run(req.auth.userId);
  res.json({ success: true });
});

/* ---- Reportes Excel ---- */
router.post('/reportes/semanal', async (req, res) => {
  try {
    const result = await generateCecoExcel(req.db, req.auth.company, req.auth.userId);
    res.json({
      success: true,
      message: 'Excel generado',
      data: {
        archivo: result.relative,
        download: `/api/angel/reportes/download/${result.filename}`,
        resumen: result.resumen,
        destinatarios: result.destinatarios
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message || 'No se pudo generar el Excel' });
  }
});

router.get('/reportes', async (req, res) => {
  const rows = await req.db.prepare(`
    SELECT id, tipo, titulo, archivo, destinatarios, resumen, fecha_creacion
    FROM angel_ia_reportes ORDER BY id DESC LIMIT 50
  `).all();
  res.json({ success: true, data: rows });
});

router.get('/reportes/download/:file', async (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(config.dataDir, 'reportes', file);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
  }
  res.download(full, file);
});

/* ---- Seguridad (solo admin): API OpenAI ---- */
router.get('/seguridad', adminRequired, async (req, res) => {
  const cfg = await getConfig(req.db);
  res.json({
    success: true,
    data: {
      configurado: !!(cfg && cfg.api_key_enc),
      hint: cfg?.api_key_hint || null,
      model: cfg?.model || 'gpt-4o-mini',
      activo: !!(cfg && cfg.activo),
      reporte_semanal: !!(cfg && cfg.reporte_semanal),
      dia_reporte: cfg?.dia_reporte ?? 1,
      hora_reporte: cfg?.hora_reporte || '08:00',
      smtp_host: cfg?.smtp_host || '',
      smtp_port: cfg?.smtp_port || 587,
      smtp_user: cfg?.smtp_user || '',
      smtp_from: cfg?.smtp_from || '',
      tiene_smtp_pass: !!(cfg && cfg.smtp_pass_enc),
      actualizado_en: cfg?.actualizado_en || null
    }
  });
});

router.post('/seguridad', adminRequired, async (req, res) => {
  try {
    const b = req.body || {};
    const current = (await getConfig(req.db)) || { id: 1 };

    let apiKeyEnc = current.api_key_enc || null;
    let hint = current.api_key_hint || null;

    if (b.api_key && String(b.api_key).trim()) {
      const key = String(b.api_key).trim();
      if (!key.startsWith('sk-')) {
        return res.status(400).json({
          success: false,
          message: 'La API key de OpenAI debe comenzar con sk-'
        });
      }
      apiKeyEnc = encrypt(key);
      hint = maskKey(key);
    }

    if (b.limpiar_api_key) {
      apiKeyEnc = null;
      hint = null;
    }

    let smtpPassEnc = current.smtp_pass_enc || null;
    if (b.smtp_pass && String(b.smtp_pass).trim()) {
      smtpPassEnc = encrypt(String(b.smtp_pass).trim());
    }

    // SQLite: ON CONFLICT; MySQL: REPLACE/INSERT ... ON DUPLICATE KEY (vía adapter)
    if (req.db.driver === 'mysql') {
      await req.db.prepare(`
        INSERT INTO angel_ia_config (
          id, api_key_enc, api_key_hint, model, activo, reporte_semanal,
          dia_reporte, hora_reporte, smtp_host, smtp_port, smtp_user, smtp_pass_enc, smtp_from,
          actualizado_por, actualizado_en
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          api_key_enc = VALUES(api_key_enc),
          api_key_hint = VALUES(api_key_hint),
          model = VALUES(model),
          activo = VALUES(activo),
          reporte_semanal = VALUES(reporte_semanal),
          dia_reporte = VALUES(dia_reporte),
          hora_reporte = VALUES(hora_reporte),
          smtp_host = VALUES(smtp_host),
          smtp_port = VALUES(smtp_port),
          smtp_user = VALUES(smtp_user),
          smtp_pass_enc = VALUES(smtp_pass_enc),
          smtp_from = VALUES(smtp_from),
          actualizado_por = VALUES(actualizado_por),
          actualizado_en = VALUES(actualizado_en)
      `).run(
        apiKeyEnc,
        hint,
        b.model || current.model || 'gpt-4o-mini',
        b.activo === false || b.activo === 0 ? 0 : 1,
        b.reporte_semanal === false || b.reporte_semanal === 0 ? 0 : 1,
        Number(b.dia_reporte ?? current.dia_reporte ?? 1),
        b.hora_reporte || current.hora_reporte || '08:00',
        b.smtp_host || null,
        Number(b.smtp_port) || 587,
        b.smtp_user || null,
        smtpPassEnc,
        b.smtp_from || null,
        req.auth.userId
      );
    } else {
      await req.db.prepare(`
        INSERT INTO angel_ia_config (
          id, api_key_enc, api_key_hint, model, activo, reporte_semanal,
          dia_reporte, hora_reporte, smtp_host, smtp_port, smtp_user, smtp_pass_enc, smtp_from,
          actualizado_por, actualizado_en
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          api_key_enc = excluded.api_key_enc,
          api_key_hint = excluded.api_key_hint,
          model = excluded.model,
          activo = excluded.activo,
          reporte_semanal = excluded.reporte_semanal,
          dia_reporte = excluded.dia_reporte,
          hora_reporte = excluded.hora_reporte,
          smtp_host = excluded.smtp_host,
          smtp_port = excluded.smtp_port,
          smtp_user = excluded.smtp_user,
          smtp_pass_enc = excluded.smtp_pass_enc,
          smtp_from = excluded.smtp_from,
          actualizado_por = excluded.actualizado_por,
          actualizado_en = excluded.actualizado_en
      `).run(
        apiKeyEnc,
        hint,
        b.model || current.model || 'gpt-4o-mini',
        b.activo === false || b.activo === 0 ? 0 : 1,
        b.reporte_semanal === false || b.reporte_semanal === 0 ? 0 : 1,
        Number(b.dia_reporte ?? current.dia_reporte ?? 1),
        b.hora_reporte || current.hora_reporte || '08:00',
        b.smtp_host || null,
        Number(b.smtp_port) || 587,
        b.smtp_user || null,
        smtpPassEnc,
        b.smtp_from || null,
        req.auth.userId
      );
    }

    res.json({
      success: true,
      message: 'Configuración de seguridad Angel IA guardada',
      data: { hint, activo: !(b.activo === false || b.activo === 0) }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'No se pudo guardar la configuración' });
  }
});

router.post('/seguridad/probar', adminRequired, async (req, res) => {
  try {
    const cfg = await getConfig(req.db);
    if (!cfg?.api_key_enc) {
      return res.status(400).json({ success: false, message: 'No hay API key configurada' });
    }
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: decrypt(cfg.api_key_enc) });
    const r = await client.chat.completions.create({
      model: cfg.model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Responde solo: OK Angel IA' }],
      max_tokens: 20
    });
    res.json({
      success: true,
      message: 'Conexión OpenAI correcta',
      data: { reply: r.choices[0]?.message?.content || 'OK' }
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Falló la prueba de API'
    });
  }
});

module.exports = router;
