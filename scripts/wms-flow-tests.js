#!/usr/bin/env node
/**
 * Pruebas del flujo WMS (modelo caótico):
 * bodega → propuesta → aprobar → ingreso → traslado → bloqueo →
 * salida documento (manual + desde solicitud) → confirmar / pick multi-posición.
 *
 * Uso:
 *   node scripts/wms-flow-tests.js
 *   npm run test:wms
 */
const path = require('path');
const fs = require('fs');
const { initEngine, Database } = require('../server/db/sqlite');
const wms = require('../server/services/wms');

const OUT_DIR = path.join(__dirname, '..', 'data', 'reportes');
const OUT_JSON = path.join(OUT_DIR, 'wms-flow-test-results.json');

const results = [];
let passed = 0;
let failed = 0;

function ok(id, name, detail) {
  passed += 1;
  results.push({ id, name, ok: true, detail: detail || null });
  console.log(`  ✓ ${id} ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(id, name, err) {
  failed += 1;
  const msg = err?.message || String(err);
  results.push({ id, name, ok: false, detail: msg });
  console.error(`  ✗ ${id} ${name} — ${msg}`);
}

async function assert(id, name, fn) {
  try {
    const detail = await fn();
    ok(id, name, typeof detail === 'string' ? detail : undefined);
  } catch (err) {
    fail(id, name, err);
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message || 'Assertion failed');
}

async function seedCore(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS materiales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      unidad TEXT DEFAULT 'UN',
      activo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS estados_solicitud (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS solicitudes_materiales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      ceco_id INTEGER,
      estado_id INTEGER NOT NULL DEFAULT 1,
      solicitante_id INTEGER NOT NULL DEFAULT 1,
      numero_proyecto TEXT,
      bodega_nombre TEXT,
      bodega_id INTEGER,
      quien_retira TEXT,
      despacho_conductor TEXT,
      despacho_rut TEXT,
      despacho_patente TEXT,
      despacho_direccion TEXT,
      observaciones TEXT,
      eliminado INTEGER NOT NULL DEFAULT 0,
      fecha_solicitud TEXT NOT NULL DEFAULT (datetime('now')),
      fecha_entrega TEXT,
      fecha_actualizacion TEXT
    );
    CREATE TABLE IF NOT EXISTS solicitudes_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id INTEGER NOT NULL,
      material_id INTEGER NOT NULL,
      cantidad REAL NOT NULL,
      unidad TEXT,
      cantidad_entregada REAL DEFAULT 0,
      observaciones TEXT
    );
    CREATE TABLE IF NOT EXISTS historial_solicitudes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id INTEGER NOT NULL,
      estado_id INTEGER,
      usuario_id INTEGER,
      accion TEXT NOT NULL,
      comentarios TEXT,
      fecha_cambio TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.prepare(
    `INSERT INTO estados_solicitud (id, nombre) VALUES (2, 'Asignar Bodeguero'), (3, 'En Entrega'), (5, 'Guías Pendientes')`
  ).run();

  await db.prepare(
    `INSERT INTO materiales (codigo, nombre, unidad) VALUES ('MAT-TUERCA', 'Tuerca M8', 'UN'), ('MAT-PERNO', 'Perno 1/2', 'UN'), ('MAT-ARAND', 'Arandela', 'UN')`
  ).run();

  await db.prepare(`
    INSERT INTO solicitudes_materiales
      (codigo, estado_id, solicitante_id, numero_proyecto, bodega_nombre, quien_retira,
       despacho_conductor, despacho_patente, despacho_direccion)
    VALUES ('SOL-TEST-001', 3, 1, 'PRY-100', 'Bodega Test', 'Juan Retira', 'Pedro Cond', 'ABCD12', 'Faena Norte')
  `).run();

  const mats = await db.prepare('SELECT id, codigo FROM materiales ORDER BY id').all();
  const sol = await db.prepare(`SELECT id FROM solicitudes_materiales WHERE codigo = 'SOL-TEST-001'`).get();
  for (const m of mats) {
    await db.prepare(`
      INSERT INTO solicitudes_detalle (solicitud_id, material_id, cantidad, unidad, cantidad_entregada)
      VALUES (?, ?, ?, 'UN', 0)
    `).run(sol.id, m.id, m.codigo === 'MAT-TUERCA' ? 10 : (m.codigo === 'MAT-PERNO' ? 5 : 2));
  }
}

async function main() {
  console.log('\n══ WMS flujo — batería de pruebas ══\n');
  await initEngine();
  const db = new Database(null); // memoria
  db.driver = 'sqlite';

  await seedCore(db);
  await wms.ensureWmsSchema(db);

  let bodega;
  let propuesta;
  let posA;
  let posB;
  let salidaManual;
  let salidaSol;

  await assert('WMS-01', 'Meta / mercados disponibles', async () => {
    const meta = wms.getMeta();
    expect(meta.mercados?.length >= 3, 'Debe haber mercados');
    expect(meta.modelo === 'caotico', 'Modelo caótico');
    return `${meta.mercados.length} mercados`;
  });

  await assert('WMS-02', 'Crear bodega con zonas ingreso/despacho', async () => {
    bodega = await wms.createBodega(db, {
      userId: 1,
      empresaSlug: 'test',
      body: {
        nombre: 'Bodega Prueba WMS',
        mercado: 'chile',
        largo_m: 30,
        ancho_m: 20,
        alto_m: 7,
        tipo_almacenaje: 'mixto'
      }
    });
    expect(bodega?.id, 'bodega id');
    expect(bodega.zonas?.length >= 3, 'zonas >= 3');
    const tipos = bodega.zonas.map((z) => z.tipo);
    expect(tipos.includes('ingreso'), 'zona ingreso');
    expect(tipos.includes('despacho'), 'zona despacho');
    return `${bodega.codigo} · ${bodega.zonas.length} zonas`;
  });

  await assert('WMS-03', 'Generar layout (rack/piso) con dimensiones', async () => {
    const layout = wms.generarLayoutPropuesta({
      bodega,
      tipoAlmacenaje: 'mixto',
      posLargo: 1.2,
      posAncho: 1.0,
      posAlto: 1.5,
      niveles: 2,
      pasillo: 2.5,
      parametros: bodega.parametros
    });
    expect(layout.posiciones.length > 0, 'posiciones > 0');
    expect(layout.zonas.length >= 3, 'zonas layout');
    return `${layout.meta.total} posiciones · ${layout.meta.filas}×${layout.meta.columnas}`;
  });

  await assert('WMS-04', 'Crear propuesta editable', async () => {
    propuesta = await wms.crearPropuesta(db, {
      userId: 1,
      bodegaId: bodega.id,
      body: {
        tipo_almacenaje: 'mixto',
        pos_largo_m: 1.2,
        pos_ancho_m: 1.0,
        pos_alto_m: 1.5,
        niveles: 2,
        pasillo_m: 2.5,
        notas: 'Prueba automática'
      }
    });
    expect(propuesta.estado === 'pendiente', 'estado pendiente');
    expect(propuesta.total_posiciones > 0, 'total > 0');
    return `${propuesta.codigo} · ${propuesta.total_posiciones} pos`;
  });

  await assert('WMS-05', 'Editar propuesta (agregar posición manual)', async () => {
    const layout = propuesta.layout;
    layout.posiciones.push({
      codigo: 'POS-TEST-EXTRA-N1',
      tipo: 'piso',
      fila: 'Z',
      columna: '99',
      nivel: 1,
      largo_m: 1.2,
      ancho_m: 1,
      alto_m: 1.5,
      x_m: 0.5,
      y_m: 5,
      capacidad_kg: 800,
      zona_tipo: 'almacen',
      estado: 'libre'
    });
    propuesta = await wms.updatePropuestaLayout(db, propuesta.id, {
      posiciones: layout.posiciones
    });
    expect(
      propuesta.layout.posiciones.some((p) => p.codigo === 'POS-TEST-EXTRA-N1'),
      'posición extra presente'
    );
    return `${propuesta.total_posiciones} posiciones`;
  });

  await assert('WMS-06', 'Aprobar propuesta → crear espacios + QR', async () => {
    const res = await wms.aprobarPropuesta(db, propuesta.id, { userId: 1 });
    expect(res.creadas > 0, 'creadas > 0');
    expect(res.propuesta.estado === 'aprobada', 'aprobada');
    const full = await wms.getBodega(db, bodega.id);
    expect(full.posiciones.length >= res.creadas, 'posiciones en bodega');
    expect(full.posiciones.every((p) => p.qr_token), 'todas con QR');
    posA = full.posiciones[0];
    posB = full.posiciones[1] || full.posiciones[0];
    bodega = full;
    return `${res.creadas} creadas · ej. ${posA.codigo}`;
  });

  await assert('WMS-07', 'Ingreso caótico (posición sugerida)', async () => {
    const r = await wms.ingresoMaterial(db, {
      userId: 1,
      body: {
        bodega_id: bodega.id,
        material_codigo: 'MAT-TUERCA',
        material_nombre: 'Tuerca M8',
        cantidad: 20,
        unidad: 'UN'
      }
    });
    expect(r.posicion?.codigo, 'posición asignada');
    expect(r.movimiento, 'movimiento');
    return `${r.movimiento} → ${r.posicion.codigo}`;
  });

  await assert('WMS-08', 'Ingreso con QR/posición manual', async () => {
    const r = await wms.ingresoMaterial(db, {
      userId: 1,
      body: {
        bodega_id: bodega.id,
        material_codigo: 'MAT-PERNO',
        material_nombre: 'Perno 1/2',
        cantidad: 15,
        posicion_codigo: posA.codigo,
        modo_captura: 'manual'
      }
    });
    expect(r.posicion.codigo === posA.codigo, 'misma posición');
    return `${r.cantidad} en ${r.posicion.codigo}`;
  });

  await assert('WMS-09', 'Ingreso segundo SKU otra posición (caótico)', async () => {
    const r = await wms.ingresoMaterial(db, {
      userId: 1,
      body: {
        bodega_id: bodega.id,
        material_codigo: 'MAT-ARAND',
        cantidad: 8,
        posicion_codigo: posB.codigo
      }
    });
    expect(r.posicion.codigo === posB.codigo, 'pos B');
    return r.posicion.codigo;
  });

  await assert('WMS-10', 'Buscar ubicaciones de material', async () => {
    const rows = await wms.buscarMaterialUbicaciones(db, {
      bodegaId: bodega.id,
      materialCodigo: 'MAT-TUERCA'
    });
    expect(rows.length >= 1, 'al menos 1 ubicación');
    const stock = rows.reduce((a, r) => a + Number(r.cantidad), 0);
    expect(stock >= 20, 'stock tuercas >= 20');
    return `${rows.length} ubi · stock ${stock}`;
  });

  await assert('WMS-11', 'Traslado interno entre posiciones', async () => {
    const r = await wms.trasladoMaterial(db, {
      userId: 1,
      body: {
        bodega_id: bodega.id,
        material_codigo: 'MAT-TUERCA',
        cantidad: 3,
        posicion_origen_codigo: (await wms.buscarMaterialUbicaciones(db, {
          bodegaId: bodega.id,
          materialCodigo: 'MAT-TUERCA'
        }))[0].posicion_codigo,
        posicion_destino_codigo: posB.codigo
      }
    });
    expect(r.origen && r.destino, 'origen/destino');
    expect(r.origen.codigo !== r.destino.codigo || posA.id === posB.id, 'traslado');
    return `${r.origen.codigo} → ${r.destino.codigo}`;
  });

  await assert('WMS-12', 'Bloquear posición y rechazar ingreso', async () => {
    const blocked = await wms.setPosicionEstado(db, {
      bodegaId: bodega.id,
      codigo: posA.codigo,
      estado: 'bloqueada'
    });
    expect(blocked.estado === 'bloqueada', 'bloqueada');
    let rejected = false;
    try {
      await wms.ingresoMaterial(db, {
        userId: 1,
        body: {
          bodega_id: bodega.id,
          material_codigo: 'MAT-PERNO',
          cantidad: 1,
          posicion_codigo: posA.codigo
        }
      });
    } catch (err) {
      rejected = /bloqueada/i.test(err.message);
    }
    expect(rejected, 'debe rechazar ingreso a bloqueada');
    await wms.setPosicionEstado(db, {
      bodegaId: bodega.id,
      codigo: posA.codigo,
      estado: 'libre'
    });
    return 'bloqueo OK';
  });

  await assert('WMS-13', 'Salida rápida (QR/manual) descuenta stock', async () => {
    const before = await wms.buscarMaterialUbicaciones(db, {
      bodegaId: bodega.id,
      materialCodigo: 'MAT-PERNO'
    });
    const totalBefore = before.reduce((a, r) => a + Number(r.cantidad), 0);
    const r = await wms.salidaMaterial(db, {
      userId: 1,
      body: {
        bodega_id: bodega.id,
        material_codigo: 'MAT-PERNO',
        cantidad: 2,
        posicion_codigo: posA.codigo,
        modo_captura: 'manual'
      }
    });
    expect(r.movimiento, 'mov');
    const after = await wms.buscarMaterialUbicaciones(db, {
      bodegaId: bodega.id,
      materialCodigo: 'MAT-PERNO'
    });
    const totalAfter = after.reduce((a, r) => a + Number(r.cantidad), 0);
    expect(totalAfter === totalBefore - 2, `stock ${totalBefore}→${totalAfter}`);
    return r.movimiento;
  });

  await assert('WMS-14', 'Crear salida manual (documento SAL-)', async () => {
    salidaManual = await wms.createSalidaManual(db, {
      userId: 1,
      body: {
        bodega_id: bodega.id,
        quien_retira: 'Operario Test',
        lineas: [
          { material_codigo: 'MAT-ARAND', cantidad: 2, unidad: 'UN' },
          { material_codigo: 'MAT-TUERCA', cantidad: 4, unidad: 'UN' }
        ]
      }
    });
    expect(salidaManual.codigo.startsWith('SAL-'), 'prefijo SAL');
    expect(salidaManual.estado === 'borrador', 'borrador');
    expect(salidaManual.detalle.length === 2, '2 líneas');
    return salidaManual.codigo;
  });

  await assert('WMS-15', 'Confirmar salida manual (pick caótico)', async () => {
    const res = await wms.confirmarSalida(db, {
      userId: 1,
      salidaId: salidaManual.id,
      body: {}
    });
    expect(res.salida.estado === 'confirmada', `estado=${res.salida.estado}`);
    expect(res.picks.length >= 2, 'picks >= 2');
    expect(res.errores.length === 0, res.errores.join('; ') || 'sin errores');
    return `${res.picks.length} picks · ${res.salida.estado}`;
  });

  await assert('WMS-16', 'Listar solicitudes pendientes de despacho', async () => {
    const rows = await wms.listSolicitudesPendientesDespacho(db, {});
    expect(rows.some((r) => r.codigo === 'SOL-TEST-001'), 'SOL-TEST-001');
    return `${rows.length} pendientes`;
  });

  await assert('WMS-17', 'Crear salida desde solicitud', async () => {
    const sol = await db.prepare(
      `SELECT id FROM solicitudes_materiales WHERE codigo = 'SOL-TEST-001'`
    ).get();
    // Asegurar stock suficiente para la solicitud
    await wms.ingresoMaterial(db, {
      userId: 1,
      body: { bodega_id: bodega.id, material_codigo: 'MAT-TUERCA', cantidad: 50 }
    });
    await wms.ingresoMaterial(db, {
      userId: 1,
      body: { bodega_id: bodega.id, material_codigo: 'MAT-PERNO', cantidad: 20 }
    });
    await wms.ingresoMaterial(db, {
      userId: 1,
      body: { bodega_id: bodega.id, material_codigo: 'MAT-ARAND', cantidad: 10 }
    });

    salidaSol = await wms.createSalidaFromSolicitud(db, {
      userId: 1,
      body: { bodega_id: bodega.id, solicitud_id: sol.id }
    });
    expect(salidaSol.solicitud_codigo === 'SOL-TEST-001', 'vinculada');
    expect(salidaSol.detalle.length >= 3, 'líneas de solicitud');
    expect(salidaSol.origen === 'solicitud', 'origen solicitud');
    return `${salidaSol.codigo} · ${salidaSol.detalle.length} líneas`;
  });

  await assert('WMS-18', 'Confirmar salida de solicitud → estado Guías pendientes', async () => {
    const res = await wms.confirmarSalida(db, {
      userId: 1,
      salidaId: salidaSol.id,
      body: {
        quien_retira: 'Juan Retira',
        despacho_conductor: 'Pedro Cond',
        despacho_patente: 'ABCD12'
      }
    });
    expect(res.salida.estado === 'confirmada', `salida=${res.salida.estado}`);
    expect(res.errores.length === 0, res.errores.join('; ') || 'ok');

    const sol = await db.prepare(
      `SELECT estado_id FROM solicitudes_materiales WHERE codigo = 'SOL-TEST-001'`
    ).get();
    expect(Number(sol.estado_id) === 5, `solicitud estado_id=${sol.estado_id} (esperado 5)`);

    const dets = await db.prepare(`
      SELECT d.cantidad, d.cantidad_entregada, m.codigo
      FROM solicitudes_detalle d
      JOIN materiales m ON m.id = d.material_id
      WHERE d.solicitud_id = (SELECT id FROM solicitudes_materiales WHERE codigo = 'SOL-TEST-001')
    `).all();
    for (const d of dets) {
      expect(
        Number(d.cantidad_entregada) >= Number(d.cantidad),
        `${d.codigo}: entregada ${d.cantidad_entregada} < pedida ${d.cantidad}`
      );
    }

    const hist = await db.prepare(`
      SELECT accion FROM historial_solicitudes
      WHERE solicitud_id = (SELECT id FROM solicitudes_materiales WHERE codigo = 'SOL-TEST-001')
      ORDER BY id DESC LIMIT 1
    `).get();
    expect(/WMS|Despacho/i.test(hist?.accion || ''), 'historial WMS');

    return `SOL→estado 5 · ${res.picks.length} picks`;
  });

  await assert('WMS-19', 'KPIs de ocupación / movimientos', async () => {
    const k = await wms.getBodegaKpis(db, bodega.id);
    expect(k.total_posiciones > 0, 'posiciones');
    expect(k.movimientos_hoy > 0, 'movimientos hoy');
    expect(typeof k.ocupacion_pct === 'number', 'ocupación');
    return `ocup ${k.ocupacion_pct}% · mov ${k.movimientos_hoy} · SKUs ${k.skus_distintos}`;
  });

  await assert('WMS-20', 'Anular borrador y rechazar re-confirmar confirmada', async () => {
    const draft = await wms.createSalidaManual(db, {
      userId: 1,
      body: {
        bodega_id: bodega.id,
        lineas: [{ material_codigo: 'MAT-TUERCA', cantidad: 1 }]
      }
    });
    const an = await wms.anularSalida(db, { salidaId: draft.id, userId: 1 });
    expect(an.estado === 'anulada', 'anulada');

    let blocked = false;
    try {
      await wms.confirmarSalida(db, { userId: 1, salidaId: salidaManual.id, body: {} });
    } catch (err) {
      blocked = /ya está confirmada|anulada/i.test(err.message);
    }
    expect(blocked, 'no re-confirmar');
    return 'guardas OK';
  });

  await assert('WMS-21', 'Lookup posición por QR token', async () => {
    const found = await wms.findPosicion(db, { qrToken: posA.qr_token });
    expect(found?.codigo === posA.codigo, 'match QR');
    return found.codigo;
  });

  // Resumen
  console.log('\n── Resumen ──');
  console.log(`  Pasaron: ${passed}`);
  console.log(`  Fallaron: ${failed}`);
  console.log(`  Total: ${passed + failed}`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    module: 'wms',
    modelo: 'caotico',
    passed,
    failed,
    total: passed + failed,
    results
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  console.log(`\n  Informe: ${OUT_JSON}\n`);

  db.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(2);
});
