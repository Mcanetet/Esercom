/**
 * Módulos compartidos entre empresas: misma data (BD SERCOM) y visibles en todas.
 * La config vive en la BD de SERCOM (fuente única).
 */
const DEFAULT_SHARED = ['agenda-camion-pluma.html', 'inspeccion.html'];

/** Módulos cuya API ya redirige a BD SERCOM cuando están marcados compartidos */
const SHARED_DATA_SUPPORTED = new Set([
  'agenda-camion-pluma.html',
  'inspeccion.html'
]);

function normalizeKey(raw) {
  return String(raw || '').trim().replace(/^\//, '').toLowerCase();
}

function sercomDb() {
  const { getDb } = require('../db/tenants');
  return getDb('sercom');
}

async function ensureSchema(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS modulos_compartidos (
        page_key VARCHAR(128) NOT NULL PRIMARY KEY,
        activo TINYINT NOT NULL DEFAULT 1,
        actualizado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS modulos_compartidos (
        page_key TEXT NOT NULL PRIMARY KEY,
        activo INTEGER NOT NULL DEFAULT 1,
        actualizado TEXT DEFAULT (datetime('now'))
      )
    `);
  }
}

/**
 * @returns {Promise<{ compartidos: string[], configured: boolean }>}
 */
async function getModulosCompartidos(catalogKeys) {
  let db;
  try {
    db = sercomDb();
  } catch (err) {
    return { compartidos: [...DEFAULT_SHARED], configured: false, error: err.message };
  }
  await ensureSchema(db);
  let rows = [];
  try {
    rows = await db.prepare('SELECT page_key, activo FROM modulos_compartidos').all();
  } catch (_) {
    rows = [];
  }
  if (!rows.length) {
    // Primera vez: sembrar defaults
    for (const key of DEFAULT_SHARED) {
      await db.prepare(
        'INSERT INTO modulos_compartidos (page_key, activo) VALUES (?, 1)'
      ).run(normalizeKey(key));
    }
    return { compartidos: DEFAULT_SHARED.map(normalizeKey), configured: false };
  }
  // Asegurar módulos default (p.ej. Inspección) aunque la tabla ya existía
  const existingKeys = new Set(rows.map((r) => normalizeKey(r.page_key)));
  for (const key of DEFAULT_SHARED) {
    const nk = normalizeKey(key);
    if (!existingKeys.has(nk)) {
      try {
        await db.prepare(
          'INSERT INTO modulos_compartidos (page_key, activo) VALUES (?, 1)'
        ).run(nk);
        rows.push({ page_key: nk, activo: 1 });
      } catch (_) { /* ignore */ }
    }
  }
  const compartidos = rows
    .filter((r) => Number(r.activo) !== 0)
    .map((r) => normalizeKey(r.page_key))
    .filter(Boolean);
  if (Array.isArray(catalogKeys) && catalogKeys.length) {
    const allowed = new Set(catalogKeys.map(normalizeKey));
    return {
      compartidos: compartidos.filter((k) => allowed.has(k)),
      configured: true
    };
  }
  return { compartidos, configured: true };
}

async function setModulosCompartidos(keysInput, catalogKeys) {
  const db = sercomDb();
  await ensureSchema(db);
  const catalog = (catalogKeys || []).map(normalizeKey).filter(Boolean);
  const want = new Set(
    (Array.isArray(keysInput) ? keysInput : [])
      .map(normalizeKey)
      .filter((k) => !catalog.length || catalog.includes(k))
  );
  // No permitir marcar always-on de sistema como "compartidos data" (no aplica)
  for (const skip of ['home.html', 'configuraciones.html', 'perfil.html']) {
    want.delete(skip);
  }

  await db.prepare('DELETE FROM modulos_compartidos').run();
  const list = catalog.length ? catalog : [...want];
  for (const key of list) {
    const activo = want.has(key) ? 1 : 0;
    if (!catalog.length && !activo) continue;
    await db.prepare(
      'INSERT INTO modulos_compartidos (page_key, activo) VALUES (?, ?)'
    ).run(key, activo);
  }
  // Invalidate cache
  _cache = { at: 0, compartidos: [] };
  return getModulosCompartidos(catalogKeys);
}

let _cache = { at: 0, compartidos: [] };
const CACHE_MS = 15_000;

async function listCompartidosCached() {
  const now = Date.now();
  if (_cache.at && now - _cache.at < CACHE_MS) return _cache.compartidos;
  const { compartidos } = await getModulosCompartidos();
  _cache = { at: now, compartidos };
  return compartidos;
}

async function isModuloCompartido(pageKey) {
  const key = normalizeKey(pageKey);
  if (!key) return false;
  const list = await listCompartidosCached();
  return list.some((p) => p === key);
}

/**
 * BD del módulo: SERCOM si está marcado compartido; si no, la del tenant.
 */
async function resolveModuleDb(req, pageKey) {
  const key = normalizeKey(pageKey);
  try {
    if (await isModuloCompartido(key)) {
      return sercomDb();
    }
  } catch (err) {
    console.warn('[modulos-compartidos] resolveModuleDb:', err.message);
  }
  return req.db;
}

/** Sync: usa cache (llamar listCompartidosCached antes si hace falta frescor). */
function isCompartidoSync(pageKey, list) {
  const key = normalizeKey(pageKey);
  const arr = Array.isArray(list) ? list : _cache.compartidos || [];
  return arr.some((p) => normalizeKey(p) === key);
}

module.exports = {
  DEFAULT_SHARED,
  SHARED_DATA_SUPPORTED,
  normalizeKey,
  getModulosCompartidos,
  setModulosCompartidos,
  listCompartidosCached,
  isModuloCompartido,
  resolveModuleDb,
  isCompartidoSync,
  sercomDb
};
