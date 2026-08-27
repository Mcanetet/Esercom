const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db/tenants');

async function angelTrainRequired(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token && req.headers['x-angel-train-token']) {
    token = String(req.headers['x-angel-train-token']);
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Sesión de entrenamiento requerida' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.scope !== 'angel_train') {
      return res.status(403).json({ success: false, message: 'Token no válido para entrenamiento' });
    }

    const company = config.getCompany(payload.empresa);
    if (!company) {
      return res.status(401).json({ success: false, message: 'Empresa inválida' });
    }

    req.db = getDb(payload.empresa);
    req.trainAuth = { empresa: payload.empresa, company };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Sesión de entrenamiento expirada' });
    }
    console.error('angelTrainRequired', err);
    return res.status(500).json({ success: false, message: 'Error al validar sesión' });
  }
}

module.exports = { angelTrainRequired };
