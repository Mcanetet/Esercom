const express = require('express');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const config = require('./config');
const { initAll } = require('./db/tenants');

const authRoutes = require('./routes/auth');
const catalogosRoutes = require('./routes/catalogos');
const solicitudesRoutes = require('./routes/solicitudes');
const modulesRoutes = require('./routes/modules');

// Asegura DBs al arrancar
initAll();

const app = express();

app.use(morgan('dev'));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/catalogos', catalogosRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/modulos', modulesRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    app: 'ESERCOM',
    version: '1.0.0',
    empresas: config.companies.map((c) => c.slug)
  });
});

app.use(express.static(config.publicDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const file = path.join(config.publicDir, req.path);
  res.sendFile(file, (err) => {
    if (err) res.sendFile(path.join(config.publicDir, 'index.html'));
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
});

app.listen(config.port, () => {
  console.log(`ESERCOM corriendo en http://localhost:${config.port}`);
  console.log(`Empresas: ${config.companies.map((c) => c.name).join(', ')}`);
});
