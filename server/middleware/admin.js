function adminRequired(req, res, next) {
  const rol = String(req.auth?.user?.rol || '').toLowerCase();
  const cargo = String(req.auth?.user?.cargo || '').toLowerCase();
  const ok =
    rol.includes('admin') ||
    rol.includes('administrador') ||
    cargo.includes('admin') ||
    req.auth?.user?.rol_id === 1;

  if (!ok) {
    return res.status(403).json({
      success: false,
      message: 'Acceso restringido: solo administradores (seguridad Angel IA)'
    });
  }
  next();
}

module.exports = { adminRequired };
