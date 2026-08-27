/**
 * Registra rutas /api/modulos/catalogo-{letra} para un módulo de catálogo.
 */
function registerCatalogoLetraRoutes(router, {
  letter,
  slug,
  isAdminUser,
  hasPermisoEspecial
}) {
  const L = String(letter).toUpperCase();
  const l = L.toLowerCase();
  const api = `catalogo-${l}`;
  const page = `catalogo-${l}.html`;
  const svc = require(`../services/catalogo-${l}`);
  const ESTADOS = svc.ESTADOS;
  const listItems = svc[`listCatalogo${L}`];
  const listBodegas = svc[`listBodegasCatalogo${L}`];
  const buildStats = svc.buildStats;
  const createItem = svc[`createCatalogo${L}`];
  const updateItem = svc[`updateCatalogo${L}`];
  const deleteItem = svc[`deleteCatalogo${L}`];
  const savePhoto = svc[`saveCatalogo${L}Photo`];
  const analyzePhoto = svc[`analyzeCatalogo${L}Photo`];
  const findDuplicatesByHash = svc.findDuplicatesByHash;
  const ensureSchema = svc[`ensureCatalogo${L}Schema`];
  const normalizeFotosList = svc.normalizeFotosList;
  const suggestFromPhoto = svc[`suggestFromCatalogo${L}Photo`];
  const buildPlantilla = svc[`buildPlantillaCatalogo${L}`];
  const importExcel = svc[`importCatalogo${L}Excel`];
  const decodeUpload = svc.decodeUploadBody;

  function denyUnlessEmpresa(req, res) {
    if (String(req.auth?.empresa || '').toLowerCase() === slug) return false;
    res.status(403).json({
      success: false,
      message: `Catálogo ${L} solo está disponible para la empresa ${slug}`
    });
    return true;
  }

  function isCatalogoRole(user) {
    const names = [
      user?.rol,
      ...(Array.isArray(user?.roles) ? user.roles : [])
    ].join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    return new RegExp(`catalogo\\s*${l}`).test(names);
  }

  async function canEdit(req) {
    const user = req.auth?.user;
    if (isAdminUser(user)) return true;
    if (isCatalogoRole(user)) return true;
    return hasPermisoEspecial(req.db, user, `catalogo_${l}_editor`);
  }

  async function resolveFotos(db, body, excludeId) {
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
      const analysis = await analyzePhoto(db, p.dataUrl, { excludeId, checkAngel: false });
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
      const saved = savePhoto(p.dataUrl, analysis);
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

  router.get(`/${api}`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    try {
      const data = await listItems(req.db);
      const bodegas = await listBodegas(req.db);
      const can_edit = await canEdit(req);
      res.json({
        success: true,
        data,
        stats: buildStats(data),
        bodegas,
        can_edit,
        estados: ESTADOS
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  router.get(`/${api}/plantilla`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    try {
      const bodegas = await listBodegas(req.db);
      const buf = await buildPlantilla(bodegas);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=plantilla_catalogo_${l}.xlsx`);
      res.send(Buffer.from(buf));
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  router.post(`/${api}/import-excel`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    if (!(await canEdit(req))) {
      return res.status(403).json({ success: false, message: 'No autorizado a cargar inventario Excel' });
    }
    try {
      const buffer = decodeUpload(req.body || {});
      const result = await importExcel(req.db, buffer, req.auth.userId, {
        filename: req.body?.filename || req.body?.nombre || `catalogo_${l}.xlsx`
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  router.post(`/${api}/upload-foto`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    if (!(await canEdit(req))) {
      return res.status(403).json({ success: false, message: 'Solo analistas de compra autorizados pueden subir fotos' });
    }
    try {
      const excludeId = req.body?.exclude_id ? Number(req.body.exclude_id) : null;
      const checkAngel = req.body?.check_angel === true || req.body?.check_angel === 1 || req.body?.check_angel === '1';
      const analysis = await analyzePhoto(req.db, req.body?.dataUrl, {
        excludeId,
        checkAngel,
        angelTimeoutMs: 8000
      });
      const saved = savePhoto(req.body?.dataUrl, analysis);
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

  router.post(`/${api}/sugerir-foto`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    if (!(await canEdit(req))) {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }
    try {
      const dataUrl = req.body?.dataUrl;
      if (!dataUrl) return res.status(400).json({ success: false, message: 'Falta la foto' });
      const suggestion = await suggestFromPhoto(req.db, dataUrl, {
        tipo: req.body?.tipo === 'marca' ? 'marca' : 'articulo',
        timeoutMs: 12000
      });
      if (!suggestion?.ok) {
        return res.json({ success: true, sugerido: false, message: suggestion?.message || 'Sin sugerencia' });
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
      console.error(`[catalogo-${l} sugerir-foto]`, err);
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  router.post(`/${api}/check-foto`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    if (!(await canEdit(req))) {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }
    try {
      await ensureSchema(req.db);
      const excludeId = req.body?.exclude_id ? Number(req.body.exclude_id) : null;
      if (req.body?.hash && !req.body?.dataUrl) {
        const hash = String(req.body.hash).trim().toLowerCase();
        let duplicados = [];
        try { duplicados = await findDuplicatesByHash(req.db, hash, excludeId); } catch (_) { duplicados = []; }
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
            id: d.id, codigo: d.codigo, correlativo: d.correlativo, descripcion: d.descripcion, foto: d.foto
          })),
          fuente: 'hash'
        });
      }
      const analysis = await analyzePhoto(req.db, req.body?.dataUrl, {
        excludeId, checkAngel: false, angelTimeoutMs: 8000
      });
      res.json({
        success: true,
        alerta_foto: !!analysis.alerta,
        nivel: analysis.nivel || null,
        mensaje: analysis.alerta ? (analysis.mensaje || 'Artículo duplicado — revisar') : 'OK',
        hash: analysis.hash,
        duplicados: (analysis.duplicados || []).map((d) => ({
          id: d.id, codigo: d.codigo, correlativo: d.correlativo, descripcion: d.descripcion, foto: d.foto
        })),
        fuente: analysis.fuente || null
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  router.post(`/${api}`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    if (!(await canEdit(req))) {
      return res.status(403).json({ success: false, message: 'Solo analistas de compra autorizados pueden crear ítems' });
    }
    try {
      const body = { ...(req.body || {}) };
      const fotos = await resolveFotos(req.db, body, null);
      if (fotos.error) return res.status(409).json(fotos.error);
      body.fotos = fotos.list;
      if (fotos.list.length) {
        body.foto = fotos.list.find((f) => f.tipo === 'articulo')?.ruta || fotos.list[0].ruta;
        body.foto_hash = fotos.list.find((f) => f.tipo === 'articulo')?.hash || fotos.list[0].hash;
      }
      const data = await createItem(req.db, req.auth.userId, body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      console.error(`[catalogo-${l} POST]`, err);
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  router.post(`/${api}/:id`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    if (!(await canEdit(req))) {
      return res.status(403).json({ success: false, message: 'Solo analistas de compra autorizados pueden editar' });
    }
    try {
      const body = { ...(req.body || {}) };
      const id = Number(req.params.id);
      const fotos = await resolveFotos(req.db, body, id);
      if (fotos.error) return res.status(409).json(fotos.error);
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
      const data = await updateItem(req.db, id, req.auth.userId, body);
      res.json({ success: true, data });
    } catch (err) {
      console.error(`[catalogo-${l} POST :id]`, err);
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  router.post(`/${api}/:id/eliminar`, async (req, res) => {
    if (denyUnlessEmpresa(req, res)) return;
    if (!(await canEdit(req))) {
      return res.status(403).json({ success: false, message: 'Solo analistas de compra autorizados pueden eliminar' });
    }
    try {
      await deleteItem(req.db, Number(req.params.id), req.auth.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  return { api, page };
}

module.exports = { registerCatalogoLetraRoutes };
