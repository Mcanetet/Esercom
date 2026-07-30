const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db/tenants');

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const company = config.getCompany(payload.empresa);
    if (!company) {
      return res.status(401).json({ success: false, message: 'Empresa inválida en sesión' });
    }

    const db = getDb(payload.empresa);
    const user = await db.prepare(`
      SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, u.rol_id, u.departamento_id, u.activo,
             u.flag_checklist, u.flag_flota, u.flag_ssgg, u.flag_camion_pluma, u.flag_aprobador_salida,
             r.nombre AS rol, r.paginas_permitidas, d.nombre AS departamento
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      LEFT JOIN departamentos d ON d.id = u.departamento_id
      WHERE u.id = ? AND u.activo = 1
    `).get(payload.userId);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no válido' });
    }

    let paginas = ['*'];
    try {
      paginas = JSON.parse(user.paginas_permitidas || '["*"]');
    } catch (_) { /* keep default */ }

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
        flag_aprobador_salida: !!user.flag_aprobador_salida
      }
    };
    req.db = db;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sesión expirada o inválida' });
  }
}

module.exports = { authRequired };
