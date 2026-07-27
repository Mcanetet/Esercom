const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db/tenants');

const router = express.Router();

router.get('/empresas', (_req, res) => {
  res.json({
    success: true,
    empresas: config.companies.map((c) => ({
      slug: c.slug,
      name: c.name,
      razonSocial: c.razonSocial,
      color: c.color
    }))
  });
});

router.post('/login', (req, res) => {
  try {
    const { empresa, email, password, remember } = req.body || {};

    if (!empresa || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Empresa, correo y contraseña son requeridos'
      });
    }

    const company = config.getCompany(empresa);
    if (!company) {
      return res.status(400).json({ success: false, message: 'Empresa no válida' });
    }

    let db;
    try {
      db = getDb(company.slug);
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: 'Base de datos no disponible. Ejecute npm run init-db'
      });
    }

    const user = db.prepare(`
      SELECT u.id, u.nombre, u.apellido, u.email, u.password, u.cargo, u.rol_id,
             u.departamento_id, u.fecha_creacion, u.telefono,
             r.nombre AS rol, r.paginas_permitidas, d.nombre AS departamento
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      LEFT JOIN departamentos d ON d.id = u.departamento_id
      WHERE lower(u.email) = lower(?) AND u.activo = 1
    `).get(String(email).trim());

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }

    db.prepare(`UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?`).run(user.id);

    let paginas = ['*'];
    try {
      paginas = JSON.parse(user.paginas_permitidas || '["*"]');
    } catch (_) { /* default */ }

    const expiresIn = remember ? '30d' : config.jwtExpiresIn;
    const token = jwt.sign(
      { userId: user.id, empresa: company.slug, email: user.email },
      config.jwtSecret,
      { expiresIn }
    );

    const userData = {
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      nombreCompleto: `${user.nombre} ${user.apellido}`.trim(),
      email: user.email,
      rol: user.rol || 'Usuario',
      rol_id: user.rol_id,
      cargo: user.cargo || user.rol || 'Usuario',
      telefono: user.telefono || '',
      departamento: user.departamento || 'Sin departamento',
      departamento_id: user.departamento_id,
      estado: 'Activo',
      fechaCreacion: user.fecha_creacion,
      paginas_permitidas: paginas,
      empresa: company.slug,
      empresaNombre: company.name,
      empresaRazonSocial: company.razonSocial
    };

    return res.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      token,
      user: userData
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

router.get('/me', require('../middleware/auth').authRequired, (req, res) => {
  res.json({ success: true, user: req.auth.user });
});

module.exports = router;
