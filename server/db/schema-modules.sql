-- Módulos adicionales ESERCOM

CREATE TABLE IF NOT EXISTS solicitudes_compras_detalle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL,
  material_id INTEGER,
  descripcion TEXT,
  cantidad REAL NOT NULL,
  unidad TEXT DEFAULT 'UN',
  precio_estimado REAL DEFAULT 0,
  observaciones TEXT,
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes_compras(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materiales(id)
);

CREATE TABLE IF NOT EXISTS portal_proveedor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL,
  proveedor_id INTEGER,
  numero_guia TEXT,
  fecha_entrega TEXT,
  persona_retira TEXT,
  guia_estado TEXT DEFAULT 'Pendiente',
  numero_factura TEXT,
  monto_factura REAL,
  factura_estado TEXT DEFAULT 'Pendiente',
  observaciones TEXT,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes_materiales(id),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
);

CREATE TABLE IF NOT EXISTS materiales_receta_tipos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS materiales_receta_insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_id INTEGER NOT NULL,
  material_id INTEGER,
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  unidad TEXT DEFAULT 'UN',
  categoria TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (tipo_id) REFERENCES materiales_receta_tipos(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materiales(id)
);

CREATE TABLE IF NOT EXISTS creacion_datos_maestros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT,
  tipo TEXT NOT NULL DEFAULT 'Material',
  descripcion TEXT NOT NULL,
  unidad_medida TEXT DEFAULT 'UN',
  color TEXT,
  medida TEXT,
  inventariable INTEGER DEFAULT 1,
  estado TEXT DEFAULT 'Pendiente',
  solicitante_id INTEGER,
  responsable TEXT,
  observaciones TEXT,
  eliminado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS tareas_operativas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL,
  fecha TEXT NOT NULL,
  hora_inicio TEXT,
  hora_termino TEXT,
  camioneta TEXT,
  descripcion TEXT NOT NULL,
  ubicacion TEXT,
  ceco_id INTEGER,
  horas_hombre REAL DEFAULT 0,
  responsable_id INTEGER,
  eliminado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ceco_id) REFERENCES cecos(id),
  FOREIGN KEY (responsable_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS solicitud_graficas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  ceco_id INTEGER,
  solicitante_id INTEGER NOT NULL,
  fecha_requerida TEXT,
  observaciones TEXT,
  estado TEXT DEFAULT 'Pendiente Aprobación',
  ot_numero TEXT,
  oc_numero TEXT,
  tipo_entrega TEXT,
  eliminado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ceco_id) REFERENCES cecos(id),
  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS servicios_generales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL,
  prioridad TEXT DEFAULT 'Media',
  titulo TEXT NOT NULL,
  descripcion TEXT,
  ubicacion TEXT,
  fecha_requerida TEXT,
  fecha_inicio TEXT,
  fecha_termino_estimada TEXT,
  fecha_termino_real TEXT,
  estado TEXT DEFAULT 'Abierto',
  solicitante_id INTEGER,
  eliminado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS checklist_flota (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patente TEXT NOT NULL,
  kilometraje INTEGER,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  conductor_id INTEGER,
  estado_general TEXT DEFAULT 'OK',
  neumaticos TEXT DEFAULT 'OK',
  luces TEXT DEFAULT 'OK',
  frenos TEXT DEFAULT 'OK',
  aceite TEXT DEFAULT 'OK',
  documentos TEXT DEFAULT 'OK',
  observaciones TEXT,
  anulado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conductor_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS requerimientos_telecom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  tipo_solicitud TEXT NOT NULL,
  ceco_id INTEGER,
  tipo_equipo TEXT,
  numero_linea TEXT,
  direccion_instalacion TEXT,
  fecha_requerida TEXT,
  descripcion TEXT,
  estado TEXT DEFAULT 'Pendiente',
  solicitante_id INTEGER,
  asignado_id INTEGER,
  eliminado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ceco_id) REFERENCES cecos(id),
  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id),
  FOREIGN KEY (asignado_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS seguimiento_contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  proveedor_id INTEGER,
  proveedor_nombre TEXT,
  descripcion TEXT NOT NULL,
  estado TEXT DEFAULT 'Borrador',
  versiones TEXT DEFAULT '[]',
  garantias TEXT DEFAULT '[]',
  aprobaciones TEXT DEFAULT '[]',
  creado_por INTEGER,
  eliminado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY (creado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS aprobacion_facturas_lote (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  creado_por INTEGER,
  aprobador_id INTEGER,
  estado TEXT DEFAULT 'Pendiente',
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  FOREIGN KEY (aprobador_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS aprobacion_facturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lote_id INTEGER NOT NULL,
  numero_factura TEXT,
  proveedor TEXT,
  monto REAL DEFAULT 0,
  estado TEXT DEFAULT 'Pendiente',
  observacion TEXT,
  fecha_decision TEXT,
  FOREIGN KEY (lote_id) REFERENCES aprobacion_facturas_lote(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS papelera (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  referencia_id INTEGER NOT NULL,
  codigo TEXT,
  titulo TEXT,
  datos_json TEXT,
  eliminado_por INTEGER,
  fecha_eliminacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (eliminado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS salidas_actividad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  tipo_receta_id INTEGER,
  ceco_id INTEGER,
  solicitante_id INTEGER,
  cantidad_obras REAL DEFAULT 1,
  numero_proyecto TEXT,
  estado TEXT DEFAULT 'Pendiente',
  observaciones TEXT,
  eliminado INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tipo_receta_id) REFERENCES materiales_receta_tipos(id),
  FOREIGN KEY (ceco_id) REFERENCES cecos(id),
  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS salidas_actividad_detalle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  salida_id INTEGER NOT NULL,
  material_id INTEGER,
  descripcion TEXT,
  cantidad REAL NOT NULL,
  unidad TEXT,
  FOREIGN KEY (salida_id) REFERENCES salidas_actividad(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materiales(id)
);

-- Ampliar agenda si faltan columnas (SQLite recrea en DBs nuevas)
CREATE TABLE IF NOT EXISTS agenda_camion_pluma_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa TEXT NOT NULL,
  fecha TEXT NOT NULL,
  hora_inicio TEXT,
  hora_fin TEXT,
  tipo_servicio TEXT DEFAULT 'Servicio',
  solicitante TEXT,
  chofer TEXT,
  ceco_id INTEGER,
  proyecto TEXT,
  origen TEXT,
  destino TEXT,
  direccion TEXT,
  contacto TEXT,
  telefono TEXT,
  kilometraje REAL DEFAULT 0,
  orden_compra TEXT,
  detalle_material TEXT,
  observaciones TEXT,
  es_bloqueo INTEGER DEFAULT 0,
  estado TEXT DEFAULT 'Programado',
  creado_por INTEGER,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ceco_id) REFERENCES cecos(id),
  FOREIGN KEY (creado_por) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_compras_estado ON solicitudes_compras(estado);
CREATE INDEX IF NOT EXISTS idx_tareas_fecha ON tareas_operativas(fecha);
CREATE INDEX IF NOT EXISTS idx_ssgg_estado ON servicios_generales(estado);
CREATE INDEX IF NOT EXISTS idx_checklist_patente ON checklist_flota(patente);
CREATE INDEX IF NOT EXISTS idx_telecom_estado ON requerimientos_telecom(estado);
CREATE INDEX IF NOT EXISTS idx_papelera_tipo ON papelera(tipo);
