/**
 * Usuarios con múltiples roles.
 * Fuente de verdad: usuarios.rol_ids (JSON) + usuarios.rol_id (primario).
 * Tabla usuario_roles se sincroniza cuando está disponible.
 */
const TABLE = 'usuario_roles';

async function ensureUsuarioRolesSchema(db) {
  // Columna JSON en usuarios (robusta en MySQL compartido)
  try {
    if (db.driver === 'mysql') {
      const row = await db.prepare(`
        SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'usuarios' AND column_name = 'rol_ids'
      `).get();
      if (!row || Number(row.c) === 0) {
        await db.exec(`ALTER TABLE usuarios ADD COLUMN rol_ids TEXT NULL`);
        console.log('[usuario-roles] columna usuarios.rol_ids añadida');
      }
    } else {
      const cols = (await db.prepare(`PRAGMA table_info(usuarios)`).all()).map((c) => c.name);
      if (!cols.includes('rol_ids')) {
        await db.exec(`ALTER TABLE usuarios ADD COLUMN rol_ids TEXT`);
      }
    }
  } catch (err) {
    if (!/duplicate column/i.test(String(err.message || ''))) {
      console.warn('[usuario-roles] rol_ids column:', err.message);
    }
  }

  try {
    if (db.driver === 'mysql') {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          usuario_id INT NOT NULL,
          rol_id INT NOT NULL,
          orden INT NOT NULL DEFAULT 0,
          PRIMARY KEY (usuario_id, rol_id),
          KEY idx_ur_rol (rol_id)
        )
      `);
    } else {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          usuario_id INTEGER NOT NULL,
          rol_id INTEGER NOT NULL,
          orden INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (usuario_id, rol_id)
        )
      `);
    }
  } catch (err) {
    console.warn('[usuario-roles] create table:', err.message);
  }

  await backfillFromPrimaryRole(db);
}

async function backfillFromPrimaryRole(db) {
  try {
    // Rellena rol_ids JSON desde rol_id si está vacío
    if (db.driver === 'mysql') {
      await db.exec(`
        UPDATE usuarios
        SET rol_ids = CONCAT('[', rol_id, ']')
        WHERE rol_id IS NOT NULL AND rol_id > 0
          AND (rol_ids IS NULL OR rol_ids = '' OR rol_ids = '[]' OR rol_ids = 'null')
      `);
    } else {
      await db.exec(`
        UPDATE usuarios
        SET rol_ids = '[' || rol_id || ']'
        WHERE rol_id IS NOT NULL AND rol_id > 0
          AND (rol_ids IS NULL OR rol_ids = '' OR rol_ids = '[]' OR rol_ids = 'null')
      `);
    }
  } catch (err) {
    console.warn('[usuario-roles] backfill json:', err.message);
  }

  try {
    if (db.driver === 'mysql') {
      await db.exec(`
        INSERT IGNORE INTO ${TABLE} (usuario_id, rol_id, orden)
        SELECT id, rol_id, 0 FROM usuarios
        WHERE rol_id IS NOT NULL AND rol_id > 0
      `);
    } else {
      await db.exec(`
        INSERT OR IGNORE INTO ${TABLE} (usuario_id, rol_id, orden)
        SELECT id, rol_id, 0 FROM usuarios
        WHERE rol_id IS NOT NULL AND rol_id > 0
      `);
    }
  } catch (err) {
    console.warn('[usuario-roles] backfill table:', err.message);
  }
}

function parsePages(raw) {
  if (raw == null || raw === '') return [];
  try {
    const pages = typeof raw === 'object' ? raw : JSON.parse(raw);
    return Array.isArray(pages) ? pages : [];
  } catch (_) {
    return [];
  }
}

function mergePages(list) {
  const set = new Set();
  for (const raw of list) {
    const pages = parsePages(raw);
    if (pages.includes('*')) return ['*'];
    pages.forEach((p) => {
      const k = String(p || '').replace(/^\//, '').trim();
      if (k) set.add(k);
    });
  }
  return Array.from(set);
}

function normalizeRolIds(input, fallbackRolId) {
  let ids = [];
  if (Array.isArray(input)) {
    ids = input.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  } else if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        ids = parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
      } else {
        ids = String(input).split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      }
    } catch (_) {
      ids = String(input).split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
  } else if (input != null && input !== '') {
    ids = [Number(input)].filter((n) => Number.isFinite(n) && n > 0);
  }
  if (!ids.length && fallbackRolId) {
    const n = Number(fallbackRolId);
    if (Number.isFinite(n) && n > 0) ids = [n];
  }
  return [...new Set(ids)];
}

function parseRolIdsField(raw, fallbackRolId) {
  return normalizeRolIds(raw, fallbackRolId);
}

async function fetchRolesByIds(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  let rows = [];
  try {
    rows = await db.prepare(`
      SELECT id, nombre, paginas_permitidas
      FROM roles WHERE id IN (${placeholders})
    `).all(...ids);
  } catch (_) {
    try {
      rows = await db.prepare(`
        SELECT id, nombre, permisos AS paginas_permitidas
        FROM roles WHERE id IN (${placeholders})
      `).all(...ids);
    } catch (e) {
      console.warn('[usuario-roles] fetchRolesByIds:', e.message);
      return [];
    }
  }
  // Mantener orden de ids
  const map = new Map(rows.map((r) => [Number(r.id), r]));
  return ids.map((id) => map.get(Number(id))).filter(Boolean);
}

async function getRolesForUser(db, userId) {
  await ensureUsuarioRolesSchema(db);
  const uid = Number(userId);

  // 1) Preferir JSON en usuarios.rol_ids
  try {
    const u = await db.prepare(`SELECT rol_id, rol_ids FROM usuarios WHERE id = ?`).get(uid);
    if (u) {
      const ids = parseRolIdsField(u.rol_ids, u.rol_id);
      if (ids.length) {
        const roles = await fetchRolesByIds(db, ids);
        if (roles.length) return roles;
      }
    }
  } catch (_) {
    try {
      const u = await db.prepare(`SELECT rol_id FROM usuarios WHERE id = ?`).get(uid);
      if (u?.rol_id) {
        const roles = await fetchRolesByIds(db, [Number(u.rol_id)]);
        if (roles.length) return roles;
      }
    } catch (e) {
      console.warn('[usuario-roles] getRolesForUser user:', e.message);
    }
  }

  // 2) Tabla N:N
  try {
    const rows = await db.prepare(`
      SELECT r.id, r.nombre, r.paginas_permitidas, ur.orden
      FROM ${TABLE} ur
      JOIN roles r ON r.id = ur.rol_id
      WHERE ur.usuario_id = ?
      ORDER BY ur.orden ASC, r.nombre ASC
    `).all(uid);
    if (rows.length) return rows;
  } catch (_) {
    try {
      const rows = await db.prepare(`
        SELECT r.id, r.nombre, r.permisos AS paginas_permitidas, ur.orden
        FROM ${TABLE} ur
        JOIN roles r ON r.id = ur.rol_id
        WHERE ur.usuario_id = ?
        ORDER BY ur.orden ASC, r.nombre ASC
      `).all(uid);
      if (rows.length) return rows;
    } catch (e) {
      console.warn('[usuario-roles] getRolesForUser join:', e.message);
    }
  }

  return [];
}

async function syncJunctionTable(db, uid, ids) {
  try {
    await db.prepare(`DELETE FROM ${TABLE} WHERE usuario_id = ?`).run(uid);
    const ins = db.prepare(`INSERT INTO ${TABLE} (usuario_id, rol_id, orden) VALUES (?, ?, ?)`);
    for (let i = 0; i < ids.length; i++) {
      await ins.run(uid, ids[i], i);
    }
  } catch (err) {
    console.warn('[usuario-roles] sync junction:', err.message);
  }
}

async function setUserRoles(db, userId, rolIds) {
  await ensureUsuarioRolesSchema(db);
  const uid = Number(userId);
  const ids = normalizeRolIds(rolIds);
  if (!ids.length) {
    const err = new Error('Debe asignar al menos un rol');
    err.status = 400;
    throw err;
  }

  const json = JSON.stringify(ids);
  let saved = false;

  // Guardar JSON + rol primario (intentos con/sin columna rol_ids)
  try {
    await db.prepare(`UPDATE usuarios SET rol_id = ?, rol_ids = ? WHERE id = ?`).run(ids[0], json, uid);
    saved = true;
  } catch (err) {
    console.warn('[usuario-roles] update rol_ids:', err.message);
    try {
      await db.prepare(`UPDATE usuarios SET rol_id = ? WHERE id = ?`).run(ids[0], uid);
    } catch (e2) {
      const e = new Error('No se pudo guardar el rol principal: ' + (e2.message || err.message));
      e.status = 500;
      throw e;
    }
  }

  await syncJunctionTable(db, uid, ids);

  // Verificar lectura
  try {
    const check = await db.prepare(`SELECT rol_id, rol_ids FROM usuarios WHERE id = ?`).get(uid);
    const readBack = parseRolIdsField(check?.rol_ids, check?.rol_id);
    if (saved && readBack.length < ids.length) {
      console.warn('[usuario-roles] read-back mismatch', { ids, readBack, raw: check?.rol_ids });
    }
  } catch (_) { /* ignore */ }

  return ids;
}

async function enrichUserRoles(db, user) {
  if (!user || !user.id) return user;
  const roles = await getRolesForUser(db, user.id);
  const rolIds = roles.map((r) => Number(r.id));
  const nombres = roles.map((r) => r.nombre).filter(Boolean);
  const pages = roles.length
    ? mergePages(roles.map((r) => r.paginas_permitidas))
    : parsePages(user.paginas_permitidas);

  return {
    ...user,
    rol_id: rolIds[0] || user.rol_id || null,
    rol_ids: rolIds.length ? rolIds : (user.rol_id ? [Number(user.rol_id)] : []),
    roles: nombres,
    rol: nombres.length ? nombres.join(', ') : (user.rol || 'Usuario'),
    paginas_permitidas: pages.length
      ? pages
      : (parsePages(user.paginas_permitidas).length ? parsePages(user.paginas_permitidas) : ['*'])
  };
}

async function attachRolesToUserList(db, users) {
  await ensureUsuarioRolesSchema(db);
  const list = Array.isArray(users) ? users : [];
  if (!list.length) return list;

  // Leer rol_ids de todos los usuarios (batch)
  let byId = new Map();
  try {
    const rows = await db.prepare(`SELECT id, rol_id, rol_ids FROM usuarios`).all();
    for (const r of rows) byId.set(Number(r.id), r);
  } catch (_) {
    try {
      const rows = await db.prepare(`SELECT id, rol_id FROM usuarios`).all();
      for (const r of rows) byId.set(Number(r.id), r);
    } catch (e) {
      console.warn('[usuario-roles] attach list users:', e.message);
    }
  }

  // Junction fallback map
  const junction = new Map();
  try {
    const links = await db.prepare(`
      SELECT ur.usuario_id, ur.rol_id, ur.orden, r.nombre
      FROM ${TABLE} ur
      JOIN roles r ON r.id = ur.rol_id
      ORDER BY ur.usuario_id, ur.orden, r.nombre
    `).all();
    for (const row of links) {
      const uid = Number(row.usuario_id);
      if (!junction.has(uid)) junction.set(uid, []);
      junction.get(uid).push(row);
    }
  } catch (_) { /* optional */ }

  // Catálogo de roles para nombres
  let roleNameById = new Map();
  try {
    const allRoles = await db.prepare(`SELECT id, nombre FROM roles`).all();
    roleNameById = new Map(allRoles.map((r) => [Number(r.id), r.nombre]));
  } catch (_) { /* ignore */ }

  return list.map((u) => {
    const uid = Number(u.id);
    const row = byId.get(uid);
    let rolIds = parseRolIdsField(row?.rol_ids, row?.rol_id || u.rol_id);
    let nombres = rolIds.map((id) => roleNameById.get(id)).filter(Boolean);

    if (!rolIds.length && junction.has(uid)) {
      const j = junction.get(uid);
      rolIds = j.map((r) => Number(r.rol_id));
      nombres = j.map((r) => r.nombre).filter(Boolean);
    }

    if (!rolIds.length && u.rol_id) {
      rolIds = [Number(u.rol_id)];
      if (u.rol) nombres = [String(u.rol).split(',')[0].trim()];
    }

    if (!nombres.length && u.rol) nombres = [u.rol];

    return {
      ...u,
      rol_id: rolIds[0] || u.rol_id || null,
      rol_ids: rolIds,
      roles: nombres,
      rol: nombres.length ? nombres.join(', ') : (u.rol || '—')
    };
  });
}

async function countUsersWithRole(db, rolId) {
  await ensureUsuarioRolesSchema(db);
  const id = Number(rolId);
  let c = 0;
  try {
    const row = await db.prepare(`
      SELECT COUNT(*) AS c FROM usuarios
      WHERE rol_id = ?
         OR rol_ids LIKE ?
         OR rol_ids LIKE ?
         OR rol_ids LIKE ?
         OR rol_ids = ?
    `).get(
      id,
      `%[${id},%`,
      `%,${id},%`,
      `%,${id}]%`,
      `[${id}]`
    );
    c = Number(row?.c || 0);
  } catch (_) { /* ignore */ }
  if (c > 0) return c;
  try {
    const row = await db.prepare(`
      SELECT COUNT(DISTINCT usuario_id) AS c FROM ${TABLE} WHERE rol_id = ?
    `).get(id);
    return Number(row?.c || 0);
  } catch (_) {
    return 0;
  }
}

module.exports = {
  ensureUsuarioRolesSchema,
  getRolesForUser,
  setUserRoles,
  enrichUserRoles,
  attachRolesToUserList,
  normalizeRolIds,
  mergePages,
  countUsersWithRole
};
