/**
 * Clona estructura MySQL desde SERCOM hacia las BDs de otras empresas.
 * Usado por scripts/create-company-dbs.js y por endpoint admin protegido.
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config');

const SKIP_DATA_TABLES = new Set([
  'solicitudes_materiales', 'solicitudes_detalle', 'solicitudes_historial',
  'solicitudes_compras', 'solicitudes_compras_detalle', 'portal_proveedor',
  'salidas_actividad', 'salidas_actividad_detalle',
  'checklist_flota', 'checklist_flota_fotos', 'agenda_camion_pluma', 'agenda_camion_pluma_v2',
  'servicios_generales', 'telecomunicaciones', 'contratos', 'facturas',
  'angel_ia_mensajes', 'angel_ia_alertas', 'angel_ia_reportes', 'angel_ia_conocimiento',
  'incidencias', 'papelera', 'notificaciones'
]);

const CATALOG_TABLES = [
  'roles', 'departamentos', 'estados_solicitud', 'empresas',
  'cecos', 'materiales', 'bodegas', 'proveedores'
];

async function listTables(conn) {
  const [rows] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  if (!rows.length) return [];
  const key = Object.keys(rows[0]).find((k) => /^tables_in_/i.test(k)) || Object.keys(rows[0])[0];
  return rows.map((r) => r[key]).filter(Boolean);
}

async function cloneStructure(sourceConn, targetConn, tables, log) {
  await targetConn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of tables) {
    try {
      const [[row]] = await sourceConn.query(`SHOW CREATE TABLE \`${table}\``);
      const ddl = row['Create Table'] || Object.values(row)[1];
      if (!ddl) {
        log.push({ table, status: 'skip', detail: 'sin DDL' });
        continue;
      }
      await targetConn.query(ddl);
      log.push({ table, status: 'ok' });
    } catch (err) {
      if (/already exists/i.test(err.message || '')) {
        log.push({ table, status: 'exists' });
      } else {
        log.push({ table, status: 'fail', detail: err.message });
      }
    }
  }
  await targetConn.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function copyCatalogRows(sourceConn, targetConn, table, log, sourceDb, targetDb) {
  if (SKIP_DATA_TABLES.has(table) || !CATALOG_TABLES.includes(table)) return;
  try {
    const [srcColsRows] = await sourceConn.query(`SHOW COLUMNS FROM \`${table}\``);
    const [dstColsRows] = await targetConn.query(`SHOW COLUMNS FROM \`${table}\``);
    const srcCols = srcColsRows.map((r) => r.Field);
    const dstCols = new Set(dstColsRows.map((r) => r.Field));
    const cols = srcCols.filter((c) => dstCols.has(c));
    if (!cols.length) {
      log.push({ table, status: 'data_fail', detail: 'sin columnas en común' });
      return;
    }
    const colList = cols.map((c) => `\`${c}\``).join(', ');
    // Copia directa entre schemas (mismo servidor MySQL)
    const sql = `
      INSERT IGNORE INTO \`${targetDb}\`.\`${table}\` (${colList})
      SELECT ${colList} FROM \`${sourceDb}\`.\`${table}\`
    `;
    const [result] = await targetConn.query(sql);
    log.push({
      table,
      status: 'data',
      rows: result.affectedRows || 0,
      cols: cols.length
    });
  } catch (err) {
    // Fallback fila a fila
    try {
      const [rows] = await sourceConn.query(`SELECT * FROM \`${table}\` LIMIT 5000`);
      if (!rows.length) {
        log.push({ table, status: 'empty' });
        return;
      }
      const [srcColsRows] = await sourceConn.query(`SHOW COLUMNS FROM \`${table}\``);
      const [dstColsRows] = await targetConn.query(`SHOW COLUMNS FROM \`${table}\``);
      const cols = srcColsRows.map((r) => r.Field).filter((c) => dstColsRows.some((d) => d.Field === c));
      const placeholders = cols.map(() => '?').join(',');
      const colList = cols.map((c) => `\`${c}\``).join(',');
      const sql = `INSERT IGNORE INTO \`${table}\` (${colList}) VALUES (${placeholders})`;
      let n = 0;
      for (const row of rows) {
        const vals = cols.map((c) => (row[c] === undefined ? null : row[c]));
        if (vals.length !== cols.length) continue;
        await targetConn.query(sql, vals);
        n += 1;
      }
      log.push({ table, status: 'data', rows: n, cols: cols.length, via: 'row' });
    } catch (err2) {
      log.push({ table, status: 'data_fail', detail: `${err.message} | ${err2.message}` });
    }
  }
}

async function seedAdmin(targetConn, company, log) {
  const hash = bcrypt.hashSync('Cambiar123!', 10);
  const email = `admin@${company.emailDomain}`;
  try {
    try {
      await targetConn.query(`
        INSERT IGNORE INTO roles (id, nombre, descripcion, permisos)
        VALUES (1, 'Administrador', 'Acceso total', ?)
      `, [JSON.stringify(['*'])]);
    } catch (_) {
      await targetConn.query(`
        INSERT IGNORE INTO roles (id, nombre, descripcion, paginas_permitidas)
        VALUES (1, 'Administrador', 'Acceso total', ?)
      `, [JSON.stringify(['*'])]);
    }
  } catch (err) {
    log.push({ admin: email, status: 'roles_fail', detail: err.message });
  }
  try {
    await targetConn.query(`
      INSERT INTO usuarios (nombre, apellido, email, password, cargo, rol_id, activo, empresas_acceso)
      VALUES (?, ?, ?, ?, 'Administrador Sistema', 1, 1, ?)
      ON DUPLICATE KEY UPDATE activo = 1, empresas_acceso = VALUES(empresas_acceso)
    `, ['Admin', company.name, email, hash, JSON.stringify([company.slug])]);
    log.push({ admin: email, status: 'ok', password: 'Cambiar123!' });
  } catch (err) {
    // sin columna empresas_acceso
    try {
      await targetConn.query(`
        INSERT INTO usuarios (nombre, apellido, email, password, cargo, rol_id, activo)
        VALUES (?, ?, ?, ?, 'Administrador Sistema', 1, 1)
        ON DUPLICATE KEY UPDATE activo = 1
      `, ['Admin', company.name, email, hash]);
      log.push({ admin: email, status: 'ok', password: 'Cambiar123!' });
    } catch (err2) {
      log.push({ admin: email, status: 'fail', detail: err2.message });
    }
  }
}

/**
 * @param {{ only?: string[] }} opts
 * @returns {Promise<object>}
 */
async function cloneCompanyDatabases(opts = {}) {
  if (!config.isMysql) {
    return { ok: false, message: 'Solo aplica con DB_DRIVER=mysql' };
  }

  const only = Array.isArray(opts.only) && opts.only.length
    ? opts.only.map((s) => String(s).toLowerCase())
    : null;

  const sourceName = config.mysqlDatabaseFor('sercom');
  const result = {
    ok: true,
    source: sourceName,
    perCompany: !!config.mysqlPerCompany,
    companies: []
  };

  const baseCfg = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    multipleStatements: true
  };

  const source = await mysql.createConnection({ ...baseCfg, database: sourceName });
  const tables = await listTables(source);
  result.sourceTables = tables.length;

  for (const company of config.companies) {
    if (company.slug === 'sercom') {
      result.companies.push({ slug: 'sercom', skipped: true, reason: 'BD productiva (origen)' });
      continue;
    }
    if (only && !only.includes(company.slug)) continue;

    const dbName = config.mysqlDatabaseFor(company.slug);
    const entry = { slug: company.slug, database: dbName, log: [] };
    let target;
    try {
      target = await mysql.createConnection({ ...baseCfg, database: dbName });
    } catch (err) {
      entry.ok = false;
      entry.error = err.message;
      result.companies.push(entry);
      continue;
    }

    try {
      await cloneStructure(source, target, tables, entry.log);
      for (const t of CATALOG_TABLES) {
        if (tables.includes(t)) await copyCatalogRows(source, target, t, entry.log, sourceName, dbName);
      }
      await seedAdmin(target, company, entry.log);
      entry.ok = !entry.log.some((x) => x.status === 'fail' || x.status === 'data_fail');
      entry.tablesOk = entry.log.filter((x) => x.status === 'ok' || x.status === 'exists').length;
    } catch (err) {
      entry.ok = false;
      entry.error = err.message;
    } finally {
      await target.end();
    }
    result.companies.push(entry);
  }

  await source.end();
  result.ok = result.companies.filter((c) => !c.skipped).every((c) => c.ok !== false);
  return result;
}

/** Admins / subadmins que deben existir en TODAS las empresas. */
const CORE_ADMINS = [
  {
    email: 'miguelcanete@serviciossercom.cl',
    nivel: 'admin',
    nombre: 'Miguel',
    apellido: 'Cañete',
    cargo: 'Administrador'
  },
  {
    email: 'michelleavila@serviciossercom.cl',
    nivel: 'subadmin',
    nombre: 'Michelle',
    apellido: 'Ávila',
    cargo: 'Subadministrador'
  },
  {
    email: 'edithgomez@serviciossercom.cl',
    nivel: 'subadmin',
    nombre: 'Edith',
    apellido: 'Gómez',
    cargo: 'Subadministrador'
  },
  {
    email: 'viviana.sierra@globalviapublica.cl',
    nivel: 'subadmin',
    nombre: 'Viviana',
    apellido: 'Sierra',
    cargo: 'Subadministrador'
  },
  {
    email: 'sebastianvicent@globalviapublica.cl',
    nivel: 'subadmin',
    nombre: 'Sebastián',
    apellido: 'Vicent',
    cargo: 'Subadministrador'
  }
];

async function ensureRole(conn, dbName, { nombre, descripcion, permisosJson }) {
  const [rows] = await conn.query(
    `SELECT id, nombre FROM \`${dbName}\`.roles WHERE LOWER(nombre) LIKE ? LIMIT 5`,
    [`%${nombre.toLowerCase()}%`]
  );
  const exact = rows.find((r) => String(r.nombre || '').toLowerCase() === nombre.toLowerCase());
  if (exact) return Number(exact.id);

  // Detect columns
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${dbName}\`.roles`);
  const names = new Set(cols.map((c) => c.Field));
  if (names.has('permisos')) {
    const [r] = await conn.query(
      `INSERT INTO \`${dbName}\`.roles (nombre, descripcion, permisos${names.has('activo') ? ', activo' : ''})
       VALUES (?, ?, ?${names.has('activo') ? ', 1' : ''})`,
      [nombre, descripcion, permisosJson]
    );
    return Number(r.insertId);
  }
  if (names.has('paginas_permitidas')) {
    const [r] = await conn.query(
      `INSERT INTO \`${dbName}\`.roles (nombre, descripcion, paginas_permitidas${names.has('activo') ? ', activo' : ''})
       VALUES (?, ?, ?${names.has('activo') ? ', 1' : ''})`,
      [nombre, descripcion, permisosJson]
    );
    return Number(r.insertId);
  }
  const [r] = await conn.query(
    `INSERT INTO \`${dbName}\`.roles (nombre, descripcion) VALUES (?, ?)`,
    [nombre, descripcion]
  );
  return Number(r.insertId);
}

async function loadSourceUser(conn, sourceDb, email) {
  const [rows] = await conn.query(
    `SELECT * FROM \`${sourceDb}\`.usuarios WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function upsertUserInDb(conn, dbName, profile, rolId, empresasJson) {
  const email = profile.email;
  const [colsRows] = await conn.query(`SHOW COLUMNS FROM \`${dbName}\`.usuarios`);
  const cols = new Set(colsRows.map((c) => c.Field));

  const [existing] = await conn.query(
    `SELECT id FROM \`${dbName}\`.usuarios WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [email]
  );

  const fields = {
    nombre: profile.nombre,
    apellido: profile.apellido,
    email,
    password: profile.password,
    cargo: profile.cargo,
    telefono: profile.telefono || null,
    rol_id: rolId,
    activo: 1
  };
  if (cols.has('empresas_acceso')) fields.empresas_acceso = empresasJson;
  if (cols.has('flag_checklist')) fields.flag_checklist = 1;
  if (cols.has('flag_flota')) fields.flag_flota = 1;
  if (cols.has('flag_ssgg')) fields.flag_ssgg = 1;
  if (cols.has('flag_camion_pluma')) fields.flag_camion_pluma = 1;
  if (cols.has('flag_aprobador_salida')) fields.flag_aprobador_salida = 1;
  if (cols.has('departamento_id') && profile.departamento_id != null) {
    fields.departamento_id = profile.departamento_id;
  }

  const usable = Object.keys(fields).filter((k) => cols.has(k));
  if (existing[0]?.id) {
    const sets = usable.filter((k) => k !== 'email').map((k) => `\`${k}\` = ?`).join(', ');
    const vals = usable.filter((k) => k !== 'email').map((k) => fields[k]);
    vals.push(existing[0].id);
    await conn.query(`UPDATE \`${dbName}\`.usuarios SET ${sets} WHERE id = ?`, vals);
    return { id: Number(existing[0].id), action: 'updated' };
  }

  const colList = usable.map((k) => `\`${k}\``).join(', ');
  const ph = usable.map(() => '?').join(', ');
  const [r] = await conn.query(
    `INSERT INTO \`${dbName}\`.usuarios (${colList}) VALUES (${ph})`,
    usable.map((k) => fields[k])
  );
  return { id: Number(r.insertId), action: 'created' };
}

async function trySetUserRoles(conn, dbName, userId, rolIds) {
  try {
    const [tables] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = ? AND table_name = 'usuario_roles'`,
      [dbName]
    );
    if (!Number(tables[0]?.c)) return;
    await conn.query(`DELETE FROM \`${dbName}\`.usuario_roles WHERE usuario_id = ?`, [userId]);
    for (const rid of rolIds) {
      await conn.query(
        `INSERT IGNORE INTO \`${dbName}\`.usuario_roles (usuario_id, rol_id) VALUES (?, ?)`,
        [userId, rid]
      );
    }
  } catch (_) { /* opcional */ }
}

/**
 * Copia/actualiza admins core desde SERCOM hacia todas las BDs de empresa.
 */
async function syncCoreAdmins() {
  if (!config.isMysql) {
    return { ok: false, message: 'Solo MySQL' };
  }

  const sourceDb = config.mysqlDatabaseFor('sercom');
  const allSlugs = config.companies.map((c) => c.slug);
  const empresasJson = JSON.stringify(allSlugs);
  const permisosAll = JSON.stringify(['*']);

  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    multipleStatements: true
  });

  const result = { ok: true, source: sourceDb, users: [] };

  try {
    // Prefetch perfiles desde SERCOM (password real si existe)
    const profiles = [];
    for (const spec of CORE_ADMINS) {
      const src = await loadSourceUser(conn, sourceDb, spec.email);
      const password = src?.password || bcrypt.hashSync('Cambiar123!', 10);
      profiles.push({
        ...spec,
        nombre: src?.nombre || spec.nombre,
        apellido: src?.apellido || spec.apellido,
        cargo: src?.cargo || spec.cargo,
        telefono: src?.telefono || null,
        departamento_id: src?.departamento_id ?? null,
        password,
        fromSource: !!src,
        passwordTemporal: !src
      });
    }

    for (const company of config.companies) {
      const dbName = config.mysqlDatabaseFor(company.slug);
      const entry = { slug: company.slug, database: dbName, synced: [] };

      try {
        const adminRolId = await ensureRole(conn, dbName, {
          nombre: 'Administrador',
          descripcion: 'Acceso total al sistema',
          permisosJson: permisosAll
        });
        // Prefer id=1 if Administrador is already 1
        let adminId = adminRolId;
        const [adminRows] = await conn.query(
          `SELECT id FROM \`${dbName}\`.roles WHERE id = 1 OR LOWER(nombre) = 'administrador' ORDER BY id ASC LIMIT 1`
        );
        if (adminRows[0]) adminId = Number(adminRows[0].id);

        const subId = await ensureRole(conn, dbName, {
          nombre: 'Subadministrador',
          descripcion: 'Acceso amplio de administración (subadmin)',
          permisosJson: permisosAll
        });

        for (const p of profiles) {
          const rolId = p.nivel === 'admin' ? adminId : subId;
          const cargo = p.nivel === 'admin' ? 'Administrador' : 'Subadministrador';
          const up = await upsertUserInDb(conn, dbName, { ...p, cargo }, rolId, empresasJson);
          await trySetUserRoles(conn, dbName, up.id, [rolId]);
          entry.synced.push({
            email: p.email,
            nivel: p.nivel,
            rol_id: rolId,
            ...up,
            fromSource: p.fromSource,
            passwordTemporal: p.passwordTemporal || false
          });
        }
        entry.ok = true;
      } catch (err) {
        entry.ok = false;
        entry.error = err.message;
        result.ok = false;
      }
      result.users.push(entry);
    }
  } finally {
    await conn.end();
  }

  return result;
}

module.exports = { cloneCompanyDatabases, syncCoreAdmins, CORE_ADMINS };
