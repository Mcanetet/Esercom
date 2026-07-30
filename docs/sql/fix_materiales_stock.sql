-- Ejecutar en phpMyAdmin → gosercom_productivo_db → pestaña SQL
-- Agrega columnas que ESERCOM espera y el PHP antiguo puede no tener.
-- Si alguna ya existe, MySQL dirá "Duplicate column" → ignora ese error y sigue.

ALTER TABLE materiales ADD COLUMN precio DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE materiales ADD COLUMN stock DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE materiales ADD COLUMN categoria VARCHAR(255) NULL;

-- Opcional: si la unidad se llama distinto
-- ALTER TABLE materiales ADD COLUMN unidad VARCHAR(50) NULL DEFAULT 'UN';
