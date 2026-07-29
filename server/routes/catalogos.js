const express = require('express');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/materiales', (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = req.db.prepare(`
      SELECT id, codigo, nombre, descripcion, unidad, precio, stock
      FROM materiales
      WHERE activo = 1 AND (codigo LIKE ? OR nombre LIKE ? OR descripcion LIKE ?)
      ORDER BY nombre LIMIT 50
    `).all(like, like, like);
  } else {
    rows = req.db.prepare(`
      SELECT id, codigo, nombre, descripcion, unidad, precio, stock
      FROM materiales WHERE activo = 1 ORDER BY nombre LIMIT 200
    `).all();
  }
  res.json({ success: true, data: rows });
});

router.get('/cecos', (req, res) => {
  const rows = req.db.prepare(`
    SELECT c.id, c.codigo, c.nombre, c.descripcion, c.jefe_proyecto_id,
           u.nombre || ' ' || u.apellido AS jefe_proyecto
    FROM cecos c
    LEFT JOIN usuarios u ON u.id = c.jefe_proyecto_id
    WHERE c.activo = 1
    ORDER BY c.codigo
  `).all();
  res.json({ success: true, data: rows });
});

router.get('/bodegas', (req, res) => {
  const rows = req.db.prepare(`
    SELECT id, codigo, nombre, ubicacion FROM bodegas WHERE activo = 1 ORDER BY nombre
  `).all();
  res.json({ success: true, data: rows });
});

router.get('/estados', (req, res) => {
  const rows = req.db.prepare(`
    SELECT id, nombre, descripcion, color, orden
    FROM estados_solicitud WHERE activo = 1 ORDER BY orden
  `).all();
  res.json({ success: true, data: rows });
});

router.get('/usuarios', (req, res) => {
  const flag = String(req.query.flag || '').trim();
  const allowed = {
    checklist: 'flag_checklist',
    flota: 'flag_flota',
    ssgg: 'flag_ssgg',
    camion_pluma: 'flag_camion_pluma',
    aprobador_salida: 'flag_aprobador_salida'
  };
  let sql = `
    SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, u.telefono, u.rol_id, u.departamento_id,
           u.flag_checklist, u.flag_flota, u.flag_ssgg, u.flag_camion_pluma, u.flag_aprobador_salida,
           r.nombre AS rol, d.nombre AS departamento
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
    LEFT JOIN departamentos d ON d.id = u.departamento_id
    WHERE u.activo = 1
  `;
  if (flag && allowed[flag]) {
    sql += ` AND u.${allowed[flag]} = 1`;
  }
  sql += ' ORDER BY u.nombre, u.apellido';
  const rows = req.db.prepare(sql).all();
  res.json({ success: true, data: rows });
});

router.get('/proveedores', (req, res) => {
  const rows = req.db.prepare(`
    SELECT id, razon_social, rut, email, telefono
    FROM proveedores WHERE activo = 1 ORDER BY razon_social
  `).all();
  res.json({ success: true, data: rows });
});

router.get('/dashboard', (req, res) => {
  const pendientes = req.db.prepare(`
    SELECT COUNT(*) AS c FROM solicitudes_materiales
    WHERE eliminado = 0 AND estado_id IN (1, 2, 3, 4, 5)
  `).get().c;
  const cerradas = req.db.prepare(`
    SELECT COUNT(*) AS c FROM solicitudes_materiales WHERE eliminado = 0 AND estado_id = 6
  `).get().c;
  const materiales = req.db.prepare(`SELECT COUNT(*) AS c FROM materiales WHERE activo = 1`).get().c;
  const usuarios = req.db.prepare(`SELECT COUNT(*) AS c FROM usuarios WHERE activo = 1`).get().c;
  const recientes = req.db.prepare(`
    SELECT s.id, s.codigo, s.fecha_solicitud, s.numero_proyecto, e.nombre AS estado, e.color,
           u.nombre || ' ' || u.apellido AS solicitante
    FROM solicitudes_materiales s
    JOIN estados_solicitud e ON e.id = s.estado_id
    JOIN usuarios u ON u.id = s.solicitante_id
    WHERE s.eliminado = 0
    ORDER BY s.id DESC LIMIT 5
  `).all();

  res.json({
    success: true,
    data: {
      pendientes,
      cerradas,
      materiales,
      usuarios,
      recientes,
      empresa: req.auth.company
    }
  });
});

module.exports = router;
