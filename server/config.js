require('dotenv').config();
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

module.exports = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'esercom-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  dataDir: path.join(__dirname, '..', 'data'),
  publicDir: path.join(__dirname, '..', 'public'),
  companies: COMPANIES,
  getCompany(slug) {
    return COMPANIES.find((c) => c.slug === String(slug || '').toLowerCase());
  }
};
