/**
 * Catálogo de permisos especiales (liberadores) — reemplaza hardcodes tipo Edith Gómez.
 */
const CATALOGO = [
  {
    codigo: 'materiales_super_aprobador',
    modulo: 'Materiales',
    titulo: 'Super aprobador de materiales',
    descripcion: 'Aprueba cualquier solicitud de salida de materiales (perfil tipo Edith Gómez / Supply Chain).',
    flag: 'flag_aprobador_salida'
  },
  {
    codigo: 'materiales_usuario_especial',
    modulo: 'Materiales',
    titulo: 'Materiales — acciones especiales',
    descripcion: 'Editar, modificar, validar OC, anular y acciones especiales en salidas de materiales.',
    flag: 'flag_aprobador_salida'
  },
  {
    codigo: 'guias_validador',
    modulo: 'Materiales',
    titulo: 'Validador de guías de despacho',
    descripcion: 'Puede validar guías de despacho (Edith Gómez, Nicole Gálvez, etc.).',
    flag: 'flag_aprobador_salida'
  },
  {
    codigo: 'validador_oc_supply_chain',
    modulo: 'Portal Proveedores',
    titulo: 'Validador OC (directo proveedor)',
    descripcion: 'Valida la OC en salidas directo-proveedor antes de notificar al proveedor (Supply Chain / Edith).',
    flag: 'flag_aprobador_salida'
  },
  {
    codigo: 'materiales_sc_segundo',
    modulo: 'Materiales',
    titulo: 'Sobre consumo — segundo liberador',
    descripcion: 'Segundo liberador cuando la solicitud es de tipo sobre consumo.',
    flag: null
  },
  {
    codigo: 'materiales_eliminar',
    modulo: 'Materiales',
    titulo: 'Eliminar solicitudes de materiales',
    descripcion: 'Puede eliminar solicitudes en estados permitidos.',
    flag: null
  },
  {
    codigo: 'materiales_modificar_admin',
    modulo: 'Materiales',
    titulo: 'Panel Modificar materiales (admin)',
    descripcion: 'Acceso al panel administrativo de modificación de materiales.',
    flag: null
  },
  {
    codigo: 'camion_agenda_control',
    modulo: 'Camión Pluma',
    titulo: 'Control Agenda Camión Pluma',
    descripcion: 'Permiso adicional para crear/editar agenda. También basta con el check del módulo «Agenda Camión Pluma» en el rol.',
    flag: 'flag_camion_pluma'
  },
  {
    codigo: 'camion_editar_km_precios',
    modulo: 'Camión Pluma',
    titulo: 'Camión pluma — editar km y precios',
    descripcion: 'Puede editar kilometraje y precios de venta en la agenda.',
    flag: 'flag_camion_pluma'
  },
  {
    codigo: 'compras_super_aprobador',
    modulo: 'Compras',
    titulo: 'Compras — super aprobador',
    descripcion: 'Puede aprobar cualquier solicitud de compras.',
    flag: null
  },
  {
    codigo: 'compras_aprobador_backup',
    modulo: 'Compras',
    titulo: 'Compras — aprobador backup',
    descripcion: 'Aprobador alterno / escalamiento en compras.',
    flag: null
  },
  {
    codigo: 'facturas_aprobador',
    modulo: 'Facturas',
    titulo: 'Aprobación de facturas',
    descripcion: 'Responsable de aprobar facturas.',
    flag: null
  },
  {
    codigo: 'servicios_generales_aprobador',
    modulo: 'SSGG',
    titulo: 'Servicios generales — aprobador',
    descripcion: 'Aprobador de tickets SSGG.',
    flag: 'flag_ssgg'
  },
  {
    codigo: 'flota_aprobador',
    modulo: 'Flota',
    titulo: 'Checklist flota — aprobador',
    descripcion: 'Aprobador / encargado de checklist de flota.',
    flag: 'flag_flota'
  },
  {
    codigo: 'flota_gestion_incidencias',
    modulo: 'Flota',
    titulo: 'Gestión de incidencias checklist',
    descripcion: 'Toma y gestiona requerimientos con problemas en checklist de flota (Martin Vera, Charly Machado).',
    flag: 'flag_flota'
  },
  {
    codigo: 'asignar_bodeguero_extra',
    modulo: 'Materiales',
    titulo: 'Asignar bodeguero (excepciones)',
    descripcion: 'Puede asignar bodeguero aunque su rol no sea de bodega.',
    flag: null
  },
  {
    codigo: 'catalogo_g_editor',
    modulo: 'Catálogo G',
    titulo: 'Catálogo G — editor',
    descripcion: 'Puede crear y editar ítems del Catálogo G (analistas: Michelle Ávila, Miguel Cañete). También editan: Administrador, Subadministrador y rol «Catálogo G». Solo empresa Global.',
    flag: null
  },
  {
    codigo: 'catalogo_s_editor',
    modulo: 'Catálogo S',
    titulo: 'Catálogo S — editor',
    descripcion: 'Puede crear y editar ítems del Catálogo S. También editan: Administrador, Subadministrador y rol «Catálogo S». Solo empresa Sercom.',
    flag: null
  },
  {
    codigo: 'catalogo_n_editor',
    modulo: 'Catálogo N',
    titulo: 'Catálogo N — editor',
    descripcion: 'Puede crear y editar ítems del Catálogo N. También editan: Administrador, Subadministrador y rol «Catálogo N». Solo empresa Nexus.',
    flag: null
  },
  {
    codigo: 'catalogo_t_editor',
    modulo: 'Catálogo T',
    titulo: 'Catálogo T — editor',
    descripcion: 'Puede crear y editar ítems del Catálogo T. También editan: Administrador, Subadministrador y rol «Catálogo T». Solo empresa Táctica.',
    flag: null
  }
];

const FLAG_BY_CODIGO = Object.fromEntries(
  CATALOGO.filter((c) => c.flag).map((c) => [c.codigo, c.flag])
);

async function hasColumn(db, table, col) {
  if (db.driver !== 'mysql') return true;
  try {
    const row = await db.prepare(`
      SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
    `).get(table, col);
    return !!(row && Number(row.c) > 0);
  } catch (_) {
    return false;
  }
}

async function migrateLiberadoresColumns(db) {
  if (db.driver !== 'mysql') return;
  const cols = [
    ['modulo', "VARCHAR(80) NOT NULL DEFAULT ''"],
    ['titulo', 'VARCHAR(255) NULL'],
    ['descripcion', 'TEXT NULL'],
    ['activo', 'TINYINT NOT NULL DEFAULT 1'],
    ['orden', 'INT NOT NULL DEFAULT 0']
  ];
  for (const [col, ddl] of cols) {
    try {
      const row = await db.prepare(`
        SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'liberadores_config' AND column_name = ?
      `).get(col);
      if (row && Number(row.c) === 0) {
        await db.exec(`ALTER TABLE liberadores_config ADD COLUMN \`${col}\` ${ddl}`);
      }
    } catch (err) {
      try {
        await db.exec(`ALTER TABLE liberadores_config ADD COLUMN \`${col}\` ${ddl}`);
      } catch (err2) {
        if (!/duplicate column/i.test(err2.message || '')) {
          console.warn('[permisos] migrate', col, err.message || err2.message);
        }
      }
    }
  }
  try {
    await db.exec(`
      UPDATE liberadores_config SET titulo = nombre
      WHERE (titulo IS NULL OR titulo = '') AND nombre IS NOT NULL AND nombre != ''
    `);
  } catch (_) { /* legacy sin nombre */ }
}

async function ensureTables(db) {
  if (db.driver === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS liberadores_config (
        codigo VARCHAR(80) NOT NULL PRIMARY KEY,
        modulo VARCHAR(80) NOT NULL DEFAULT '',
        titulo VARCHAR(255) NULL,
        descripcion TEXT NULL,
        usuario_id INT NULL,
        activo TINYINT NOT NULL DEFAULT 1,
        orden INT NOT NULL DEFAULT 0
      )
    `);
    await migrateLiberadoresColumns(db);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS liberadores_extra (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(80) NOT NULL,
        usuario_id INT NOT NULL,
        orden INT DEFAULT 0,
        UNIQUE KEY uq_lib_extra (codigo, usuario_id)
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS liberadores_config (
        codigo TEXT NOT NULL PRIMARY KEY,
        modulo TEXT,
        titulo TEXT,
        descripcion TEXT,
        usuario_id INTEGER,
        activo INTEGER NOT NULL DEFAULT 1,
        orden INTEGER DEFAULT 0
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS liberadores_extra (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL,
        usuario_id INTEGER NOT NULL,
        orden INTEGER DEFAULT 0,
        UNIQUE(codigo, usuario_id)
      )
    `);
  }
}

async function seedCatalog(db) {
  for (let i = 0; i < CATALOGO.length; i++) {
    const c = CATALOGO[i];
    const orden = (i + 1) * 10;
    let inserted = false;
    if (db.driver === 'mysql' && await hasColumn(db, 'liberadores_config', 'titulo')) {
      try {
        await db.prepare(`
          INSERT IGNORE INTO liberadores_config (codigo, modulo, titulo, descripcion, activo, orden)
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(c.codigo, c.modulo, c.titulo, c.descripcion, orden);
        inserted = true;
      } catch (_) { /* fallback abajo */ }
    } else if (db.driver !== 'mysql') {
      try {
        await db.prepare(`
          INSERT OR IGNORE INTO liberadores_config (codigo, modulo, titulo, descripcion, activo, orden)
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(c.codigo, c.modulo, c.titulo, c.descripcion, orden);
        inserted = true;
      } catch (_) { /* fallback */ }
    }
    if (!inserted) {
      try {
        if (db.driver === 'mysql') {
          await db.prepare(`INSERT IGNORE INTO liberadores_config (codigo) VALUES (?)`).run(c.codigo);
        } else {
          await db.prepare(`INSERT OR IGNORE INTO liberadores_config (codigo) VALUES (?)`).run(c.codigo);
        }
      } catch (_2) { /* ignore */ }
    }
  }
}

/** Asigna usuarios conocidos de producción una sola vez (no re-asigna si el admin los quitó). */
async function seedKnownUsers(db) {
  try {
    const done = await db.prepare(
      `SELECT codigo FROM liberadores_config WHERE codigo = '_seed_users_done'`
    ).get();
    if (done) return;
  } catch (_) {
    return;
  }

  const patterns = [
    { codigo: 'materiales_super_aprobador', like: '%edith%' },
    { codigo: 'validador_oc_supply_chain', like: '%edith%' },
    { codigo: 'guias_validador', like: '%edith%' },
    { codigo: 'camion_agenda_control', like: '%edith%' },
    { codigo: 'camion_editar_km_precios', like: '%edith%' },
    { codigo: 'materiales_usuario_especial', like: '%edith%' },
    { codigo: 'materiales_usuario_especial', like: '%nicole%' },
    { codigo: 'materiales_usuario_especial', like: '%manuel%vasquez%' },
    { codigo: 'materiales_usuario_especial', like: '%miguel%ca%ete%' },
    { codigo: 'materiales_modificar_admin', like: '%edith%' },
    { codigo: 'materiales_modificar_admin', like: '%nicole%' },
    { codigo: 'materiales_modificar_admin', like: '%miguel%ca%ete%' },
    { codigo: 'guias_validador', like: '%nicole%' },
    { codigo: 'flota_gestion_incidencias', like: '%martin%vera%' },
    { codigo: 'flota_gestion_incidencias', like: '%charly%machado%' },
    { codigo: 'flota_aprobador', like: '%martin%vera%' },
    { codigo: 'flota_aprobador', like: '%charly%machado%' },
    { codigo: 'guias_validador', like: '%manuel%' },
    { codigo: 'guias_validador', like: '%miguel%ca%ete%' }
  ];

  const nameExpr = db.driver === 'mysql'
    ? `LOWER(CONCAT(IFNULL(nombre,''), ' ', IFNULL(apellido,'')))`
    : `LOWER(IFNULL(nombre,'') || ' ' || IFNULL(apellido,''))`;

  for (const p of patterns) {
    try {
      const users = await db.prepare(`
        SELECT id FROM usuarios
        WHERE (activo = 1 OR activo IS NULL) AND (
          ${nameExpr} LIKE LOWER(?)
          OR LOWER(IFNULL(email,'')) LIKE LOWER(?)
        )
        LIMIT 8
      `).all(p.like, p.like);
      for (const u of users) {
        await addUser(db, p.codigo, u.id);
      }
    } catch (_) { /* ignore seed errors */ }
  }

  try {
    if (db.driver === 'mysql') {
      await db.prepare(`INSERT IGNORE INTO liberadores_config (codigo) VALUES ('_seed_users_done')`).run();
    } else {
      await db.prepare(`INSERT OR IGNORE INTO liberadores_config (codigo) VALUES ('_seed_users_done')`).run();
    }
  } catch (_) { /* ignore */ }
}

async function listAll(db) {
  const titularByCodigo = {};
  try {
    const rows = await db.prepare(`
      SELECT codigo, usuario_id FROM liberadores_config
    `).all();
    for (const r of rows || []) {
      if (r.usuario_id) titularByCodigo[r.codigo] = r.usuario_id;
    }
  } catch (err) {
    console.warn('[permisos] listAll config:', err.message);
  }

  let extras = [];
  try {
    extras = await db.prepare(`
      SELECT e.codigo, e.usuario_id, e.id AS extra_id,
             u.nombre, u.apellido, u.email, u.cargo
      FROM liberadores_extra e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE u.activo = 1 OR u.activo IS NULL
      ORDER BY e.codigo, u.nombre
    `).all();
  } catch (err) {
    console.warn('[permisos] listAll extras:', err.message);
  }

  const byCodigo = {};
  for (const e of extras) {
    if (!byCodigo[e.codigo]) byCodigo[e.codigo] = [];
    byCodigo[e.codigo].push({
      extra_id: e.extra_id,
      usuario_id: e.usuario_id,
      nombre: `${e.nombre} ${e.apellido}`.trim(),
      email: e.email,
      cargo: e.cargo
    });
  }

  for (const [codigo, usuarioId] of Object.entries(titularByCodigo)) {
    if (byCodigo[codigo]?.some((x) => x.usuario_id === usuarioId)) continue;
    try {
      const u = await db.prepare(`
        SELECT id, nombre, apellido, email, cargo FROM usuarios WHERE id = ?
      `).get(usuarioId);
      if (u) {
        const list = byCodigo[codigo] || [];
        list.unshift({
          extra_id: null,
          usuario_id: u.id,
          nombre: `${u.nombre} ${u.apellido}`.trim(),
          email: u.email,
          cargo: u.cargo,
          titular: true
        });
        byCodigo[codigo] = list;
      }
    } catch (_) { /* ignore */ }
  }

  return CATALOGO.map((c, i) => ({
    codigo: c.codigo,
    modulo: c.modulo,
    titulo: c.titulo,
    descripcion: c.descripcion,
    usuario_id: titularByCodigo[c.codigo] || null,
    activo: 1,
    orden: (i + 1) * 10,
    usuarios: byCodigo[c.codigo] || [],
    flag: FLAG_BY_CODIGO[c.codigo] || null
  }));
}

async function syncUserFlag(db, usuarioId, codigo, enabled) {
  const flag = FLAG_BY_CODIGO[codigo];
  if (!flag || !usuarioId) return;
  try {
    if (enabled) {
      await db.prepare(`UPDATE usuarios SET ${flag} = 1 WHERE id = ?`).run(usuarioId);
    } else {
      // Solo apaga el flag si el usuario no tiene otro permiso que lo requiera
      const related = Object.entries(FLAG_BY_CODIGO)
        .filter(([, f]) => f === flag)
        .map(([code]) => code);
      const placeholders = related.map(() => '?').join(',');
      const still = await db.prepare(`
        SELECT COUNT(*) AS c FROM liberadores_extra
        WHERE usuario_id = ? AND codigo IN (${placeholders})
      `).get(usuarioId, ...related);
      const titular = await db.prepare(`
        SELECT COUNT(*) AS c FROM liberadores_config
        WHERE usuario_id = ? AND codigo IN (${placeholders})
      `).get(usuarioId, ...related);
      if (Number(still?.c || 0) + Number(titular?.c || 0) === 0) {
        await db.prepare(`UPDATE usuarios SET ${flag} = 0 WHERE id = ?`).run(usuarioId);
      }
    }
  } catch (err) {
    console.warn('[permisos] sync flag', err.message);
  }
}

async function addUser(db, codigo, usuarioId) {
  const cfg = await db.prepare(`SELECT codigo FROM liberadores_config WHERE codigo = ?`).get(codigo);
  if (!cfg) throw new Error('Permiso no encontrado');
  const user = await db.prepare(`SELECT id FROM usuarios WHERE id = ?`).get(usuarioId);
  if (!user) throw new Error('Usuario no encontrado');

  try {
    if (db.driver === 'mysql') {
      await db.prepare(`
        INSERT IGNORE INTO liberadores_extra (codigo, usuario_id, orden) VALUES (?, ?, 0)
      `).run(codigo, usuarioId);
    } else {
      await db.prepare(`
        INSERT OR IGNORE INTO liberadores_extra (codigo, usuario_id, orden) VALUES (?, ?, 0)
      `).run(codigo, usuarioId);
    }
  } catch (err) {
    throw err;
  }
  await syncUserFlag(db, usuarioId, codigo, true);
}

async function removeUser(db, codigo, usuarioId) {
  await db.prepare(`DELETE FROM liberadores_extra WHERE codigo = ? AND usuario_id = ?`).run(codigo, usuarioId);
  // Si era titular, limpia
  try {
    await db.prepare(`UPDATE liberadores_config SET usuario_id = NULL WHERE codigo = ? AND usuario_id = ?`)
      .run(codigo, usuarioId);
  } catch (_) { /* ignore */ }
  await syncUserFlag(db, usuarioId, codigo, false);
}

async function userHas(db, usuarioId, codigo) {
  const extra = await db.prepare(`
    SELECT id FROM liberadores_extra WHERE codigo = ? AND usuario_id = ? LIMIT 1
  `).get(codigo, usuarioId);
  if (extra) return true;
  const titular = await db.prepare(`
    SELECT codigo FROM liberadores_config WHERE codigo = ? AND usuario_id = ? LIMIT 1
  `).get(codigo, usuarioId);
  return !!titular;
}

async function userCodes(db, usuarioId) {
  const rows = await db.prepare(`
    SELECT codigo FROM liberadores_extra WHERE usuario_id = ?
    UNION
    SELECT codigo FROM liberadores_config WHERE usuario_id = ?
  `).all(usuarioId, usuarioId);
  const map = {};
  for (const r of rows) map[r.codigo] = true;
  return map;
}

async function initPermisos(db) {
  try { await ensureTables(db); } catch (err) {
    console.warn('[permisos] ensureTables:', err.message);
  }
  try { await seedCatalog(db); } catch (err) {
    console.warn('[permisos] seedCatalog:', err.message);
  }
  try { await seedKnownUsers(db); } catch (err) {
    console.warn('[permisos] seedKnownUsers:', err.message);
  }
}

module.exports = {
  CATALOGO,
  initPermisos,
  listAll,
  addUser,
  removeUser,
  userHas,
  userCodes,
  FLAG_BY_CODIGO
};
