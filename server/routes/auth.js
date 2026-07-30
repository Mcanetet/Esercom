const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db/tenants');

const router = express.Router();

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function buildUserData(user, company) {
  let paginas = ['*'];
  try {
    paginas = JSON.parse(user.paginas_permitidas || '["*"]');
  } catch (_) { /* default */ }

  return {
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
    empresaRazonSocial: company.razonSocial,
    flag_checklist: !!user.flag_checklist,
    flag_flota: !!user.flag_flota,
    flag_ssgg: !!user.flag_ssgg,
    flag_camion_pluma: !!user.flag_camion_pluma,
    flag_aprobador_salida: !!user.flag_aprobador_salida
  };
}

function signToken(user, company, remember) {
  const expiresIn = remember ? '30d' : config.jwtExpiresIn;
  return jwt.sign(
    { userId: user.id, empresa: company.slug, email: user.email },
    config.jwtSecret,
    { expiresIn }
  );
}

async function loadUserByEmail(db, email) {
  return db.prepare(`
    SELECT u.id, u.nombre, u.apellido, u.email, u.password, u.cargo, u.rol_id,
           u.departamento_id, u.fecha_creacion, u.telefono,
           u.flag_checklist, u.flag_flota, u.flag_ssgg, u.flag_camion_pluma, u.flag_aprobador_salida,
           r.nombre AS rol, r.paginas_permitidas, d.nombre AS departamento
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
    LEFT JOIN departamentos d ON d.id = u.departamento_id
    WHERE LOWER(u.email) = LOWER(?) AND u.activo = 1
  `).get(String(email).trim());
}

async function loadAdminUser(db, company) {
  const adminEmail = `admin@${company.emailDomain}`;
  let user = await loadUserByEmail(db, adminEmail);
  if (!user) {
    user = await db.prepare(`
      SELECT u.id, u.nombre, u.apellido, u.email, u.password, u.cargo, u.rol_id,
             u.departamento_id, u.fecha_creacion, u.telefono,
             u.flag_checklist, u.flag_flota, u.flag_ssgg, u.flag_camion_pluma, u.flag_aprobador_salida,
             r.nombre AS rol, r.paginas_permitidas, d.nombre AS departamento
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      LEFT JOIN departamentos d ON d.id = u.departamento_id
      WHERE u.rol_id = 1 AND u.activo = 1
      ORDER BY u.id
      LIMIT 1
    `).get();
  }
  return user;
}

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

router.post('/login', async (req, res) => {
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

    const user = await loadUserByEmail(db, email);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }

    await db.prepare(`UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?`).run(user.id);

    const userData = buildUserData(user, company);
    const token = signToken(user, company, remember);

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

/** Acceso administrador por URL dedicada + clave maestra (ADMIN_PORTAL_PASSWORD) */
router.post('/acceso-sistema', async (req, res) => {
  try {
    const { empresa, clave, remember } = req.body || {};
    const portalPass = config.adminPortalPassword;

    if (!portalPass) {
      return res.status(503).json({
        success: false,
        message: 'Acceso sistema no configurado. Defina ADMIN_PORTAL_PASSWORD en el servidor.'
      });
    }

    if (!empresa || !clave) {
      return res.status(400).json({
        success: false,
        message: 'Empresa y clave de administrador son requeridos'
      });
    }

    if (!safeEqual(String(clave), portalPass)) {
      return res.status(401).json({ success: false, message: 'Clave de administrador incorrecta' });
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

    const user = await loadAdminUser(db, company);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No hay usuario administrador en esta empresa'
      });
    }

    await db.prepare(`UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?`).run(user.id);

    const userData = buildUserData(user, company);
    userData.acceso_portal = true;
    const token = signToken(user, company, remember);

    return res.json({
      success: true,
      message: 'Acceso administrador concedido',
      token,
      user: userData,
      redirect: '/panel-admin.html'
    });
  } catch (err) {
    console.error('acceso-sistema error', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

router.get('/me', require('../middleware/auth').authRequired, (req, res) => {
  res.json({ success: true, user: req.auth.user });
});

module.exports = router;
