# ESERCOM — Gestión Integral Empresarial

Aplicación **Node.js** multiempresa basada en Salida de Materiales / [www.esercom.cl](https://www.esercom.cl).

## Empresas

Cada empresa tiene su **propia base SQLite** en `data/`:

| Empresa | Admin demo |
|---------|------------|
| Global | `admin@globalviapublica.com` |
| Sercom | `admin@serviciossercom.cl` |
| Nexus | `admin@nexus.cl` |
| Tactica | `admin@tactica.cl` |
| Intercanje | `admin@intercanje.cl` |

Contraseña: **`password`**

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
