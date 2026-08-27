-- ESERCOM schema multiempresa (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  razon_social TEXT NOT NULL,
  rut TEXT NOT NULL UNIQUE,
  email TEXT,
  telefono TEXT,
  direccion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  paginas_permitidas TEXT NOT NULL DEFAULT '["*"]',
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS departamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  apellido TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  telefono TEXT,
  cargo TEXT,
  rol_id INTEGER,
  departamento_id INTEGER,
  ceco_id INTEGER,
  flag_checklist INTEGER NOT NULL DEFAULT 0,
  flag_flota INTEGER NOT NULL DEFAULT 0,
  flag_ssgg INTEGER NOT NULL DEFAULT 0,
  flag_camion_pluma INTEGER NOT NULL DEFAULT 0,
  flag_aprobador_salida INTEGER NOT NULL DEFAULT 0,
  flag_chofer INTEGER NOT NULL DEFAULT 0,
  empresas_acceso TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  ultimo_acceso TEXT,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (rol_id) REFERENCES roles(id),
  FOREIGN KEY (departamento_id) REFERENCES departamentos(id),
  FOREIGN KEY (ceco_id) REFERENCES cecos(id)
);

CREATE TABLE IF NOT EXISTS cecos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  jefe_proyecto_id INTEGER,
  analista_compras_id INTEGER,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (jefe_proyecto_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (analista_compras_id) REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS materiales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  unidad TEXT DEFAULT 'UN',
  categoria TEXT,
  precio REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  razon_social TEXT NOT NULL,
  rut TEXT NOT NULL UNIQUE,
  email TEXT,
  telefono TEXT,
  direccion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bodegas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  ubicacion TEXT,
  telefono TEXT,
  email TEXT,
  responsable_id INTEGER,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (responsable_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS estados_solicitud (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  color TEXT DEFAULT '#64748b',
  orden INTEGER DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS solicitudes_materiales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  ceco_id INTEGER,
  estado_id INTEGER NOT NULL DEFAULT 1,
  solicitante_id INTEGER NOT NULL,
  jefe_proyecto_id INTEGER,
  fecha_solicitud TEXT NOT NULL DEFAULT (datetime('now')),
  fecha_requerida TEXT,
  bodega_nombre TEXT,
  bodega_id INTEGER,
  bodeguero_id INTEGER,
  ubicacion_entrega TEXT DEFAULT 'bodega',
  observaciones TEXT,
  quien_retira TEXT,
  quien_usa TEXT,
  numero_proyecto TEXT,
  forma_pedido TEXT DEFAULT 'normal',
  solicitud_padre_id INTEGER,
  solmat_referencia TEXT,
  observacion_aprobacion_sc TEXT,
  sc_etapa_aprobacion TEXT,
  orden_compra TEXT,
  proveedor_id INTEGER,
  email_proveedor TEXT,
  -- Guía de despacho (retiro)
  despacho_conductor TEXT,
  despacho_rut TEXT,
  despacho_patente TEXT,
  despacho_direccion TEXT,
  -- Softland / entrega
  numero_guia_softland TEXT,
  guia_softland_adjunto TEXT,
  foto_entrega TEXT,
  guias_proveedor TEXT,
  fecha_aprobacion TEXT,
  aprobado_por_id INTEGER,
  fecha_entrega TEXT,
  fecha_entrega_real TEXT,
  fecha_cierre TEXT,
  fecha_entrega_proveedor TEXT,
  -- Portal proveedor (estados embebidos como en MySQL prod)
  portal_estado TEXT,
  portal_activado_at TEXT,
  oc_validada_por INTEGER,
  oc_validada_at TEXT,
  oc_validada_observacion TEXT,
  oc_rechazada_por INTEGER,
  oc_rechazada_at TEXT,
  oc_rechazada_motivo TEXT,
  guia_proveedor_archivo TEXT,
  guia_proveedor_subida_at TEXT,
  guia_proveedor_numero TEXT,
  guia_proveedor_persona_retira TEXT,
  factura_estado TEXT,
  factura_archivo TEXT,
  factura_numero TEXT,
  factura_monto REAL,
  factura_subida_at TEXT,
  factura_aprobada_por INTEGER,
  factura_aprobada_at TEXT,
  factura_rechazada_motivo TEXT,
  factura_finanzas_notif_at TEXT,
  eliminado INTEGER NOT NULL DEFAULT 0,
  fecha_actualizacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ceco_id) REFERENCES cecos(id),
  FOREIGN KEY (estado_id) REFERENCES estados_solicitud(id),
  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id),
  FOREIGN KEY (jefe_proyecto_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  FOREIGN KEY (bodeguero_id) REFERENCES usuarios(id),
  FOREIGN KEY (solicitud_padre_id) REFERENCES solicitudes_materiales(id)
);

CREATE TABLE IF NOT EXISTS solicitudes_detalle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  cantidad REAL NOT NULL,
  unidad TEXT,
  cantidad_entregada REAL DEFAULT 0,
  cantidad_pendiente REAL,
  precio_unitario REAL DEFAULT 0,
  subtotal REAL DEFAULT 0,
  observaciones TEXT,
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes_materiales(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materiales(id)
);

CREATE TABLE IF NOT EXISTS historial_solicitudes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL,
  estado_id INTEGER,
  usuario_id INTEGER,
  accion TEXT NOT NULL,
  comentarios TEXT,
  fecha_cambio TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes_materiales(id) ON DELETE CASCADE,
  FOREIGN KEY (estado_id) REFERENCES estados_solicitud(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS solicitudes_compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_solicitud TEXT NOT NULL UNIQUE,
  solicitante_id INTEGER NOT NULL,
  ceco_id INTEGER,
  jefe_proyecto_id INTEGER,
  fecha_solicitud TEXT NOT NULL DEFAULT (datetime('now')),
  fecha_requerida TEXT,
  estado TEXT DEFAULT 'Pendiente',
  observaciones TEXT,
  eliminado INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id),
  FOREIGN KEY (ceco_id) REFERENCES cecos(id),
  FOREIGN KEY (jefe_proyecto_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS agenda_camion_pluma (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa TEXT NOT NULL,
  fecha TEXT NOT NULL,
  hora_inicio TEXT,
  hora_fin TEXT,
  proyecto TEXT,
  direccion TEXT,
  contacto TEXT,
  telefono TEXT,
  observaciones TEXT,
  estado TEXT DEFAULT 'Programado',
  creado_por INTEGER,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (creado_por) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_solmat_codigo ON solicitudes_materiales(codigo);
CREATE INDEX IF NOT EXISTS idx_solmat_estado ON solicitudes_materiales(estado_id);
CREATE INDEX IF NOT EXISTS idx_solmat_solicitante ON solicitudes_materiales(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_detalle_solicitud ON solicitudes_detalle(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_materiales_codigo ON materiales(codigo);
