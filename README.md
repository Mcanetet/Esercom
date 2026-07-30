# ESERCOM — Gestión Integral Empresarial

Aplicación **Node.js** multiempresa basada en Salida de Materiales / [www.esercom.cl](https://www.esercom.cl).

## Empresas

### Local (SQLite)

Cada empresa tiene su **propia base SQLite** en `data/`:

| Empresa | Admin demo |
|---------|------------|
| Global | `admin@globalviapublica.com` |
| Sercom | `admin@serviciossercom.cl` |
| Nexus | `admin@nexus.cl` |
| Tactica | `admin@tactica.cl` |
| Intercanje | `admin@intercanje.cl` |

Contraseña: **`password`**

### Producción Bluehosting (MySQL — Opción A)

Node usa la **misma** MySQL `gosercom_productivo_db` que el PHP actual (sin exportar a SQLite).

Variables en cPanel → Node.js → Environment:

| Variable | Valor |
|----------|--------|
| `DB_DRIVER` | `mysql` |
| `DB_HOST` | `localhost` |
| `DB_USER` | usuario MySQL de cPanel |
| `DB_PASSWORD` | contraseña MySQL |
| `DB_NAME` | `gosercom_productivo_db` |
| `JWT_SECRET` | clave larga aleatoria |
| `ADMIN_PORTAL_PASSWORD` | clave del portal `/acceso-sistema.html` |
| `NODE_ENV` | `production` |

Startup file: `server/index.js`. Con MySQL **no** hace falta `npm run init-db` (usa usuarios/datos ya existentes; solo agrega columnas flags + tablas Angel IA si faltan).

> Recomendado: app Node en subruta (`/app`) para no pisar el HTML/PHP actual.

## Instalación

```bash
npm install
npm run init-db
npm start
```

Abrir http://localhost:3000

> **Nota Hostinger / cPanel:** el proyecto usa `sql.js` (SQLite en WASM), sin módulos nativos.  
> Así evita el error de `better-sqlite3` (`GLIBC_2.29` / `make not found`) en CloudLinux.  
> Tras el deploy: `npm install` → `npm run init-db` → arrancar la app Node.

## Acceso administrador (URL separada)

No aparece en el menú público. Solo por enlace directo:

**https://tudominio.cl/acceso-sistema.html**

1. Elige la **empresa**
2. Ingresa la **clave maestra** (`ADMIN_PORTAL_PASSWORD`, no la contraseña de usuario)
3. Entras como administrador con acceso total → **Panel admin** → **API OpenAI**

### Hostinger (Environment variables)

| Variable | Ejemplo |
|----------|---------|
| `ADMIN_PORTAL_PASSWORD` | `MiClaveSecreta2026!` |
| `JWT_SECRET` | clave larga aleatoria |
| `NODE_ENV` | `production` |

En local (desarrollo), si no defines la variable, la clave por defecto es **`esercom-admin`**.

## Migrar data del servidor viejo (MySQL → SQLite local)

Ver guía completa: [docs/MIGRACION_DATOS.md](docs/MIGRACION_DATOS.md)

Resumen: exportar tablas JSON desde phpMyAdmin → `node server/db/import-mysql-json.js --empresa=sercom --dir=./import/sercom`

Para **usar MySQL en vivo** (Bluehosting, sin migrar): [docs/BLUEHOSTING_MYSQL.md](docs/BLUEHOSTING_MYSQL.md)

## Módulos

1. Solicitud de Salida Materiales  
2. Salida Material por Actividad  
3. Portal Proveedores  
4. Materiales por Receta  
5. Solicitud de Compras  
6. Creación Datos Maestros  
7. Tareas Operativas  
8. Solicitud de Gráficas  
9. Servicios Generales  
10. Agenda Camión Pluma  
11. Checklist Flota  
12. Telecomunicaciones  
13. Gestión de Contratos  
14. Aprobación de Facturas  
15. Reportes (+ export CSV)  
16. Configuraciones  
17. Papelera  

## Angel IA

Asistente OpenAI integrado:

1. Entra como **Administrador**
2. Ve a **Seguridad Angel IA** e ingresa tu API key (`sk-...`)
3. Usa **Angel IA** para preguntar, generar Excel semanal por CECO/materiales y sincronizar alertas

La API key se guarda cifrada (AES-256-GCM) por empresa y solo es visible/editable por administradores.

Scheduler:
- Alertas de pendientes: cada hora
- Reporte semanal Excel a jefes de proyecto: según día configurado (default lunes 08:00)

## API

- `/api/auth/*` — login multiempresa  
- `/api/catalogos/*` — materiales, cecos, bodegas, dashboard  
- `/api/solicitudes/*` — salida de materiales  
- `/api/modulos/*` — resto de módulos  
- `/api/angel/*` — Angel IA (chat, alertas, reportes, seguridad)  

Auth: `Authorization: Bearer <token>`
