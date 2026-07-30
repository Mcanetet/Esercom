#!/usr/bin/env node
/**
 * Importa data exportada desde MySQL (Salida Materiales) hacia SQLite ESERCOM.
 *
 * Uso:
 *   1) En phpMyAdmin (servidor viejo), exporta estas tablas como JSON (array de filas):
 *      roles, departamentos, usuarios, cecos, materiales, proveedores, bodegas,
 *      estados_solicitud, solicitudes_materiales, solicitudes_detalle,
 *      historial_solicitudes, checklist_flota, servicios_generales,
 *      tareas_operativas, liberadores_config
 *   2) Guárdalas en import/<empresa>/usuarios.json, etc.
 *   3) npm run init-db   (si aún no hay DB)
 *   4) node server/db/import-mysql-json.js --empresa=sercom --dir=./import/sercom
 *
 * Conserva IDs originales para no romper FKs.
 */
const fs = require('fs');
const path = require('path');
const { getDb, initAll, closeAll, dbPathFor } = require('./tenants');
const config = require('../config');

const TABLE_ORDER = [
  'roles',
  'departamentos',
  'usuarios',
  'cecos',
  'materiales',
  'proveedores',
  'bodegas',
  'estados_solicitud',
  'solicitudes_materiales',
  'solicitudes_detalle',
  'historial_solicitudes',
  'solicitudes_compras',
  'solicitudes_compras_detalle',
  'portal_proveedor',
  'materiales_receta_tipos',
  'materiales_receta_insumos',
  'creacion_datos_maestros',
  'tareas_operativas',
  'solicitud_graficas',
  'servicios_generales',
  'checklist_flota',
  'requerimientos_telecom',
  'seguimiento_contratos',
  'aprobacion_facturas_lote',
  'aprobacion_facturas',
  'papelera',
  'liberadores_config',
  'liberadores_extra',
  'usuarios_proveedor',
  'portal_proveedor_log',
  'agenda_camion_pluma_v2'
];

/** Renombres de columna MySQL → SQLite cuando difieren */
const COLUMN_ALIASES = {
  checklist_flota: {
    operario_id: 'operario_id',
    nivel_aceite: 'nivel_aceite',
    documentacion: 'documentacion'
  },
  servicios_generales: {
    numero_caso: 'numero_caso',
    codigo: 'codigo'
  },
  solicitudes_compras: {
    numero_solicitud: 'numero_solicitud'
  }
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { empresa: 'sercom', dir: null, wipe: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--empresa' && args[i + 1]) out.empresa = args[++i];
    else if (args[i].startsWith('--empresa=')) out.empresa = args[i].split('=')[1];
    else if (args[i] === '--dir' && args[i + 1]) out.dir = args[++i];
    else if (args[i].startsWith('--dir=')) out.dir = args[i].split('=')[1];
    else if (args[i] === '--wipe') out.wipe = true;
  }
  return out;
}

function loadJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let data = JSON.parse(raw);
  // phpMyAdmin a veces envuelve: [{ type, name, data: [...] }]
  if (Array.isArray(data) && data[0] && data[0].data && Array.isArray(data[0].data)) {
    data = data[0].data;
  }
  if (data && data.data && Array.isArray(data.data)) data = data.data;
  if (!Array.isArray(data)) throw new Error(`JSON no es array: ${file}`);
  return data;
}

function boolToInt(v) {
  if (v === true || v === 1 || v === '1') return 1;
  if (v === false || v === 0 || v === '0') return 0;
  return v;
}

function normalizeRow(table, row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    let key = k;
    // aliases comunes
    if (table === 'checklist_flota' && k === 'operario_id' && row.conductor_id == null) {
      out.conductor_id = v;
    }
    if (table === 'servicios_generales' && k === 'numero_caso' && !row.codigo) {
      out.codigo = v;
    }
    if (table === 'solicitudes_compras' && (k === 'numero_solicitud') && !row.numero_solicitud) {
      /* keep */
    }
    if (v === null || v === undefined) {
      out[key] = null;
    } else if (typeof v === 'boolean') {
      out[key] = boolToInt(v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function insertRows(db, table, rows) {
  if (!rows.length) return 0;
  const colsInfo = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!colsInfo.length) {
    console.warn(`  ⚠ Tabla ${table} no existe en SQLite, se omite`);
    return 0;
  }
  const allowed = new Set(colsInfo.map((c) => c.name));
  let n = 0;
  const tx = db.transaction(() => {
    for (const raw of rows) {
      const row = normalizeRow(table, raw);
      const keys = Object.keys(row).filter((k) => allowed.has(k));
      if (!keys.length) continue;
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
      db.prepare(sql).run(...keys.map((k) => row[k]));
      n += 1;
    }
  });
  tx();
  return n;
}

async function main() {
  const opts = parseArgs();
  if (!opts.dir) {
    console.error('Uso: node server/db/import-mysql-json.js --empresa=sercom --dir=./import/sercom');
    process.exit(1);
  }
  const company = config.getCompany(opts.empresa);
  if (!company) {
    console.error('Empresa inválida:', opts.empresa);
    process.exit(1);
  }
  const dir = path.resolve(opts.dir);
  if (!fs.existsSync(dir)) {
    console.error('No existe el directorio:', dir);
    process.exit(1);
  }

  await initAll();
  const db = getDb(opts.empresa);

  if (opts.wipe) {
    console.log('⚠ --wipe: vaciando tablas de negocio (conserva schema)...');
    const skip = new Set(['empresas', 'angel_ia_config', 'sqlite_sequence']);
    for (const t of [...TABLE_ORDER].reverse()) {
      try {
        if (!skip.has(t)) db.prepare(`DELETE FROM ${t}`).run();
      } catch (_) { /* ignore */ }
    }
  }

  console.log(`Importando → ${opts.empresa} (${dbPathFor(opts.empresa)})`);
  console.log(`Desde: ${dir}\n`);

  let total = 0;
  for (const table of TABLE_ORDER) {
    const file = path.join(dir, `${table}.json`);
    // alias de nombres de archivo desde MySQL
    const alt = {
      solicitudes_compras: ['solicitud_de_compras.json', 'solicitudes_compras.json'],
      estados_solicitud: ['estados_solicitud.json', 'estados_solicitud_salida.json']
    };
    let useFile = fs.existsSync(file) ? file : null;
    if (!useFile && alt[table]) {
      for (const a of alt[table]) {
        const p = path.join(dir, a);
        if (fs.existsSync(p)) { useFile = p; break; }
      }
    }
    if (!useFile) continue;

    try {
      const rows = loadJson(useFile);
      const n = insertRows(db, table, rows);
      total += n;
      console.log(`✓ ${table.padEnd(32)} ${String(n).padStart(6)} filas`);
    } catch (err) {
      console.error(`✗ ${table}: ${err.message}`);
    }
  }

  // Derivar flags operativos desde cargo/rol si vienen en 0
  try {
    db.prepare(`
      UPDATE usuarios SET flag_aprobador_salida = 1
      WHERE (lower(cargo) LIKE '%jefe%' OR lower(cargo) LIKE '%supply%' OR lower(cargo) LIKE '%edith%'
             OR rol_id IN (1,2,5)) AND COALESCE(flag_aprobador_salida,0) = 0
    `).run();
    db.prepare(`
      UPDATE usuarios SET flag_camion_pluma = 1
      WHERE (lower(nombre) LIKE '%edith%' OR lower(cargo) LIKE '%agenda%' OR lower(cargo) LIKE '%pluma%')
        AND COALESCE(flag_camion_pluma,0) = 0
    `).run();
    db.prepare(`
      UPDATE usuarios SET flag_flota = 1, flag_checklist = 1
      WHERE (lower(cargo) LIKE '%flota%' OR lower(cargo) LIKE '%bodeguero%')
        AND COALESCE(flag_flota,0) = 0
    `).run();
    db.prepare(`
      UPDATE usuarios SET flag_ssgg = 1
      WHERE (lower(cargo) LIKE '%mantenc%' OR lower(cargo) LIKE '%ssgg%' OR lower(cargo) LIKE '%servicios generales%')
        AND COALESCE(flag_ssgg,0) = 0
    `).run();
    db.prepare(`UPDATE usuarios SET flag_checklist=1, flag_flota=1, flag_ssgg=1, flag_camion_pluma=1, flag_aprobador_salida=1 WHERE rol_id=1`).run();
  } catch (err) {
    console.warn('Flags auto:', err.message);
  }

  console.log(`\nListo. Total filas importadas: ${total}`);
  closeAll();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
