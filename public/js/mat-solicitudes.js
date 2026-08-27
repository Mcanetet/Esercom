/**
 * Acciones y flujo Salida de Materiales (alineado al proceso Softland).
 * Estados: 1 Pendiente · 2 Asignar Bodeguero · 3 En Entrega · 4 OC · 5 Guías · 6 Cerrado · 7 Rechazado · 8 Anulado
 */
(function (global) {
  function currentUser(fallback) {
    return (typeof Auth !== 'undefined' && Auth.getUser && Auth.getUser()) || fallback || {};
  }

  function esEspecial(user, permisos) {
    const u = user || {};
    const p = permisos || {};
    const rol = String(u.rol || '').toLowerCase();
    return u.rol_id === 1
      || rol.includes('admin')
      || !!u.flag_aprobador_salida
      || !!p.materiales_super_aprobador
      || !!p.materiales_usuario_especial
      || !!p.validador_oc_supply_chain;
  }

  function esAprobador(user, permisos) {
    return esEspecial(user, permisos);
  }

  function esBodegueroRol(user) {
    const rol = String(user?.rol || '').toLowerCase();
    const cargo = String(user?.cargo || '').toLowerCase();
    return rol.includes('bodega') || cargo.includes('bodega') || cargo.includes('bodeguero');
  }

  function rowActionsHtml(r, ctx) {
    const user = currentUser(ctx.user);
    const especial = esEspecial(user, ctx.permisos);
    const aprobador = esAprobador(user, ctx.permisos);
    const propia = Number(r.solicitante_id) === Number(user.id);
    const eid = Number(r.estado_id);
    const est = String(r.estado || '').toLowerCase();
    const anulada = eid === 8 || /anulad/.test(est);
    const rechazada = eid === 7 || /rechazad/.test(est);
    const cerrada = eid === 6 || /cerrad/.test(est);
    const btns = [];

    btns.push(`<a class="btn btn-outline btn-sm" href="/ver-solicitud.html?id=${r.id}" title="Ver"><i class="fas fa-eye"></i> Ver</a>`);

    // Editar: especial siempre (excepto cerrada/anulada) o solicitante en pendiente
    if ((especial && !anulada && !cerrada && !rechazada) || (propia && eid === 1)) {
      btns.push(`<button type="button" class="btn btn-outline btn-sm" data-act="editar" data-id="${r.id}" title="Editar"><i class="fas fa-edit"></i> Editar</button>`);
    }

    if (aprobador && eid === 1) {
      btns.push(`<button type="button" class="btn btn-success btn-sm" data-act="aprobar" data-id="${r.id}" title="Aprobar"><i class="fas fa-check"></i> Aprobar</button>`);
      btns.push(`<button type="button" class="btn btn-danger btn-sm" data-act="rechazar" data-id="${r.id}" title="Rechazar"><i class="fas fa-times"></i> Rechazar</button>`);
    }

    // Asignar bodeguero (estado 2)
    if (especial && eid === 2 && r.ubicacion_entrega !== 'directo-proveedor') {
      btns.push(`<button type="button" class="btn btn-outline btn-sm" data-act="bodeguero" data-id="${r.id}" title="Asignar bodeguero"><i class="fas fa-user-tag"></i> Bodeguero</button>`);
    }

    // Entregar (estado 3)
    const puedeEntregar = eid === 3 && (
      especial
      || Number(r.bodeguero_id) === Number(user.id)
      || esBodegueroRol(user)
    );
    if (puedeEntregar) {
      btns.push(`<button type="button" class="btn btn-success btn-sm" data-act="entregar" data-id="${r.id}" title="Registrar entrega"><i class="fas fa-truck"></i> Entregar</button>`);
    }

    // Guía Softland (estado 5 o 3)
    if ((eid === 5 || eid === 3) && (especial || Number(r.bodeguero_id) === Number(user.id) || esBodegueroRol(user))) {
      btns.push(`<button type="button" class="btn btn-secondary btn-sm" data-act="guia" data-id="${r.id}" title="Guía Softland"><i class="fas fa-file-invoice"></i> Guía</button>`);
    }

    if (especial && !anulada && !rechazada && !cerrada) {
      btns.push(`<button type="button" class="btn btn-outline btn-sm" data-act="anular" data-id="${r.id}" title="Anular"><i class="fas fa-ban"></i> Anular</button>`);
    } else if (propia && eid === 1) {
      btns.push(`<button type="button" class="btn btn-outline btn-sm" data-act="anular" data-id="${r.id}" title="Anular"><i class="fas fa-ban"></i></button>`);
    }

    if (especial && anulada) {
      btns.push(`<button type="button" class="btn btn-success btn-sm" data-act="reactivar" data-id="${r.id}" title="Reactivar"><i class="fas fa-redo"></i> Reactivar</button>`);
    }

    return `<div class="mat-actions">${btns.join('')}</div>`;
  }

  global.MatSolicitudes = {
    esEspecial,
    esAprobador,
    rowActionsHtml,
    currentUser
  };
})(window);
