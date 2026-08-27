const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { Database, initEngine } = require('./sqlite');
const { createMysqlPool } = require('./mysql');

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const schemaModulesSql = fs.readFileSync(path.join(__dirname, 'schema-modules.sql'), 'utf8');
const schemaAngelSql = fs.readFileSync(path.join(__dirname, 'schema-angel.sql'), 'utf8');

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
  db.pragma('foreign_keys = ON');
  return db;
}

function ensureColumns(db, table, columns) {
  // sqlite only (sync pragma via async all)
  return (async () => {
    let existing;
    try {
      existing = (await db.prepare(`PRAGMA table_info(${table})`).all()).map((c) => c.name);
    } catch (_) {
      return;
    }
    if (!existing.length) return;
    for (const [col, ddl] of columns) {
      if (!existing.includes(col)) {
        try {
          await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
        } catch (err) {
          console.warn(`[migrate] ${table}.${col}:`, err.message);
        }
      }
    }
  })();
}

async function ensureMysqlColumns(db, table, columns) {
  for (const [col, ddl] of columns) {
    try {
      const row = await db.prepare(`
        SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      `).get(table, col);
      if (row && Number(row.c) === 0) {
        await db.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`);
        console.log(`[mysql migrate] ${table}.${col} añadida`);
      }
    } catch (err) {
      // Reintento directo: a veces information_schema no coincide con el nombre real
      try {
        await db.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`);
        console.log(`[mysql migrate] ${table}.${col} añadida (retry)`);
      } catch (err2) {
        if (!/duplicate column/i.test(err2.message || '')) {
          console.warn(`[mysql migrate] ${table}.${col}:`, err.message || err2.message);
        }
      }
    }
  }
}

async function ensureMysqlModuleTables(db) {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS solicitudes_compras (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero_solicitud VARCHAR(64) NOT NULL,
      solicitante_id INT NULL,
      ceco_id INT NULL,
      jefe_proyecto_id INT NULL,
      fecha_requerida DATE NULL,
      fecha_solicitud DATETIME DEFAULT CURRENT_TIMESTAMP,
      estado VARCHAR(64) DEFAULT 'Pendiente',
      observaciones TEXT NULL,
      eliminado TINYINT NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS solicitudes_compras_detalle (
      id INT AUTO_INCREMENT PRIMARY KEY,
      solicitud_id INT NOT NULL,
      material_id INT NULL,
      descripcion TEXT NULL,
      cantidad DECIMAL(15,2) NOT NULL DEFAULT 1,
      unidad VARCHAR(32) DEFAULT 'UN',
      precio_estimado DECIMAL(15,2) DEFAULT 0,
      observaciones TEXT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS portal_proveedor (
      id INT AUTO_INCREMENT PRIMARY KEY,
      solicitud_id INT NOT NULL,
      proveedor_id INT NULL,
      numero_guia VARCHAR(128) NULL,
      fecha_entrega DATE NULL,
      persona_retira VARCHAR(255) NULL,
      guia_estado VARCHAR(64) DEFAULT 'Pendiente',
      numero_factura VARCHAR(128) NULL,
      monto_factura DECIMAL(15,2) NULL,
      factura_estado VARCHAR(64) DEFAULT 'Pendiente',
      observaciones TEXT NULL,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS materiales_receta_tipos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(255) NOT NULL,
      descripcion TEXT NULL,
      activo TINYINT NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS materiales_receta_insumos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tipo_id INT NOT NULL,
      material_id INT NULL,
      descripcion VARCHAR(255) NOT NULL,
      cantidad DECIMAL(15,2) NOT NULL DEFAULT 1,
      unidad VARCHAR(32) DEFAULT 'UN',
      categoria VARCHAR(128) NULL,
      activo TINYINT NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS salidas_actividad (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NOT NULL,
      tipo_receta_id INT NULL,
      ceco_id INT NULL,
      solicitante_id INT NULL,
      cantidad_obras INT DEFAULT 1,
      numero_proyecto VARCHAR(128) NULL,
      estado VARCHAR(64) DEFAULT 'Pendiente',
      observaciones TEXT NULL,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS salidas_actividad_detalle (
      id INT AUTO_INCREMENT PRIMARY KEY,
      salida_id INT NOT NULL,
      material_id INT NULL,
      descripcion VARCHAR(255) NULL,
      cantidad DECIMAL(15,2) DEFAULT 0,
      unidad VARCHAR(32) DEFAULT 'UN'
    )`,
    `CREATE TABLE IF NOT EXISTS creacion_datos_maestros (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      tipo VARCHAR(64) DEFAULT 'Material',
      descripcion TEXT NOT NULL,
      unidad_medida VARCHAR(32) DEFAULT 'UN',
      estado VARCHAR(64) DEFAULT 'Pendiente',
      solicitante_id INT NULL,
      observaciones TEXT NULL,
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS tareas_operativas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      area VARCHAR(128) NOT NULL,
      fecha DATE NOT NULL,
      hora_inicio VARCHAR(16) NULL,
      hora_termino VARCHAR(16) NULL,
      descripcion TEXT NOT NULL,
      ubicacion VARCHAR(255) NULL,
      ceco_id INT NULL,
      responsable_id INT NULL,
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS solicitud_graficas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NOT NULL,
      ceco_id INT NULL,
      solicitante_id INT NOT NULL,
      fecha_requerida DATE NULL,
      observaciones TEXT NULL,
      estado VARCHAR(64) DEFAULT 'Pendiente Aprobación',
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS servicios_generales (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      titulo VARCHAR(255) NULL,
      descripcion TEXT NULL,
      solicitante_id INT NULL,
      estado VARCHAR(64) DEFAULT 'Abierto',
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS agenda_camion_pluma_v2 (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa VARCHAR(255) NOT NULL DEFAULT 'Sercom',
      fecha DATE NOT NULL,
      hora_inicio VARCHAR(16) NULL,
      hora_fin VARCHAR(16) NULL,
      tipo_servicio VARCHAR(128) DEFAULT 'Servicio',
      solicitante VARCHAR(255) NULL,
      chofer VARCHAR(255) NULL,
      ceco_id INT NULL,
      proyecto VARCHAR(255) NULL,
      origen VARCHAR(255) NULL,
      destino VARCHAR(255) NULL,
      direccion TEXT NULL,
      contacto VARCHAR(255) NULL,
      telefono VARCHAR(64) NULL,
      kilometraje DECIMAL(12,2) DEFAULT 0,
      orden_compra VARCHAR(128) NULL,
      detalle_material TEXT NULL,
      observaciones TEXT NULL,
      es_bloqueo TINYINT NOT NULL DEFAULT 0,
      estado VARCHAR(64) DEFAULT 'Programado',
      creado_por INT NULL,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS checklist_flota (
      id INT AUTO_INCREMENT PRIMARY KEY,
      patente VARCHAR(32) NULL,
      kilometraje INT NULL,
      fecha DATE NULL,
      tecnico_id INT NULL,
      estado VARCHAR(64) DEFAULT 'OK',
      observaciones TEXT NULL,
      anulado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS requerimientos_telecom (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      titulo VARCHAR(255) NULL,
      estado VARCHAR(64) DEFAULT 'Pendiente',
      solicitante_id INT NULL,
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS catalogo_g (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      correlativo INT NULL,
      empresa VARCHAR(255) NOT NULL,
      descripcion TEXT NOT NULL,
      cantidad DECIMAL(15,2) NOT NULL DEFAULT 0,
      bodega VARCHAR(255) NULL,
      foto VARCHAR(512) NULL,
      foto_hash VARCHAR(64) NULL,
      estado VARCHAR(64) NOT NULL DEFAULT 'Nuevo',
      creado_por INT NULL,
      actualizado_por INT NULL,
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS catalogo_s (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      correlativo INT NULL,
      empresa VARCHAR(255) NOT NULL,
      descripcion TEXT NOT NULL,
      cantidad DECIMAL(15,2) NOT NULL DEFAULT 0,
      bodega VARCHAR(255) NULL,
      foto VARCHAR(512) NULL,
      foto_hash VARCHAR(64) NULL,
      estado VARCHAR(64) NOT NULL DEFAULT 'Nuevo',
      creado_por INT NULL,
      actualizado_por INT NULL,
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS catalogo_n (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      correlativo INT NULL,
      empresa VARCHAR(255) NOT NULL,
      descripcion TEXT NOT NULL,
      cantidad DECIMAL(15,2) NOT NULL DEFAULT 0,
      bodega VARCHAR(255) NULL,
      foto VARCHAR(512) NULL,
      foto_hash VARCHAR(64) NULL,
      estado VARCHAR(64) NOT NULL DEFAULT 'Nuevo',
      creado_por INT NULL,
      actualizado_por INT NULL,
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS catalogo_t (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      correlativo INT NULL,
      empresa VARCHAR(255) NOT NULL,
      descripcion TEXT NOT NULL,
      cantidad DECIMAL(15,2) NOT NULL DEFAULT 0,
      bodega VARCHAR(255) NULL,
      foto VARCHAR(512) NULL,
      foto_hash VARCHAR(64) NULL,
      estado VARCHAR(64) NOT NULL DEFAULT 'Nuevo',
      creado_por INT NULL,
      actualizado_por INT NULL,
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS seguimiento_contratos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      titulo VARCHAR(255) NULL,
      estado VARCHAR(64) DEFAULT 'Activo',
      eliminado TINYINT NOT NULL DEFAULT 0,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS aprobacion_facturas_lote (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(64) NULL,
      descripcion TEXT NULL,
      creado_por INT NULL,
      aprobador_id INT NULL,
      estado VARCHAR(64) DEFAULT 'Pendiente',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS aprobacion_facturas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lote_id INT NULL,
      numero_factura VARCHAR(128) NULL,
      proveedor VARCHAR(255) NULL,
      monto DECIMAL(15,2) DEFAULT 0,
      estado VARCHAR(64) DEFAULT 'Pendiente'
    )`,
    `CREATE TABLE IF NOT EXISTS papelera (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tipo VARCHAR(64) NOT NULL,
      referencia_id INT NULL,
      codigo VARCHAR(128) NULL,
      titulo VARCHAR(255) NULL,
      datos_json TEXT NULL,
      eliminado_por INT NULL,
      fecha_eliminacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS liberadores_config (
      codigo VARCHAR(80) NOT NULL PRIMARY KEY,
      modulo VARCHAR(80) NOT NULL DEFAULT '',
      titulo VARCHAR(255) NOT NULL,
      descripcion TEXT NULL,
      usuario_id INT NULL,
      activo TINYINT NOT NULL DEFAULT 1,
      orden INT NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS liberadores_extra (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(80) NOT NULL,
      usuario_id INT NOT NULL,
      orden INT DEFAULT 0,
      UNIQUE KEY uq_lib_extra (codigo, usuario_id)
    )`
  ];

  for (const sql of ddl) {
    try {
      await db.exec(sql);
    } catch (err) {
      console.warn('[mysql modules]', err.message);
    }
  }
  console.log('[mysql] tablas de módulos verificadas/creadas');
}

async function ensureAngelTrainingSchema(db) {
  const isMysql = db.driver === 'mysql';
  if (isMysql) {
    await ensureMysqlColumns(db, 'angel_ia_config', [
      ['instrucciones_entrenamiento', 'TEXT NULL'],
      ['ejemplos_entrenamiento', 'TEXT NULL'],
      ['prompt_seguridad', 'TEXT NULL'],
      ['ejemplos_seguridad', 'TEXT NULL'],
      ['seguridad_activa', 'TINYINT NOT NULL DEFAULT 1'],
      ['voz_activa', 'TINYINT NOT NULL DEFAULT 1'],
      ['voz_tts_voice', 'VARCHAR(32) NULL'],
      ['voz_tts_model', 'VARCHAR(64) NULL'],
      ['voz_autoplay', 'TINYINT NOT NULL DEFAULT 1'],
      ['voz_instrucciones', 'TEXT NULL'],
      ['voz_stt_model', 'VARCHAR(64) NULL'],
      ['voz_tts_speed', 'DECIMAL(4,2) NULL']
    ]);
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS angel_ia_train_mensajes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          rol VARCHAR(32) NOT NULL,
          contenido TEXT NOT NULL,
          meta_json TEXT NULL,
          fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS angel_ia_seguridad_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tipo VARCHAR(64) NOT NULL,
          severidad VARCHAR(16) NOT NULL DEFAULT 'media',
          mensaje_usuario TEXT NOT NULL,
          usuario_id INT NULL,
          usuario_nombre VARCHAR(255) NULL,
          usuario_email VARCHAR(255) NULL,
          bloqueado TINYINT NOT NULL DEFAULT 1,
          detalle TEXT NULL,
          origen VARCHAR(32) NOT NULL DEFAULT 'produccion',
          fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (err) {
      console.warn('[mysql] angel train/security tables:', err.message);
    }
    return;
  }

  await ensureColumns(db, 'angel_ia_config', [
    ['instrucciones_entrenamiento', 'TEXT'],
    ['ejemplos_entrenamiento', 'TEXT'],
    ['prompt_seguridad', 'TEXT'],
    ['ejemplos_seguridad', 'TEXT'],
    ['seguridad_activa', 'INTEGER NOT NULL DEFAULT 1'],
    ['voz_activa', 'INTEGER NOT NULL DEFAULT 1'],
    ['voz_tts_voice', 'TEXT'],
    ['voz_tts_model', 'TEXT'],
    ['voz_autoplay', 'INTEGER NOT NULL DEFAULT 1'],
    ['voz_instrucciones', 'TEXT'],
    ['voz_stt_model', 'TEXT'],
    ['voz_tts_speed', 'REAL']
  ]);
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS angel_ia_train_mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rol TEXT NOT NULL,
        contenido TEXT NOT NULL,
        meta_json TEXT,
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS angel_ia_seguridad_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        severidad TEXT NOT NULL DEFAULT 'media',
        mensaje_usuario TEXT NOT NULL,
        usuario_id INTEGER,
        usuario_nombre TEXT,
        usuario_email TEXT,
        bloqueado INTEGER NOT NULL DEFAULT 1,
        detalle TEXT,
        origen TEXT NOT NULL DEFAULT 'produccion',
        fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } catch (err) {
    console.warn('[sqlite] angel train/security tables:', err.message);
  }
}

async function migrateUserFlags(db) {
  if (db.driver === 'mysql') {
    await ensureMysqlColumns(db, 'usuarios', [
      ['ceco_id', 'INT NULL'],
      ['flag_checklist', 'TINYINT NOT NULL DEFAULT 0'],
      ['flag_flota', 'TINYINT NOT NULL DEFAULT 0'],
      ['flag_ssgg', 'TINYINT NOT NULL DEFAULT 0'],
      ['flag_camion_pluma', 'TINYINT NOT NULL DEFAULT 0'],
      ['flag_aprobador_salida', 'TINYINT NOT NULL DEFAULT 0'],
      ['flag_chofer', 'TINYINT NOT NULL DEFAULT 0'],
      ['empresas_acceso', 'TEXT NULL']
    ]);
    await ensureMysqlColumns(db, 'materiales', [
      ['precio', 'DECIMAL(15,2) DEFAULT 0'],
      ['stock', 'DECIMAL(15,2) DEFAULT 0'],
      ['categoria', 'VARCHAR(255) NULL']
    ]);
    await ensureMysqlColumns(db, 'solicitudes_materiales', [
      ['bodega_nombre', 'VARCHAR(255) NULL'],
      ['ubicacion_entrega', 'VARCHAR(64) NULL'],
      ['bodeguero_id', 'INT NULL'],
      ['despacho_conductor', 'VARCHAR(255) NULL'],
      ['despacho_rut', 'VARCHAR(32) NULL'],
      ['despacho_patente', 'VARCHAR(32) NULL'],
      ['despacho_direccion', 'VARCHAR(500) NULL'],
      ['numero_guia_softland', 'VARCHAR(128) NULL'],
      ['guia_softland_adjunto', 'VARCHAR(500) NULL'],
      ['guias_proveedor', 'MEDIUMTEXT NULL'],
      ['guia_proveedor_archivo', 'VARCHAR(500) NULL'],
      ['guia_proveedor_numero', 'VARCHAR(128) NULL'],
      ['foto_entrega', 'MEDIUMTEXT NULL'],
      ['quien_retira', 'VARCHAR(255) NULL'],
      ['quien_usa', 'VARCHAR(255) NULL'],
      ['numero_proyecto', 'VARCHAR(255) NULL'],
      ['fecha_entrega', 'DATETIME NULL'],
      ['fecha_cierre', 'DATETIME NULL'],
      ['fecha_aprobacion', 'DATETIME NULL'],
      ['aprobado_por_id', 'INT NULL']
    ]);
    await ensureMysqlColumns(db, 'historial_solicitudes', [
      ['accion', 'VARCHAR(255) NULL'],
      ['comentarios', 'TEXT NULL'],
      ['observaciones', 'TEXT NULL'],
      ['fecha_cambio', 'DATETIME NULL']
    ]);
    await ensureMysqlModuleTables(db);
    try {
      const { ensureAgendaCamionSchema } = require('../services/agenda-camion');
      await ensureAgendaCamionSchema(db);
    } catch (err) {
      console.warn('[mysql] agenda camion pluma:', err.message);
    }
    try {
      const { ensureChecklistSchema } = require('../services/checklist-flota');
      await ensureChecklistSchema(db);
    } catch (err) {
      console.warn('[mysql] checklist flota:', err.message);
    }
    try {
      const { initPermisos } = require('../services/permisos-especiales');
      await initPermisos(db);
    } catch (err) {
      console.warn('[mysql] permisos especiales:', err.message);
    }
    try {
      const { ensureCatalogoGSchema } = require('../services/catalogo-g');
      await ensureCatalogoGSchema(db);
    } catch (err) {
      console.warn('[mysql] catalogo G:', err.message);
    }
    try {
      const { ensureCatalogoSSchema } = require('../services/catalogo-s');
      await ensureCatalogoSSchema(db);
    } catch (err) {
      console.warn('[mysql] catalogo S:', err.message);
    }
    try {
      const { ensureCatalogoNSchema } = require('../services/catalogo-n');
      await ensureCatalogoNSchema(db);
    } catch (err) {
      console.warn('[mysql] catalogo N:', err.message);
    }
    try {
      const { ensureCatalogoTSchema } = require('../services/catalogo-t');
      await ensureCatalogoTSchema(db);
    } catch (err) {
      console.warn('[mysql] catalogo T:', err.message);
    }
    try {
      const { ensureIncidenciasSchema } = require('../services/incidencias');
      await ensureIncidenciasSchema(db);
    } catch (err) {
      console.warn('[mysql] incidencias:', err.message);
    }
    try {
      const { ensureInspeccionSchema } = require('../services/inspeccion');
      await ensureInspeccionSchema(db);
    } catch (err) {
      console.warn('[mysql] inspeccion:', err.message);
    }
    try {
      const { ensureWmsSchema } = require('../services/wms');
      await ensureWmsSchema(db);
    } catch (err) {
      console.warn('[mysql] wms:', err.message);
    }
    try {
      const { ensureUsuarioRolesSchema } = require('../services/usuario-roles');
      await ensureUsuarioRolesSchema(db);
    } catch (err) {
      console.warn('[mysql] usuario roles:', err.message);
    }
    try {
      await db.exec(`
        UPDATE usuarios SET flag_chofer = 1
        WHERE COALESCE(flag_chofer, 0) = 0 AND (
          LOWER(COALESCE(cargo,'')) LIKE '%chofer%'
          OR LOWER(COALESCE(cargo,'')) LIKE '%conductor%'
        )
      `);
    } catch (_) { /* ignore */ }
    // Angel IA (solo ESERCOM; no existe en PHP)
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS angel_ia_config (
          id INT PRIMARY KEY,
          api_key_enc TEXT NULL,
          api_key_hint VARCHAR(64) NULL,
          model VARCHAR(64) NOT NULL DEFAULT 'gpt-4o-mini',
          activo TINYINT NOT NULL DEFAULT 0,
          reporte_semanal TINYINT NOT NULL DEFAULT 1,
          dia_reporte INT NOT NULL DEFAULT 1,
          hora_reporte VARCHAR(8) NOT NULL DEFAULT '08:00',
          smtp_host VARCHAR(255) NULL,
          smtp_port INT DEFAULT 587,
          smtp_user VARCHAR(255) NULL,
          smtp_pass_enc TEXT NULL,
          smtp_from VARCHAR(255) NULL,
          actualizado_por INT NULL,
          actualizado_en DATETIME NULL
        )
      `);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS angel_ia_alertas (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tipo VARCHAR(64) NOT NULL,
          severidad VARCHAR(16) NOT NULL DEFAULT 'media',
          titulo VARCHAR(255) NOT NULL,
          mensaje TEXT NOT NULL,
          modulo VARCHAR(64) NULL,
          referencia VARCHAR(128) NULL,
          usuario_id INT NULL,
          leida TINYINT NOT NULL DEFAULT 0,
          fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS angel_ia_mensajes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          usuario_id INT NOT NULL,
          rol VARCHAR(32) NOT NULL,
          contenido TEXT NOT NULL,
          meta_json TEXT NULL,
          fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS angel_ia_reportes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tipo VARCHAR(64) NOT NULL,
          titulo VARCHAR(255) NOT NULL,
          archivo VARCHAR(500) NULL,
          destinatarios TEXT NULL,
          resumen TEXT NULL,
          generado_por INT NULL,
          fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.prepare(`INSERT IGNORE INTO angel_ia_config (id, model, activo, reporte_semanal) VALUES (1, 'gpt-4o-mini', 0, 1)`).run();
      await ensureAngelTrainingSchema(db);
    } catch (err) {
      console.warn('[mysql] angel tables:', err.message);
    }
    return;
  }

  await ensureColumns(db, 'usuarios', [
    ['ceco_id', 'INTEGER'],
    ['flag_checklist', 'INTEGER NOT NULL DEFAULT 0'],
    ['flag_flota', 'INTEGER NOT NULL DEFAULT 0'],
    ['flag_ssgg', 'INTEGER NOT NULL DEFAULT 0'],
    ['flag_camion_pluma', 'INTEGER NOT NULL DEFAULT 0'],
    ['flag_aprobador_salida', 'INTEGER NOT NULL DEFAULT 0'],
    ['flag_chofer', 'INTEGER NOT NULL DEFAULT 0'],
    ['empresas_acceso', 'TEXT']
  ]);

  try {
    const { initPermisos } = require('../services/permisos-especiales');
    await initPermisos(db);
  } catch (err) {
    console.warn('[sqlite] permisos especiales:', err.message);
  }

  try {
    const { ensureAgendaCamionSchema } = require('../services/agenda-camion');
    await ensureAgendaCamionSchema(db);
  } catch (err) {
    console.warn('[sqlite] agenda camion pluma:', err.message);
  }

  try {
    const { ensureIncidenciasSchema } = require('../services/incidencias');
    await ensureIncidenciasSchema(db);
  } catch (err) {
    console.warn('[sqlite] incidencias:', err.message);
  }

  try {
    const { ensureInspeccionSchema } = require('../services/inspeccion');
    await ensureInspeccionSchema(db);
  } catch (err) {
    console.warn('[sqlite] inspeccion:', err.message);
  }

  try {
    const { ensureWmsSchema } = require('../services/wms');
    await ensureWmsSchema(db);
  } catch (err) {
    console.warn('[sqlite] wms:', err.message);
  }

  await ensureColumns(db, 'materiales', [['categoria', 'TEXT']]);

  await ensureColumns(db, 'solicitudes_materiales', [
    ['bodega_id', 'INTEGER'],
    ['bodeguero_id', 'INTEGER'],
    ['email_proveedor', 'TEXT'],
    ['observacion_aprobacion_sc', 'TEXT'],
    ['sc_etapa_aprobacion', 'TEXT'],
    ['despacho_conductor', 'TEXT'],
    ['despacho_rut', 'TEXT'],
    ['despacho_patente', 'TEXT'],
    ['despacho_direccion', 'TEXT'],
    ['numero_guia_softland', 'TEXT'],
    ['guia_softland_adjunto', 'TEXT'],
    ['foto_entrega', 'TEXT'],
    ['guias_proveedor', 'TEXT'],
    ['fecha_aprobacion', 'TEXT'],
    ['aprobado_por_id', 'INTEGER'],
    ['fecha_entrega', 'TEXT'],
    ['fecha_entrega_real', 'TEXT'],
    ['fecha_cierre', 'TEXT'],
    ['fecha_entrega_proveedor', 'TEXT'],
    ['portal_estado', 'TEXT'],
    ['portal_activado_at', 'TEXT'],
    ['oc_validada_por', 'INTEGER'],
    ['oc_validada_at', 'TEXT'],
    ['oc_validada_observacion', 'TEXT'],
    ['oc_rechazada_por', 'INTEGER'],
    ['oc_rechazada_at', 'TEXT'],
    ['oc_rechazada_motivo', 'TEXT'],
    ['guia_proveedor_archivo', 'TEXT'],
    ['guia_proveedor_subida_at', 'TEXT'],
    ['guia_proveedor_numero', 'TEXT'],
    ['guia_proveedor_persona_retira', 'TEXT'],
    ['factura_estado', 'TEXT'],
    ['factura_archivo', 'TEXT'],
    ['factura_numero', 'TEXT'],
    ['factura_monto', 'REAL'],
    ['factura_subida_at', 'TEXT'],
    ['factura_aprobada_por', 'INTEGER'],
    ['factura_aprobada_at', 'TEXT'],
    ['factura_rechazada_motivo', 'TEXT'],
    ['factura_finanzas_notif_at', 'TEXT']
  ]);

  await ensureColumns(db, 'servicios_generales', [
    ['asignado_id', 'INTEGER'],
    ['numero_caso', 'TEXT'],
    ['fecha_completado', 'TEXT'],
    ['tecnico_asignado', 'TEXT'],
    ['proveedor', 'TEXT'],
    ['costo_estimado', 'REAL'],
    ['costo_real', 'REAL'],
    ['observaciones', 'TEXT'],
    ['adjuntos', 'TEXT']
  ]);

  await ensureColumns(db, 'checklist_flota', [
    ['codigo', 'TEXT'],
    ['fecha_inspeccion', 'TEXT'],
    ['operario_id', 'INTEGER'],
    ['tecnico_asignado_id', 'INTEGER'],
    ['nivel_aceite', 'TEXT'],
    ['nivel_combustible', 'TEXT'],
    ['limpieza_interior', 'TEXT'],
    ['limpieza_exterior', 'TEXT'],
    ['documentacion', 'TEXT'],
    ['kit_emergencia', 'TEXT'],
    ['extintor', 'TEXT'],
    ['rueda_repuesto', 'TEXT'],
    ['requiere_atencion', 'INTEGER DEFAULT 0'],
    ['estado_seguimiento', "TEXT DEFAULT 'sin_revisar'"],
    ['foto_frontal', 'TEXT'],
    ['foto_lateral_izq', 'TEXT'],
    ['foto_lateral_der', 'TEXT'],
    ['foto_trasera', 'TEXT'],
    ['foto_rueda', 'TEXT'],
    ['foto_kit_herramientas', 'TEXT'],
    ['foto_colision', 'TEXT'],
    ['vehiculo_marca', 'TEXT'],
    ['vehiculo_modelo', 'TEXT'],
    ['vehiculo_tipo', 'TEXT'],
    ['vehiculo_anio', 'TEXT'],
    ['propietario_nombre', 'TEXT'],
    ['propietario_rut', 'TEXT']
  ]);

  await ensureAngelTrainingSchema(db);
}

function getDb(slug) {
  const key = String(slug || '').toLowerCase();
  if (!config.getCompany(key)) {
    throw new Error(`Empresa no válida: ${slug}`);
  }
  if (config.isMysql) {
    const dbName = config.mysqlDatabaseFor(key);
    const connKey = `mysql:${dbName}`;
    if (!connections.has(connKey)) {
      // Compat legado: pool único sin multiempresa
      if (connections.has('__mysql__') && !config.mysqlPerCompany) {
        return connections.get('__mysql__');
      }
      throw new Error(`MySQL no inicializado para ${key} (${dbName}). Revise DB_NAME_* / DB_PER_COMPANY.`);
    }
    return connections.get(connKey);
  }
  if (!connections.has(key)) {
    if (!fs.existsSync(dbPathFor(key))) {
      throw new Error(`Base de datos no inicializada para ${key}. Ejecute: npm run init-db`);
    }
    connections.set(key, openDb(key));
  }
  return connections.get(key);
}

/** Todas las BDs de empresa ya abiertas (útil para sync de usuarios). */
function getAllCompanyDbs() {
  const out = [];
  for (const company of config.companies) {
    try {
      out.push({ company, db: getDb(company.slug) });
    } catch (_) { /* BD aún no disponible */ }
  }
  return out;
}

async function initAll() {
  const results = [];

  if (config.isMysql) {
    if (!config.mysql.user) {
      throw new Error(
        'DB_DRIVER=mysql requiere DB_USER. Revise variables de entorno.'
      );
    }
    const seen = new Map(); // dbName → MysqlDatabase
    for (const company of config.companies) {
      const dbName = config.mysqlDatabaseFor(company.slug);
      let db = seen.get(dbName);
      if (!db) {
        console.log(`[DB] MySQL → ${config.mysql.host}/${dbName} (${company.slug})`);
        try {
          db = await createMysqlPool({ ...config.mysql, database: dbName });
        } catch (err) {
          console.error(`[DB] No se pudo abrir ${dbName} (${company.slug}):`, err.message);
          if (company.slug === 'sercom' || !config.mysqlPerCompany) throw err;
          results.push({
            slug: company.slug,
            name: company.name,
            file: `mysql://${dbName}`,
            created: false,
            error: err.message,
            admin: '(BD no disponible — créela en cPanel y ejecute scripts/create-company-dbs.js)'
          });
          continue;
        }
        await migrateUserFlags(db);
        seen.set(dbName, db);
        connections.set(`mysql:${dbName}`, db);
        if (!config.mysqlPerCompany) connections.set('__mysql__', db);
      } else {
        connections.set(`mysql:${dbName}`, db);
      }
      results.push({
        slug: company.slug,
        name: company.name,
        file: `mysql://${dbName}`,
        created: false,
        admin: `(usuarios en ${dbName})`
      });
    }
    if (!results.some((r) => !r.error)) {
      throw new Error('Ninguna base MySQL de empresa pudo abrirse.');
    }
    return results;
  }

  await initEngine();
  ensureDataDir();

  for (const company of config.companies) {
    const file = dbPathFor(company.slug);
    const existed = fs.existsSync(file);
    const db = openDb(company.slug);
    await db.exec(schemaSql);
    await db.exec(schemaModulesSql);
    await db.exec(schemaAngelSql);
    await migrateUserFlags(db);
    await seedCompany(db, company);
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

async function seedCompany(db, company) {
  const passwordHash = bcrypt.hashSync('password', 10);
  const adminEmail = `admin@${company.emailDomain}`;

  await db.prepare(`
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
    [5, 'Supply Chain', 'Aprobación OC y proveedores', '["home.html","solicitud-salida-materiales.html","portal-proveedores.html","solicitud-de-compras.html"]'],
    [6, 'Catálogo G', 'Acceso al módulo Catálogo G (empresa Global)', '["home.html","catalogo-g.html"]'],
    [7, 'Catálogo S', 'Acceso al módulo Catálogo S (empresa Sercom)', '["home.html","catalogo-s.html"]'],
    [8, 'Catálogo N', 'Acceso al módulo Catálogo N (empresa Nexus)', '["home.html","catalogo-n.html"]'],
    [9, 'Catálogo T', 'Acceso al módulo Catálogo T (empresa Táctica)', '["home.html","catalogo-t.html"]']
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
    // id, nombre, apellido, email, pass, cargo, rol_id, dept, checklist, flota, ssgg, camion, aprobador
    [1, 'Admin', company.name, adminEmail, passwordHash, 'Administrador Sistema', 1, 3, 1, 1, 1, 1, 1],
    [2, 'Juan', 'Pérez', `jperez@${company.emailDomain}`, passwordHash, 'Jefe de Proyecto', 2, 1, 0, 0, 0, 0, 1],
    [3, 'María', 'González', `mgonzalez@${company.emailDomain}`, passwordHash, 'Analista Operaciones', 3, 1, 1, 0, 0, 0, 0],
    [4, 'Carlos', 'Ruiz', `cruiz@${company.emailDomain}`, passwordHash, 'Bodeguero / Flota', 4, 2, 1, 1, 0, 0, 0],
    [5, 'Ana', 'Silva', `asilva@${company.emailDomain}`, passwordHash, 'Analista Compras', 5, 4, 0, 0, 0, 0, 1],
    [6, 'Edith', 'Gómez', `edith.gomez@${company.emailDomain}`, passwordHash, 'Supply Chain / Control Agenda', 5, 4, 0, 0, 0, 1, 1],
    [7, 'Pedro', 'Flota', `pflota@${company.emailDomain}`, passwordHash, 'Encargado de Flota', 3, 1, 1, 1, 0, 0, 0],
    [8, 'Lucia', 'Mantención', `lmanten@${company.emailDomain}`, passwordHash, 'Servicios Generales', 3, 1, 0, 0, 1, 0, 0]
  ];
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO usuarios
      (id, nombre, apellido, email, password, cargo, rol_id, departamento_id,
       flag_checklist, flag_flota, flag_ssgg, flag_camion_pluma, flag_aprobador_salida)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const u of usuarios) insertUser.run(...u);

  // Asegura flags en usuarios ya existentes (re-init)
  await db.prepare(`UPDATE usuarios SET flag_checklist=1, flag_flota=1, flag_ssgg=1, flag_camion_pluma=1, flag_aprobador_salida=1 WHERE id=1`).run();
  await db.prepare(`UPDATE usuarios SET flag_aprobador_salida=1 WHERE id IN (2,5)`).run();
  await db.prepare(`UPDATE usuarios SET flag_checklist=1 WHERE id IN (3,4)`).run();
  await db.prepare(`UPDATE usuarios SET flag_checklist=1, flag_flota=1 WHERE id=4`).run();
  await db.prepare(`UPDATE usuarios SET flag_camion_pluma=1, flag_aprobador_salida=1 WHERE email LIKE 'edith.gomez@%'`).run();
  await db.prepare(`UPDATE usuarios SET flag_checklist=1, flag_flota=1 WHERE email LIKE 'pflota@%'`).run();
  await db.prepare(`UPDATE usuarios SET flag_ssgg=1 WHERE email LIKE 'lmanten@%'`).run();

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

  await db.prepare(`
    INSERT OR IGNORE INTO proveedores (id, razon_social, rut, email, telefono)
    VALUES
      (1, 'Proveedor Demo SpA', '77.100.100-1', 'contacto@proveedordemo.cl', '+56 9 1111 1111'),
      (2, 'Distribuidora Norte Ltda', '77.200.200-2', 'ventas@distnorte.cl', '+56 9 2222 2222')
  `).run();

  // Solicitud de ejemplo
  const exists = db.prepare('SELECT id FROM solicitudes_materiales WHERE id = 1').get();
  if (!exists) {
    await db.prepare(`
      INSERT INTO solicitudes_materiales
        (id, codigo, ceco_id, estado_id, solicitante_id, jefe_proyecto_id, fecha_requerida,
         bodega_nombre, ubicacion_entrega, observaciones, quien_retira, quien_usa, numero_proyecto)
      VALUES
        (1, 'SOLMAT-00001', 1, 1, 3, 2, date('now', '+3 days'),
         ?, 'bodega', 'Solicitud de ejemplo generada en seed', 'María González', 'Cuadrilla A', 'PRY-2026-001')
    `).run(`Bodega Central ${company.name}`);

    await db.prepare(`
      INSERT INTO solicitudes_detalle
        (solicitud_id, material_id, cantidad, unidad, cantidad_pendiente, precio_unitario, subtotal)
      VALUES
        (1, 1, 100, 'MT', 100, 850, 85000),
        (1, 2, 50, 'UN', 50, 120, 6000),
        (1, 5, 10, 'UN', 10, 890, 8900)
    `).run();

    await db.prepare(`
      INSERT INTO historial_solicitudes (solicitud_id, estado_id, usuario_id, accion, comentarios)
      VALUES (1, 1, 3, 'Creación', 'Solicitud creada (seed)')
    `).run();
  }

  await seedModules(db, company);
}

async function seedModules(db, company) {
  const prefix = company.slug.substring(0, 3).toUpperCase();

  await db.prepare(`
    INSERT OR IGNORE INTO materiales_receta_tipos (id, nombre, descripcion) VALUES
      (1, 'Paradero estándar', 'Receta tipo paradero'),
      (2, 'Poste luminaria', 'Instalación luminaria'),
      (3, 'Canalización', 'Obra de canalización')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO materiales_receta_insumos (id, tipo_id, material_id, descripcion, cantidad, unidad, categoria) VALUES
      (1, 1, 3, 'Poste metálico 6m', 1, 'UN', 'Estructura'),
      (2, 1, 7, 'Luminaria LED 50W', 1, 'UN', 'Iluminación'),
      (3, 1, 8, 'Abrazadera metálica', 4, 'UN', 'Fijación'),
      (4, 2, 3, 'Poste metálico 6m', 1, 'UN', 'Estructura'),
      (5, 2, 7, 'Luminaria LED 50W', 2, 'UN', 'Iluminación'),
      (6, 3, 6, 'Canaleta PVC 40x25', 10, 'UN', 'Canalización'),
      (7, 3, 1, 'Cable UTP Cat6', 50, 'MT', 'Cableado')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO solicitudes_compras
      (id, numero_solicitud, solicitante_id, ceco_id, jefe_proyecto_id, fecha_requerida, estado, observaciones)
    VALUES (1, 'SC-00001', 3, 1, 2, date('now', '+7 days'), 'Pendiente', 'Compra de ejemplo')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO solicitudes_compras_detalle
      (id, solicitud_id, material_id, descripcion, cantidad, unidad, precio_estimado)
    VALUES (1, 1, 7, 'Luminaria LED 50W', 20, 'UN', 28000)
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO portal_proveedor
      (id, solicitud_id, proveedor_id, numero_guia, guia_estado, factura_estado)
    VALUES (1, 1, 1, NULL, 'Pendiente', 'Pendiente')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO creacion_datos_maestros
      (id, codigo, tipo, descripcion, unidad_medida, estado, solicitante_id)
    VALUES (1, NULL, 'Material', 'Tornillo hexagonal M8', 'UN', 'Pendiente', 3)
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO tareas_operativas
      (id, area, fecha, hora_inicio, hora_termino, descripcion, ubicacion, ceco_id, horas_hombre, responsable_id)
    VALUES (1, 'Operaciones', date('now'), '08:00', '12:00', 'Inspección de obra', 'Terreno', 1, 4, 3)
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO solicitud_graficas
      (id, codigo, ceco_id, solicitante_id, fecha_requerida, observaciones, estado)
    VALUES (1, 'SG-00001', 1, 3, date('now', '+5 days'), 'Planos de instalación', 'Pendiente Aprobación')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO servicios_generales
      (id, codigo, categoria, prioridad, titulo, descripcion, ubicacion, estado, solicitante_id)
    VALUES (1, 'SSGG-00001', 'Eléctrico', 'Alta', 'Falla tablero eléctrico', 'Corte intermitente en bodega', 'Bodega Central', 'Abierto', 3)
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO agenda_camion_pluma_v2
      (id, empresa, fecha, hora_inicio, hora_fin, tipo_servicio, solicitante, chofer, proyecto, origen, destino, kilometraje, estado, creado_por)
    VALUES (1, ?, date('now', '+1 day'), '09:00', '13:00', 'Servicio', 'María González', 'Chofer Demo', 'PRY-2026-001', 'Bodega', 'Obra', 45, 'Programado', 1)
  `).run(company.name);

  await db.prepare(`
    INSERT OR IGNORE INTO checklist_flota
      (id, patente, kilometraje, fecha, conductor_id, estado_general, observaciones)
    VALUES (1, 'ABCD12', 45200, date('now'), 3, 'OK', 'Checklist diario de ejemplo')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO requerimientos_telecom
      (id, codigo, tipo_solicitud, ceco_id, tipo_equipo, descripcion, estado, solicitante_id)
    VALUES (1, 'TEL-00001', 'Nueva línea', 1, 'Smartphone', 'Línea para jefe de terreno', 'Pendiente', 3)
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO seguimiento_contratos
      (id, codigo, proveedor_id, proveedor_nombre, descripcion, estado, creado_por)
    VALUES (1, 'CTR-00001', 1, 'Proveedor Demo SpA', 'Contrato de suministro anual', 'Borrador', 1)
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO aprobacion_facturas_lote
      (id, codigo, descripcion, creado_por, aprobador_id, estado)
    VALUES (1, 'LOTE-00001', 'Facturas semana actual', 5, 2, 'Pendiente')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO aprobacion_facturas
      (id, lote_id, numero_factura, proveedor, monto, estado)
    VALUES
      (1, 1, 'F-1001', 'Proveedor Demo SpA', 350000, 'Pendiente'),
      (2, 1, 'F-1002', 'Distribuidora Norte Ltda', 128000, 'Pendiente')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO salidas_actividad
      (id, codigo, tipo_receta_id, ceco_id, solicitante_id, cantidad_obras, numero_proyecto, estado)
    VALUES (1, 'SMA-00001', 1, 1, 3, 2, 'PRY-2026-001', 'Pendiente')
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO salidas_actividad_detalle
      (id, salida_id, material_id, descripcion, cantidad, unidad)
    VALUES
      (1, 1, 3, 'Poste metálico 6m', 2, 'UN'),
      (2, 1, 7, 'Luminaria LED 50W', 2, 'UN'),
      (3, 1, 8, 'Abrazadera metálica', 8, 'UN')
  `).run();
}

async function closeAll() {
  const closed = new Set();
  for (const db of connections.values()) {
    if (closed.has(db)) continue;
    closed.add(db);
    await db.close();
  }
  connections.clear();
}

module.exports = {
  getDb,
  getAllCompanyDbs,
  initAll,
  closeAll,
  dbPathFor,
  ensureDataDir,
  initEngine,
  isMysql: () => config.isMysql,
  migrateUserFlags
};
