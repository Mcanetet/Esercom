/**
 * Geocodificación, distancia y precios — Camión Pluma (port desde PHP).
 */

const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const UA = 'ESERCOM/1.0 (Agenda Camion Pluma; contacto@esercom.cl)';
const REFERER = 'https://esercom.cl/agenda-camion-pluma.html';
const CHILE_LAT = -33.4489;
const CHILE_LON = -70.6693;
const FETCH_TIMEOUT_MS = 3500;
const GEO_CACHE_MAX = 400;
const GEO_CACHE_TTL_MS = 60 * 60 * 1000;
const geoCache = new Map();

function cacheGet(key) {
  const e = geoCache.get(key);
  if (!e) return null;
  if (Date.now() - e.t > GEO_CACHE_TTL_MS) {
    geoCache.delete(key);
    return null;
  }
  return e.v;
}

function cacheSet(key, val) {
  if (geoCache.size >= GEO_CACHE_MAX) {
    const first = geoCache.keys().next().value;
    geoCache.delete(first);
  }
  geoCache.set(key, { v: val, t: Date.now() });
}

function fetchUrlHttps(url, timeout = FETCH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let req;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const timer = setTimeout(() => {
      if (req) req.destroy();
      done(null);
    }, timeout);
    req = https.get(url, {
      headers: {
        'User-Agent': UA,
        Referer: REFERER,
        Accept: 'application/json',
        'Accept-Language': 'es'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        clearTimeout(timer);
        done(null);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        done(body || null);
      });
    });
    req.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
  });
}

async function fetchUrlCurl(url, timeoutSec = 5) {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-sS', '-L', '--max-time', String(timeoutSec),
      '-A', UA,
      '-e', REFERER,
      '-H', 'Accept: application/json',
      '-H', 'Accept-Language: es',
      url
    ], { maxBuffer: 5 * 1024 * 1024 });
    return stdout && stdout.trim() ? stdout : null;
  } catch {
    return null;
  }
}

async function fetchUrl(url, timeout = FETCH_TIMEOUT_MS) {
  const httpsBody = await fetchUrlHttps(url, timeout);
  if (httpsBody) return httpsBody;
  return fetchUrlCurl(url, Math.max(4, Math.ceil(timeout / 1000)));
}

function mergeDirecciones(lists, max = 10) {
  const vistos = new Set();
  const merged = [];
  for (const list of lists) {
    for (const item of list || []) {
      const name = String(item?.display_name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (vistos.has(key)) continue;
      vistos.add(key);
      merged.push({
        display_name: name,
        lat: item.lat != null ? Number(item.lat) : null,
        lon: item.lon != null ? Number(item.lon) : null,
        source: item.source || 'nominatim'
      });
      if (merged.length >= max) return merged;
    }
  }
  return merged;
}

async function buscarDireccionesLocal(db, query) {
  if (!db) return [];
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const out = [];
  const vistos = new Set();
  const push = (name, source) => {
    const n = String(name || '').trim();
    if (!n) return;
    const key = n.toLowerCase();
    if (vistos.has(key)) return;
    vistos.add(key);
    out.push({ display_name: n, lat: null, lon: null, source });
  };

  try {
    if (await tableExists(db, 'camion_pluma_rutas')) {
      const rows = await db.prepare(`
        SELECT alias, direccion, comuna FROM camion_pluma_rutas
        WHERE activo = 1 AND (alias LIKE ? OR direccion LIKE ? OR comuna LIKE ?)
        ORDER BY alias LIMIT 8
      `).all(like, like, like);
      for (const r of rows) {
        const addr = [r.direccion, r.comuna, 'Chile'].filter(Boolean).join(', ');
        push(addr || r.alias, 'ruta');
      }
    }
  } catch (_) { /* ignore */ }

  try {
    if (await tableExists(db, 'camion_pluma_servicios')) {
      const deleted = db.driver === 'mysql'
        ? "(deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')"
        : '1=1';
      const rows = await db.prepare(`
        SELECT addr FROM (
          SELECT direccion_origen AS addr FROM camion_pluma_servicios
          WHERE direccion_origen LIKE ? AND ${deleted}
          UNION
          SELECT direccion_destino FROM camion_pluma_servicios
          WHERE direccion_destino LIKE ? AND ${deleted}
        ) t
        WHERE addr IS NOT NULL AND TRIM(addr) <> ''
        LIMIT 10
      `).all(like, like);
      for (const r of rows) push(r.addr, 'historial');
    }
  } catch (_) { /* ignore */ }

  return out;
}

async function buscarDireccionesNominatim(query) {
  const q = /chile/i.test(query) ? query : `${query}, Chile`;
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q, format: 'json', limit: '8', countrycodes: 'cl', addressdetails: '0'
  })}`;
  const json = await fetchUrl(url, 4000);
  if (!json) return [];
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const results = [];
  const vistos = new Set();
  for (const item of data) {
    const name = item.display_name || '';
    if (!name || vistos.has(name)) continue;
    vistos.add(name);
    results.push({
      display_name: name,
      lat: item.lat != null ? Number(item.lat) : null,
      lon: item.lon != null ? Number(item.lon) : null,
      source: 'nominatim'
    });
    if (results.length >= 10) break;
  }
  return results;
}

function photonLabel(p) {
  const parts = [];
  if (p.housenumber && p.street) parts.push(`${p.street} ${p.housenumber}`);
  else if (p.street) parts.push(p.street);
  else if (p.name) parts.push(p.name);
  if (p.city) parts.push(p.city);
  else if (p.district) parts.push(p.district);
  else if (p.county) parts.push(p.county);
  if (p.state) parts.push(p.state);
  parts.push('Chile');
  return [...new Set(parts.filter(Boolean))].join(', ');
}

async function buscarDireccionesPhoton(query) {
  const url = `https://photon.komoot.io/api/?${new URLSearchParams({
    q: query,
    lat: String(CHILE_LAT),
    lon: String(CHILE_LON),
    limit: '12'
  })}`;
  const json = await fetchUrl(url);
  if (!json) return [];
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const features = data?.features;
  if (!Array.isArray(features)) return [];
  const results = [];
  const vistos = new Set();
  for (const f of features) {
    const p = f.properties || {};
    if (p.countrycode && p.countrycode !== 'CL') continue;
    const coords = f.geometry?.coordinates;
    const name = photonLabel(p);
    if (!name || vistos.has(name)) continue;
    vistos.add(name);
    results.push({
      display_name: name,
      lat: coords?.[1] != null ? Number(coords[1]) : null,
      lon: coords?.[0] != null ? Number(coords[0]) : null,
      source: 'photon'
    });
    if (results.length >= 10) break;
  }
  return results;
}

async function buscarDirecciones(q, db) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const cacheKey = `dir:${query.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const [local, photon] = await Promise.all([
    buscarDireccionesLocal(db, query),
    buscarDireccionesPhoton(query)
  ]);
  let merged = mergeDirecciones([local, photon], 10);
  if (merged.length < 3) {
    const nominatim = await buscarDireccionesNominatim(query);
    merged = mergeDirecciones([merged, nominatim], 10);
  }
  cacheSet(cacheKey, merged);
  return merged;
}

async function geocodePhotonSingle(address) {
  const url = `https://photon.komoot.io/api/?${new URLSearchParams({
    q: address,
    lat: String(CHILE_LAT),
    lon: String(CHILE_LON),
    limit: '3'
  })}`;
  const json = await fetchUrl(url);
  if (!json) return null;
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const features = data?.features;
  if (!Array.isArray(features) || !features.length) return null;
  for (const f of features) {
    const p = f.properties || {};
    if (p.countrycode && p.countrycode !== 'CL') continue;
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    return {
      lat: Number(coords[1]),
      lon: Number(coords[0]),
      display_name: photonLabel(p),
      comuna: p.city || p.district || p.county || ''
    };
  }
  return null;
}

async function geocodeNominatimSingle(address) {
  const q = /chile/i.test(address) ? address : `${address}, Chile`;
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q, format: 'json', limit: '1', countrycodes: 'cl'
  })}`;
  const json = await fetchUrl(url, 4000);
  if (!json) return null;
  try {
    const data = JSON.parse(json);
    if (data?.[0]?.lat && data[0].lon) {
      return {
        lat: Number(data[0].lat),
        lon: Number(data[0].lon),
        display_name: data[0].display_name || '',
        comuna: ''
      };
    }
  } catch { /* ignore */ }
  return null;
}

async function geocodeChile(address) {
  const key = `geo:${String(address || '').trim().toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  let result = await geocodePhotonSingle(address);
  if (!result) result = await geocodeNominatimSingle(address);
  if (result) cacheSet(key, result);
  return result;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanciaPorCarreteraKm(lat1, lon1, lat2, lon2) {
  const lineal = haversineKm(lat1, lon1, lat2, lon2);
  if (lineal <= 0) return null;
  return Math.round(lineal * 1.35 * 10) / 10;
}

async function routeDistanceKm(lon1, lat1, lon2, lat2) {
  const rapida = distanciaPorCarreteraKm(lat1, lon1, lat2, lon2);
  const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
  try {
    const json = await fetchUrl(url, 2500);
    if (json) {
      const data = JSON.parse(json);
      const m = data?.routes?.[0]?.distance;
      if (m > 0) return m / 1000;
    }
  } catch { /* ignore */ }
  return rapida;
}

async function kmDesdeRutasGuardadas(db, destino) {
  if (!db) return null;
  try {
    if (!(await tableExists(db, 'camion_pluma_rutas'))) return null;
    const rows = await db.prepare(`
      SELECT kilometraje_promedio, direccion, alias, comuna
      FROM camion_pluma_rutas WHERE activo = 1
    `).all();
    const dest = String(destino || '').trim().toLowerCase();
    for (const r of rows) {
      const dir = (r.direccion || '').trim().toLowerCase();
      const alias = (r.alias || '').trim().toLowerCase();
      if ((dir && dest.includes(dir)) || (alias && dest.includes(alias))
        || (dir && dest.length >= 8 && dir.includes(dest.slice(0, 20)))) {
        const km = Number(r.kilometraje_promedio);
        if (km > 0) {
          return { km, comuna_destino: r.comuna || '' };
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

function parseCoord(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

async function calcularDistancia(origen, destino, db, opts = {}) {
  if (!String(destino || '').trim()) {
    const err = new Error('Falta dirección de destino');
    err.status = 400;
    throw err;
  }
  if (!String(origen || '').trim()) {
    const err = new Error('Falta dirección de origen');
    err.status = 400;
    throw err;
  }

  const desdeRuta = await kmDesdeRutasGuardadas(db, destino);
  if (desdeRuta) {
    return {
      km: Math.round(desdeRuta.km * 10) / 10,
      comuna_destino: desdeRuta.comuna_destino || ''
    };
  }

  const oLat = parseCoord(opts.origen_lat);
  const oLon = parseCoord(opts.origen_lon);
  const dLat = parseCoord(opts.destino_lat);
  const dLon = parseCoord(opts.destino_lon);

  const [geoOrigen, geoDestino] = await Promise.all([
    (oLat != null && oLon != null)
      ? Promise.resolve({ lat: oLat, lon: oLon, display_name: origen, comuna: '' })
      : geocodeChile(origen),
    (dLat != null && dLon != null)
      ? Promise.resolve({ lat: dLat, lon: dLon, display_name: destino, comuna: '' })
      : geocodeChile(destino)
  ]);

  if (!geoOrigen) {
    const err = new Error('No se encontró la dirección de origen');
    err.status = 400;
    throw err;
  }
  if (!geoDestino) {
    const err = new Error('No se encontró la dirección de destino');
    err.status = 400;
    throw err;
  }

  const km = distanciaPorCarreteraKm(
    geoOrigen.lat, geoOrigen.lon,
    geoDestino.lat, geoDestino.lon
  );
  if (!km || km <= 0) {
    const err = new Error('No se pudo calcular la ruta entre las direcciones');
    err.status = 400;
    throw err;
  }
  let comunaDestino = geoDestino.comuna || '';
  if (!comunaDestino && geoDestino.display_name) {
    const parts = geoDestino.display_name.split(',');
    if (parts.length >= 2) comunaDestino = parts[0].trim();
  }
  return { km: Math.round(km * 10) / 10, comuna_destino: comunaDestino };
}

async function tableExists(db, table) {
  if (db.driver === 'mysql') {
    const row = await db.prepare(`
      SELECT COUNT(*) AS c FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
    `).get(table);
    return row && Number(row.c) > 0;
  }
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  return !!row;
}

const TRAMOS_DEFAULT = [
  { id: 0, nombre: 'Tramo 1 - Urbano Corto', alcance_ruta: 'Misma comuna o comuna colindante', km_min: 0, km_max: 10, tiempo_promedio: '1-3 hrs', precio_sugerido_iva: 95000, orden: 1 },
  { id: 0, nombre: 'Tramo 2 - Urbano medio', alcance_ruta: 'Cruce de comunas dentro del Gran Santiago', km_min: 10, km_max: 25, tiempo_promedio: '3,5-4 hrs', precio_sugerido_iva: 140000, orden: 2 },
  { id: 0, nombre: 'Tramo 3 - Urbano Largo/Periferia', alcance_ruta: 'Desde o hacia periferia RM', km_min: 25, km_max: 45, tiempo_promedio: '4,5-6 hrs', precio_sugerido_iva: 190000, orden: 3 }
];

async function getTramosYPrecios(db) {
  let tramos = [];
  let precioKmAdicional = 1800;
  let precioHoraAdicional = 18000;

  if (await tableExists(db, 'camion_pluma_tramos')) {
    tramos = await db.prepare(`
      SELECT id, nombre, alcance_ruta, km_min, km_max, tiempo_promedio, precio_sugerido_iva, orden
      FROM camion_pluma_tramos ORDER BY orden ASC, km_min ASC
    `).all();
  }
  if (!tramos.length) tramos = TRAMOS_DEFAULT;

  if (await tableExists(db, 'camion_pluma_precios_config')) {
    const rows = await db.prepare(`SELECT clave, valor FROM camion_pluma_precios_config`).all();
    for (const row of rows) {
      if (row.clave === 'precio_km_adicional') precioKmAdicional = Number(row.valor) || precioKmAdicional;
      if (row.clave === 'precio_hora_adicional') precioHoraAdicional = Number(row.valor) || precioHoraAdicional;
    }
  }

  return { tramos, precio_km_adicional: precioKmAdicional, precio_hora_adicional: precioHoraAdicional };
}

async function getRutas(db) {
  if (!(await tableExists(db, 'camion_pluma_rutas'))) return [];
  return db.prepare(`
    SELECT id, alias, direccion, comuna, kilometraje_promedio, tiempo_promedio_minutos
    FROM camion_pluma_rutas WHERE activo = 1 ORDER BY alias
  `).all();
}

function calcularPrecioDesdeKm(km, tramos, precioKmAdicional = 1800) {
  const k = Number(km);
  if (!k || k < 0 || !tramos?.length) return { tramo_nombre: '', subtotal: 0, total: 0 };
  let tramo = tramos.find((t) => k > (Number(t.km_min) || 0) && k <= (Number(t.km_max) || 999));
  if (!tramo) {
    if (k <= (Number(tramos[0].km_max) || 0)) tramo = tramos[0];
    else tramo = tramos[tramos.length - 1];
  }
  const base = Number(tramo.precio_sugerido_iva) || 0;
  const extra = k > 45 ? (k - 45) * precioKmAdicional : 0;
  const subtotal = Math.round(base + extra);
  return { tramo_nombre: tramo.nombre || '', subtotal, total: subtotal };
}

async function ensurePreciosTables(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS camion_pluma_tramos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(120) NOT NULL,
        alcance_ruta VARCHAR(255) DEFAULT NULL,
        km_min DECIMAL(8,2) NOT NULL DEFAULT 0,
        km_max DECIMAL(8,2) NOT NULL,
        tiempo_promedio VARCHAR(50) DEFAULT NULL,
        precio_sugerido_iva DECIMAL(12,0) NOT NULL,
        orden INT NOT NULL DEFAULT 0
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS camion_pluma_precios_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        clave VARCHAR(60) NOT NULL UNIQUE,
        valor VARCHAR(100) NOT NULL
      )
    `);
    return;
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS camion_pluma_tramos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      alcance_ruta TEXT,
      km_min REAL NOT NULL DEFAULT 0,
      km_max REAL NOT NULL,
      tiempo_promedio TEXT,
      precio_sugerido_iva REAL NOT NULL,
      orden INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS camion_pluma_precios_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clave TEXT NOT NULL UNIQUE,
      valor TEXT NOT NULL
    )
  `);
}

async function saveTramosYPrecios(db, body) {
  await ensurePreciosTables(db);
  const tramos = Array.isArray(body?.tramos) ? body.tramos : [];
  const precioKm = Number(body?.precio_km_adicional) || 1800;
  const precioHora = Number(body?.precio_hora_adicional) || 18000;

  for (let i = 0; i < tramos.length; i++) {
    const t = tramos[i] || {};
    const nombre = String(t.nombre || '').trim();
    if (!nombre) continue;
    const id = Number(t.id) || 0;
    const params = [
      nombre,
      String(t.alcance_ruta || '').trim() || null,
      Number(t.km_min) || 0,
      Number(t.km_max) || 0,
      String(t.tiempo_promedio || '').trim() || null,
      Number(t.precio_sugerido_iva) || 0,
      Number(t.orden) || (i + 1)
    ];
    if (id > 0) {
      await db.prepare(`
        UPDATE camion_pluma_tramos
        SET nombre = ?, alcance_ruta = ?, km_min = ?, km_max = ?, tiempo_promedio = ?,
            precio_sugerido_iva = ?, orden = ?
        WHERE id = ?
      `).run(...params, id);
    } else {
      await db.prepare(`
        INSERT INTO camion_pluma_tramos
          (nombre, alcance_ruta, km_min, km_max, tiempo_promedio, precio_sugerido_iva, orden)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(...params);
    }
  }

  if (db.driver === 'mysql') {
    await db.prepare(`
      INSERT INTO camion_pluma_precios_config (clave, valor) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE valor = VALUES(valor)
    `).run('precio_km_adicional', String(precioKm));
    await db.prepare(`
      INSERT INTO camion_pluma_precios_config (clave, valor) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE valor = VALUES(valor)
    `).run('precio_hora_adicional', String(precioHora));
  } else {
    await db.prepare(`INSERT OR REPLACE INTO camion_pluma_precios_config (clave, valor) VALUES (?, ?)`)
      .run('precio_km_adicional', String(precioKm));
    await db.prepare(`INSERT OR REPLACE INTO camion_pluma_precios_config (clave, valor) VALUES (?, ?)`)
      .run('precio_hora_adicional', String(precioHora));
  }
}

async function resetTramosDuplicados(db) {
  if (!(await tableExists(db, 'camion_pluma_tramos'))) return { deleted: 0 };
  const rows = await db.prepare(`
    SELECT MIN(id) AS id FROM camion_pluma_tramos WHERE orden IN (1, 2, 3) GROUP BY orden ORDER BY orden ASC
  `).all();
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (!ids.length) return { deleted: 0 };
  const placeholders = ids.map(() => '?').join(',');
  const info = await db.prepare(`DELETE FROM camion_pluma_tramos WHERE id NOT IN (${placeholders})`).run(...ids);
  return { deleted: info.changes || 0, kept_ids: ids };
}

async function restablecerTramosOficiales(db) {
  await ensurePreciosTables(db);
  await db.exec('DELETE FROM camion_pluma_tramos');
  const oficiales = [
    ['Tramo 1 - Urbano Corto', 'Misma comuna o comuna colindante', 0, 10, '1-3 hrs', 95000, 1],
    ['Tramo 2 - Urbano medio', 'Cruce de comunas dentro del Gran Santiago', 10, 25, '3,5-4 hrs', 140000, 2],
    ['Tramo 3 - Urbano Largo/Periferia', 'Desde o hacia periferia RM', 25, 45, '4,5-6 hrs', 190000, 3]
  ];
  for (const t of oficiales) {
    await db.prepare(`
      INSERT INTO camion_pluma_tramos
        (nombre, alcance_ruta, km_min, km_max, tiempo_promedio, precio_sugerido_iva, orden)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(...t);
  }
}

module.exports = {
  buscarDirecciones,
  calcularDistancia,
  getTramosYPrecios,
  getRutas,
  calcularPrecioDesdeKm,
  saveTramosYPrecios,
  resetTramosDuplicados,
  restablecerTramosOficiales
};
