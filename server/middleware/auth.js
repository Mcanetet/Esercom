const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db/tenants');
const { enrichUserRoles } = require('../services/usuario-roles');

async function loadAuthUser(db, userId) {
  const withFlags = `
    SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, u.rol_id, u.departamento_id, u.activo,
           u.flag_checklist, u.flag_flota, u.flag_ssgg, u.flag_camion_pluma, u.flag_aprobador_salida,
           r.nombre AS rol, r.paginas_permitidas, d.nombre AS departamento
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
    LEFT JOIN departamentos d ON d.id = u.departamento_id
    WHERE u.id = ? AND (u.activo = 1 OR u.activo IS NULL)
  `;
  const withoutFlags = `
    SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, u.rol_id, u.departamento_id, u.activo,
           0 AS flag_checklist, 0 AS flag_flota, 0 AS flag_ssgg, 0 AS flag_camion_pluma, 0 AS flag_aprobador_salida,
           r.nombre AS rol, r.paginas_permitidas, d.nombre AS departamento
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
    LEFT JOIN departamentos d ON d.id = u.departamento_id
    WHERE u.id = ? AND (u.activo = 1 OR u.activo IS NULL)
  `;
  const bare = `
    SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, u.rol_id, u.departamento_id, u.activo,
           0 AS flag_checklist, 0 AS flag_flota, 0 AS flag_ssgg, 0 AS flag_camion_pluma, 0 AS flag_aprobador_salida,
           r.nombre AS rol, r.permisos AS paginas_permitidas, NULL AS departamento
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
    WHERE u.id = ? AND (u.activo = 1 OR u.activo IS NULL)
  `;

  try {
    return await db.prepare(withFlags).get(userId);
  } catch (err) {
    console.warn('[auth] withFlags:', err.message);
    try {
      return await db.prepare(withoutFlags).get(userId);
    } catch (err2) {
      console.warn('[auth] withoutFlags:', err2.message);
      return db.prepare(bare).get(userId);
    }
  }
}

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  // Fallback si Apache/Passenger no reenvía Authorization
  if (!token) {
    const alt = req.headers['x-auth-token'];
    if (alt) token = String(alt);
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.scope === 'angel_train') {
      return res.status(401).json({
        success: false,
        message: 'Token de entrenamiento Angel; use el portal /acceso-angel.html'
      });
    }
    const company = config.getCompany(payload.empresa);
    if (!company) {
      return res.status(401).json({ success: false, message: 'Empresa inválida en sesión' });
    }

    const userId = Number(payload.userId);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Sesión inválida (sin usuario)' });
    }

    const db = getDb(payload.empresa);
    const rawUser = await loadAuthUser(db, userId);

    if (!rawUser) {
      return res.status(401).json({ success: false, message: 'Usuario no válido' });
    }

    let user;
    try {
      user = await enrichUserRoles(db, rawUser);
    } catch (e) {
      console.warn('[auth] enrichUserRoles:', e.message);
      user = rawUser;
    }

    let paginas = [];
    try {
      const raw = user.paginas_permitidas;
      if (raw == null || raw === '') paginas = [];
      else if (typeof raw === 'object') paginas = raw;
      else paginas = JSON.parse(raw);
      if (!Array.isArray(paginas)) paginas = [];
    } catch (_) {
      paginas = [];
    }
    // Solo admin explícito obtiene wildcard por defecto si el rol viene vacío
    const isAdmin =
      Number(user.rol_id) === 1 ||
      (Array.isArray(user.rol_ids) && user.rol_ids.map(Number).includes(1));
    if (!paginas.length && isAdmin) paginas = ['*'];

    req.auth = {
      userId: user.id,
      empresa: payload.empresa,
      company,
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        nombreCompleto: `${user.nombre} ${user.apellido}`.trim(),
        email: user.email,
        rol: user.rol || 'Usuario',
        rol_id: user.rol_id,
        rol_ids: Array.isArray(user.rol_ids) ? user.rol_ids : (user.rol_id ? [Number(user.rol_id)] : []),
        roles: Array.isArray(user.roles) ? user.roles : (user.rol ? String(user.rol).split(',').map((s) => s.trim()) : []),
        cargo: user.cargo || user.rol || 'Usuario',
        departamento: user.departamento || 'Sin departamento',
        departamento_id: user.departamento_id,
        paginas_permitidas: paginas,
        empresa: payload.empresa,
        empresaNombre: company.name,
        empresaRazonSocial: company.razonSocial,
        flag_checklist: !!user.flag_checklist,
        flag_flota: !!user.flag_flota,
        flag_ssgg: !!user.flag_ssgg,
        flag_camion_pluma: !!user.flag_camion_pluma,
        flag_aprobador_salida: !!user.flag_aprobador_salida,
        modulos_empresa: null,
        modulos_compartidos: []
      }
    };
    try {
      const { getEmpresaModulos } = require('../services/empresa-modulos');
      const mods = await getEmpresaModulos(db);
      req.auth.user.modulos_empresa = mods.visibles;
      req.auth.user.modulos_empresa_configured = mods.configured;
      req.auth.user.modulos_compartidos = mods.compartidos || [];
    } catch (e) {
      console.warn('[auth] empresa_modulos:', e.message);
    }
    req.db = db;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Sesión expirada o inválida' });
    }
    console.error('authRequired', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Error al validar sesión'
    });
  }
}

module.exports = { authRequired };
