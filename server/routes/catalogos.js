const express = require('express');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

const columnCache = new Map();

function isMysql(db) {
  return db?.driver === 'mysql' || config.isMysql;
}

async function getColumns(db, table) {
  if (!isMysql(db)) return null; // null = schema ESERCOM completo (sqlite)
  const key = `mysql:${table}`;
  if (columnCache.has(key)) return columnCache.get(key);
  let set = new Set();
  try {
    const rows = await db.prepare(`
      SELECT COLUMN_NAME AS n
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
    `).all(table);
    set = new Set(rows.map((r) => String(r.n || r.COLUMN_NAME || '').toLowerCase()).filter(Boolean));
  } catch (err) {
    console.warn('[schema]', table, err.message);
  }
  columnCache.set(key, set);
  return set;
}

function hasCol(cols, name) {
  if (cols == null) return true;
  return cols.has(String(name).toLowerCase());
}

router.get('/materiales', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    // Nunca selecciona stock/precio de la BD: evita crash si la columna no existe.
    // Esos campos se rellenan en JS (0) o se leen aparte solo si migrate ya los creó.
    let rows;
    try {
      if (q) {
        const like = `%${q}%`;
        rows = await req.db.prepare(`
          SELECT id, codigo, nombre, descripcion
          FROM materiales
          WHERE (activo = 1 OR activo IS NULL)
            AND (codigo LIKE ? OR nombre LIKE ? OR IFNULL(descripcion,'') LIKE ?)
          ORDER BY nombre
          LIMIT 50
        `).all(like, like, like);
      } else {
        rows = await req.db.prepare(`
          SELECT id, codigo, nombre, descripcion
          FROM materiales
          WHERE (activo = 1 OR activo IS NULL)
          ORDER BY nombre
          LIMIT 200
        `).all();
      }
    } catch (_) {
      rows = await req.db.prepare(`
        SELECT id, codigo, nombre, descripcion FROM materiales ORDER BY id DESC LIMIT 200
      `).all();
    }

    let unidadById = new Map();
    try {
      const cols = await getColumns(req.db, 'materiales');
      if (cols && (hasCol(cols, 'unidad') || hasCol(cols, 'unidad_medida'))) {
        const unidadExpr = hasCol(cols, 'unidad') ? 'unidad' : 'unidad_medida AS unidad';
        const ids = rows.map((r) => r.id);
        if (ids.length) {
          const ph = ids.map(() => '?').join(',');
          const extra = await req.db.prepare(
            `SELECT id, ${unidadExpr} FROM materiales WHERE id IN (${ph})`
          ).all(...ids);
          unidadById = new Map(extra.map((e) => [e.id, e.unidad]));
        }
      }
    } catch (_) { /* ignore */ }

    const data = rows.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      nombre: r.nombre,
      descripcion: r.descripcion,
      unidad: unidadById.get(r.id) || 'UN',
      precio: 0,
      stock: 0
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('catalogos/materiales', err);
    res.status(500).json({ success: false, message: err.message || 'Error materiales', data: [] });
  }
});

router.get('/cecos', async (req, res) => {
  try {
    const rows = await req.db.prepare(`
      SELECT c.id, c.codigo, c.nombre, c.descripcion, c.jefe_proyecto_id,
             u.nombre || ' ' || u.apellido AS jefe_proyecto
      FROM cecos c
      LEFT JOIN usuarios u ON u.id = c.jefe_proyecto_id
      WHERE c.activo = 1 OR c.activo IS NULL
      ORDER BY c.codigo
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('catalogos/cecos', err);
    try {
      const rows = await req.db.prepare(`
        SELECT id, codigo, nombre, descripcion, jefe_proyecto_id FROM cecos ORDER BY codigo
      `).all();
      res.json({ success: true, data: rows.map((r) => ({ ...r, jefe_proyecto: null })) });
    } catch (err2) {
      res.status(500).json({ success: false, message: err2.message || 'Error cecos', data: [] });
    }
  }
});

router.get('/bodegas', async (req, res) => {
  try {
    const rows = await req.db.prepare(`
      SELECT id, codigo, nombre, ubicacion FROM bodegas WHERE activo = 1 OR activo IS NULL ORDER BY nombre
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

router.get('/estados', async (req, res) => {
  try {
    const rows = await req.db.prepare(`
      SELECT id, nombre, descripcion, color, orden
      FROM estados_solicitud WHERE activo = 1 OR activo IS NULL ORDER BY orden
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Error estados', data: [] });
  }
});

router.get('/usuarios', async (req, res) => {
  try {
    const flag = String(req.query.flag || '').trim();
    const allowed = {
      checklist: 'flag_checklist',
      flota: 'flag_flota',
      ssgg: 'flag_ssgg',
      camion_pluma: 'flag_camion_pluma',
      aprobador_salida: 'flag_aprobador_salida'
    };
    const cols = await getColumns(req.db, 'usuarios');
    const flagSelect = ['flag_checklist', 'flag_flota', 'flag_ssgg', 'flag_camion_pluma', 'flag_aprobador_salida']
      .map((f) => (hasCol(cols, f) ? `COALESCE(u.${f}, 0) AS ${f}` : `0 AS ${f}`))
      .join(',\n             ');

    let sql = `
      SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, u.telefono, u.rol_id, u.departamento_id,
             ${flagSelect},
             r.nombre AS rol, d.nombre AS departamento
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      LEFT JOIN departamentos d ON d.id = u.departamento_id
      WHERE u.activo = 1 OR u.activo IS NULL
    `;
    if (flag && allowed[flag] && hasCol(cols, allowed[flag])) {
      sql += ` AND u.${allowed[flag]} = 1`;
    }
    sql += ' ORDER BY u.nombre, u.apellido';
    const rows = await req.db.prepare(sql).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('catalogos/usuarios', err);
    try {
      const rows = await req.db.prepare(`
        SELECT u.id, u.nombre, u.apellido, u.email, u.cargo, u.telefono, u.rol_id, u.departamento_id,
               0 AS flag_checklist, 0 AS flag_flota, 0 AS flag_ssgg, 0 AS flag_camion_pluma, 0 AS flag_aprobador_salida,
               r.nombre AS rol, NULL AS departamento
        FROM usuarios u
        LEFT JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 OR u.activo IS NULL
        ORDER BY u.nombre, u.apellido
      `).all();
      res.json({ success: true, data: rows, warning: err.message });
    } catch (err2) {
      res.status(500).json({ success: false, message: err2.message || err.message || 'Error usuarios', data: [] });
    }
  }
});

router.get('/proveedores', async (req, res) => {
  try {
    const cols = await getColumns(req.db, 'proveedores');
    // Productivo PHP usa "nombre"; ESERCOM usa "razon_social"
    let rows;
    if (isMysql(req.db) && cols && hasCol(cols, 'nombre') && !hasCol(cols, 'razon_social')) {
      const emailExpr = hasCol(cols, 'email') ? 'email' : (hasCol(cols, 'correo') ? 'correo AS email' : 'NULL AS email');
      const telExpr = hasCol(cols, 'telefono') ? 'telefono' : 'NULL AS telefono';
      const where = hasCol(cols, 'activo') ? 'WHERE (activo = 1 OR activo IS NULL)' : '';
      rows = await req.db.prepare(`
        SELECT id, nombre AS razon_social, rut, ${emailExpr}, ${telExpr}
        FROM proveedores ${where} ORDER BY nombre
      `).all();
    } else {
      try {
        rows = await req.db.prepare(`
          SELECT id, razon_social, rut, email, telefono
          FROM proveedores WHERE activo = 1 OR activo IS NULL ORDER BY razon_social
        `).all();
      } catch (_) {
        rows = await req.db.prepare(`
          SELECT id, nombre AS razon_social, rut, email, telefono
          FROM proveedores ORDER BY nombre
        `).all();
      }
    }
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('catalogos/proveedores', err);
    res.status(500).json({ success: false, message: err.message || 'Error proveedores', data: [] });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const pendientes = (await req.db.prepare(`
      SELECT COUNT(*) AS c FROM solicitudes_materiales
      WHERE eliminado = 0 AND estado_id IN (1, 2, 3, 4, 5)
    `).get())?.c || 0;
    const cerradas = (await req.db.prepare(`
      SELECT COUNT(*) AS c FROM solicitudes_materiales WHERE eliminado = 0 AND estado_id = 6
    `).get())?.c || 0;
    const materiales = (await req.db.prepare(`
      SELECT COUNT(*) AS c FROM materiales WHERE activo = 1 OR activo IS NULL
    `).get())?.c || 0;
    const usuarios = (await req.db.prepare(`
      SELECT COUNT(*) AS c FROM usuarios WHERE activo = 1 OR activo IS NULL
    `).get())?.c || 0;
    let recientes = [];
    try {
      recientes = await req.db.prepare(`
        SELECT s.id, s.codigo, s.fecha_solicitud, s.numero_proyecto, e.nombre AS estado, e.color,
               u.nombre || ' ' || u.apellido AS solicitante
        FROM solicitudes_materiales s
        JOIN estados_solicitud e ON e.id = s.estado_id
        JOIN usuarios u ON u.id = s.solicitante_id
        WHERE s.eliminado = 0
        ORDER BY s.id DESC LIMIT 5
      `).all();
    } catch (_) { /* ignore */ }

    res.json({
      success: true,
      data: {
        pendientes,
        cerradas,
        materiales,
        usuarios,
        recientes,
        empresa: req.auth.company
      }
    });
  } catch (err) {
    console.error('catalogos/dashboard', err);
    res.status(500).json({ success: false, message: err.message || 'Error dashboard' });
  }
});

module.exports = router;
