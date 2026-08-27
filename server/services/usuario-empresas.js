/**
 * Acceso multiempresa de usuarios.
 * - Columna usuarios.empresas_acceso (JSON array de slugs).
 * - Con BD por empresa: replica el usuario en cada BD marcada.
 */
const config = require('../config');
const { getDb, getAllCompanyDbs } = require('../db/tenants');

const VALID = new Set(config.companies.map((c) => c.slug));

function normalizeEmpresasAcceso(input, fallbackSlug) {
  let list = [];
  if (Array.isArray(input)) list = input;
  else if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input);
      list = Array.isArray(parsed) ? parsed : input.split(/[,;\s]+/);
    } catch (_) {
      list = input.split(/[,;\s]+/);
    }
  }
  const out = [...new Set(
    list.map((s) => String(s || '').toLowerCase().trim()).filter((s) => VALID.has(s))
  )];
  if (!out.length && fallbackSlug && VALID.has(String(fallbackSlug).toLowerCase())) {
    out.push(String(fallbackSlug).toLowerCase());
  }
  return out;
}

function parseEmpresasAcceso(raw) {
  return normalizeEmpresasAcceso(raw, null);
}

function serializeEmpresasAcceso(slugs) {
  return JSON.stringify(normalizeEmpresasAcceso(slugs, null));
}

/** Vacío = legado (acceso a la BD donde existe el usuario). */
function userCanAccessEmpresa(userRow, empresaSlug) {
  const slug = String(empresaSlug || '').toLowerCase();
  if (!VALID.has(slug)) return false;
  const list = parseEmpresasAcceso(userRow?.empresas_acceso);
  if (!list.length) return true;
  return list.includes(slug);
}

async function columnExists(db, table, col) {
  try {
    if (db.driver === 'mysql') {
      const row = await db.prepare(`
        SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      `).get(table, col);
      return Number(row?.c || 0) > 0;
    }
    const cols = await db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === col);
  } catch (_) {
    return false;
  }
}

async function setEmpresasAccesoOnDb(db, userId, empresas) {
  if (!(await columnExists(db, 'usuarios', 'empresas_acceso'))) return;
  const json = serializeEmpresasAcceso(empresas);
  await db.prepare('UPDATE usuarios SET empresas_acceso = ? WHERE id = ?').run(json, userId);
}

async function setEmpresasAccesoByEmail(db, email, empresas) {
  if (!(await columnExists(db, 'usuarios', 'empresas_acceso'))) return;
  const json = serializeEmpresasAcceso(empresas);
  await db.prepare('UPDATE usuarios SET empresas_acceso = ? WHERE LOWER(email) = LOWER(?)').run(json, email);
}

/**
 * Crea o actualiza el mismo usuario en las BDs de las empresas marcadas.
 * En modo MySQL compartido solo actualiza empresas_acceso en la BD actual.
 */
async function syncUserAcrossEmpresas(opts) {
  const {
    sourceDb,
    sourceEmpresa,
    email,
    profile,
    passwordHash,
    rolIds,
    empresas,
    deactivateMissing = true
  } = opts;

  const slugs = normalizeEmpresasAcceso(empresas, sourceEmpresa);
  const emailNorm = String(email || '').trim();
  if (!emailNorm) throw new Error('Email requerido para sync multiempresa');

  // Misma conexión física para todas → solo JSON
  const sharedMysql = config.isMysql && !config.mysqlPerCompany;
  if (sharedMysql || (!config.isMysql && getAllCompanyDbs().length <= 1)) {
    const row = await sourceDb.prepare('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)').get(emailNorm);
    if (row?.id) await setEmpresasAccesoOnDb(sourceDb, row.id, slugs);
    return { empresas: slugs, synced: [sourceEmpresa], mode: 'shared' };
  }

  const { setUserRoles, normalizeRolIds } = require('./usuario-roles');
  const roles = normalizeRolIds(rolIds != null ? rolIds : profile?.rol_id, 3);
  const primaryRol = roles[0] || 3;
  const synced = [];
  const errors = [];

  for (const slug of slugs) {
    let db;
    try {
      db = getDb(slug);
    } catch (err) {
      errors.push({ slug, error: err.message });
      continue;
    }
    try {
      const existing = await db.prepare(
        'SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)'
      ).get(emailNorm);

      const flag = (v) => (v === true || v === 1 || v === '1' ? 1 : 0);
      const nombre = profile.nombre;
      const apellido = profile.apellido;
      const cargo = profile.cargo || null;
      const telefono = profile.telefono || null;
      const dept = profile.departamento_id ? Number(profile.departamento_id) : null;

      let userId = existing?.id;
      let hashToUse = passwordHash;
      if (!existing && !hashToUse) {
        try {
          const src = await sourceDb.prepare(
            'SELECT password FROM usuarios WHERE LOWER(email) = LOWER(?)'
          ).get(emailNorm);
          hashToUse = src?.password || null;
        } catch (_) { /* */ }
      }
      if (existing) {
        const sets = [
          'nombre = ?', 'apellido = ?', 'cargo = ?', 'telefono = ?',
          'rol_id = ?', 'departamento_id = ?', 'activo = 1'
        ];
        const params = [nombre, apellido, cargo, telefono, primaryRol, dept];
        if (hashToUse) {
          sets.push('password = ?');
          params.push(hashToUse);
        }
        if (await columnExists(db, 'usuarios', 'flag_checklist')) {
          sets.push(
            'flag_checklist = ?', 'flag_flota = ?', 'flag_ssgg = ?',
            'flag_camion_pluma = ?', 'flag_aprobador_salida = ?'
          );
          params.push(
            flag(profile.flag_checklist), flag(profile.flag_flota), flag(profile.flag_ssgg),
            flag(profile.flag_camion_pluma), flag(profile.flag_aprobador_salida)
          );
        }
        params.push(userId);
        await db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      } else {
        if (!hashToUse) {
          errors.push({ slug, error: 'Password requerido para crear en otra empresa' });
          continue;
        }
        const attempts = [
          {
            sql: `INSERT INTO usuarios (
              nombre, apellido, email, password, cargo, rol_id, departamento_id, telefono,
              flag_checklist, flag_flota, flag_ssgg, flag_camion_pluma, flag_aprobador_salida, activo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            params: [
              nombre, apellido, emailNorm, hashToUse, cargo, primaryRol, dept, telefono,
              flag(profile.flag_checklist), flag(profile.flag_flota), flag(profile.flag_ssgg),
              flag(profile.flag_camion_pluma), flag(profile.flag_aprobador_salida)
            ]
          },
          {
            sql: `INSERT INTO usuarios (
              nombre, apellido, email, password, cargo, rol_id, departamento_id, telefono, activo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            params: [nombre, apellido, emailNorm, hashToUse, cargo, primaryRol, dept, telefono]
          }
        ];
        let lastErr = null;
        for (const a of attempts) {
          try {
            const info = await db.prepare(a.sql).run(...a.params);
            userId = info.lastInsertRowid;
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (/Unknown column|no such column/i.test(err.message || '')) continue;
            throw err;
          }
        }
        if (lastErr) throw lastErr;
      }

      if (userId) {
        try { await setUserRoles(db, userId, roles); } catch (_) { /* */ }
        await setEmpresasAccesoOnDb(db, userId, slugs);
        synced.push(slug);
      }
    } catch (err) {
      errors.push({ slug, error: err.message });
    }
  }

  if (deactivateMissing) {
    for (const { company, db } of getAllCompanyDbs()) {
      if (slugs.includes(company.slug)) continue;
      try {
        await db.prepare(
          'UPDATE usuarios SET activo = 0 WHERE LOWER(email) = LOWER(?)'
        ).run(emailNorm);
        await setEmpresasAccesoByEmail(db, emailNorm, slugs);
      } catch (_) { /* */ }
    }
  }

  // Asegura JSON también en la BD origen
  try {
    await setEmpresasAccesoByEmail(sourceDb, emailNorm, slugs);
  } catch (_) { /* */ }

  return { empresas: slugs, synced, errors, mode: 'per-company' };
}

module.exports = {
  VALID,
  normalizeEmpresasAcceso,
  parseEmpresasAcceso,
  serializeEmpresasAcceso,
  userCanAccessEmpresa,
  setEmpresasAccesoOnDb,
  syncUserAcrossEmpresas
};
