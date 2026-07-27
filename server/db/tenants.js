const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('../config');

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

const connections = new Map();

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

function dbPathFor(slug) {
  return path.join(config.dataDir, `${slug}.db`);
}

function openDb(slug) {
  ensureDataDir();
  const file = dbPathFor(slug);
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function getDb(slug) {
  const key = String(slug || '').toLowerCase();
  if (!config.getCompany(key)) {
    throw new Error(`Empresa no válida: ${slug}`);
  }
  if (!connections.has(key)) {
    if (!fs.existsSync(dbPathFor(key))) {
      throw new Error(`Base de datos no inicializada para ${key}. Ejecute: npm run init-db`);
    }
    connections.set(key, openDb(key));
  }
  return connections.get(key);
}

function seedCompany(db, company) {
  const passwordHash = bcrypt.hashSync('password', 10);
  const adminEmail = `admin@${company.emailDomain}`;

  db.prepare(`
    INSERT OR IGNORE INTO empresas (id, slug, razon_social, rut, email, telefono, direccion)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(
    company.slug,
    company.razonSocial,
    company.rut,
    adminEmail,
    '+56 2 2345 6789',
    `Santiago, Chile — ${company.name}`
  );

  const roles = [
    [1, 'Administrador', 'Acceso total al sistema', '["*"]'],
    [2, 'Jefe de Proyecto', 'Aprueba solicitudes de materiales', '["home.html","solicitud-salida-materiales.html","reportes.html"]'],
    [3, 'Solicitante', 'Crea solicitudes de salida', '["home.html","solicitud-salida-materiales.html"]'],
    [4, 'Bodeguero', 'Gestiona entregas de bodega', '["home.html","solicitud-salida-materiales.html","gestion-entrega.html"]'],
    [5, 'Supply Chain', 'Aprobación OC y proveedores', '["home.html","solicitud-salida-materiales.html","portal-proveedores.html","solicitud-de-compras.html"]']
  ];
  const insertRol = db.prepare(`
    INSERT OR IGNORE INTO roles (id, nombre, descripcion, paginas_permitidas) VALUES (?, ?, ?, ?)
  `);
  for (const r of roles) insertRol.run(...r);

  const depts = [
    [1, 'Operaciones', 'Operaciones de terreno'],
    [2, 'Logística', 'Bodega y despacho'],
    [3, 'Administración', 'Administración general'],
    [4, 'Compras', 'Supply Chain / Compras']
  ];
  const insertDept = db.prepare(`
    INSERT OR IGNORE INTO departamentos (id, nombre, descripcion) VALUES (?, ?, ?)
  `);
  for (const d of depts) insertDept.run(...d);

  const usuarios = [
    [1, 'Admin', company.name, adminEmail, passwordHash, 'Administrador Sistema', 1, 3],
    [2, 'Juan', 'Pérez', `jperez@${company.emailDomain}`, passwordHash, 'Jefe de Proyecto', 2, 1],
    [3, 'María', 'González', `mgonzalez@${company.emailDomain}`, passwordHash, 'Analista Operaciones', 3, 1],
    [4, 'Carlos', 'Ruiz', `cruiz@${company.emailDomain}`, passwordHash, 'Bodeguero', 4, 2],
    [5, 'Ana', 'Silva', `asilva@${company.emailDomain}`, passwordHash, 'Analista Compras', 5, 4]
  ];
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO usuarios
      (id, nombre, apellido, email, password, cargo, rol_id, departamento_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const u of usuarios) insertUser.run(...u);

  const estados = [
    [1, 'Pendiente Aprobación', 'Espera aprobación del jefe de proyecto', '#f59e0b', 1],
    [2, 'Asignar Bodeguero', 'Pendiente asignación de bodeguero', '#3b82f6', 2],
    [3, 'En Entrega', 'Materiales en proceso de entrega', '#8b5cf6', 3],
    [4, 'Pendiente Aprobación OC', 'Espera aprobación Supply Chain', '#f97316', 4],
    [5, 'Guías Pendientes', 'Espera guías de despacho', '#06b6d4', 5],
    [6, 'Cerrado', 'Solicitud finalizada', '#22c55e', 6],
    [7, 'Rechazado', 'Solicitud rechazada', '#ef4444', 7],
    [8, 'Anulado', 'Solicitud anulada', '#64748b', 8]
  ];
  const insertEstado = db.prepare(`
    INSERT OR IGNORE INTO estados_solicitud (id, nombre, descripcion, color, orden)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const e of estados) insertEstado.run(...e);

  const prefix = company.slug.substring(0, 3).toUpperCase();
  const cecos = [
    [1, `${prefix}-CECO-001`, `Proyecto Principal ${company.name}`, 'Centro de costo principal', 2],
    [2, `${prefix}-CECO-002`, `Mantención ${company.name}`, 'Mantención y SSGG', 2],
    [3, `${prefix}-CECO-003`, `Obra Especial ${company.name}`, 'Obras especiales', 2]
  ];
  const insertCeco = db.prepare(`
    INSERT OR IGNORE INTO cecos (id, codigo, nombre, descripcion, jefe_proyecto_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const c of cecos) insertCeco.run(...c);

  const materiales = [
    [1, `${prefix}-MAT-001`, 'Cable UTP Cat6', 'Bobina cable red', 'MT', 850, 500],
    [2, `${prefix}-MAT-002`, 'Conector RJ45', 'Conector macho', 'UN', 120, 2000],
    [3, `${prefix}-MAT-003`, 'Poste metálico 6m', 'Poste galvanizado', 'UN', 45000, 80],
    [4, `${prefix}-MAT-004`, 'Tornillo autoperforante', 'Caja 100 und', 'CJ', 3500, 150],
    [5, `${prefix}-MAT-005`, 'Cinta aisladora', 'Rollo negro', 'UN', 890, 300],
    [6, `${prefix}-MAT-006`, 'Canaleta PVC 40x25', 'Tramo 2m', 'UN', 2100, 120],
    [7, `${prefix}-MAT-007`, 'Luminaria LED 50W', 'Alumbrado público', 'UN', 28000, 60],
    [8, `${prefix}-MAT-008`, 'Abrazadera metálica', 'Abrazadera 2"', 'UN', 450, 800]
  ];
  const insertMat = db.prepare(`
    INSERT OR IGNORE INTO materiales (id, codigo, nombre, descripcion, unidad, precio, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of materiales) insertMat.run(...m);

  const bodegas = [
    [1, `${prefix}-BOD-01`, `Bodega Central ${company.name}`, 'Santiago', 4],
    [2, `${prefix}-BOD-02`, `Bodega Terreno ${company.name}`, 'Obra', 4]
  ];
  const insertBod = db.prepare(`
    INSERT OR IGNORE INTO bodegas (id, codigo, nombre, ubicacion, responsable_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const b of bodegas) insertBod.run(...b);

  db.prepare(`
    INSERT OR IGNORE INTO proveedores (id, razon_social, rut, email, telefono)
    VALUES
      (1, 'Proveedor Demo SpA', '77.100.100-1', 'contacto@proveedordemo.cl', '+56 9 1111 1111'),
      (2, 'Distribuidora Norte Ltda', '77.200.200-2', 'ventas@distnorte.cl', '+56 9 2222 2222')
  `).run();

  // Solicitud de ejemplo
  const exists = db.prepare('SELECT id FROM solicitudes_materiales WHERE id = 1').get();
  if (!exists) {
    db.prepare(`
      INSERT INTO solicitudes_materiales
        (id, codigo, ceco_id, estado_id, solicitante_id, jefe_proyecto_id, fecha_requerida,
         bodega_nombre, ubicacion_entrega, observaciones, quien_retira, quien_usa, numero_proyecto)
      VALUES
        (1, 'SOLMAT-00001', 1, 1, 3, 2, date('now', '+3 days'),
         ?, 'bodega', 'Solicitud de ejemplo generada en seed', 'María González', 'Cuadrilla A', 'PRY-2026-001')
    `).run(`Bodega Central ${company.name}`);

    db.prepare(`
      INSERT INTO solicitudes_detalle
        (solicitud_id, material_id, cantidad, unidad, cantidad_pendiente, precio_unitario, subtotal)
      VALUES
        (1, 1, 100, 'MT', 100, 850, 85000),
        (1, 2, 50, 'UN', 50, 120, 6000),
        (1, 5, 10, 'UN', 10, 890, 8900)
    `).run();

    db.prepare(`
      INSERT INTO historial_solicitudes (solicitud_id, estado_id, usuario_id, accion, comentarios)
      VALUES (1, 1, 3, 'Creación', 'Solicitud creada (seed)')
    `).run();
  }
}

function initAll() {
  ensureDataDir();
  const results = [];

  for (const company of config.companies) {
    const file = dbPathFor(company.slug);
    const existed = fs.existsSync(file);
    const db = openDb(company.slug);
    db.exec(schemaSql);
    seedCompany(db, company);
    connections.set(company.slug, db);
    results.push({
      slug: company.slug,
      name: company.name,
      file,
      created: !existed,
      admin: `admin@${company.emailDomain}`
    });
  }

  return results;
}

function closeAll() {
  for (const db of connections.values()) db.close();
  connections.clear();
}

module.exports = {
  getDb,
  initAll,
  closeAll,
  dbPathFor,
  ensureDataDir
};
