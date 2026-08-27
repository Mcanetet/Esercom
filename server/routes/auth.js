const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db/tenants');
const { createRateLimiter } = require('../middleware/rate-limit');

const router = express.Router();
const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 8, message: 'Demasiados intentos de login. Espera 1 minuto.' });
const portalLimiter = createRateLimiter({ windowMs: 60_000, max: 5, message: 'Demasiados intentos. Espera 1 minuto.' });
const recoverLimiter = createRateLimiter({ windowMs: 60_000, max: 5, message: 'Demasiados intentos de recuperación.' });

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function buildUserData(user, company) {
  let paginas = [];
  try {
    if (Array.isArray(user.paginas_permitidas)) paginas = user.paginas_permitidas;
    else if (user.paginas_permitidas) paginas = JSON.parse(user.paginas_permitidas);
  } catch (_) { /* deny by default */ }
  if (!Array.isArray(paginas)) paginas = [];
  const isAdmin = Number(user.rol_id) === 1
    || (Array.isArray(user.rol_ids) && user.rol_ids.map(Number).includes(1));
  if (!paginas.length && isAdmin) paginas = ['*'];

  const { parseEmpresasAcceso } = require('../services/usuario-empresas');
  const empresasAcceso = parseEmpresasAcceso(user.empresas_acceso);
  const empresasFinal = empresasAcceso.length ? empresasAcceso : [company.slug];

  return {
    id: user.id,
    nombre: user.nombre,
    apellido: user.apellido,
    nombreCompleto: `${user.nombre} ${user.apellido}`.trim(),
    email: user.email,
    rol: user.rol || 'Usuario',
    rol_id: user.rol_id,
    rol_ids: Array.isArray(user.rol_ids) ? user.rol_ids : (user.rol_id ? [Number(user.rol_id)] : []),
    roles: Array.isArray(user.roles) ? user.roles : (user.rol ? [user.rol] : []),
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
    empresas_acceso: empresasFinal,
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

function signAngelTrainToken(company, remember) {
  const expiresIn = remember ? '8h' : '2h';
  return jwt.sign(
    { scope: 'angel_train', empresa: company.slug },
    config.jwtSecret,
    { expiresIn }
  );
}

async function loadUserByEmail(db, email) {
  const emailNorm = String(email).trim();
  const base = `
    SELECT u.id, u.nombre, u.apellido, u.email, u.password, u.cargo, u.rol_id,
           u.departamento_id, u.fecha_creacion, u.telefono,
           u.flag_checklist, u.flag_flota, u.flag_ssgg, u.flag_camion_pluma, u.flag_aprobador_salida,
           r.nombre AS rol, r.paginas_permitidas, d.nombre AS departamento
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
    LEFT JOIN departamentos d ON d.id = u.departamento_id
    WHERE LOWER(u.email) = LOWER(?) AND u.activo = 1
  `;
  try {
    return await db.prepare(`
      SELECT u.id, u.nombre, u.apellido, u.email, u.password, u.cargo, u.rol_id,
             u.departamento_id, u.fecha_creacion, u.telefono,
             u.flag_checklist, u.flag_flota, u.flag_ssgg, u.flag_camion_pluma, u.flag_aprobador_salida,
             u.empresas_acceso,
             r.nombre AS rol, r.paginas_permitidas, d.nombre AS departamento
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      LEFT JOIN departamentos d ON d.id = u.departamento_id
      WHERE LOWER(u.email) = LOWER(?) AND u.activo = 1
    `).get(emailNorm);
  } catch (err) {
    if (!/Unknown column|no such column|empresas_acceso/i.test(err.message || '')) throw err;
    const row = await db.prepare(base).get(emailNorm);
    if (row) row.empresas_acceso = null;
    return row;
  }
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

router.post('/login', loginLimiter, async (req, res) => {
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

    const rawUser = await loadUserByEmail(db, email);
    let hash = rawUser ? String(rawUser.password || '') : '';
    if (hash.startsWith('$2y$')) hash = '$2a$' + hash.slice(4);

    if (!rawUser || !hash || !bcrypt.compareSync(password, hash)) {
      return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }

    const { userCanAccessEmpresa } = require('../services/usuario-empresas');
    if (!userCanAccessEmpresa(rawUser, company.slug)) {
      return res.status(403).json({
        success: false,
        message: 'Tu usuario no tiene acceso a esta empresa. Elige otra en el selector o pide acceso al administrador.'
      });
    }

    const { enrichUserRoles } = require('../services/usuario-roles');
    const user = await enrichUserRoles(db, rawUser);

    try {
      await db.prepare(`UPDATE usuarios SET ultimo_acceso = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"} WHERE id = ?`).run(user.id);
    } catch (_) { /* columna opcional */ }

    const userData = buildUserData(user, company);
    try {
      const { getEmpresaModulos } = require('../services/empresa-modulos');
      const mods = await getEmpresaModulos(db);
      userData.modulos_empresa = mods.visibles;
      userData.modulos_empresa_configured = mods.configured;
      userData.modulos_compartidos = mods.compartidos || [];
    } catch (_) {
      userData.modulos_empresa = null;
      userData.modulos_compartidos = [];
    }
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
router.post('/acceso-sistema', portalLimiter, async (req, res) => {
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

    const rawUser = await loadAdminUser(db, company);
    if (!rawUser) {
      return res.status(404).json({
        success: false,
        message: 'No hay usuario administrador en esta empresa'
      });
    }

    const { enrichUserRoles } = require('../services/usuario-roles');
    const user = await enrichUserRoles(db, rawUser);

    try {
      await db.prepare(`UPDATE usuarios SET ultimo_acceso = ${db.driver === 'mysql' ? 'NOW()' : "datetime('now')"} WHERE id = ?`).run(user.id);
    } catch (_) { /* ignore */ }

    const userData = buildUserData(user, company);
    userData.acceso_portal = true;
    try {
      const { getEmpresaModulos } = require('../services/empresa-modulos');
      const mods = await getEmpresaModulos(db);
      userData.modulos_empresa = mods.visibles;
      userData.modulos_empresa_configured = mods.configured;
      userData.modulos_compartidos = mods.compartidos || [];
    } catch (_) { /* */ }
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

/**
 * Clona estructura SERCOM → BDs de Global/Nexus/Táctica/Intercanje.
 * Protegido con ADMIN_PORTAL_PASSWORD. Solo MySQL multiempresa.
 */
router.post('/clone-company-dbs', portalLimiter, async (req, res) => {
  try {
    const portalPass = config.adminPortalPassword;
    if (!portalPass) {
      return res.status(503).json({ success: false, message: 'ADMIN_PORTAL_PASSWORD no configurado' });
    }
    const clave = String(req.body?.clave || req.headers['x-admin-clave'] || '');
    if (!clave || !safeEqual(clave, portalPass)) {
      return res.status(401).json({ success: false, message: 'Clave de administrador incorrecta' });
    }
    if (!config.isMysql) {
      return res.status(400).json({ success: false, message: 'Solo disponible con DB_DRIVER=mysql' });
    }
    if (!config.mysqlPerCompany) {
      return res.status(400).json({
        success: false,
        message: 'Active DB_PER_COMPANY=1 y DB_NAME_GLOBAL / DB_NAME_NEXUS / etc. en el servidor, reinicie, y reintente.'
      });
    }
    const only = req.body?.only;
    const { cloneCompanyDatabases } = require('../services/clone-company-dbs');
    const result = await cloneCompanyDatabases({
      only: Array.isArray(only) ? only : (typeof only === 'string' ? only.split(',') : null)
    });
    return res.json({ success: !!result.ok, data: result });
  } catch (err) {
    console.error('clone-company-dbs', err);
    return res.status(500).json({ success: false, message: err.message || 'Error al clonar' });
  }
});

/** Lista BDs visibles para el usuario MySQL (diagnóstico multiempresa). */
router.post('/list-mysql-dbs', portalLimiter, async (req, res) => {
  try {
    const portalPass = config.adminPortalPassword;
    const clave = String(req.body?.clave || req.headers['x-admin-clave'] || '');
    if (!portalPass || !clave || !safeEqual(clave, portalPass)) {
      return res.status(401).json({ success: false, message: 'Clave de administrador incorrecta' });
    }
    if (!config.isMysql) {
      return res.status(400).json({ success: false, message: 'Solo MySQL' });
    }
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password
    });
    const [rows] = await conn.query('SHOW DATABASES');
    await conn.end();
    const databases = rows.map((r) => Object.values(r)[0]).filter(Boolean);
    const expected = Object.fromEntries(
      config.companies.map((c) => [c.slug, config.mysqlDatabaseFor(c.slug)])
    );
    const access = {};
    for (const [slug, name] of Object.entries(expected)) {
      access[slug] = { database: name, visible: databases.includes(name) };
    }
    return res.json({
      success: true,
      data: {
        user: config.mysql.user,
        databases,
        expected,
        access,
        hint: 'Si visible=false, en cPanel → MySQL Databases asigna el usuario a esa BD (ALL PRIVILEGES).'
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Replica admins/subadmins core en todas las BDs de empresa.
 * Body: { clave } (ADMIN_PORTAL_PASSWORD)
 */
router.post('/sync-core-admins', portalLimiter, async (req, res) => {
  try {
    const portalPass = config.adminPortalPassword;
    const clave = String(req.body?.clave || req.headers['x-admin-clave'] || '');
    if (!portalPass || !clave || !safeEqual(clave, portalPass)) {
      return res.status(401).json({ success: false, message: 'Clave de administrador incorrecta' });
    }
    if (!config.isMysql || !config.mysqlPerCompany) {
      return res.status(400).json({
        success: false,
        message: 'Requiere DB_DRIVER=mysql y DB_PER_COMPANY=1'
      });
    }
    const { syncCoreAdmins } = require('../services/clone-company-dbs');
    const result = await syncCoreAdmins();
    return res.json({ success: !!result.ok, data: result });
  } catch (err) {
    console.error('sync-core-admins', err);
    return res.status(500).json({ success: false, message: err.message || 'Error sync admins' });
  }
});

/** Acceso exclusivo entrenamiento Angel IA — URL oculta, no aparece en menú */
router.post('/acceso-angel', portalLimiter, async (req, res) => {
  try {
    const { empresa, clave, remember } = req.body || {};
    const trainPass = config.angelTrainPassword;

    if (!trainPass) {
      return res.status(503).json({
        success: false,
        message: 'Entrenamiento Angel IA no configurado. Defina ANGEL_TRAIN_PASSWORD en el servidor.'
      });
    }

    if (!empresa || !clave) {
      return res.status(400).json({
        success: false,
        message: 'Empresa y clave de entrenamiento son requeridos'
      });
    }

    if (!safeEqual(String(clave), trainPass)) {
      return res.status(401).json({ success: false, message: 'Clave de entrenamiento incorrecta' });
    }

    const company = config.getCompany(empresa);
    if (!company) {
      return res.status(400).json({ success: false, message: 'Empresa no válida' });
    }

    try {
      getDb(company.slug);
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: 'Base de datos no disponible'
      });
    }

    const token = signAngelTrainToken(company, remember);

    return res.json({
      success: true,
      message: 'Acceso a entrenamiento Angel IA concedido',
      token,
      empresa: company.slug,
      empresaNombre: company.name,
      redirect: '/angel-entrenamiento.html'
    });
  } catch (err) {
    console.error('acceso-angel error', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

router.get('/me', require('../middleware/auth').authRequired, (req, res) => {
  res.json({ success: true, user: req.auth.user });
});

/** Paso 1: envía código de 6 dígitos al correo del usuario */
router.post('/recuperar/enviar-codigo', recoverLimiter, async (req, res) => {
  try {
    const { empresa, email } = req.body || {};
    if (!empresa || !email) {
      return res.status(400).json({ success: false, message: 'Empresa y correo son requeridos' });
    }
    const company = config.getCompany(empresa);
    if (!company) {
      return res.status(400).json({ success: false, message: 'Empresa no válida' });
    }
    let db;
    try {
      db = getDb(company.slug);
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Base de datos no disponible' });
    }
    const { enviarCodigoRecuperacion } = require('../services/password-reset');
    const result = await enviarCodigoRecuperacion(db, {
      email: String(email).trim(),
      empresaNombre: company.name
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('recuperar/enviar-codigo', err);
    return res.status(500).json({ success: false, message: 'No se pudo procesar la solicitud' });
  }
});

/** Paso 2: valida código y guarda la nueva contraseña */
router.post('/recuperar/restablecer', recoverLimiter, async (req, res) => {
  try {
    const { empresa, email, codigo, password_nueva, password_confirmar } = req.body || {};
    if (!empresa || !email || !codigo || !password_nueva) {
      return res.status(400).json({
        success: false,
        message: 'Complete empresa, correo, código y nueva contraseña'
      });
    }
    if (String(password_nueva) !== String(password_confirmar || password_nueva)) {
      return res.status(400).json({ success: false, message: 'La confirmación no coincide' });
    }
    const company = config.getCompany(empresa);
    if (!company) {
      return res.status(400).json({ success: false, message: 'Empresa no válida' });
    }
    let db;
    try {
      db = getDb(company.slug);
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Base de datos no disponible' });
    }
    const { restablecerConCodigo } = require('../services/password-reset');
    const result = await restablecerConCodigo(db, {
      email: String(email).trim(),
      codigo: String(codigo).trim(),
      passwordNueva: String(password_nueva)
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('recuperar/restablecer', err);
    return res.status(500).json({ success: false, message: 'No se pudo restablecer la contraseña' });
  }
});

/** Cambio de contraseña del usuario autenticado (perfil propio) */
router.post('/cambiar-password', require('../middleware/auth').authRequired, async (req, res) => {
  try {
    const actual = String(req.body?.password_actual || req.body?.actual || '').trim();
    const nueva = String(req.body?.password_nueva || req.body?.nueva || '').trim();
    const confirmar = String(req.body?.password_confirmar || req.body?.confirmar || nueva).trim();

    if (!actual || !nueva) {
      return res.status(400).json({
        success: false,
        message: 'Ingrese la contraseña actual y la nueva'
      });
    }
    if (nueva.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener al menos 6 caracteres'
      });
    }
    if (nueva !== confirmar) {
      return res.status(400).json({
        success: false,
        message: 'La confirmación no coincide con la nueva contraseña'
      });
    }
    if (actual === nueva) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe ser distinta a la actual'
      });
    }

    const db = req.db;
    const userId = req.auth.userId;
    const row = await db.prepare(`
      SELECT id, password FROM usuarios WHERE id = ? AND (activo = 1 OR activo IS NULL)
    `).get(userId);

    if (!row || !row.password) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    let hash = String(row.password);
    // Compatibilidad hashes PHP ($2y$)
    if (hash.startsWith('$2y$')) hash = '$2a$' + hash.slice(4);

    if (!bcrypt.compareSync(actual, hash)) {
      return res.status(401).json({ success: false, message: 'La contraseña actual es incorrecta' });
    }

    const newHash = bcrypt.hashSync(nueva, 10);
    await db.prepare(`UPDATE usuarios SET password = ? WHERE id = ?`).run(newHash, userId);

    return res.json({
      success: true,
      message: 'Contraseña actualizada correctamente'
    });
  } catch (err) {
    console.error('cambiar-password error', err);
    return res.status(500).json({ success: false, message: 'No se pudo cambiar la contraseña' });
  }
});

module.exports = router;
