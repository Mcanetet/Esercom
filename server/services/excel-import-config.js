/**
 * Importación Excel: usuarios e inventario (materiales).
 */
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.text != null) return String(v.text).trim();
  if (typeof v === 'object' && v.result != null) return String(v.result).trim();
  return String(v).trim();
}

function normHeader(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

function decodeUploadBody(body) {
  const raw = body?.dataUrl || body?.base64 || body?.file;
  if (!raw) {
    const err = new Error('Archivo Excel requerido (dataUrl o base64)');
    err.status = 400;
    throw err;
  }
  const b64 = String(raw).includes(',') ? String(raw).split(',')[1] : String(raw);
  return Buffer.from(b64, 'base64');
}

function mapHeaders(ws, aliasesByField) {
  for (let r = 1; r <= Math.min(ws.rowCount || 0, 30); r++) {
    const row = ws.getRow(r);
    const colMap = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = normHeader(cell.value);
      if (!key) return;
      for (const [field, aliases] of Object.entries(aliasesByField)) {
        if (aliases.includes(key) || aliases.some((a) => key === a || key.includes(a))) {
          colMap[col] = field;
        }
      }
    });
    const fields = Object.values(colMap);
    if (fields.length >= 2) return { headerRow: r, colMap };
  }
  return null;
}

function extractRows(ws, aliasesByField, requiredAny) {
  const mapped = mapHeaders(ws, aliasesByField);
  if (!mapped) return [];
  const { headerRow, colMap } = mapped;
  const out = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    Object.entries(colMap).forEach(([col, field]) => {
      obj[field] = cellText(row.getCell(Number(col)).value);
    });
    if (requiredAny.some((f) => obj[f])) out.push(obj);
  }
  return out;
}

/* ========== USUARIOS ========== */

const USER_ALIASES = {
  nombre: ['nombre', 'name', 'primernombre'],
  apellido: ['apellido', 'lastname', 'apellidos'],
  email: ['email', 'correo', 'mail', 'usuario'],
  password: ['password', 'clave', 'contrasena', 'pass'],
  cargo: ['cargo', 'puesto', 'job'],
  telefono: ['telefono', 'fono', 'celular', 'mobile'],
  rol: ['rol', 'role', 'perfil', 'rolid'],
  empresas: ['empresas', 'empresa', 'companias', 'acceso']
};

async function buildPlantillaUsuarios(roles = [], empresas = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Usuarios');
  ws.addRow(['Nombre', 'Apellido', 'Email', 'Password', 'Cargo', 'Telefono', 'Rol', 'Empresas']);
  ws.addRow([
    'Juan',
    'Pérez',
    'juan.perez@ejemplo.cl',
    'Cambiar123!',
    'Analista',
    '+56 9 1234 5678',
    roles[0]?.nombre || 'Solicitante',
    (empresas[0]?.slug || 'sercom')
  ]);
  ws.getRow(1).font = { bold: true };
  ws.columns = [
    { width: 14 }, { width: 14 }, { width: 32 }, { width: 14 },
    { width: 16 }, { width: 16 }, { width: 16 }, { width: 28 }
  ];

  const wsRoles = wb.addWorksheet('Roles');
  wsRoles.addRow(['id', 'nombre']);
  (roles || []).forEach((r) => wsRoles.addRow([r.id, r.nombre]));
  wsRoles.getRow(1).font = { bold: true };

  const wsEmp = wb.addWorksheet('Empresas');
  wsEmp.addRow(['slug', 'nombre']);
  (empresas || []).forEach((e) => wsEmp.addRow([e.slug, e.name || e.nombre]));
  wsEmp.getRow(1).font = { bold: true };

  const wsHelp = wb.addWorksheet('Instrucciones');
  wsHelp.addRow(['Columnas']);
  wsHelp.addRow(['Nombre*, Apellido*, Email*, Password (opcional: Cambiar123!), Cargo, Telefono, Rol (nombre o id), Empresas (slugs separados por coma)']);
  wsHelp.addRow(['Si el email ya existe se omite esa fila.']);
  wsHelp.getColumn(1).width = 100;

  return wb.xlsx.writeBuffer();
}

async function resolveRolId(db, rolRaw, rolesCache) {
  const raw = String(rolRaw || '').trim();
  if (!raw) return 3;
  if (/^\d+$/.test(raw)) return Number(raw);
  const roles = rolesCache || (await db.prepare('SELECT id, nombre FROM roles').all());
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const found = roles.find((r) => norm(r.nombre) === norm(raw));
  return found ? Number(found.id) : 3;
}

async function createUserFromRow(db, row, opts = {}) {
  const { setUserRoles, normalizeRolIds } = require('./usuario-roles');
  const { normalizeEmpresasAcceso, syncUserAcrossEmpresas } = require('./usuario-empresas');

  const nombre = String(row.nombre || '').trim();
  const apellido = String(row.apellido || '').trim();
  const email = String(row.email || '').trim().toLowerCase();
  if (!nombre || !apellido || !email) {
    return { ok: false, skip: true, reason: 'Faltan nombre, apellido o email' };
  }

  const existing = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existing) {
    return { ok: false, skip: true, reason: 'Email ya existe', email };
  }

  const password = String(row.password || '').trim() || opts.defaultPassword || 'Cambiar123!';
  const hash = bcrypt.hashSync(password, 10);
  const rolId = await resolveRolId(db, row.rol, opts.roles);
  const rolIds = normalizeRolIds([rolId], 3);
  const primaryRol = rolIds[0] || 3;
  const sessionEmpresa = String(opts.sessionEmpresa || 'sercom').toLowerCase();
  const empresasRaw = String(row.empresas || '').split(/[,;|/]+/).map((s) => s.trim()).filter(Boolean);
  const empresas = normalizeEmpresasAcceso(empresasRaw.length ? empresasRaw : [sessionEmpresa], sessionEmpresa);

  const attempts = [
    {
      sql: `INSERT INTO usuarios (
          nombre, apellido, email, password, cargo, rol_id, departamento_id, telefono,
          flag_checklist, flag_flota, flag_ssgg, flag_camion_pluma, flag_aprobador_salida
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, 0, 0, 0)`,
      params: [nombre, apellido, email, hash, row.cargo || null, primaryRol, row.telefono || null]
    },
    {
      sql: `INSERT INTO usuarios (nombre, apellido, email, password, cargo, rol_id, telefono)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [nombre, apellido, email, hash, row.cargo || null, primaryRol, row.telefono || null]
    }
  ];

  let newId = null;
  let lastErr = null;
  for (const a of attempts) {
    try {
      const info = await db.prepare(a.sql).run(...a.params);
      newId = info.lastInsertRowid;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (/Duplicate|UNIQUE/i.test(err.message || '')) {
        return { ok: false, skip: true, reason: 'Email ya existe', email };
      }
      if (!/Unknown column|no such column/i.test(err.message || '')) break;
    }
  }
  if (!newId) {
    return { ok: false, reason: lastErr?.message || 'No se pudo crear', email };
  }

  try { await setUserRoles(db, newId, rolIds); } catch (_) { /* */ }

  try {
    await syncUserAcrossEmpresas({
      sourceDb: db,
      sourceEmpresa: sessionEmpresa,
      email,
      profile: {
        nombre, apellido,
        cargo: row.cargo,
        telefono: row.telefono,
        rol_id: primaryRol
      },
      passwordHash: hash,
      rolIds,
      empresas,
      deactivateMissing: false
    });
  } catch (_) { /* */ }

  return { ok: true, id: newId, email, password_default: !String(row.password || '').trim() };
}

async function importUsuariosExcel(db, buffer, opts = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  let roles = [];
  try { roles = await db.prepare('SELECT id, nombre FROM roles').all(); } catch (_) { roles = []; }

  const rows = [];
  for (const ws of wb.worksheets || []) {
    if (/instruccion|rol|empresa/i.test(ws.name) && !/usuario/i.test(ws.name)) continue;
    rows.push(...extractRows(ws, USER_ALIASES, ['email', 'nombre']));
  }
  if (!rows.length) {
    const err = new Error('No se encontraron filas. Use columnas: Nombre, Apellido, Email, Password, Cargo, Telefono, Rol, Empresas');
    err.status = 400;
    throw err;
  }

  const created = [];
  const skipped = [];
  const errors = [];
  for (const row of rows) {
    const r = await createUserFromRow(db, row, {
      sessionEmpresa: opts.sessionEmpresa,
      roles,
      defaultPassword: opts.defaultPassword || 'Cambiar123!'
    });
    if (r.ok) created.push(r);
    else if (r.skip) skipped.push(r);
    else errors.push(r);
  }

  return {
    total: created.length,
    skipped: skipped.length,
    errors: errors.length,
    created,
    skipped_detail: skipped.slice(0, 30),
    error_detail: errors.slice(0, 30),
    archivo_nombre: String(opts.filename || 'usuarios.xlsx').slice(0, 255),
    password_default_si_vacio: opts.defaultPassword || 'Cambiar123!'
  };
}

/* ========== MATERIALES (inventario) ========== */

const MAT_ALIASES = {
  codigo: ['codigo', 'code', 'sku', 'cod'],
  nombre: ['nombre', 'name', 'descripcion', 'producto', 'material', 'item'],
  descripcion: ['descripciondetalle', 'detalle', 'observacion', 'obs'],
  unidad: ['unidad', 'unit', 'um', 'uom'],
  precio: ['precio', 'price', 'valor', 'costo'],
  stock: ['stock', 'cantidad', 'qty', 'existencia', 'saldo']
};

async function buildPlantillaMateriales() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Materiales');
  ws.addRow(['Codigo', 'Nombre', 'Descripcion', 'Unidad', 'Precio', 'Stock']);
  ws.addRow(['MAT-001', 'Tornillo 1/4', 'Tornillo hexagonal', 'UN', 150, 100]);
  ws.addRow(['MAT-002', 'Cable UTP', 'Cable red Cat6', 'MT', 890, 250]);
  ws.getRow(1).font = { bold: true };
  ws.columns = [
    { width: 14 }, { width: 28 }, { width: 32 }, { width: 10 }, { width: 12 }, { width: 10 }
  ];
  const help = wb.addWorksheet('Instrucciones');
  help.addRow(['Codigo* y Nombre* son obligatorios. Si el código ya existe se actualiza nombre/stock/precio.']);
  help.getColumn(1).width = 90;
  return wb.xlsx.writeBuffer();
}

async function upsertMaterial(db, row) {
  const codigo = String(row.codigo || '').trim();
  const nombre = String(row.nombre || '').trim();
  if (!codigo || !nombre) {
    return { ok: false, skip: true, reason: 'Faltan código o nombre' };
  }
  const unidad = String(row.unidad || 'UN').trim() || 'UN';
  const descripcion = String(row.descripcion || '').trim() || null;
  const precio = Number(String(row.precio || '0').replace(',', '.')) || 0;
  const stock = Number(String(row.stock || '0').replace(',', '.')) || 0;

  const existing = await db.prepare('SELECT id FROM materiales WHERE codigo = ?').get(codigo);
  if (existing) {
    try {
      await db.prepare(`
        UPDATE materiales SET nombre = ?, descripcion = COALESCE(?, descripcion),
          unidad = ?, precio = ?, stock = ?, activo = 1
        WHERE id = ?
      `).run(nombre, descripcion, unidad, precio, stock, existing.id);
    } catch (_) {
      try {
        await db.prepare(`
          UPDATE materiales SET nombre = ?, unidad = ?, activo = 1 WHERE id = ?
        `).run(nombre, unidad, existing.id);
      } catch (e) {
        return { ok: false, reason: e.message, codigo };
      }
    }
    return { ok: true, updated: true, id: existing.id, codigo };
  }

  try {
    const info = await db.prepare(`
      INSERT INTO materiales (codigo, nombre, descripcion, unidad, precio, stock)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(codigo, nombre, descripcion, unidad, precio, stock);
    return { ok: true, created: true, id: info.lastInsertRowid, codigo };
  } catch (_) {
    try {
      const info = await db.prepare(`
        INSERT INTO materiales (codigo, nombre, descripcion, unidad)
        VALUES (?, ?, ?, ?)
      `).run(codigo, nombre, descripcion, unidad);
      return { ok: true, created: true, id: info.lastInsertRowid, codigo };
    } catch (e) {
      return { ok: false, reason: e.message, codigo };
    }
  }
}

async function importMaterialesExcel(db, buffer, opts = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const rows = [];
  for (const ws of wb.worksheets || []) {
    if (/instruccion/i.test(ws.name)) continue;
    rows.push(...extractRows(ws, MAT_ALIASES, ['codigo', 'nombre']));
  }
  if (!rows.length) {
    const err = new Error('No se encontraron filas. Use columnas: Codigo, Nombre, Descripcion, Unidad, Precio, Stock');
    err.status = 400;
    throw err;
  }

  let created = 0;
  let updated = 0;
  const errors = [];
  for (const row of rows) {
    const r = await upsertMaterial(db, row);
    if (r.ok && r.created) created += 1;
    else if (r.ok && r.updated) updated += 1;
    else if (!r.skip) errors.push(r);
  }

  return {
    total: created + updated,
    created,
    updated,
    errors: errors.length,
    error_detail: errors.slice(0, 30),
    archivo_nombre: String(opts.filename || 'materiales.xlsx').slice(0, 255)
  };
}

module.exports = {
  decodeUploadBody,
  buildPlantillaUsuarios,
  importUsuariosExcel,
  buildPlantillaMateriales,
  importMaterialesExcel
};
