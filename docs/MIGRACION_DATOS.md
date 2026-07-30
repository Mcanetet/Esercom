# Migración de data: MySQL (Salida Materiales) → ESERCOM (SQLite)

ESERCOM en Hostinger usa **SQLite por empresa** (`data/sercom.db`, etc.), no MySQL.
El dump viejo `database_completo.sql` **no refleja** la producción real (`solicitudes_materiales`).

## Qué se sumó al schema ESERCOM

### `solicitudes_materiales` (columnas productivas)
- Despacho: `despacho_conductor`, `despacho_rut`, `despacho_patente`, `despacho_direccion`
- SC / sobre-consumo: `observacion_aprobacion_sc`, `sc_etapa_aprobacion`
- Bodega: `bodega_id`, `bodeguero_id`
- Softland: `numero_guia_softland`, `guia_softland_adjunto`, `foto_entrega`, `guias_proveedor`
- Fechas: `fecha_aprobacion`, `aprobado_por_id`, `fecha_entrega*`, `fecha_cierre`
- Portal proveedor embebido: `portal_estado`, `guia_proveedor_*`, `factura_*`, `oc_validada_*`, `oc_rechazada_*`
- `email_proveedor`

### Otras
- `usuarios.ceco_id` + flags operativos (`flag_*`) — solo ESERCOM
- `materiales.categoria`
- Checklist ampliado (fotos, seguimiento, operario)
- SSGG: costos, técnico, adjuntos
- Tablas: `liberadores_config`, `liberadores_extra`, `usuarios_proveedor`, `portal_proveedor_log`
- Angel IA (`angel_ia_*`) — no viene de MySQL

## Paso a paso (traslado)

### 1. En el servidor viejo (phpMyAdmin)
Exporta como **JSON** (o CSV → convertir) estas tablas, una por archivo:

```
roles.json
departamentos.json
usuarios.json
cecos.json
materiales.json
proveedores.json
bodegas.json
estados_solicitud.json
solicitudes_materiales.json
solicitudes_detalle.json
historial_solicitudes.json
checklist_flota.json
servicios_generales.json
tareas_operativas.json
liberadores_config.json
```

Opcionales: `solicitud_de_compras` → renombrar a `solicitudes_compras.json`, portal, facturas, telecom, contratos.

### 2. En tu Mac / build
```bash
mkdir -p import/sercom
# copia los JSON a import/sercom/

npm install
npm run init-db
node server/db/import-mysql-json.js --empresa=sercom --dir=./import/sercom
# si quieres reemplazar seeds demo:
node server/db/import-mysql-json.js --empresa=sercom --dir=./import/sercom --wipe
```

### 3. Subir a Hostinger
Sube la carpeta `data/` (los `.db`) **o** corre `init-db` + import en el servidor si tienes Node CLI.

Variables de entorno:
- `ADMIN_PORTAL_PASSWORD`
- `JWT_SECRET`
- `NODE_ENV=production`

### 4. Verificar
- Login usuario real (mismo email/password hasheado bcrypt que en MySQL)
- Acceso sistema: `/acceso-sistema.html`
- Contar filas: solicitudes, materiales, usuarios

## Orden de importación (automático en el script)

1. Catálogos: roles → departamentos → usuarios → cecos → materiales → proveedores → bodegas → estados  
2. Solicitudes: materiales → detalle → historial  
3. Módulos: checklist, SSGG, tareas, liberadores, portal…

**Se conservan los IDs** para no romper relaciones.

## Passwords
Los `password` de MySQL (bcrypt) se importan tal cual. No hace falta regenerarlos si el hash es compatible (`$2y$` / `$2a$` — bcryptjs los acepta).

## Multi-empresa
Si el MySQL viejo es solo Sercom/Global, importa a `--empresa=sercom` (o `global`).  
Las otras empresas de ESERCOM quedan con seed demo hasta que tengas dumps separados.
