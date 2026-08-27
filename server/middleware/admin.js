function adminRequired(req, res, next) {
  const user = req.auth?.user;
  const rolId = Number(user?.rol_id);
  const rolIds = Array.isArray(user?.rol_ids) ? user.rol_ids.map(Number) : [];
  const names = [
    user?.rol,
    ...(Array.isArray(user?.roles) ? user.roles : [])
  ]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const ok =
    rolId === 1 ||
    rolIds.includes(1) ||
    /(^|\b)(administrador|administrator|super\s*admin)\b/.test(names);

  if (!ok) {
    return res.status(403).json({
      success: false,
      message: 'Acceso restringido: solo administradores'
    });
  }
  next();
}

module.exports = { adminRequired };
