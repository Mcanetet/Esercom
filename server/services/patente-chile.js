/**
 * Validación de patentes chilenas — catálogo Excel + BD local + API Boostr (opcional).
 */
const config = require('../config');
const { buscarEnCatalogo, tieneCatalogo, alertarPatenteAusente } = require('./flota-catalogo');

const FORMATOS = [
  /^[A-Z]{4}\d{2}$/,       // nuevo: ABCD12
  /^[A-Z]{2}\d{4}$/,       // antiguo: AB1234
  /^[A-Z]{2}\d{3}[A-Z]$/,  // moto: AB123C
  /^\d{4}[A-Z]{2}$/        // otro formato histórico
];

function normalizarPatente(patente) {
  return String(patente || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function formatoValido(patente) {
  const p = normalizarPatente(patente);
  if (p.length < 5 || p.length > 7) return false;
  return FORMATOS.some((rx) => rx.test(p));
}

async function consultarBoostr(patente) {
  const key = process.env.BOOSTR_API_KEY || process.env.PATENTE_API_KEY || '';
  if (!key) return null;
  const url = `https://api.boostr.cl/vehicle/${encodeURIComponent(patente)}.json?include=owner`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'X-API-KEY': key },
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error || data.status === 'not_found' || data.status === 'error') return null;
    const v = data.data || data.vehicle || data;
    const owner = v.owner || {};
    const rut = owner.documentNumber || owner.document || null;
    const dv = owner.dv || null;
    return {
      marca: v.make || v.marca || v.brand || null,
      modelo: v.model || v.modelo || null,
      anio: v.year || v.anio || v.year_manufacture || null,
      tipo: v.type || v.tipo || v.vehicle_type || null,
      color: v.color || null,
      motor: v.engine_number || v.engine || v.motor || null,
      propietario: owner.fullname || owner.name || null,
      propietario_rut: rut && dv ? `${rut}-${dv}` : rut
    };
  } catch (_) {
    return null;
  }
}

async function consultarLocal(db, patente) {
  try {
    const row = await db.prepare(`
      SELECT COUNT(*) AS veces,
             MAX(kilometraje) AS ultimo_km,
             MAX(COALESCE(fecha, fecha_inspeccion)) AS ultima_fecha
      FROM checklist_flota
      WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = ?
        AND COALESCE(anulado, 0) = 0
    `).get(patente);
    if (!row || Number(row.veces) === 0) return null;

    let vehiculo = null;
    try {
      const last = await db.prepare(`
        SELECT vehiculo_marca, vehiculo_modelo, vehiculo_tipo, vehiculo_anio,
               propietario_nombre, propietario_rut
        FROM checklist_flota
        WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = ?
          AND COALESCE(anulado, 0) = 0
        ORDER BY id DESC
        LIMIT 1
      `).get(patente);
      if (last && (last.vehiculo_marca || last.vehiculo_tipo || last.propietario_nombre)) {
        vehiculo = {
          marca: last.vehiculo_marca || null,
          modelo: last.vehiculo_modelo || null,
          tipo: last.vehiculo_tipo || null,
          anio: last.vehiculo_anio || null,
          propietario: last.propietario_nombre || null,
          propietario_rut: last.propietario_rut || null
        };
      }
    } catch (_) { /* columnas aún no migradas */ }

    return {
      veces: Number(row.veces),
      ultimo_km: row.ultimo_km,
      ultima_fecha: row.ultima_fecha,
      vehiculo
    };
  } catch (_) {
    return null;
  }
}

function mergeVehiculo(a, b) {
  if (!a && !b) return null;
  const out = { ...(b || {}), ...(a || {}) };
  for (const k of Object.keys(out)) {
    if (out[k] == null || out[k] === '') delete out[k];
  }
  return Object.keys(out).length ? out : null;
}

function vehiculoMessage(v) {
  if (!v) return '';
  const parts = [v.marca, v.modelo, v.tipo, v.anio].filter(Boolean);
  if (v.propietario) parts.push('Dueño: ' + v.propietario);
  return parts.join(' · ');
}

async function validarPatente(db, patenteRaw, opts = {}) {
  const patente = normalizarPatente(patenteRaw);
  if (!patente) {
    return { valid: false, patente: '', message: 'Ingrese la patente del vehículo' };
  }
  if (!formatoValido(patente)) {
    return {
      valid: false,
      patente,
      message: 'Formato de patente chilena no válido (ej: ABCD12 o AB1234)'
    };
  }

  const catalogo = await buscarEnCatalogo(db, patente);
  if (catalogo) {
    const vehiculo = {
      marca: catalogo.marca || null,
      modelo: catalogo.modelo || null,
      tipo: catalogo.tipo || null,
      anio: catalogo.anio || null,
      propietario: catalogo.propietario_nombre || null,
      propietario_rut: catalogo.propietario_rut || null
    };
    return {
      valid: true,
      patente,
      verificado: true,
      fuente: 'catalogo_flota',
      vehiculo,
      message: vehiculoMessage(vehiculo) || `Vehículo en catálogo: ${catalogo.modelo}`
    };
  }

  let alertaCatalogo = null;
  if (await tieneCatalogo(db)) {
    alertaCatalogo = await alertarPatenteAusente(db, patente, opts);
  }

  const [local, externo] = await Promise.all([
    consultarLocal(db, patente),
    consultarBoostr(patente)
  ]);

  const vehiculo = mergeVehiculo(externo, local?.vehiculo || null);
  const alertaExtra = alertaCatalogo?.sent
    ? { alerta_catalogo: true, email_enviado: true, email_destino: alertaCatalogo.email }
    : alertaCatalogo
      ? { alerta_catalogo: true, email_enviado: false, alerta_motivo: alertaCatalogo.reason }
      : {};

  if (externo && (externo.marca || externo.modelo || externo.tipo)) {
    return {
      valid: true,
      patente,
      verificado: true,
      fuente: 'registro_vehicular',
      vehiculo: mergeVehiculo(externo, local?.vehiculo),
      historial: local,
      message: vehiculoMessage(vehiculo),
      ...alertaExtra,
      ...(alertaCatalogo?.sent ? {
        message: (vehiculoMessage(vehiculo) || 'Patente válida') +
          ' · ⚠ No está en catálogo flota — aviso enviado a flota'
      } : {})
    };
  }

  if (vehiculo && (vehiculo.marca || vehiculo.tipo || vehiculo.propietario)) {
    return {
      valid: true,
      patente,
      verificado: true,
      fuente: local ? 'historial_esercom' : 'formato',
      vehiculo,
      historial: local,
      message: vehiculoMessage(vehiculo),
      ...alertaExtra
    };
  }

  if (local) {
    return {
      valid: true,
      patente,
      verificado: true,
      fuente: 'historial_esercom',
      historial: local,
      message: `Patente en historial ESERCOM (${local.veces} checklist${local.veces > 1 ? 's' : ''})`,
      ...alertaExtra
    };
  }

  const msgBase = alertaCatalogo?.sent
    ? 'Patente no está en el catálogo de flota. Se envió aviso a flota@serviciossercom.cl'
    : alertaCatalogo
      ? 'Patente no está en el catálogo de flota cargado'
      : 'Formato válido. Configure catálogo Excel o BOOSTR_API_KEY para más datos.';

  return {
    valid: true,
    patente,
    verificado: !!alertaCatalogo?.sent || false,
    fuente: alertaCatalogo ? 'catalogo_ausente' : 'formato',
    message: msgBase,
    ...alertaExtra
  };
}

module.exports = { normalizarPatente, formatoValido, validarPatente };
