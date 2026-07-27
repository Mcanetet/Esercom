# ESERCOM — Gestión Integral Empresarial

Aplicación **Node.js** multiempresa basada en el sistema Salida de Materiales / [www.esercom.cl](https://www.esercom.cl).

## Empresas

Cada empresa tiene su **propia base de datos SQLite**:

| Empresa     | Slug         | Admin demo                         |
|-------------|--------------|------------------------------------|
| Global      | `global`     | `admin@globalviapublica.com`       |
| Sercom      | `sercom`     | `admin@serviciossercom.cl`         |
| Nexus       | `nexus`      | `admin@nexus.cl`                   |
| Tactica     | `tactica`    | `admin@tactica.cl`                 |
| Intercanje  | `intercanje` | `admin@intercanje.cl`              |

Contraseña demo de todos los usuarios seed: **`password`**

También existen usuarios por empresa: `jperez@…`, `mgonzalez@…`, `cruiz@…`, `asilva@…` (mismo dominio de cada empresa).

## Requisitos

- Node.js 18+
- npm

## Instalación

```bash
cd Esercom
npm install
npm run init-db   # crea data/*.db (también se ejecuta al arrancar)
npm start
```

Abrir: [http://localhost:3000](http://localhost:3000)

## Módulos

- Login con selector de empresa (estilo ESERCOM)
- Menú principal / dashboard
- **Solicitud de Salida de Materiales** (crear, listar, ver, aprobar, rechazar)
- Schema preparado para compras, agenda camión pluma y catálogos

## API principal

- `GET /api/auth/empresas`
- `POST /api/auth/login` `{ empresa, email, password, remember }`
- `GET /api/catalogos/*` (materiales, cecos, bodegas, estados, dashboard)
- `GET|POST /api/solicitudes`
- `GET /api/solicitudes/:id`
- `POST /api/solicitudes/:id/aprobar|rechazar|anular`

Autenticación: header `Authorization: Bearer <token>`.

## Estructura

```
server/          API Express + multi-tenant SQLite
public/          Login, home, salida de materiales
data/            Bases por empresa (*.db)
```
