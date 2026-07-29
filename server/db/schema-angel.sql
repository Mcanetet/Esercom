-- Angel IA

CREATE TABLE IF NOT EXISTS angel_ia_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_key_enc TEXT,
  api_key_hint TEXT,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  activo INTEGER NOT NULL DEFAULT 0,
  reporte_semanal INTEGER NOT NULL DEFAULT 1,
  dia_reporte INTEGER NOT NULL DEFAULT 1,
  hora_reporte TEXT NOT NULL DEFAULT '08:00',
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  smtp_user TEXT,
  smtp_pass_enc TEXT,
  smtp_from TEXT,
  actualizado_por INTEGER,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS angel_ia_alertas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  severidad TEXT NOT NULL DEFAULT 'media',
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  modulo TEXT,
  referencia TEXT,
  usuario_id INTEGER,
  leida INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS angel_ia_mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  rol TEXT NOT NULL,
  contenido TEXT NOT NULL,
  meta_json TEXT,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS angel_ia_reportes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  archivo TEXT,
  destinatarios TEXT,
  resumen TEXT,
  generado_por INTEGER,
  fecha_creacion TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (generado_por) REFERENCES usuarios(id)
);

INSERT OR IGNORE INTO angel_ia_config (id, model, activo, reporte_semanal)
VALUES (1, 'gpt-4o-mini', 0, 1);

CREATE INDEX IF NOT EXISTS idx_angel_alertas_leida ON angel_ia_alertas(leida);
CREATE INDEX IF NOT EXISTS idx_angel_mensajes_user ON angel_ia_mensajes(usuario_id);
