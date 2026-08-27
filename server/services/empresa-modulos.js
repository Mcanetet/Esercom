/**
 * Módulos visibles a nivel empresa (techo sobre permisos de rol).
 * Por defecto (sin filas): todos los módulos del catálogo están habilitados.
 */
const ALWAYS_ON = new Set([
  'home.html',
  'configuraciones.html',
  'perfil.html',
  'incidencias.html'
]);

const DEFAULT_CATALOG = [
  'home.html',
  'solicitud-salida-materiales.html',
  'salida-material-por-actividad.html',
  'portal-proveedores.html',
  'materiales-por-receta.html',
  'solicitud-de-compras.html',
  'creacion-datos-maestros.html',
  'tareas-operativas.html',
  'solicitud-de-graficas.html',
  'serviciosgenerales.html',
  'agenda-camion-pluma.html',
  'checklist-flota.html',
  'inspeccion.html',
  'wms.html',
  'catalogo-g.html',
  'catalogo-s.html',
  'catalogo-n.html',
  'catalogo-t.html',
  'telecomunicaciones.html',
  'seguimiento-contratos.html',
  'aprobacion-facturas.html',
  'reportes.html',
  'angel-ia.html',
  'incidencias.html',
  'configuraciones.html',
  'papelera.html'
];

async function ensureEmpresaModulosSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS empresa_modulos (
        page_key VARCHAR(128) NOT NULL PRIMARY KEY,
        visible TINYINT NOT NULL DEFAULT 1,
        actualizado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS empresa_modulos (
        page_key TEXT NOT NULL PRIMARY KEY,
        visible INTEGER NOT NULL DEFAULT 1,
        actualizado TEXT DEFAULT (datetime('now'))
      )
    `);
  }
}

function normalizeKey(raw) {
  return String(raw || '').trim().replace(/^\//, '').toLowerCase();
}

function isAlwaysOn(key) {
  return ALWAYS_ON.has(normalizeKey(key));
}

async function loadCompartidos() {
  try {
    const { listCompartidosCached } = require('./modulos-compartidos');
    return await listCompartidosCached();
  } catch (_) {
    return [];
  }
}

/**
 * Si la empresa ya tiene techo configurado, inserta módulos nuevos del catálogo
 * como visibles (evita que WMS u otros queden invisibles al no existir en la tabla).
 */
async function syncCatalogIntoEmpresaModulos(db, catalogKeys = DEFAULT_CATALOG) {
  await ensureEmpresaModulosSchema(db);
  let rows = [];
  try {
    rows = await db.prepare('SELECT page_key FROM empresa_modulos').all();
  } catch (_) {
    return;
  }
  if (!rows.length) return;
  const existing = new Set(rows.map((r) => normalizeKey(r.page_key)));
  for (const key of (catalogKeys || DEFAULT_CATALOG).map(normalizeKey)) {
    if (existing.has(key) || !key) continue;
    try {
      await db.prepare(
        'INSERT INTO empresa_modulos (page_key, visible) VALUES (?, 1)'
      ).run(key, 1);
    } catch (_) { /* unique race */ }
  }
}

/**
 * Agrega wms.html a roles que ya operan materiales/operaciones (sin tocar '*').
 */
async function ensureWmsInRoles(db) {
  let roles = [];
  try {
    roles = await db.prepare('SELECT id, paginas_permitidas FROM roles').all();
  } catch (_) {
    return { updated: 0 };
  }
  let updated = 0;
  for (const r of roles || []) {
    let pages;
    try {
      pages = typeof r.paginas_permitidas === 'string'
        ? JSON.parse(r.paginas_permitidas)
        : r.paginas_permitidas;
    } catch (_) {
      continue;
    }
    if (!Array.isArray(pages)) continue;
    if (pages.includes('*')) continue;
    if (pages.some((p) => normalizeKey(p) === 'wms.html')) continue;
    const blob = pages.join(' ').toLowerCase();
    const relevant = /inspeccion|checklist|agenda|solicitud-salida|material|configuraciones|papelera|tareas|reportes/
      .test(blob) || pages.length >= 6;
    if (!relevant) continue;
    pages.push('wms.html');
    try {
      await db.prepare('UPDATE roles SET paginas_permitidas = ? WHERE id = ?')
        .run(JSON.stringify(pages), r.id);
      updated += 1;
    } catch (_) { /* ignore */ }
  }
  return { updated };
}

/**
 * @returns {Promise<{ configured: boolean, visibles: string[], ocultos: string[], compartidos: string[] }>}
 */
async function getEmpresaModulos(db, catalogKeys = DEFAULT_CATALOG) {
  await ensureEmpresaModulosSchema(db);
  await syncCatalogIntoEmpresaModulos(db, catalogKeys);
  const compartidos = (await loadCompartidos()).map(normalizeKey);
  const sharedSet = new Set(compartidos);
  let rows = [];
  try {
    rows = await db.prepare('SELECT page_key, visible FROM empresa_modulos').all();
  } catch (_) {
    rows = [];
  }
  const catalog = (catalogKeys || DEFAULT_CATALOG).map(normalizeKey);
  if (!rows.length) {
    return {
      configured: false,
      visibles: [...catalog],
      ocultos: [],
      always_on: [...ALWAYS_ON],
      compartidos
    };
  }
  const map = new Map(rows.map((r) => [normalizeKey(r.page_key), Number(r.visible) !== 0]));
  const visibles = [];
  const ocultos = [];
  for (const key of catalog) {
    if (isAlwaysOn(key) || sharedSet.has(key)) {
      visibles.push(key);
      continue;
    }
    const on = map.has(key) ? map.get(key) : true;
    if (on) visibles.push(key);
    else ocultos.push(key);
  }
  return { configured: true, visibles, ocultos, always_on: [...ALWAYS_ON], compartidos };
}

/**
 * Guarda el set de módulos visibles. Always-on siempre quedan en 1.
 */
async function setEmpresaModulos(db, visiblesInput, catalogKeys = DEFAULT_CATALOG) {
  await ensureEmpresaModulosSchema(db);
  const catalog = (catalogKeys || DEFAULT_CATALOG).map(normalizeKey);
  const compartidos = (await loadCompartidos()).map(normalizeKey);
  const want = new Set(
    (Array.isArray(visiblesInput) ? visiblesInput : [])
      .map(normalizeKey)
      .filter(Boolean)
  );
  for (const k of ALWAYS_ON) want.add(k);
  for (const k of compartidos) want.add(k);

  await db.prepare('DELETE FROM empresa_modulos').run();
  for (const key of catalog) {
    const visible = want.has(key) || isAlwaysOn(key) || compartidos.includes(key) ? 1 : 0;
    await db.prepare(
      'INSERT INTO empresa_modulos (page_key, visible) VALUES (?, ?)'
    ).run(key, visible);
  }
  return getEmpresaModulos(db, catalog);
}

/** true si el módulo está permitido por el techo de empresa */
function isModuleEnabledForUser(user, pageKey) {
  const key = normalizeKey(pageKey);
  if (!key || isAlwaysOn(key)) return true;
  const compartidos = user?.modulos_compartidos;
  if (Array.isArray(compartidos) && compartidos.some((p) => normalizeKey(p) === key)) return true;
  const list = user?.modulos_empresa;
  // Sin lista / no configurado → todo permitido (compat)
  if (!Array.isArray(list) || !list.length) return true;
  if (list.includes('*')) return true;
  return list.some((p) => normalizeKey(p) === key);
}

module.exports = {
  ALWAYS_ON,
  DEFAULT_CATALOG,
  ensureEmpresaModulosSchema,
  syncCatalogIntoEmpresaModulos,
  ensureWmsInRoles,
  getEmpresaModulos,
  setEmpresaModulos,
  isModuleEnabledForUser,
  normalizeKey,
  isAlwaysOn
};
