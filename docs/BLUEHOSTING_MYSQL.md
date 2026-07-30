# Bluehosting — Opción A (MySQL compartida)

Node.js ESERCOM se conecta a la **misma** base MySQL del PHP (`gosercom_productivo_db`). No hay que exportar ni `init-db`.

## Variables de entorno (cPanel → Node.js Selector)

```
DB_DRIVER=mysql
DB_HOST=localhost
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=gosercom_productivo_db
JWT_SECRET=...
ADMIN_PORTAL_PASSWORD=...
NODE_ENV=production
```

## Arranque

1. Application root: carpeta del repo (ej. `~/esercom-app`)
2. Startup file: `server/index.js`
3. Node **≥ 18**
4. `npm install` (usa `mysql2` + `sql.js`; sin compiladores nativos)
5. Restart app

Al iniciar, el servidor:

- Abre pool MySQL
- Agrega flags operativos en `usuarios` si faltan (`flag_checklist`, etc.)
- Crea tablas Angel IA si no existen
- **No** siembra usuarios demo (usa los de producción)

## Login

Usuarios y contraseñas son los de la BD productiva. El selector de empresa en el front sigue existiendo (JWT/empresa), pero todas apuntan a la misma MySQL.

Portal admin: `/acceso-sistema.html` + `ADMIN_PORTAL_PASSWORD`.

## Nota sobre roles

En MySQL productivo la columna suele llamarse `roles.permisos`. El adapter la expone como `paginas_permitidas` en las consultas.
