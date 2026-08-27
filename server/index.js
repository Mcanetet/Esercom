const express = require('express');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const cors = require('cors');
const config = require('./config');
const { initAll } = require('./db/tenants');

const authRoutes = require('./routes/auth');
const catalogosRoutes = require('./routes/catalogos');
const solicitudesRoutes = require('./routes/solicitudes');
const modulesRoutes = require('./routes/modules');
const angelRoutes = require('./routes/angel');
const { startAngelScheduler } = require('./services/angel-scheduler');

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  next();
}

function safeSendPublic(req, res, next) {
  if (req.path.startsWith('/api/')) return next();
  const root = path.resolve(config.publicDir);
  const candidate = path.resolve(path.join(root, req.path === '/' ? 'index.html' : req.path));
  if (!candidate.startsWith(root + path.sep) && candidate !== root) {
    return res.status(400).send('Ruta inválida');
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return res.sendFile(candidate);
  }
  return res.sendFile(path.join(root, 'index.html'));
}

async function boot() {
  await initAll();

  // Diagnóstico rápido Excel materiales (útil tras deploy Passenger)
  try {
    const { getDb } = require('./db/tenants');
    const db = getDb(config.companies[0]?.slug || 'sercom');
    const sol = await db.prepare('SELECT COUNT(*) AS c FROM solicitudes_materiales').get();
    const det = await db.prepare('SELECT COUNT(*) AS c FROM solicitudes_detalle').get();
    const join = await db.prepare(`
      SELECT COUNT(*) AS c FROM solicitudes_materiales s
      INNER JOIN solicitudes_detalle sd ON sd.solicitud_id = s.id
    `).get();
    const sample = await db.prepare(`
      SELECT s.codigo, s.fecha_solicitud,
             (SELECT COUNT(*) FROM solicitudes_detalle sd WHERE sd.solicitud_id = s.id) AS n_det
      FROM solicitudes_materiales s ORDER BY s.id DESC LIMIT 3
    `).all();
    const payload = {
      at: new Date().toISOString(),
      driver: db.driver || 'sqlite',
      solicitudes: Number(sol?.c || 0),
      detalle: Number(det?.c || 0),
      join_lineas: Number(join?.c || 0),
      sample
    };
    const dir = path.join(config.dataDir, 'reportes');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'boot-excel-diag.json'), JSON.stringify(payload, null, 2));
    console.log('[boot] materiales diag', payload.solicitudes, 'sol /', payload.detalle, 'det /', payload.join_lineas, 'join');
  } catch (err) {
    console.warn('[boot] materiales diag:', err.message);
  }

  const app = express();

  app.use(morgan('dev'));
  app.use(securityHeaders);
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (!config.corsOrigins.length) return cb(null, true);
      if (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
        return cb(null, true);
      }
      return cb(new Error('Origen no permitido por CORS'));
    },
    credentials: true
  }));
  app.use((req, res, next) => {
    const large = /\/(upload-foto|conocimiento\/docs|catalogo-[gsnt]|sugerir-foto|\/angel\/chat|\/angel\/voice|\/incidencias|\/inspeccion)/.test(req.path);
    express.json({ limit: large ? '14mb' : '2mb' })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/catalogos', catalogosRoutes);
  app.use('/api/solicitudes', solicitudesRoutes);
  app.use('/api/modulos', modulesRoutes);
  app.use('/api/angel/train', require('./routes/angel-train'));
  app.use('/api/angel', angelRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      app: 'ESERCOM',
      version: '1.0.0',
      empresas: config.companies.map((c) => c.slug),
      mysql: config.isMysql,
      mysqlPerCompany: !!config.mysqlPerCompany,
      databases: config.isMysql
        ? Object.fromEntries(config.companies.map((c) => [c.slug, config.mysqlDatabaseFor(c.slug)]))
        : null
    });
  });

  app.use('/uploads/checklist', (_req, res) => {
    res.status(401).json({ success: false, message: 'Autenticación requerida' });
  });

  // Adjuntos PHP: public/uploads, esercom-app/uploads y legado /antiguo/uploads
  const uploadRoots = [
    path.join(config.publicDir, 'uploads'),
    path.join(config.publicDir, '..', 'uploads'),
    path.join(config.publicDir, '..', '..', 'uploads'),
    path.join(config.publicDir, '..', '..', 'antiguo', 'uploads')
  ];
  const seenUpload = new Set();
  for (const root of uploadRoots) {
    const abs = path.resolve(root);
    if (seenUpload.has(abs) || !fs.existsSync(abs)) continue;
    seenUpload.add(abs);
    app.use('/uploads', express.static(abs, {
      setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); }
    }));
    console.log('[static] /uploads <-', abs);
  }

  app.use(express.static(config.publicDir, {
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.get('*', safeSendPublic);

  app.use((err, _req, res, _next) => {
    if (err && /CORS/i.test(err.message || '')) {
      return res.status(403).json({ success: false, message: 'Origen no permitido' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  });

  app.listen(config.port, () => {
    console.log(`ESERCOM corriendo en http://localhost:${config.port}`);
    console.log(`Empresas: ${config.companies.map((c) => c.name).join(', ')}`);
    startAngelScheduler();
  });
}

boot().catch((err) => {
  console.error('No se pudo iniciar ESERCOM:', err);
  process.exit(1);
});
