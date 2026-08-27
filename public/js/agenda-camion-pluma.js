/**
 * Agenda Camión Pluma — calendario Lun–Dom, modal, km y precio automático
 */
(function () {
  'use strict';

  const HORA_INICIO = 7;
  const HORA_FIN = 17;
  const SLOT_MINUTOS = 60;
  const DIAS_HABILES = 5;
  const DIAS_CON_FINDE = 7;
  const TABLA_PAGE_SIZE = 5;
  const JORNADA_INICIO_MIN = 7 * 60;
  const JORNADA_FIN_LUN_JUE_MIN = 16 * 60 + 30;
  const JORNADA_FIN_VIE_MIN = 15 * 60 + 30;
  const EMPRESAS = ['Sercom', 'Global', 'Intercanje', 'Tactica', 'Nexus', 'Otros'];

  let semanaInicio = null;
  let servicios = [];
  let canManage = false;
  let canEditAgenda = false;
  let canEditPrecios = false;
  let cecos = [];
  let usuarios = [];
  let choferes = [];
  let tramos = [];
  let rutas = [];
  let precioKmAdicional = 1800;
  let precioHoraAdicional = 18000;
  let tablaPagina = 1;
  const busquedaState = {
    cpOrigen: { timer: null, seq: 0 },
    cpDestino: { timer: null, seq: 0 },
    cpSolicitante: { timer: null, seq: 0 }
  };
  const addrCoords = { cpOrigen: null, cpDestino: null };
  const ADDR_FIELDS = {
    cpOrigen: { listId: 'cpListOrigen', otherListId: 'cpListDestino' },
    cpDestino: { listId: 'cpListDestino', otherListId: 'cpListOrigen' }
  };

  function $(id) { return document.getElementById(id); }

  function normFecha(v) {
    if (!v) return '';
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const day = String(v.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') : s + 'T12:00:00');
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return s.slice(0, 10);
  }

  function normHora(v) {
    if (!v) return '';
    const s = String(v);
    const m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
  }

  function fechaStr(d) {
    return normFecha(d);
  }

  function timeToMinutes(t) {
    const h = normHora(t);
    if (!h) return 0;
    const [hh, mm] = h.split(':').map(Number);
    return (hh || 0) * 60 + (mm || 0);
  }

  function getSemanaInicio(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(12, 0, 0, 0);
    return date;
  }

  function actualizarRangoSemana() {
    if (!semanaInicio) semanaInicio = getSemanaInicio(new Date());
  }

  function actualizarLabelSemana() {
    actualizarRangoSemana();
    const fin = new Date(semanaInicio);
    fin.setDate(fin.getDate() + diasEnCalendario() - 1);
    const opts = { weekday: 'short', day: 'numeric', month: 'short' };
    const el = $('cpWeekLabel');
    if (el) {
      el.textContent = `${semanaInicio.toLocaleDateString('es-CL', opts)} – ${fin.toLocaleDateString('es-CL', opts)}`;
    }
    const sel = $('cpFechaSelector');
    if (sel) sel.value = fechaStr(semanaInicio);
  }

  function solapa(fecha, slotIniMin, slotFinMin, s) {
    const f = normFecha(s.fecha_servicio || s.fecha);
    if (f !== fecha) return false;
    const ini = timeToMinutes(s.hora_inicio);
    const fin = timeToMinutes(s.hora_fin);
    if (!fin || fin <= ini) return ini >= slotIniMin && ini < slotFinMin;
    return slotIniMin < fin && slotFinMin > ini;
  }

  function esSlotPasado(date, slotIniMin) {
    const slotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(slotIniMin / 60), slotIniMin % 60);
    return slotDate.getTime() <= Date.now();
  }

  const FINde_STORAGE_KEY = 'cp_habilitar_finde';

  function findeHabilitado() {
    return !!$('cpHabilitarFinde')?.checked;
  }

  function diasEnCalendario() {
    return findeHabilitado() ? DIAS_CON_FINDE : DIAS_HABILES;
  }

  function actualizarHintFinde() {
    const el = $('cpCalendarHint');
    if (!el) return;
    if (findeHabilitado()) {
      el.innerHTML = 'Vista <strong>lun–dom</strong> (7 días). Sábado y domingo habilitados para reservar (07:00–17:00).';
    } else {
      el.innerHTML = 'Vista <strong>lun–vie</strong> (5 días). Marque el check para mostrar sábado y domingo.';
    }
  }

  function slotDentroDeJornada(dayOfWeek, slotIniMin) {
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      if (!findeHabilitado()) return false;
      return slotIniMin >= JORNADA_INICIO_MIN && slotIniMin < HORA_FIN * 60;
    }
    const finJornada = dayOfWeek === 5 ? JORNADA_FIN_VIE_MIN : JORNADA_FIN_LUN_JUE_MIN;
    return slotIniMin >= JORNADA_INICIO_MIN && slotIniMin < finJornada;
  }

  function serviciosFiltrados() {
    const filtroEmpresa = $('cpFiltroEmpresa')?.value || '';
    const filtroEstado = $('cpFiltroEstado')?.value || '';
    let lista = [...servicios];
    if (filtroEmpresa) lista = lista.filter((s) => (s.empresa || '') === filtroEmpresa);
    if (filtroEstado) lista = lista.filter((s) => (s.estado || '') === filtroEstado);
    return lista;
  }

  async function cargarCatalogos() {
    const [t, r] = await Promise.all([
      Auth.api('/api/modulos/agenda/tramos'),
      Auth.api('/api/modulos/agenda/rutas')
    ]);
    tramos = t.tramos || [];
    precioKmAdicional = t.precio_km_adicional || 1800;
    precioHoraAdicional = t.precio_hora_adicional || 18000;
    rutas = r.rutas || [];
  }

  async function cargarAgenda() {
    actualizarRangoSemana();
    const desde = fechaStr(semanaInicio);
    const fin = new Date(semanaInicio);
    fin.setDate(fin.getDate() + diasEnCalendario() - 1);
    const hasta = fechaStr(fin);
    const res = await Auth.api(`/api/modulos/agenda?fecha_desde=${desde}&fecha_hasta=${hasta}`);
    servicios = (res.data || []).map((s) => ({
      ...s,
      fecha_servicio: normFecha(s.fecha_servicio || s.fecha),
      hora_inicio: normHora(s.hora_inicio),
      hora_fin: normHora(s.hora_fin)
    }));
    canManage = !!res.can_manage;
    canEditAgenda = !!(res.can_edit_agenda ?? res.can_manage);
    canEditPrecios = !!res.can_edit_precios;
    const btnPrecio = $('btnPrecioVenta');
    if (btnPrecio) btnPrecio.style.display = canEditPrecios ? '' : 'none';
    const btnProgramar = $('btnProgramar');
    if (btnProgramar) btnProgramar.style.display = canEditAgenda ? '' : 'none';
    return servicios;
  }

  function calcularPrecioLocal(km) {
    const k = Number(km);
    if (!k || k < 0 || !tramos.length) return { tramoNombre: '', subtotal: 0 };
    let tramo = tramos.find((t) => k > (Number(t.km_min) || 0) && k <= (Number(t.km_max) || 999));
    if (!tramo) {
      tramo = k <= (Number(tramos[0]?.km_max) || 0) ? tramos[0] : tramos[tramos.length - 1];
    }
    if (!tramo) return { tramoNombre: '', subtotal: 0 };
    const base = Number(tramo.precio_sugerido_iva) || 0;
    const extra = k > 45 ? (k - 45) * precioKmAdicional : 0;
    return { tramoNombre: tramo.nombre || '', subtotal: Math.round(base + extra) };
  }

  function actualizarPrecioModal() {
    const km = $('cpKilometraje')?.value;
    const { tramoNombre, subtotal } = calcularPrecioLocal(km);
    if ($('cpTramo')) $('cpTramo').value = tramoNombre;
    if ($('cpPrecioTotal')) {
      $('cpPrecioTotal').value = subtotal > 0
        ? '$ ' + subtotal.toLocaleString('es-CL')
        : '';
    }
  }

  function pintarCalendario() {
    const grid = $('cpCalendarGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const numDias = diasEnCalendario();
    grid.classList.remove('cols-5', 'cols-6', 'cols-7');
    grid.classList.add(numDias === DIAS_CON_FINDE ? 'cols-7' : 'cols-5');
    const visibles = serviciosFiltrados();

    const slots = [];
    for (let h = HORA_INICIO; h < HORA_FIN; h++) {
      const m = h * 60;
      slots.push({ ini: m, fin: m + SLOT_MINUTOS, label: `${String(h).padStart(2, '0')}:00` });
    }

    for (let i = 0; i < numDias; i++) {
      const date = new Date(semanaInicio);
      date.setDate(date.getDate() + i);
      const fecha = fechaStr(date);
      const dayOfWeek = date.getDay();
      const dow = date.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '');
      const dayNum = date.getDate();

      const col = document.createElement('div');
      col.className = 'cp-cal-col';
      if (dayOfWeek === 0) col.classList.add('cp-dom');
      if (dayOfWeek === 6) col.classList.add('cp-sab');
      if (findeHabilitado() && (dayOfWeek === 0 || dayOfWeek === 6)) col.classList.add('cp-fin-hab');
      col.innerHTML = `<header><span class="cp-dow">${dow}</span><span class="cp-day">${dayNum}</span></header>`;

      slots.forEach((slot) => {
        const srv = visibles.find((s) => solapa(fecha, slot.ini, slot.fin, s));
        const ocupado = !!srv;
        const esBloqueo = srv && (srv.tipo_reserva === 'bloqueo' || srv.es_bloqueo);
        const esPasado = esSlotPasado(date, slot.ini);
        const enJornada = slotDentroDeJornada(dayOfWeek, slot.ini);
        const puedeReservar = canEditAgenda && !ocupado && !esPasado && enJornada;

        const hi = `${String(Math.floor(slot.ini / 60)).padStart(2, '0')}:${String(slot.ini % 60).padStart(2, '0')}`;
        const hf = `${String(Math.floor(slot.fin / 60)).padStart(2, '0')}:${String(slot.fin % 60).padStart(2, '0')}`;

        const slotEl = document.createElement('div');
        let cls = 'cp-slot ';
        if (ocupado) cls += esBloqueo ? 'blocked' : 'booked';
        else if (puedeReservar) cls += 'free';
        else cls += 'muted';
        slotEl.className = cls;

        if (ocupado) {
          slotEl.innerHTML = `<span class="cp-slot-time">${hi}</span><span class="cp-slot-label">${esBloqueo ? 'Bloqueo' : (srv.folio || 'Reservado')}</span>`;
          slotEl.title = [srv.folio, srv.chofer, srv.destino, srv.estado].filter(Boolean).join(' · ');
          slotEl.addEventListener('click', () => {
            if (canEditAgenda) abrirModalEditar(srv);
            else abrirDetalle(srv);
          });
        } else if (puedeReservar) {
          slotEl.innerHTML = `<span class="cp-slot-time">${hi}</span><span class="cp-slot-label">Disponible</span>`;
          slotEl.addEventListener('click', () => abrirModal({ fecha, hora_inicio: hi, hora_fin: hf }));
        } else {
          slotEl.innerHTML = `<span class="cp-slot-time">${hi}</span><span class="cp-slot-label">—</span>`;
        }

        col.appendChild(slotEl);
      });
      grid.appendChild(col);
    }
  }

  function actualizarMetricas() {
    const visibles = serviciosFiltrados();
    let numServicios = 0;
    let numBloqueos = 0;
    let km = 0;
    visibles.forEach((s) => {
      if (s.tipo_reserva === 'bloqueo' || s.es_bloqueo) numBloqueos++;
      else numServicios++;
      km += Number(s.kilometraje) || 0;
    });
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    set('metricServicios', String(numServicios));
    set('metricBloqueos', String(numBloqueos));
    set('metricKm', `${Math.round(km)} km`);
    set('metricTotal', String(visibles.length));
  }

  function cecoLabel(c) {
    const desc = c.nombre || c.descripcion || '';
    return desc ? `${c.codigo} — ${desc}` : c.codigo;
  }

  function pintarTabla() {
    const tbody = $('cpTablaServicios');
    const pagEl = $('cpTablaPaginacion');
    if (!tbody) return;

    const lista = serviciosFiltrados().sort((a, b) => {
      const da = `${a.fecha_servicio || ''}${a.hora_inicio || ''}`;
      const db = `${b.fecha_servicio || ''}${b.hora_inicio || ''}`;
      return da.localeCompare(db);
    });

    const total = lista.length;
    const totalPaginas = Math.max(1, Math.ceil(total / TABLA_PAGE_SIZE));
    if (tablaPagina > totalPaginas) tablaPagina = totalPaginas;
    if (tablaPagina < 1) tablaPagina = 1;

    if (!total) {
      tbody.innerHTML = UI.emptyRow(9);
      if (pagEl) pagEl.innerHTML = '';
      return;
    }

    const inicio = (tablaPagina - 1) * TABLA_PAGE_SIZE;
    const pagina = lista.slice(inicio, inicio + TABLA_PAGE_SIZE);

    tbody.innerHTML = pagina.map((r) => {
      const cecoTxt = r.ceco_codigo
        ? (r.ceco_nombre ? `${r.ceco_codigo} — ${r.ceco_nombre}` : r.ceco_codigo)
        : '—';
      return `
      <tr>
        <td>${r.folio || '—'}</td>
        <td>${formatDate(r.fecha_servicio)}</td>
        <td>${r.hora_inicio || '—'} – ${r.hora_fin || '—'}</td>
        <td>${r.empresa || '—'}</td>
        <td>${cecoTxt}</td>
        <td>${(r.origen || '—') + ' → ' + (r.destino || '—')}</td>
        <td>${r.kilometraje || 0}</td>
        <td>${r.orden_compra || '—'}</td>
        <td class="cp-estado-cell">
          <div class="cp-estado-row">
            ${UI.badge(r.estado, UI.statusColor(r.estado))}
            ${canEditAgenda ? `
              <button class="btn btn-outline btn-sm cp-btn-acc" type="button" data-edit="${r.id}">Editar</button>
              <button class="btn btn-outline btn-sm cp-btn-acc" type="button" data-del="${r.id}">Eliminar</button>
            ` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const srv = lista.find((r) => r.id === Number(btn.dataset.edit));
        if (srv) abrirModalEditar(srv);
      });
    });
    tbody.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => eliminarServicio(Number(btn.dataset.del)));
    });

    if (pagEl) {
      if (totalPaginas <= 1) {
        pagEl.innerHTML = `<span class="cp-pag-info">${total} registro${total === 1 ? '' : 's'}</span>`;
        return;
      }
      const fin = Math.min(inicio + TABLA_PAGE_SIZE, total);
      pagEl.innerHTML = `
        <span class="cp-pag-info">Mostrando ${inicio + 1}–${fin} de ${total}</span>
        <div class="cp-pag-btns">
          <button type="button" class="btn btn-outline btn-sm" id="cpPagPrev" ${tablaPagina <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="cp-pag-num">Página ${tablaPagina} de ${totalPaginas}</span>
          <button type="button" class="btn btn-outline btn-sm" id="cpPagNext" ${tablaPagina >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
        </div>
      `;
      $('cpPagPrev')?.addEventListener('click', () => {
        if (tablaPagina > 1) { tablaPagina--; pintarTabla(); }
      });
      $('cpPagNext')?.addEventListener('click', () => {
        if (tablaPagina < totalPaginas) { tablaPagina++; pintarTabla(); }
      });
    }
  }

  function abrirDetalle(srv) {
    const lines = [
      srv.folio ? `Folio: ${srv.folio}` : null,
      `Fecha: ${formatDate(srv.fecha_servicio)}`,
      `Horario: ${srv.hora_inicio || '—'} – ${srv.hora_fin || '—'}`,
      `Empresa: ${srv.empresa || '—'}`,
      `Chofer: ${srv.chofer || '—'}`,
      `Ruta: ${srv.origen || '—'} → ${srv.destino || '—'}`,
      `Km: ${srv.kilometraje || 0}`,
      srv.precio_total_servicio ? `Precio: $${Number(srv.precio_total_servicio).toLocaleString('es-CL')}` : null,
      `Estado: ${srv.estado || '—'}`
    ].filter(Boolean).join('\n');
    alert(lines);
  }

  function aplicarPermisosKmModal() {
    const kmEl = $('cpKilometraje');
    if (kmEl) kmEl.readOnly = !canEditPrecios;
  }

  function resetModalServicio() {
    if ($('cpServicioId')) $('cpServicioId').value = '';
    if ($('cpModalTitle')) $('cpModalTitle').textContent = 'Programar servicio';
    if ($('cpModalSubtitle')) $('cpModalSubtitle').textContent = 'Complete los datos del camión pluma';
    if ($('cpBtnGuardar')) $('cpBtnGuardar').textContent = 'Guardar servicio';
    $('cpRowEstado')?.classList.add('hidden');
    $('cpRowRuta')?.classList.remove('hidden');
    aplicarPermisosKmModal();
  }

  function abrirModal(prefill = {}) {
    if (!canEditAgenda) {
      UI.flash('Sin permiso para programar en la agenda. Active el módulo en el rol del usuario.', true);
      return;
    }
    const modal = $('cpModalServicio');
    if (!modal) return;
    $('cpFormServicio')?.reset();
    resetModalServicio();
    if ($('cpFecha')) $('cpFecha').value = prefill.fecha || fechaStr(new Date());
    if ($('cpHoraInicio') && prefill.hora_inicio) $('cpHoraInicio').value = prefill.hora_inicio;
    if ($('cpHoraFin') && prefill.hora_fin) $('cpHoraFin').value = prefill.hora_fin;
    if ($('cpTramo')) $('cpTramo').value = '';
    if ($('cpPrecioTotal')) $('cpPrecioTotal').value = '';
    if ($('cpOrdenCompra')) $('cpOrdenCompra').value = '';
    cerrarListaAddr('cpListOrigen');
    cerrarListaAddr('cpListDestino');
    cerrarListaAddr('cpListSolicitante');
    modal.classList.add('is-open');
    document.body.classList.add('modal-open');
  }

  function abrirModalEditar(srv) {
    if (!srv || !canEditAgenda) return;
    const modal = $('cpModalServicio');
    if (!modal) return;
    $('cpFormServicio')?.reset();
    resetModalServicio();

    if ($('cpServicioId')) $('cpServicioId').value = srv.id;
    if ($('cpModalTitle')) $('cpModalTitle').textContent = 'Editar servicio';
    if ($('cpModalSubtitle')) $('cpModalSubtitle').textContent = srv.folio ? `Folio ${srv.folio}` : 'Modifique los datos del servicio';
    if ($('cpBtnGuardar')) $('cpBtnGuardar').textContent = 'Guardar cambios';

    const esBloqueo = srv.tipo_reserva === 'bloqueo' || srv.es_bloqueo;
    if ($('cpEmpresa')) $('cpEmpresa').value = srv.empresa || 'Sercom';
    if ($('cpFecha')) $('cpFecha').value = srv.fecha_servicio || srv.fecha || '';
    if ($('cpTipoReserva')) $('cpTipoReserva').value = esBloqueo ? 'bloqueo' : 'servicio';
    if ($('cpHoraInicio')) $('cpHoraInicio').value = normHora(srv.hora_inicio);
    if ($('cpHoraFin')) $('cpHoraFin').value = normHora(srv.hora_fin);
    if ($('cpTipoServicio')) $('cpTipoServicio').value = srv.tipo_servicio || 'operacion';
    if ($('cpSolicitante')) {
      $('cpSolicitante').value = srv.solicitante || '';
      if ($('cpSolicitanteId')) $('cpSolicitanteId').value = srv.solicitante_id ? String(srv.solicitante_id) : '';
    }
    if ($('cpChofer') && srv.chofer_id) {
      const id = String(srv.chofer_id);
      const sel = $('cpChofer');
      if (!sel.querySelector(`option[value="${id}"]`)) {
        const u = choferes.find((x) => String(x.id) === id) || usuarios.find((x) => String(x.id) === id);
        if (u) {
          const n = [u.nombre, u.apellido].filter(Boolean).join(' ').trim();
          sel.insertAdjacentHTML('beforeend', `<option value="${id}">${n || u.email || `Usuario #${id}`}</option>`);
        }
      }
      sel.value = id;
    }
    if ($('cpCeco') && srv.ceco_id) $('cpCeco').value = String(srv.ceco_id);
    if ($('cpOrigen')) $('cpOrigen').value = srv.origen || '';
    if ($('cpDestino')) $('cpDestino').value = srv.destino || '';
    if ($('cpComuna')) $('cpComuna').value = srv.comuna_destino || '';
    if ($('cpKilometraje')) $('cpKilometraje').value = srv.kilometraje != null ? srv.kilometraje : '';
    if ($('cpTramo')) $('cpTramo').value = srv.tramo_nombre || '';
    if ($('cpPrecioTotal')) {
      $('cpPrecioTotal').value = srv.precio_total_servicio > 0
        ? '$ ' + Number(srv.precio_total_servicio).toLocaleString('es-CL')
        : '';
    }
    if ($('cpObservaciones')) $('cpObservaciones').value = srv.observaciones || srv.motivo_bloqueo || '';
    if ($('cpOrdenCompra')) $('cpOrdenCompra').value = srv.orden_compra || '';

    $('cpRowRuta')?.classList.toggle('hidden', esBloqueo);
    $('cpRowEstado')?.classList.remove('hidden');
    const est = ['finalizado', 'cancelado', 'bloqueado'].includes(srv.estado) ? srv.estado : 'pendiente';
    if ($('cpEstado')) $('cpEstado').value = est;

    aplicarPermisosKmModal();
    cerrarListaAddr('cpListOrigen');
    cerrarListaAddr('cpListDestino');
    cerrarListaAddr('cpListSolicitante');
    modal.classList.add('is-open');
    document.body.classList.add('modal-open');
  }

  function cerrarModalPrecio() {
    $('cpModalPrecioVenta')?.classList.remove('is-open');
    document.body.classList.remove('modal-open');
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function refrescarTablaTramosModal() {
    const tbody = $('cpTramosBody');
    if (!tbody) return;
    tbody.innerHTML = tramos.map((t) => `
      <tr data-id="${t.id || ''}">
        <td>
          <input type="hidden" class="tramo-id" value="${t.id || ''}">
          <input class="tramo-nombre" value="${escHtml(t.nombre)}" placeholder="Nombre">
        </td>
        <td><input class="tramo-alcance" value="${escHtml(t.alcance_ruta)}" placeholder="Alcance"></td>
        <td><input type="number" step="0.01" class="tramo-km-min" value="${t.km_min != null ? t.km_min : ''}"></td>
        <td><input type="number" step="0.01" class="tramo-km-max" value="${t.km_max != null ? t.km_max : ''}"></td>
        <td><input class="tramo-tiempo" value="${escHtml(t.tiempo_promedio)}" placeholder="1-3 hrs"></td>
        <td><input type="number" class="tramo-precio" value="${t.precio_sugerido_iva != null ? t.precio_sugerido_iva : ''}"></td>
      </tr>
    `).join('');
  }

  async function abrirModalPrecio() {
    if (!canEditPrecios) {
      UI.flash('No tiene permiso para ver precios por rango', true);
      return;
    }
    await cargarCatalogos();
    if ($('cpPrecioKmAdicional')) $('cpPrecioKmAdicional').value = precioKmAdicional;
    if ($('cpPrecioHoraAdicional')) $('cpPrecioHoraAdicional').value = precioHoraAdicional;
    refrescarTablaTramosModal();
    $('cpModalPrecioVenta')?.classList.add('is-open');
    document.body.classList.add('modal-open');
  }

  function leerTramosDelModal() {
    const tbody = $('cpTramosBody');
    const tramosData = [];
    if (!tbody) return tramosData;
    tbody.querySelectorAll('tr').forEach((row, i) => {
      tramosData.push({
        id: Number(row.querySelector('.tramo-id')?.value) || 0,
        nombre: row.querySelector('.tramo-nombre')?.value?.trim() || '',
        alcance_ruta: row.querySelector('.tramo-alcance')?.value?.trim() || '',
        km_min: Number(row.querySelector('.tramo-km-min')?.value) || 0,
        km_max: Number(row.querySelector('.tramo-km-max')?.value) || 0,
        tiempo_promedio: row.querySelector('.tramo-tiempo')?.value?.trim() || '',
        precio_sugerido_iva: Number(row.querySelector('.tramo-precio')?.value) || 0,
        orden: i + 1
      });
    });
    return tramosData;
  }

  async function guardarPreciosVenta() {
    try {
      await Auth.api('/api/modulos/agenda/precios', {
        method: 'POST',
        body: JSON.stringify({
          tramos: leerTramosDelModal(),
          precio_km_adicional: Number($('cpPrecioKmAdicional')?.value) || 1800,
          precio_hora_adicional: Number($('cpPrecioHoraAdicional')?.value) || 18000
        })
      });
      UI.flash('Precios guardados');
      cerrarModalPrecio();
      await cargarCatalogos();
    } catch (err) {
      UI.flash(err.message, true);
    }
  }

  async function dejarSoloTresTramos() {
    if (!confirm('¿Eliminar tramos duplicados y dejar solo 3 (uno por orden)?')) return;
    try {
      const d = await Auth.api('/api/modulos/agenda/precios/reset-tramos', { method: 'POST', body: '{}' });
      await cargarCatalogos();
      refrescarTablaTramosModal();
      UI.flash(d.message || 'Tramos actualizados');
    } catch (err) {
      UI.flash(err.message, true);
    }
  }

  async function restablecerTramosOficiales() {
    if (!confirm('¿Restablecer tramos oficiales?\nTramo 1: $95.000 · Tramo 2: $140.000 · Tramo 3: $190.000')) return;
    try {
      const d = await Auth.api('/api/modulos/agenda/precios/tramos-oficiales', { method: 'POST', body: '{}' });
      await cargarCatalogos();
      refrescarTablaTramosModal();
      UI.flash(d.message || 'Tramos restablecidos');
    } catch (err) {
      UI.flash(err.message, true);
    }
  }

  function cerrarModal() {
    $('cpModalServicio')?.classList.remove('is-open');
    document.body.classList.remove('modal-open');
  }

  function cerrarListaAddr(listId) {
    const el = $(listId);
    if (!el) return;
    el.style.display = 'none';
    el.innerHTML = '';
  }

  function userLabel(u) {
    const n = [u.nombre, u.apellido].filter(Boolean).join(' ').trim();
    return n || u.email || `Usuario #${u.id}`;
  }

  function filtrarUsuarios(query, max = 10) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 1) return [];
    const out = [];
    for (const u of usuarios) {
      const nombre = userLabel(u).toLowerCase();
      const email = String(u.email || '').toLowerCase();
      const cargo = String(u.cargo || '').toLowerCase();
      if (!nombre.includes(q) && !email.includes(q) && !cargo.includes(q)) continue;
      out.push(u);
      if (out.length >= max) break;
    }
    return out;
  }

  function pintarListaSolicitantes(listEl, inputEl, results) {
    if (!results.length) {
      listEl.innerHTML = '<div class="cp-addr-item muted">Sin resultados</div>';
    } else {
      listEl.innerHTML = results.map((u) => {
        const label = userLabel(u);
        const meta = [u.cargo, u.email].filter(Boolean).join(' · ');
        const name = label.replace(/"/g, '&quot;');
        const text = meta ? `${label} — ${meta}` : label;
        return `<button type="button" class="cp-addr-item" data-id="${u.id}" data-name="${name}">${text}</button>`;
      }).join('');
      listEl.querySelectorAll('.cp-addr-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          inputEl.value = btn.getAttribute('data-name') || '';
          const idEl = $('cpSolicitanteId');
          if (idEl) idEl.value = btn.getAttribute('data-id') || '';
          listEl.style.display = 'none';
        });
      });
    }
    listEl.style.display = 'block';
  }

  function buscarSolicitanteUi(q) {
    const listEl = $('cpListSolicitante');
    const inputEl = $('cpSolicitante');
    const st = busquedaState.cpSolicitante;
    if (!listEl || !inputEl || !st) return;

    st.seq += 1;
    const mySeq = st.seq;
    const query = (q || '').trim();
    if (query.length < 1) {
      cerrarListaAddr('cpListSolicitante');
      return;
    }

    const results = filtrarUsuarios(query, 12);
    pintarListaSolicitantes(listEl, inputEl, results);
    if (st.seq !== mySeq) return;
  }

  function debounceBuscarSolicitante() {
    const st = busquedaState.cpSolicitante;
    if (!st) return;
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.timer = null;
      buscarSolicitanteUi($('cpSolicitante')?.value);
    }, 180);
  }

  function resolverSolicitanteId() {
    const id = Number($('cpSolicitanteId')?.value);
    if (id > 0) return id;
    const q = ($('cpSolicitante')?.value || '').trim().toLowerCase();
    if (!q) return null;
    const u = usuarios.find((x) => {
      const n = userLabel(x).toLowerCase();
      const email = String(x.email || '').toLowerCase();
      return n === q || email === q;
    });
    return u?.id || null;
  }

  function mergeDireccionesUi(lists, max = 10) {
    const vistos = new Set();
    const out = [];
    for (const list of lists) {
      for (const item of list || []) {
        const name = String(item?.display_name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (vistos.has(key)) continue;
        vistos.add(key);
        out.push({
          display_name: name,
          lat: item.lat != null ? Number(item.lat) : null,
          lon: item.lon != null ? Number(item.lon) : null
        });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function kmDesdeCoordenadas(origen, destino) {
    if (!origen?.lat || !origen?.lon || !destino?.lat || !destino?.lon) return null;
    const lineal = haversineKm(origen.lat, origen.lon, destino.lat, destino.lon);
    if (!lineal || lineal <= 0) return null;
    return Math.round(lineal * 1.35 * 10) / 10;
  }

  function buscarDireccionesEnMemoria(query) {
    const q = query.toLowerCase();
    const vistos = new Set();
    const out = [];
    const add = (name) => {
      const n = String(name || '').trim();
      if (!n || !n.toLowerCase().includes(q)) return;
      const key = n.toLowerCase();
      if (vistos.has(key)) return;
      vistos.add(key);
      out.push({ display_name: n });
    };
    for (const r of rutas) {
      if ((r.direccion || '').toLowerCase().includes(q)) add(r.direccion);
      if ((r.alias || '').toLowerCase().includes(q)) add(r.direccion || r.alias);
      if ((r.comuna || '').toLowerCase().includes(q)) {
        add([r.direccion, r.comuna, 'Chile'].filter(Boolean).join(', '));
      }
    }
    for (const s of servicios) {
      add(s.origen);
      add(s.destino);
    }
    return out.slice(0, 8);
  }

  function pintarListaDirecciones(listEl, inputEl, inputId, results) {
    if (!results.length) {
      listEl.innerHTML = '<div class="cp-addr-item muted">Sin resultados. Pruebe con calle y número.</div>';
    } else {
      listEl.innerHTML = results.map((r) => {
        const name = String(r.display_name || '').replace(/"/g, '&quot;');
        const lat = r.lat != null ? String(r.lat) : '';
        const lon = r.lon != null ? String(r.lon) : '';
        return `<button type="button" class="cp-addr-item" data-name="${name}" data-lat="${lat}" data-lon="${lon}">${r.display_name}</button>`;
      }).join('');
      listEl.querySelectorAll('.cp-addr-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          inputEl.value = btn.getAttribute('data-name') || '';
          const lat = parseFloat(btn.getAttribute('data-lat'));
          const lon = parseFloat(btn.getAttribute('data-lon'));
          addrCoords[inputId] = (Number.isFinite(lat) && Number.isFinite(lon))
            ? { lat, lon }
            : null;
          listEl.style.display = 'none';
          if (inputId === 'cpDestino') {
            aplicarKmDesdeRuta();
            setTimeout(calcularKmModal, 50);
          } else if (inputId === 'cpOrigen' && ($('cpDestino')?.value || '').trim()) {
            setTimeout(calcularKmModal, 50);
          }
        });
      });
    }
    listEl.style.display = 'block';
  }

  async function buscarDireccionesUi(q, listId, inputId) {
    const listEl = $(listId);
    const inputEl = $(inputId);
    const st = busquedaState[inputId];
    if (!listEl || !inputEl || !st) return;

    st.seq += 1;
    const mySeq = st.seq;

    const query = (q || '').trim();
    if (query.length < 2) {
      cerrarListaAddr(listId);
      return;
    }

    const locales = buscarDireccionesEnMemoria(query);
    if (locales.length) {
      pintarListaDirecciones(listEl, inputEl, inputId, locales);
    } else {
      listEl.innerHTML = '<div class="cp-addr-item muted">Buscando direcciones…</div>';
      listEl.style.display = 'block';
    }
    try {
      const res = await Auth.api(`/api/modulos/agenda/direcciones?q=${encodeURIComponent(query)}`);
      if (st.seq !== mySeq) return;
      const results = mergeDireccionesUi([locales, res.results || []], 10);
      pintarListaDirecciones(listEl, inputEl, inputId, results);
    } catch (err) {
      if (st.seq !== mySeq) return;
      if (locales.length) {
        pintarListaDirecciones(listEl, inputEl, inputId, locales);
      } else {
        listEl.innerHTML = `<div class="cp-addr-item error">${err.message || 'Error al buscar dirección'}</div>`;
        listEl.style.display = 'block';
      }
    }
  }

  function debounceBuscar(inputId, listId) {
    const st = busquedaState[inputId];
    const pair = ADDR_FIELDS[inputId];
    if (!st) return;
    if (st.timer) clearTimeout(st.timer);
    if (pair?.otherListId) cerrarListaAddr(pair.otherListId);
    st.timer = setTimeout(() => {
      st.timer = null;
      buscarDireccionesUi($(inputId)?.value, listId, inputId);
    }, 220);
  }

  function aplicarKmCalculado(km, comuna) {
    if (km > 0 && $('cpKilometraje')) {
      $('cpKilometraje').value = km;
      if ($('cpComuna') && comuna) $('cpComuna').value = comuna;
      actualizarPrecioModal();
      UI.flash('Kilometraje calculado: ' + km + ' km');
      return true;
    }
    return false;
  }

  function aplicarKmDesdeRuta() {
    const destino = ($('cpDestino')?.value || '').trim().toLowerCase();
    if (!destino || !rutas.length) return;
    const r = rutas.find((rt) => {
      const dir = (rt.direccion || '').trim().toLowerCase();
      const alias = (rt.alias || '').trim().toLowerCase();
      return (dir && destino.includes(dir)) || (alias && destino.includes(alias));
    });
    if (r?.kilometraje_promedio > 0 && $('cpKilometraje')) {
      $('cpKilometraje').value = Number(r.kilometraje_promedio);
      actualizarPrecioModal();
    }
  }

  async function calcularKmModal() {
    const origen = ($('cpOrigen')?.value || '').trim();
    const destino = ($('cpDestino')?.value || '').trim();
    if (!origen || !destino) {
      UI.flash('Indique dirección de origen y destino', true);
      return;
    }
    const kmLocal = kmDesdeCoordenadas(addrCoords.cpOrigen, addrCoords.cpDestino);
    if (kmLocal > 0) {
      aplicarKmCalculado(kmLocal);
      return;
    }
    const btn = $('cpBtnCalcularKm');
    if (btn) { btn.disabled = true; btn.textContent = 'Calculando…'; }
    try {
      const params = new URLSearchParams({ origen, destino });
      const o = addrCoords.cpOrigen;
      const d = addrCoords.cpDestino;
      if (o?.lat != null && o?.lon != null) {
        params.set('origen_lat', String(o.lat));
        params.set('origen_lon', String(o.lon));
      }
      if (d?.lat != null && d?.lon != null) {
        params.set('destino_lat', String(d.lat));
        params.set('destino_lon', String(d.lon));
      }
      const res = await Auth.api(`/api/modulos/agenda/calcular-km?${params}`);
      const km = Number(res.km);
      if (!aplicarKmCalculado(km, res.comuna_destino)) {
        UI.flash(res.message || 'No se pudo calcular el kilometraje', true);
      }
    } catch (err) {
      UI.flash(err.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-route"></i> Calcular km'; }
    }
  }

  async function guardarServicio(e) {
    e.preventDefault();
    if (!canEditAgenda) {
      UI.flash('Sin permiso para guardar. Active el módulo Agenda Camión Pluma en el rol.', true);
      return;
    }
    const servicioId = Number($('cpServicioId')?.value) || 0;
    const esEdicion = servicioId > 0;
    const esBloqueo = $('cpTipoReserva')?.value === 'bloqueo';
    const km = Number($('cpKilometraje')?.value) || 0;
    const { tramoNombre, subtotal } = calcularPrecioLocal(km);
    const payload = {
      empresa: $('cpEmpresa')?.value,
      fecha: $('cpFecha')?.value,
      hora_inicio: $('cpHoraInicio')?.value,
      hora_fin: $('cpHoraFin')?.value,
      tipo_servicio: $('cpTipoServicio')?.value || 'operacion',
      tipo_reserva: esBloqueo ? 'bloqueo' : 'servicio',
      solicitante: ($('cpSolicitante')?.value || '').trim() || null,
      solicitante_id: resolverSolicitanteId(),
      chofer_id: $('cpChofer')?.value ? Number($('cpChofer').value) : null,
      ceco_id: $('cpCeco')?.value ? Number($('cpCeco').value) : null,
      origen: $('cpOrigen')?.value || null,
      destino: $('cpDestino')?.value || null,
      comuna_destino: $('cpComuna')?.value || null,
      kilometraje: km,
      tramo_nombre: tramoNombre || null,
      precio_total_servicio: subtotal || null,
      orden_compra: ($('cpOrdenCompra')?.value || '').trim() || null,
      observaciones: $('cpObservaciones')?.value || null,
      es_bloqueo: esBloqueo
    };
    if (esEdicion) {
      payload.id = servicioId;
      const est = $('cpEstado')?.value;
      payload.estado = est || (esBloqueo ? 'bloqueado' : 'pendiente');
    }
    if (!payload.fecha || !payload.empresa) {
      UI.flash('Empresa y fecha son obligatorios', true);
      return;
    }
    if (!payload.hora_inicio || !payload.hora_fin) {
      UI.flash('Indique hora de inicio y fin', true);
      return;
    }
    if (!esBloqueo && !payload.destino) {
      UI.flash('La dirección destino es obligatoria para un servicio', true);
      return;
    }
    try {
      await Auth.api('/api/modulos/agenda', { method: 'POST', body: JSON.stringify(payload) });
      UI.flash(esEdicion ? 'Servicio actualizado correctamente' : 'Servicio agendado correctamente');
      cerrarModal();
      await refrescar();
    } catch (err) {
      UI.flash(err.message, true);
    }
  }

  async function eliminarServicio(id) {
    if (!confirm('¿Eliminar este servicio de la agenda?')) return;
    try {
      await Auth.api(`/api/modulos/agenda/${id}/eliminar`, { method: 'POST', body: '{}' });
      UI.flash('Servicio eliminado');
      await refrescar();
    } catch (err) {
      UI.flash(err.message, true);
    }
  }

  async function refrescar() {
    await cargarAgenda();
    tablaPagina = 1;
    actualizarLabelSemana();
    pintarCalendario();
    pintarTabla();
    actualizarMetricas();
  }

  function bindNav() {
    $('btnPrevWeek')?.addEventListener('click', () => {
      semanaInicio.setDate(semanaInicio.getDate() - 7);
      refrescar();
    });
    $('btnNextWeek')?.addEventListener('click', () => {
      semanaInicio.setDate(semanaInicio.getDate() + 7);
      refrescar();
    });
    $('btnToday')?.addEventListener('click', () => {
      semanaInicio = getSemanaInicio(new Date());
      refrescar();
    });
    $('cpFechaSelector')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      semanaInicio = getSemanaInicio(new Date(e.target.value + 'T12:00:00'));
      refrescar();
    });
    $('cpFiltroEmpresa')?.addEventListener('change', () => {
      tablaPagina = 1;
      pintarCalendario(); pintarTabla(); actualizarMetricas();
    });
    $('cpFiltroEstado')?.addEventListener('change', () => {
      tablaPagina = 1;
      pintarCalendario(); pintarTabla(); actualizarMetricas();
    });
    const findeEl = $('cpHabilitarFinde');
    if (findeEl) {
      try {
        findeEl.checked = localStorage.getItem(FINde_STORAGE_KEY) === '1';
      } catch (_) { /* ignore */ }
      actualizarHintFinde();
      findeEl.addEventListener('change', () => {
        try {
          localStorage.setItem(FINde_STORAGE_KEY, findeEl.checked ? '1' : '0');
        } catch (_) { /* ignore */ }
        actualizarHintFinde();
        refrescar();
      });
    }
    $('btnProgramar')?.addEventListener('click', () => abrirModal());
    $('btnPrecioVenta')?.addEventListener('click', abrirModalPrecio);
    $('cpModalServicio')?.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', cerrarModal);
    });
    $('cpModalPrecioVenta')?.querySelectorAll('[data-close-precio]').forEach((el) => {
      el.addEventListener('click', cerrarModalPrecio);
    });
    $('cpBtnGuardarPrecios')?.addEventListener('click', guardarPreciosVenta);
    $('cpBtnSoloTresTramos')?.addEventListener('click', dejarSoloTresTramos);
    $('cpBtnTramosOficiales')?.addEventListener('click', restablecerTramosOficiales);
    $('cpFormServicio')?.addEventListener('submit', guardarServicio);
    $('cpBtnCalcularKm')?.addEventListener('click', calcularKmModal);
    $('cpKilometraje')?.addEventListener('input', actualizarPrecioModal);
    $('cpOrigen')?.addEventListener('input', () => { addrCoords.cpOrigen = null; debounceBuscar('cpOrigen', 'cpListOrigen'); });
    $('cpDestino')?.addEventListener('input', () => { addrCoords.cpDestino = null; debounceBuscar('cpDestino', 'cpListDestino'); });
    $('cpOrigen')?.addEventListener('focus', () => { cerrarListaAddr('cpListDestino'); cerrarListaAddr('cpListSolicitante'); });
    $('cpDestino')?.addEventListener('focus', () => { cerrarListaAddr('cpListOrigen'); cerrarListaAddr('cpListSolicitante'); });
    $('cpSolicitante')?.addEventListener('input', () => {
      if ($('cpSolicitanteId')) $('cpSolicitanteId').value = '';
      debounceBuscarSolicitante();
    });
    $('cpSolicitante')?.addEventListener('focus', () => {
      cerrarListaAddr('cpListOrigen');
      cerrarListaAddr('cpListDestino');
      debounceBuscarSolicitante();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.cp-addr-wrap')) {
        cerrarListaAddr('cpListOrigen');
        cerrarListaAddr('cpListDestino');
      }
    });
    $('cpTipoReserva')?.addEventListener('change', () => {
      const bloqueo = $('cpTipoReserva')?.value === 'bloqueo';
      $('cpRowRuta')?.classList.toggle('hidden', bloqueo);
    });
    $('btnExportarExcel')?.addEventListener('click', descargarReporteExcel);
    $('btnExportarExcelTop')?.addEventListener('click', descargarReporteExcel);
  }

  function initReporteFechas() {
    const hoy = new Date();
    const inicioAnio = new Date(hoy.getFullYear(), 0, 1);
    const desde = $('cpReporteDesde');
    const hasta = $('cpReporteHasta');
    if (desde && !desde.value) desde.value = fechaStr(inicioAnio);
    if (hasta && !hasta.value) hasta.value = fechaStr(hoy);
  }

  async function descargarReporteExcel() {
    const desde = $('cpReporteDesde')?.value;
    const hasta = $('cpReporteHasta')?.value;
    if (!desde || !hasta) {
      UI.flash('Indique el rango de fechas del reporte', true);
      return;
    }
    if (desde > hasta) {
      UI.flash('La fecha desde no puede ser mayor que la fecha hasta', true);
      return;
    }
    const btns = [$('btnExportarExcel'), $('btnExportarExcelTop')].filter(Boolean);
    const prevHtml = btns.map((b) => b.innerHTML);
    btns.forEach((b) => { b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando…'; });
    try {
      const params = new URLSearchParams({ fecha_desde: desde, fecha_hasta: hasta });
      const token = Auth.getToken();
      const res = await fetch(`/api/modulos/agenda/reporte-excel?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Auth-Token': token || ''
        },
        cache: 'no-store'
      });
      if (!res.ok) {
        let msg = 'No se pudo generar el reporte';
        try {
          const err = JSON.parse(await res.text());
          if (err.message) msg = err.message;
        } catch (_) { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `agenda_camion_pluma_${desde}_${hasta}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      UI.flash('Reporte Excel descargado');
    } catch (err) {
      UI.flash(err.message, true);
    } finally {
      btns.forEach((b, i) => {
        b.disabled = false;
        b.innerHTML = prevHtml[i];
      });
    }
  }

  function renderFiltros() {
    const emp = $('cpFiltroEmpresa');
    if (emp) {
      emp.innerHTML = '<option value="">Todas las empresas</option>'
        + EMPRESAS.map((e) => `<option value="${e}">${e}</option>`).join('');
    }
  }

  function renderModalOptions() {
    if ($('cpCeco')) {
      $('cpCeco').innerHTML = '<option value="">— Seleccione CECO —</option>'
        + cecos.map((c) => `<option value="${c.id}">${cecoLabel(c)}</option>`).join('');
    }
    if ($('cpChofer')) {
      $('cpChofer').innerHTML = '<option value="">—</option>'
        + choferes.map((u) => `<option value="${u.id}">${userLabel(u)}</option>`).join('');
    }
  }

  window.AgendaCamionPluma = {
    async init(user, cecosData, usuariosData, choferesData) {
      cecos = cecosData || [];
      usuarios = usuariosData || [];
      choferes = choferesData || [];
      renderFiltros();
      renderModalOptions();
      initReporteFechas();
      bindNav();
      await cargarCatalogos();
      await refrescar();
    },
    get canManage() { return canManage; },
    get canEditAgenda() { return canEditAgenda; },
    get canEditPrecios() { return canEditPrecios; }
  };
})();
