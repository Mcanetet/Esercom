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
  const rows = req.db.prepare(`
    SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, r.nombre AS rol
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
    WHERE u.activo = 1
    ORDER BY u.nombre
  `).all();
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
