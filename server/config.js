require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');

const COMPANIES = [
  {
    slug: 'global',
    name: 'Global',
    razonSocial: 'Global Vía Pública SpA',
    rut: '76.111.111-1',
    color: '#0ea5e9',
    emailDomain: 'globalviapublica.com'
  },
  {
    slug: 'sercom',
    name: 'Sercom',
    razonSocial: 'SERCOM SpA',
    rut: '76.222.222-2',
    color: '#0369a1',
    emailDomain: 'serviciossercom.cl'
  },
  {
    slug: 'nexus',
    name: 'Nexus',
    razonSocial: 'Nexus SpA',
    rut: '76.333.333-3',
    color: '#0284c7',
    emailDomain: 'nexus.cl'
  },
  {
    slug: 'tactica',
    name: 'Tactica',
    razonSocial: 'Táctica SpA',
    rut: '76.444.444-4',
    color: '#075985',
    emailDomain: 'tactica.cl'
  },
  {
    slug: 'intercanje',
    name: 'Intercanje',
    razonSocial: 'Intercanje SpA',
    rut: '76.555.555-5',
    color: '#0c4a6e',
    emailDomain: 'intercanje.cl'
  }
];

const dbDriver = String(process.env.DB_DRIVER || 'sqlite').toLowerCase();
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
/** MySQL: una BD física por empresa (DB_NAME_GLOBAL, DB_NAME_SERCOM, … o DB_PER_COMPANY=1). */
const mysqlPerCompany = String(process.env.DB_PER_COMPANY || '').trim() === '1'
  || COMPANIES.some((c) => String(process.env[`DB_NAME_${c.slug.toUpperCase()}`] || '').trim());

function mysqlDatabaseFor(slug) {
  const key = String(slug || '').toLowerCase();
  const envKey = `DB_NAME_${key.toUpperCase().replace(/-/g, '_')}`;
  const specific = String(process.env[envKey] || '').trim();
  if (specific) return specific;
  const primary = String(process.env.DB_NAME || 'gosercom_productivo_db').trim();
  if (!mysqlPerCompany) return primary;
  // SERCOM conserva la BD productiva legada; el resto usa prefijo.
  if (key === 'sercom') return primary;
  const prefix = String(process.env.DB_NAME_PREFIX || 'gosercom_').trim() || 'gosercom_';
  return `${prefix}${key}_db`;
}

const jwtSecret = String(process.env.JWT_SECRET || '').trim();
if (isProd) {
  // No tumbar Passenger: advertir y seguir. El sitio debe quedar arriba.
  if (!jwtSecret || jwtSecret.length < 32 || /esercom-dev-secret|cambia-esta-clave/i.test(jwtSecret)) {
    console.error('[SEGURIDAD] JWT_SECRET débil o ausente en producción. Defina uno ≥32 caracteres cuanto antes.');
  }
  if (!String(process.env.ADMIN_PORTAL_PASSWORD || '').trim()) {
    console.error('[SEGURIDAD] ADMIN_PORTAL_PASSWORD no definido en producción.');
  }
  if (!String(process.env.ANGEL_TRAIN_PASSWORD || '').trim()) {
    console.error('[SEGURIDAD] ANGEL_TRAIN_PASSWORD no definido en producción.');
  }
}

const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

module.exports = {
  port: Number(process.env.PORT) || 3000,
  isProd,
  jwtSecret: jwtSecret || 'esercom-dev-secret',
  /** Clave AES distinta si existe; si no, deriva de JWT (legacy). */
  encryptionSecret: String(process.env.ENCRYPTION_KEY || jwtSecret || 'esercom-dev-secret').trim(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  adminPortalPassword: process.env.ADMIN_PORTAL_PASSWORD
    || (isProd ? '' : 'esercom-admin'),
  angelTrainPassword: process.env.ANGEL_TRAIN_PASSWORD
    || (isProd ? '' : 'esercom-angel-train'),
  dataDir: path.join(__dirname, '..', 'data'),
  publicDir: path.join(__dirname, '..', 'public'),
  corsOrigins,
  companies: COMPANIES,
  getCompany(slug) {
    return COMPANIES.find((c) => c.slug === String(slug || '').toLowerCase());
  },
  dbDriver,
  isMysql: dbDriver === 'mysql',
  mysqlPerCompany,
  mysqlDatabaseFor,
  mysql: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gosercom_productivo_db'
  },
  openai: {
    apiKey: String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim(),
    model: String(process.env.OPENAI_MODEL || '').trim() || 'gpt-4o-mini'
  }
};

if (module.exports.isMysql && !mysqlPerCompany) {
  console.warn(
    '[SEGURIDAD] DB_DRIVER=mysql sin DB_PER_COMPANY: todas las marcas usan la misma BD. ' +
    'Active DB_PER_COMPANY=1 y cree DB_NAME_GLOBAL / DB_NAME_NEXUS / etc. para aislar datos.'
  );
} else if (module.exports.isMysql && mysqlPerCompany) {
  console.log('[DB] MySQL multiempresa activo:', COMPANIES.map((c) => `${c.slug}=${mysqlDatabaseFor(c.slug)}`).join(', '));
}
