/**
 * UI módulo Inspección de fabricación (todas las empresas).
 * Renderiza dentro de #app-content tras renderShell (mismo patrón que el resto).
 */
(function () {
  const state = {
    user: null,
    list: [],
    current: null,
    cecos: [],
    usuarios: [],
    proveedores: [],
    catalogoPiezas: [],
    draftPiezas: [],
    planoDataUrl: null,
    planoNombre: null
  };

  const $ = (id) => document.getElementById(id);

  function flash(msg, isErr) {
    if (window.UI?.flash) {
      UI.flash(msg, !!isErr);
      return;
    }
    const el = document.getElementById('flash');
    if (el) {
      el.innerHTML = `<div class="alert ${isErr ? 'alert-error' : 'alert-ok'}">${esc(msg)}</div>`;
      setTimeout(() => { el.innerHTML = ''; }, 4000);
    } else {
      alert(msg);
    }
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function archivoUrl(ruta) {
    if (!ruta) return null;
    const parts = String(ruta).split('/');
    if (parts.length >= 3) {
      return `/api/modulos/inspeccion/archivo/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
    }
    return null;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('No se pudo leer el archivo'));
      r.readAsDataURL(file);
    });
  }

  function fmtDate(v) {
    if (!v) return '—';
    try {
      return String(v).slice(0, 10).split('-').reverse().join('/');
    } catch {
      return v;
    }
  }

  function badgeEstado(estado) {
    const color = typeof statusColor === 'function' ? statusColor(estado) : '#64748b';
    return typeof badge === 'function'
      ? badge(estado || '—', color)
      : `<span class="badge" style="background:${color}">${esc(estado || '—')}</span>`;
  }

  function paintShell() {
    const content = document.getElementById('app-content');
    if (!content) return;
    content.innerHTML = `
      <div id="flash"></div>
      <div class="insp-page">
        <div class="card">
          <div class="card-header">
            <h2><i class="fas fa-plus-circle"></i> Nuevo requerimiento de inspección</h2>
          </div>
          <div class="card-body">
            <p class="angel-train-note" style="margin-top:0">
              El analista ingresa la fabricación con OC, CECO (sale el jefe de proyecto), encargado de inspección,
              proveedor, fecha necesaria y el <strong>plano</strong>. Luego el encargado registra la fecha real,
              observaciones, piezas y fotos técnicas.
            </p>
            <form id="inspForm">
              <div class="form-row cols-2">
                <div class="form-group">
                  <label for="inspFabricacion">Fabricación / requerimiento *</label>
                  <input id="inspFabricacion" required maxlength="255" placeholder="Ej: Estructura paradero Av. Providencia">
                </div>
                <div class="form-group">
                  <label for="inspOc">Orden de compra (OC) *</label>
                  <input id="inspOc" required maxlength="64" placeholder="Ej: OC-12345">
                </div>
              </div>
              <div class="form-row cols-2">
                <div class="form-group">
                  <label for="inspCeco">CECO *</label>
                  <select id="inspCeco" required></select>
                </div>
                <div class="form-group">
                  <label for="inspJefeProyecto">Jefe de proyecto (automático)</label>
                  <input id="inspJefeProyecto" readonly placeholder="Se completa al elegir CECO">
                </div>
              </div>
              <div class="form-row cols-2">
                <div class="form-group">
                  <label for="inspEncargado">Encargado de inspección *</label>
                  <select id="inspEncargado" required></select>
                </div>
                <div class="form-group">
                  <label for="inspProveedor">Proveedor *</label>
                  <select id="inspProveedor" required></select>
                </div>
              </div>
              <div class="form-row cols-2">
                <div class="form-group">
                  <label for="inspFechaNec">Fecha en que se necesita *</label>
                  <input type="date" id="inspFechaNec" required>
                </div>
                <div class="form-group">
                  <label for="inspPlano">Plano (PDF o imagen) *</label>
                  <input type="file" id="inspPlano" accept=".pdf,image/*,application/pdf">
                  <small id="inspPlanoName">Sin archivo</small>
                </div>
              </div>
              <div class="form-group">
                <label for="inspObs">Observaciones iniciales</label>
                <textarea id="inspObs" rows="2" placeholder="Contexto del requerimiento…"></textarea>
              </div>
              <h3 style="margin:0.85rem 0 0.4rem;font-size:0.95rem">Piezas a revisar (opcional al crear)</h3>
              <p class="angel-train-note" style="margin:0 0 0.5rem;font-size:0.78rem">
                La primera vez escríbela a mano; después quedará como alternativa de selección.
              </p>
              <datalist id="inspPiezasDatalist"></datalist>
              <div class="form-row cols-2" style="align-items:end">
                <div class="form-group" style="margin:0">
                  <label for="inspPiezaNueva">Pieza</label>
                  <input list="inspPiezasDatalist" id="inspPiezaNueva" placeholder="Ej: Poste tubular">
                </div>
                <button type="button" class="btn btn-outline" id="btnAddPiezaDraft"><i class="fas fa-plus"></i> Agregar</button>
              </div>
              <div id="inspDraftPiezas" class="insp-draft-list"></div>
              <div class="toolbar" style="margin-top:1rem">
                <button type="submit" class="btn btn-primary" id="btnCrearInsp">
                  <i class="fas fa-save"></i> Crear inspección
                </button>
              </div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2><i class="fas fa-list"></i> Inspecciones</h2>
          </div>
          <div class="card-body">
            <div class="form-row cols-3" style="align-items:end;margin-bottom:0.75rem">
              <div class="form-group" style="margin:0">
                <label>Buscar</label>
                <input id="inspQ" placeholder="Código, OC, fabricación, CECO…">
              </div>
              <div class="form-group" style="margin:0">
                <label>Estado</label>
                <select id="inspEstadoFiltro">
                  <option value="">Todos</option>
                  <option>Pendiente</option>
                  <option>En inspección</option>
                  <option>Completada</option>
                  <option>Con observaciones</option>
                </select>
              </div>
              <div class="form-group" style="margin:0;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
                <label class="role-all-access" style="margin:0"><input type="checkbox" id="inspMias"> Solo mías</label>
                <button type="button" class="btn btn-primary btn-sm" id="btnFiltrarInsp"><i class="fas fa-search"></i></button>
              </div>
            </div>
            <div id="inspListHost"><p class="home-empty">Cargando…</p></div>
          </div>
        </div>

        <div class="card" id="inspDetalle" hidden>
          <div class="card-header">
            <h2 id="inspDetalleTitle">Detalle</h2>
            <button type="button" class="btn btn-outline btn-sm" id="btnCerrarDetalle"><i class="fas fa-times"></i> Cerrar</button>
          </div>
          <div class="card-body" id="inspDetalleBody"></div>
        </div>
      </div>
    `;
  }

  function fillSelect(el, items, placeholder) {
    if (!el) return;
    el.innerHTML = `<option value="">${esc(placeholder)}</option>`
      + items.map((i) => `<option value="${esc(i.value)}">${esc(i.label)}</option>`).join('');
  }

  function refreshCatalogoDatalist() {
    const dl = $('inspPiezasDatalist');
    if (!dl) return;
    dl.innerHTML = state.catalogoPiezas
      .map((p) => `<option value="${esc(p.nombre)}"></option>`)
      .join('');
  }

  function renderDraftPiezas() {
    const host = $('inspDraftPiezas');
    if (!host) return;
    if (!state.draftPiezas.length) {
      host.innerHTML = '<p class="home-empty" style="margin:0">Sin piezas aún. Agrégalas aquí o después en el detalle.</p>';
      return;
    }
    host.innerHTML = state.draftPiezas.map((p, i) => `
      <div class="insp-pieza-draft">
        <strong>${esc(p.nombre)}</strong>
        <button type="button" class="btn btn-outline btn-sm" data-rm="${i}"><i class="fas fa-times"></i></button>
      </div>
    `).join('');
    host.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = () => {
        state.draftPiezas.splice(Number(b.dataset.rm), 1);
        renderDraftPiezas();
      };
    });
  }

  function bindForm() {
    $('inspCeco').onchange = () => {
      const c = state.cecos.find((x) => String(x.id) === String($('inspCeco').value));
      $('inspJefeProyecto').value = c?.jefe_proyecto
        || (c?.jefe_proyecto_id ? `ID ${c.jefe_proyecto_id}` : 'Sin jefe asignado en el CECO');
    };

    $('inspPlano').onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        state.planoDataUrl = await fileToDataUrl(file);
        state.planoNombre = file.name;
        $('inspPlanoName').textContent = file.name;
      } catch (err) {
        flash(err.message, true);
      }
    };

    $('btnAddPiezaDraft').onclick = () => {
      const nombre = $('inspPiezaNueva').value.trim();
      if (!nombre) return flash('Escribe el nombre de la pieza', true);
      state.draftPiezas.push({ nombre, observacion: '', fotoDataUrl: null });
      $('inspPiezaNueva').value = '';
      renderDraftPiezas();
    };

    $('inspForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!state.planoDataUrl) return flash('Debes subir el plano', true);
      const btn = $('btnCrearInsp');
      btn.disabled = true;
      try {
        const body = {
          fabricacion: $('inspFabricacion').value.trim(),
          orden_compra: $('inspOc').value.trim(),
          ceco_id: Number($('inspCeco').value),
          encargado_id: Number($('inspEncargado').value),
          proveedor_id: Number($('inspProveedor').value),
          fecha_necesaria: $('inspFechaNec').value,
          observaciones: $('inspObs').value.trim(),
          planoDataUrl: state.planoDataUrl,
          plano_nombre: state.planoNombre,
          piezas: state.draftPiezas
        };
        const r = await Auth.api('/api/modulos/inspeccion', {
          method: 'POST',
          body: JSON.stringify(body)
        });
        flash(r.message || 'Creada');
        resetForm();
        await loadList();
        if (r.data?.id) openDetail(r.data.id);
      } catch (err) {
        flash(err.message, true);
      } finally {
        btn.disabled = false;
      }
    };

    $('btnFiltrarInsp').onclick = () => loadList();
    $('inspQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); loadList(); }
    });
    $('btnCerrarDetalle')?.addEventListener('click', () => {
      $('inspDetalle').hidden = true;
      state.current = null;
    });
  }

  function resetForm() {
    $('inspForm').reset();
    state.draftPiezas = [];
    state.planoDataUrl = null;
    state.planoNombre = null;
    $('inspPlanoName').textContent = 'Sin archivo';
    $('inspJefeProyecto').value = '';
    renderDraftPiezas();
  }

  async function loadList() {
    const host = $('inspListHost');
    host.innerHTML = '<p class="home-empty"><i class="fas fa-spinner fa-spin"></i></p>';
    try {
      const qs = new URLSearchParams();
      const q = $('inspQ').value.trim();
      const estado = $('inspEstadoFiltro').value;
      if (q) qs.set('q', q);
      if (estado) qs.set('estado', estado);
      if ($('inspMias').checked) qs.set('mias', '1');
      const r = await Auth.api('/api/modulos/inspeccion?' + qs.toString());
      state.list = r.data || [];
      if (!state.list.length) {
        host.innerHTML = '<p class="home-empty">No hay inspecciones aún. Crea la primera arriba.</p>';
        return;
      }
      host.innerHTML = `<div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Código</th><th>Fabricación</th><th>OC</th><th>CECO</th><th>Encargado</th>
          <th>Fecha nec.</th><th>Estado</th><th></th>
        </tr></thead>
        <tbody>${state.list.map((row) => `
          <tr>
            <td><strong>${esc(row.codigo)}</strong></td>
            <td>${esc(row.fabricacion)}</td>
            <td>${esc(row.orden_compra)}</td>
            <td>${esc(row.ceco_nombre || row.ceco_codigo || '—')}</td>
            <td>${esc(row.encargado_nombre || '—')}</td>
            <td>${fmtDate(row.fecha_necesaria)}</td>
            <td>${badgeEstado(row.estado)}</td>
            <td><button type="button" class="btn btn-outline btn-sm" data-id="${row.id}">Abrir</button></td>
          </tr>`).join('')}</tbody></table></div>`;
      host.querySelectorAll('[data-id]').forEach((b) => {
        b.onclick = () => openDetail(b.dataset.id);
      });
    } catch (err) {
      host.innerHTML = `<p class="alert alert-error">${esc(err.message)}</p>`;
    }
  }

  async function openDetail(id) {
    const panel = $('inspDetalle');
    panel.hidden = false;
    $('inspDetalleBody').innerHTML = '<p class="home-empty"><i class="fas fa-spinner fa-spin"></i></p>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const r = await Auth.api('/api/modulos/inspeccion/' + id);
      state.current = r.data;
      renderDetail();
      await loadChat();
    } catch (err) {
      $('inspDetalleBody').innerHTML = `<p class="alert alert-error">${esc(err.message)}</p>`;
    }
  }

  function uid() {
    return Number(state.user?.id || state.user?.userId);
  }

  function isEncargado(insp) {
    return Number(insp.encargado_id) === uid();
  }

  function canEdit(insp) {
    return isEncargado(insp)
      || Number(insp.creado_por) === uid()
      || Number(insp.jefe_proyecto_id) === uid()
      || Number(state.user?.rol_id) === 1;
  }

  function renderDetail() {
    const insp = state.current;
    if (!insp) return;
    const plano = archivoUrl(insp.plano_ruta);
    const encargado = isEncargado(insp);
    const editable = canEdit(insp);
    const admin = Number(state.user?.rol_id) === 1;

    $('inspDetalleTitle').textContent = `${insp.codigo} · ${insp.fabricacion}`;
    $('inspDetalleBody').innerHTML = `
      <div class="form-row cols-3">
        <div class="form-group"><label>OC</label><div>${esc(insp.orden_compra)}</div></div>
        <div class="form-group"><label>CECO</label><div>${esc(insp.ceco_nombre || '—')}</div></div>
        <div class="form-group"><label>Jefe de proyecto</label><div>${esc(insp.jefe_proyecto || '—')}</div></div>
        <div class="form-group"><label>Encargado</label><div>${esc(insp.encargado_nombre || '—')}</div></div>
        <div class="form-group"><label>Proveedor</label><div>${esc(insp.proveedor_nombre || '—')}</div></div>
        <div class="form-group"><label>Estado</label><div>${badgeEstado(insp.estado)}</div></div>
        <div class="form-group"><label>Fecha necesaria</label><div>${fmtDate(insp.fecha_necesaria)}</div></div>
        <div class="form-group"><label>Fecha realizada</label>
          ${encargado || admin
            ? `<input type="date" id="detFechaReal" value="${esc(String(insp.fecha_realizada || '').slice(0, 10))}">`
            : `<div>${fmtDate(insp.fecha_realizada)}</div>`}
        </div>
        <div class="form-group"><label>Plano</label>
          <div>${plano ? `<a class="btn btn-outline btn-sm" href="${plano}" target="_blank" rel="noopener"><i class="fas fa-file"></i> Ver plano</a>` : '—'}</div>
        </div>
      </div>
      <div class="form-group">
        <label>Observaciones</label>
        <textarea id="detObs" rows="3" ${editable ? '' : 'readonly'}>${esc(insp.observaciones || '')}</textarea>
      </div>
      ${encargado || admin ? `
        <div class="form-row cols-2">
          <div class="form-group">
            <label>Cambiar estado</label>
            <select id="detEstado">
              ${['Pendiente', 'En inspección', 'Completada', 'Con observaciones'].map((e) =>
                `<option value="${e}" ${insp.estado === e ? 'selected' : ''}>${e}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:end">
            <button type="button" class="btn btn-primary" id="btnGuardarInsp"><i class="fas fa-save"></i> Guardar avance</button>
          </div>
        </div>
      ` : ''}

      <h3 style="margin:1rem 0 .5rem;font-size:1rem"><i class="fas fa-cubes"></i> Piezas a revisar</h3>
      <div id="detPiezasHost"></div>
      ${encargado || editable ? `
        <div class="form-row cols-2" style="margin-top:.65rem;align-items:end">
          <div class="form-group" style="margin:0">
            <label>Agregar pieza</label>
            <input list="inspPiezasDatalist" id="detPiezaNueva" placeholder="Escribe o elige…">
          </div>
          <button type="button" class="btn btn-outline" id="btnDetAddPieza"><i class="fas fa-plus"></i> Agregar</button>
        </div>
      ` : ''}

      <h3 style="margin:1.25rem 0 .5rem;font-size:1rem"><i class="fas fa-comments"></i> Chat del requerimiento</h3>
      <p class="angel-train-note" style="margin-top:0">Cualquier usuario con acceso puede preguntar dudas. Angel puede leer este historial.</p>
      <div class="angel-chat insp-chat" id="detChatBox"></div>
      <form id="detChatForm" class="angel-compose" style="margin-top:.5rem">
        <input id="detChatInput" placeholder="Escribe una duda o comentario…" autocomplete="off">
        <button class="btn btn-primary" type="submit"><i class="fas fa-paper-plane"></i></button>
      </form>
    `;

    renderPiezas();

    $('btnGuardarInsp')?.addEventListener('click', async () => {
      try {
        const body = {
          fecha_realizada: $('detFechaReal')?.value || null,
          observaciones: $('detObs')?.value || '',
          estado: $('detEstado')?.value || insp.estado
        };
        if (['Completada', 'Con observaciones'].includes(body.estado)) {
          const sinFoto = (insp.piezas || []).filter((p) => !p.foto_ruta);
          if (sinFoto.length) {
            return flash(`Faltan fotos en ${sinFoto.length} pieza(s).`, true);
          }
          if (!body.fecha_realizada) {
            return flash('Indica la fecha en que se realizó la inspección', true);
          }
        }
        const r = await Auth.api('/api/modulos/inspeccion/' + insp.id, {
          method: 'PUT',
          body: JSON.stringify(body)
        });
        state.current = r.data;
        flash('Guardado');
        renderDetail();
        await loadChat();
        loadList();
      } catch (err) {
        flash(err.message, true);
      }
    });

    $('btnDetAddPieza')?.addEventListener('click', async () => {
      const nombre = $('detPiezaNueva').value.trim();
      if (!nombre) return flash('Nombre de pieza requerido', true);
      try {
        await Auth.api('/api/modulos/inspeccion/' + insp.id + '/piezas', {
          method: 'POST',
          body: JSON.stringify({ nombre })
        });
        const r = await Auth.api('/api/modulos/inspeccion/' + insp.id);
        state.current = r.data;
        $('detPiezaNueva').value = '';
        const meta = await Auth.api('/api/modulos/inspeccion/meta');
        state.catalogoPiezas = meta.data?.piezas_catalogo || [];
        refreshCatalogoDatalist();
        renderDetail();
        await loadChat();
      } catch (err) {
        flash(err.message, true);
      }
    });

    $('detChatForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const mensaje = $('detChatInput').value.trim();
      if (!mensaje) return;
      try {
        await Auth.api('/api/modulos/inspeccion/' + insp.id + '/chat', {
          method: 'POST',
          body: JSON.stringify({ mensaje })
        });
        $('detChatInput').value = '';
        await loadChat();
      } catch (err) {
        flash(err.message, true);
      }
    });
  }

  function renderPiezas() {
    const host = $('detPiezasHost');
    const insp = state.current;
    const piezas = insp.piezas || [];
    const encargado = isEncargado(insp) || Number(state.user?.rol_id) === 1;
    if (!piezas.length) {
      host.innerHTML = '<p class="home-empty">Aún no hay piezas cargadas.</p>';
      return;
    }
    host.innerHTML = piezas.map((p) => {
      const foto = archivoUrl(p.foto_ruta);
      return `
        <div class="insp-pieza-card" data-pieza="${p.id}">
          <div class="insp-pieza-main">
            <strong>${esc(p.nombre)}</strong>
            <span class="badge">${esc(p.estado || 'Pendiente')}</span>
            ${p.observacion ? `<small>${esc(p.observacion)}</small>` : ''}
          </div>
          <div class="insp-pieza-foto">
            ${foto
              ? `<a href="${foto}" target="_blank" rel="noopener"><img src="${foto}" alt="foto pieza"></a>`
              : '<span class="home-empty">Sin foto</span>'}
            ${encargado ? `
              <label class="btn btn-outline btn-sm">
                <i class="fas fa-camera"></i> Subir foto
                <input type="file" accept="image/*" hidden data-foto-pieza="${p.id}">
              </label>
            ` : ''}
          </div>
        </div>`;
    }).join('');

    host.querySelectorAll('[data-foto-pieza]').forEach((input) => {
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await fileToDataUrl(file);
          await Auth.api('/api/modulos/inspeccion/pieza/' + input.dataset.fotoPieza, {
            method: 'PUT',
            body: JSON.stringify({ fotoDataUrl: dataUrl, estado: 'Revisada' })
          });
          flash('Foto subida');
          const r = await Auth.api('/api/modulos/inspeccion/' + insp.id);
          state.current = r.data;
          renderDetail();
          await loadChat();
        } catch (err) {
          flash(err.message, true);
        }
      };
    });
  }

  async function loadChat() {
    const box = $('detChatBox');
    if (!box || !state.current) return;
    try {
      const r = await Auth.api('/api/modulos/inspeccion/' + state.current.id + '/chat');
      const msgs = r.data || [];
      if (!msgs.length) {
        box.innerHTML = '<div class="angel-msg bot"><div class="angel-bubble">Sin mensajes aún. Pregunta dudas sobre piezas o el plano.</div></div>';
        return;
      }
      box.innerHTML = msgs.map((m) => {
        const me = Number(m.usuario_id) === uid();
        return `<div class="angel-msg ${me ? 'me' : 'bot'}">
          <div class="angel-bubble">
            ${!me ? `<small style="opacity:.75;display:block;margin-bottom:.2rem">${esc(m.usuario_nombre || 'Usuario')}</small>` : ''}
            ${esc(m.mensaje)}
            <small style="opacity:.65;display:block;margin-top:.35rem">${esc(m.fecha_creacion || '')}</small>
          </div>
        </div>`;
      }).join('');
      box.scrollTop = box.scrollHeight;
    } catch (err) {
      box.innerHTML = `<p class="alert alert-error">${esc(err.message)}</p>`;
    }
  }

  window.bootInspeccion = async function bootInspeccion(user) {
    state.user = user;
    paintShell();
    renderDraftPiezas();
    try {
      const meta = await Auth.api('/api/modulos/inspeccion/meta');
      state.catalogoPiezas = meta.data?.piezas_catalogo || [];
      // Misma fuente de datos en todas las empresas (compartido SERCOM)
      if (Array.isArray(meta.data?.cecos) && meta.data.cecos.length) {
        state.cecos = meta.data.cecos;
      } else {
        state.cecos = await UI.loadCecos();
      }
      if (Array.isArray(meta.data?.usuarios) && meta.data.usuarios.length) {
        state.usuarios = meta.data.usuarios;
      } else {
        state.usuarios = await UI.loadUsuarios();
      }
      if (Array.isArray(meta.data?.proveedores) && meta.data.proveedores.length) {
        state.proveedores = meta.data.proveedores;
      } else {
        state.proveedores = await UI.loadProveedores();
      }

      fillSelect($('inspCeco'), state.cecos.map((c) => ({
        value: c.id,
        label: `${c.codigo || ''} — ${c.nombre}${c.jefe_proyecto ? ` (JP: ${c.jefe_proyecto})` : ''}`
      })), 'Seleccione CECO…');

      fillSelect($('inspEncargado'), state.usuarios.map((u) => ({
        value: u.id,
        label: `${u.nombre || ''} ${u.apellido || ''}`.trim() + (u.rol ? ` · ${u.rol}` : '')
      })), 'Seleccione encargado…');

      fillSelect($('inspProveedor'), state.proveedores.map((p) => ({
        value: p.id,
        label: (p.razon_social || p.nombre || ('#' + p.id)) + (p.rut ? ` (${p.rut})` : '')
      })), 'Seleccione proveedor…');

      refreshCatalogoDatalist();
      bindForm();
      await loadList();
    } catch (err) {
      flash(err.message || 'No se pudo cargar Inspección', true);
      const host = $('inspListHost');
      if (host) host.innerHTML = `<p class="alert alert-error">${esc(err.message)}</p>`;
    }
  };
})();
