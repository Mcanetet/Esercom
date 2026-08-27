/**
 * WMS Bodega — UI: diseño de layout, aprobación, operación QR/manual (modelo caótico).
 */
(function () {
  const state = {
    meta: null,
    bodegas: [],
    bodega: null,
    propuestas: [],
    propuesta: null,
    inventario: [],
    movimientos: [],
    kpis: null,
    salidas: [],
    salida: null,
    solicitudesPend: [],
    tab: 'bodegas',
    planoDataUrl: null,
    scanner: null,
    scanTarget: null
  };

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function flash(msg, ok = true) {
    const el = document.getElementById('wmsFlash');
    if (!el) return;
    el.className = 'wms-flash ' + (ok ? 'ok' : 'err');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });
  }

  async function api(path, opts) {
    return Auth.api(path, opts);
  }

  function content() {
    return document.getElementById('app-content');
  }

  function tabsHtml() {
    const tabs = [
      { id: 'bodegas', label: 'Bodegas', icon: 'fa-industry' },
      { id: 'diseno', label: 'Diseño layout', icon: 'fa-drafting-compass' },
      { id: 'propuesta', label: 'Propuesta', icon: 'fa-th' },
      { id: 'operacion', label: 'Ingreso / Salida', icon: 'fa-mobile-alt' },
      { id: 'salidas', label: 'Salidas', icon: 'fa-truck-loading' },
      { id: 'inventario', label: 'Inventario', icon: 'fa-boxes' },
      { id: 'posiciones', label: 'Posiciones', icon: 'fa-map-marked-alt' },
      { id: 'etiquetas', label: 'QR posiciones', icon: 'fa-qrcode' }
    ];
    return `
      <div class="wms-tabs">
        ${tabs.map((t) => `
          <button type="button" data-tab="${t.id}" class="${state.tab === t.id ? 'active' : ''}">
            <i class="fas ${t.icon}"></i> ${t.label}
          </button>
        `).join('')}
      </div>
    `;
  }

  function bodegaSelect(id = 'wmsBodSel') {
    const opts = state.bodegas.map((b) =>
      `<option value="${b.id}" ${state.bodega?.id === b.id ? 'selected' : ''}>${esc(b.codigo)} — ${esc(b.nombre)}</option>`
    ).join('');
    return `
      <div class="form-group">
        <label>Bodega activa</label>
        <select id="${id}">
          <option value="">— Selecciona —</option>
          ${opts}
        </select>
      </div>
    `;
  }

  function kpisHtml() {
    const k = state.kpis;
    if (!k) return '';
    return `
      <div class="wms-stats">
        <div class="wms-stat"><b>${k.ocupacion_pct}%</b><span>Ocupación</span></div>
        <div class="wms-stat"><b>${k.libres}/${k.total_posiciones}</b><span>Libres</span></div>
        <div class="wms-stat"><b>${k.skus_distintos}</b><span>SKUs</span></div>
        <div class="wms-stat"><b>${k.unidades_stock}</b><span>Unidades</span></div>
        <div class="wms-stat"><b>${k.movimientos_hoy}</b><span>Mov. hoy</span></div>
        <div class="wms-stat"><b>${k.bloqueadas}</b><span>Bloqueadas</span></div>
        <div class="wms-stat"><b>${k.salidas_pendientes || 0}</b><span>Salidas pend.</span></div>
      </div>
    `;
  }

  function matAutocomplete(inputId, listId) {
    return `<datalist id="${listId}"></datalist>`;
  }

  function wireMatAutocomplete(inputId, listId) {
    const inp = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!inp || !list) return;
    let t;
    inp.setAttribute('list', listId);
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = inp.value.trim();
        if (q.length < 1) return;
        try {
          const res = await api('/api/catalogos/materiales?q=' + encodeURIComponent(q));
          const rows = res.data || [];
          list.innerHTML = rows.map((m) =>
            `<option value="${esc(m.codigo)}">${esc(m.nombre || '')}</option>`
          ).join('');
          // Si hay match exacto, rellenar nombre si existe campo hermano
          const exact = rows.find((m) => String(m.codigo).toUpperCase() === q.toUpperCase());
          if (exact) {
            const nameId = inputId === 'inMat' ? 'inNombre' : null;
            const nameEl = nameId ? document.getElementById(nameId) : null;
            if (nameEl && !nameEl.value) nameEl.value = exact.nombre || '';
            const unEl = document.getElementById('inUn');
            if (unEl && exact.unidad) unEl.value = exact.unidad;
          }
        } catch (_) { /* ignore */ }
      }, 220);
    });
  }

  /* ---------- Tab: Bodegas ---------- */
  function renderBodegas() {
    const m = state.meta;
    return `
      <div class="card">
        <div class="card-header"><h2><i class="fas fa-plus-circle"></i> Nueva bodega</h2></div>
        <div class="card-body">
          <p class="wms-help">
            Dimensiona el espacio (plano o foto + medidas). El <strong>mercado</strong> fija zonas de
            ingreso y despacho. Modelo <strong>caótico</strong>: el producto puede ir a cualquier posición libre.
          </p>
          <form id="formBod">
            <div class="form-row cols-2">
              <div class="form-group">
                <label>Nombre *</label>
                <input id="bodNombre" required maxlength="160" placeholder="Ej: Bodega Central Santiago">
              </div>
              <div class="form-group">
                <label>Mercado (flujo ingreso/despacho) *</label>
                <select id="bodMercado" required>
                  ${(m?.mercados || []).map((x) =>
                    `<option value="${esc(x.key)}">${esc(x.label)} — ${esc(x.zona_ingreso)} / ${esc(x.zona_despacho)}</option>`
                  ).join('')}
                </select>
              </div>
            </div>
            <div class="form-row cols-3">
              <div class="form-group">
                <label>Largo bodega (m) *</label>
                <input id="bodLargo" type="number" step="0.01" min="1" required placeholder="ej. 40">
              </div>
              <div class="form-group">
                <label>Ancho bodega (m) *</label>
                <input id="bodAncho" type="number" step="0.01" min="1" required placeholder="ej. 25">
              </div>
              <div class="form-group">
                <label>Alto libre (m) *</label>
                <input id="bodAlto" type="number" step="0.01" min="1" required placeholder="ej. 8">
              </div>
            </div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label>¿Habrá rack o piso?</label>
                <select id="bodTipo">
                  <option value="mixto">Mixto (rack + piso)</option>
                  <option value="rack">Solo rack</option>
                  <option value="piso">Solo piso</option>
                </select>
              </div>
              <div class="form-group">
                <label>Plano o fotografía del espacio</label>
                <input type="file" id="bodPlano" accept="image/jpeg,image/png,image/webp,image/*">
                <div id="bodPlanoPrev" hidden style="margin-top:.5rem"></div>
              </div>
            </div>
            <button class="btn btn-primary" type="submit"><i class="fas fa-save"></i> Crear bodega y zonas</button>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Bodegas</h2></div>
        <div class="card-body">
          ${state.bodegas.length ? `
            <div class="wms-grid">
              ${state.bodegas.map((b) => `
                <div class="wms-bod-card ${state.bodega?.id === b.id ? 'active' : ''}" data-open-bod="${b.id}">
                  <h3>${esc(b.codigo)} · ${esc(b.nombre)}</h3>
                  <div class="muted" style="font-size:.8rem">
                    ${Number(b.largo_m)} × ${Number(b.ancho_m)} × ${Number(b.alto_m)} m · ${esc(b.mercado)}
                  </div>
                  <div class="wms-bod-meta">
                    <span class="wms-pill teal"><i class="fas fa-map-marker-alt"></i> ${b.total_posiciones || 0} pos.</span>
                    <span class="wms-pill blue"><i class="fas fa-door-open"></i> ${b.posiciones_libres || 0} libres</span>
                    <span class="wms-pill orange"><i class="fas fa-cube"></i> ${esc(b.tipo_almacenaje)}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<p class="muted">Aún no hay bodegas. Crea la primera arriba.</p>'}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2><i class="fas fa-route"></i> Flujo operativo</h2></div>
        <div class="card-body">
          <ol class="wms-flow">
            ${(m?.flujo || []).map((f, i) => `<li><b>${i + 1}</b><span>${esc(f.replace(/^\d+\.\s*/, ''))}</span></li>`).join('')}
          </ol>
        </div>
      </div>
    `;
  }

  /* ---------- Tab: Diseño ---------- */
  function renderDiseno() {
    if (!state.bodega) {
      return `<div class="card"><div class="card-body">${bodegaSelect()}
        <p class="muted">Selecciona o crea una bodega para dimensionar posiciones.</p></div></div>`;
    }
    const b = state.bodega;
    return `
      <div class="card">
        <div class="card-header"><h2>Diseño de posiciones — ${esc(b.codigo)}</h2></div>
        <div class="card-body">
          ${bodegaSelect()}
          <div class="wms-stats">
            <div class="wms-stat"><b>${Number(b.largo_m)}×${Number(b.ancho_m)}</b><span>Planta (m)</span></div>
            <div class="wms-stat"><b>${Number(b.alto_m)} m</b><span>Alto libre</span></div>
            <div class="wms-stat"><b>${(b.posiciones || []).length}</b><span>Posiciones activas</span></div>
            <div class="wms-stat"><b>${esc(b.tipo_almacenaje)}</b><span>Tipo actual</span></div>
          </div>
          ${b.plano_ruta ? `<p><img class="wms-plano-preview" src="${esc(b.plano_ruta)}" alt="Plano"></p>` : ''}
          <p class="wms-help">
            Indica si usarán <strong>rack</strong>, <strong>piso</strong> o <strong>mixto</strong>, y las dimensiones
            de cada posición (largo × ancho × alto). El sistema calcula la grilla, reserva muelles de
            ingreso/despacho según mercado y genera una propuesta editable.
          </p>
          <form id="formProp">
            <div class="form-row cols-2">
              <div class="form-group">
                <label>¿Rack o piso? *</label>
                <select id="propTipo" required>
                  <option value="mixto" ${b.tipo_almacenaje === 'mixto' ? 'selected' : ''}>Mixto</option>
                  <option value="rack" ${b.tipo_almacenaje === 'rack' ? 'selected' : ''}>Rack</option>
                  <option value="piso" ${b.tipo_almacenaje === 'piso' ? 'selected' : ''}>Piso</option>
                </select>
              </div>
              <div class="form-group">
                <label>Niveles de rack</label>
                <input id="propNiveles" type="number" min="1" max="12" value="3">
                <div class="wms-help">En piso se fuerza 1 nivel. En mixto: rack multi-nivel + zonas de piso.</div>
              </div>
            </div>
            <div class="form-row cols-3">
              <div class="form-group">
                <label>Largo posición (m) *</label>
                <input id="propLargo" type="number" step="0.01" min="0.3" value="1.2" required>
              </div>
              <div class="form-group">
                <label>Ancho posición (m) *</label>
                <input id="propAncho" type="number" step="0.01" min="0.3" value="1.0" required>
              </div>
              <div class="form-group">
                <label>Alto posición (m) *</label>
                <input id="propAlto" type="number" step="0.01" min="0.3" value="1.5" required>
              </div>
            </div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label>Pasillo entre filas (m)</label>
                <input id="propPasillo" type="number" step="0.1" min="1.5"
                  value="${esc(b.parametros?.pasillo_min_m || 2.5)}">
              </div>
              <div class="form-group">
                <label>Notas</label>
                <input id="propNotas" maxlength="255" placeholder="Ej: pasillo contra-incendio 3.5 m">
              </div>
            </div>
            <button class="btn btn-primary" type="submit">
              <i class="fas fa-magic"></i> Generar propuesta de posiciones
            </button>
          </form>

          <h3 style="margin-top:1.25rem;font-size:.95rem">Propuestas anteriores</h3>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>Código</th><th>Tipo</th><th>Pos.</th><th>Estado</th><th>Fecha</th><th></th></tr>
              </thead>
              <tbody>
                ${(state.propuestas || []).map((p) => `
                  <tr>
                    <td><strong>${esc(p.codigo)}</strong></td>
                    <td>${esc(p.tipo_almacenaje)}</td>
                    <td>${p.total_posiciones}</td>
                    <td>${esc(p.estado)}</td>
                    <td>${esc(String(p.fecha_creacion || '').slice(0, 16))}</td>
                    <td><button type="button" class="btn btn-outline btn-sm" data-open-prop="${p.id}">
                      <i class="fas fa-eye"></i></button></td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">Sin propuestas aún</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function layoutMapHtml(layout, scale = 12) {
    if (!layout) return '<p class="muted">Sin layout</p>';
    const zonas = layout.zonas || [];
    const posiciones = layout.posiciones || [];
    let maxX = 20;
    let maxY = 20;
    [...zonas, ...posiciones].forEach((z) => {
      maxX = Math.max(maxX, (Number(z.x_m) || 0) + (Number(z.largo_m) || Number(z.ancho_m) || 1) + 1);
      maxY = Math.max(maxY, (Number(z.y_m) || 0) + (Number(z.ancho_m) || Number(z.largo_m) || 1) + 1);
    });
    if (state.bodega) {
      maxX = Math.max(maxX, Number(state.bodega.ancho_m) || maxX);
      maxY = Math.max(maxY, Number(state.bodega.largo_m) || maxY);
    }
    const w = Math.ceil(maxX * scale);
    const h = Math.ceil(maxY * scale);

    return `
      <div class="wms-layout-map">
        <div class="wms-layout-inner" style="width:${w}px;height:${h}px">
          ${zonas.map((z) => `
            <div class="wms-zone" style="
              left:${(Number(z.x_m) || 0) * scale}px;
              top:${(Number(z.y_m) || 0) * scale}px;
              width:${Math.max(24, (Number(z.largo_m) || 1) * scale)}px;
              height:${Math.max(20, (Number(z.ancho_m) || 1) * scale)}px;
              border-color:${esc(z.color || '#64748b')};
              background:${esc(z.color || '#64748b')}22;
              color:${esc(z.color || '#64748b')}">
              ${esc(z.codigo)}
            </div>
          `).join('')}
          ${posiciones.map((p) => `
            <div class="wms-pos ${esc(p.tipo || 'piso')} ${esc(p.estado || '')}"
              title="${esc(p.codigo)}"
              style="
                left:${(Number(p.x_m) || 0) * scale}px;
                top:${(Number(p.y_m) || 0) * scale}px;
                width:${Math.max(18, (Number(p.largo_m) || 1) * scale)}px;
                height:${Math.max(14, (Number(p.ancho_m) || 1) * scale)}px">
              ${esc(String(p.codigo || '').replace(/^POS-|^UBI-|^LOC-/, '').slice(0, 10))}
            </div>
          `).join('')}
        </div>
      </div>
      <p class="wms-help">Escala ~1 m = ${scale} px · Verde/naranja = rack/piso · Zonas punteadas = ingreso / almacén / despacho</p>
    `;
  }

  /* ---------- Tab: Propuesta ---------- */
  function renderPropuesta() {
    if (!state.propuesta) {
      return `<div class="card"><div class="card-body">
        ${bodegaSelect()}
        <p class="muted">Genera o abre una propuesta desde «Diseño layout».</p>
      </div></div>`;
    }
    const p = state.propuesta;
    const layout = p.layout || {};
    const posiciones = layout.posiciones || [];
    const editable = p.estado !== 'aprobada';

    return `
      <div class="card">
        <div class="card-header">
          <h2>Propuesta ${esc(p.codigo)}
            <span class="wms-pill ${p.estado === 'aprobada' ? 'teal' : 'orange'}">${esc(p.estado)}</span>
          </h2>
        </div>
        <div class="card-body">
          <p class="wms-help">
            ${posiciones.length} posiciones · ${esc(p.tipo_almacenaje)} ·
            pos. ${Number(p.pos_largo_m)}×${Number(p.pos_ancho_m)}×${Number(p.pos_alto_m)} m
            ${layout.meta?.advertencia ? ` · <strong>${esc(layout.meta.advertencia)}</strong>` : ''}
          </p>
          ${layoutMapHtml(layout)}

          ${editable ? `
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:1rem 0">
              <button type="button" class="btn btn-secondary" id="btnAddPos">
                <i class="fas fa-plus"></i> Agregar posición
              </button>
              <button type="button" class="btn btn-primary" id="btnSaveProp">
                <i class="fas fa-save"></i> Guardar cambios
              </button>
              <button type="button" class="btn btn-primary" id="btnAprobar" style="background:#0f766e">
                <i class="fas fa-check-double"></i> Aprobar y crear espacios
              </button>
            </div>
          ` : `<p class="wms-flash ok" style="display:block">Aprobada — las posiciones ya existen con QR.</p>`}

          <div class="table-wrap">
            <table class="data wms-prop-table">
              <thead>
                <tr>
                  <th>Código</th><th>Tipo</th><th>Fila</th><th>Col</th><th>Niv</th>
                  <th>L</th><th>An</th><th>Al</th><th>X</th><th>Y</th>
                  ${editable ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody id="propPosBody">
                ${posiciones.map((pos, i) => propRow(pos, i, editable)).join('') ||
                  '<tr><td colspan="11" class="muted">Sin posiciones</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function propRow(pos, i, editable) {
    if (!editable) {
      return `<tr>
        <td>${esc(pos.codigo)}</td><td>${esc(pos.tipo)}</td><td>${esc(pos.fila)}</td>
        <td>${esc(pos.columna)}</td><td>${esc(pos.nivel)}</td>
        <td>${esc(pos.largo_m)}</td><td>${esc(pos.ancho_m)}</td><td>${esc(pos.alto_m)}</td>
        <td>${esc(pos.x_m)}</td><td>${esc(pos.y_m)}</td>
      </tr>`;
    }
    return `<tr data-idx="${i}">
      <td><input data-f="codigo" value="${esc(pos.codigo)}"></td>
      <td><select data-f="tipo">
        <option value="rack" ${pos.tipo === 'rack' ? 'selected' : ''}>rack</option>
        <option value="piso" ${pos.tipo === 'piso' ? 'selected' : ''}>piso</option>
      </select></td>
      <td><input data-f="fila" value="${esc(pos.fila || '')}"></td>
      <td><input data-f="columna" value="${esc(pos.columna || '')}"></td>
      <td><input data-f="nivel" type="number" value="${esc(pos.nivel || 1)}"></td>
      <td><input data-f="largo_m" type="number" step="0.01" value="${esc(pos.largo_m)}"></td>
      <td><input data-f="ancho_m" type="number" step="0.01" value="${esc(pos.ancho_m)}"></td>
      <td><input data-f="alto_m" type="number" step="0.01" value="${esc(pos.alto_m)}"></td>
      <td><input data-f="x_m" type="number" step="0.01" value="${esc(pos.x_m)}"></td>
      <td><input data-f="y_m" type="number" step="0.01" value="${esc(pos.y_m)}"></td>
      <td><button type="button" class="btn btn-outline btn-sm" data-del-pos="${i}" title="Quitar">
        <i class="fas fa-trash"></i></button></td>
    </tr>`;
  }

  function collectPropRows() {
    const rows = [...document.querySelectorAll('#propPosBody tr[data-idx]')];
    return rows.map((tr) => {
      const get = (f) => tr.querySelector(`[data-f="${f}"]`)?.value;
      return {
        codigo: get('codigo'),
        tipo: get('tipo'),
        fila: get('fila'),
        columna: get('columna'),
        nivel: Number(get('nivel')) || 1,
        largo_m: Number(get('largo_m')),
        ancho_m: Number(get('ancho_m')),
        alto_m: Number(get('alto_m')),
        x_m: Number(get('x_m')),
        y_m: Number(get('y_m')),
        capacidad_kg: 1000,
        zona_tipo: 'almacen',
        estado: 'libre'
      };
    });
  }

  /* ---------- Tab: Operación móvil ---------- */
  function renderOperacion() {
    if (!state.bodega) {
      return `<div class="card"><div class="card-body">${bodegaSelect()}
        <p class="muted">Selecciona bodega para operar ingreso/salida.</p></div></div>`;
    }
    return `
      <div class="card">
        <div class="card-header"><h2><i class="fas fa-mobile-alt"></i> Operación celular · modelo caótico</h2></div>
        <div class="card-body">
          ${bodegaSelect()}
          ${kpisHtml()}
          <p class="wms-help">
            El material puede almacenarse en <strong>cualquier posición libre</strong>.
            Captura por <strong>QR</strong> o escribe el código de posición a mano.
            Zona de ingreso: recepción → putaway. Zona de despacho: pick → embarque.
          </p>
          <div class="wms-ops">
            <div>
              <h3 style="font-size:.95rem;margin:0 0 .75rem"><i class="fas fa-arrow-down" style="color:#0284c7"></i> Ingreso</h3>
              <form id="formIngreso">
                <div class="form-group">
                  <label>Código material *</label>
                  <input id="inMat" required placeholder="SKU / código" autocomplete="off">
                  ${matAutocomplete('inMat', 'dlInMat')}
                </div>
                <div class="form-group">
                  <label>Nombre (opcional)</label>
                  <input id="inNombre" placeholder="Descripción">
                </div>
                <div class="form-row cols-2">
                  <div class="form-group">
                    <label>Cantidad *</label>
                    <input id="inQty" type="number" step="0.001" min="0.001" value="1" required>
                  </div>
                  <div class="form-group">
                    <label>Unidad</label>
                    <input id="inUn" value="UN" maxlength="16">
                  </div>
                </div>
                <div class="form-group">
                  <label>Posición (QR o manual)</label>
                  <div style="display:flex;gap:.4rem">
                    <input id="inPos" placeholder="Código posición o deja vacío = sugiere" style="flex:1">
                    <button type="button" class="btn btn-outline" data-scan="inPos" title="Escanear QR">
                      <i class="fas fa-qrcode"></i>
                    </button>
                    <button type="button" class="btn btn-outline" id="btnSugiere" title="Sugerir libre">
                      <i class="fas fa-random"></i>
                    </button>
                  </div>
                </div>
                <div class="form-group">
                  <label>Lote / documento</label>
                  <div class="form-row cols-2">
                    <input id="inLote" placeholder="Lote">
                    <input id="inDoc" placeholder="Guía / OC">
                  </div>
                </div>
                <button class="btn btn-primary" type="submit" style="width:100%">
                  <i class="fas fa-check"></i> Confirmar ingreso
                </button>
              </form>
            </div>
            <div>
              <h3 style="font-size:.95rem;margin:0 0 .75rem"><i class="fas fa-arrow-up" style="color:#c2410c"></i> Salida / despacho</h3>
              <form id="formSalida">
                <div class="form-group">
                  <label>Código material *</label>
                  <div style="display:flex;gap:.4rem">
                    <input id="outMat" required placeholder="SKU" style="flex:1" autocomplete="off">
                    ${matAutocomplete('outMat', 'dlOutMat')}
                    <button type="button" class="btn btn-outline" id="btnBuscarUbi" title="Dónde está">
                      <i class="fas fa-search-location"></i>
                    </button>
                  </div>
                  <div id="outUbicaciones" class="wms-help"></div>
                </div>
                <div class="form-row cols-2">
                  <div class="form-group">
                    <label>Cantidad *</label>
                    <input id="outQty" type="number" step="0.001" min="0.001" value="1" required>
                  </div>
                  <div class="form-group">
                    <label>Posición (QR o manual)</label>
                    <div style="display:flex;gap:.4rem">
                      <input id="outPos" placeholder="Confirmar posición" style="flex:1">
                      <button type="button" class="btn btn-outline" data-scan="outPos">
                        <i class="fas fa-qrcode"></i>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="form-group">
                  <label>Documento ref.</label>
                  <input id="outDoc" placeholder="Solicitud / guía">
                </div>
                <button class="btn btn-primary" type="submit" style="width:100%;background:#c2410c;border-color:#c2410c">
                  <i class="fas fa-truck"></i> Confirmar salida
                </button>
              </form>
            </div>
          </div>

          <div class="card" style="margin-top:1rem;box-shadow:none;border:1px solid var(--border)">
            <div class="card-header"><h2 style="font-size:.95rem"><i class="fas fa-exchange-alt"></i> Traslado interno</h2></div>
            <div class="card-body">
              <form id="formTraslado">
                <div class="form-row cols-2">
                  <div class="form-group">
                    <label>Material *</label>
                    <input id="trMat" required autocomplete="off">
                    ${matAutocomplete('trMat', 'dlTrMat')}
                  </div>
                  <div class="form-group">
                    <label>Cantidad *</label>
                    <input id="trQty" type="number" step="0.001" min="0.001" value="1" required>
                  </div>
                </div>
                <div class="form-row cols-2">
                  <div class="form-group">
                    <label>Origen (QR / código) *</label>
                    <div style="display:flex;gap:.4rem">
                      <input id="trOrigen" required style="flex:1">
                      <button type="button" class="btn btn-outline" data-scan="trOrigen"><i class="fas fa-qrcode"></i></button>
                    </div>
                  </div>
                  <div class="form-group">
                    <label>Destino (QR / código)</label>
                    <div style="display:flex;gap:.4rem">
                      <input id="trDestino" placeholder="Vacío = sugiere libre" style="flex:1">
                      <button type="button" class="btn btn-outline" data-scan="trDestino"><i class="fas fa-qrcode"></i></button>
                    </div>
                  </div>
                </div>
                <button class="btn btn-secondary" type="submit"><i class="fas fa-random"></i> Trasladar</button>
              </form>
            </div>
          </div>

          <div class="wms-scan-box" id="scanPanel" hidden style="margin-top:1rem">
            <strong>Escáner QR</strong>
            <div id="wmsQrReader"></div>
            <button type="button" class="btn btn-outline btn-sm" id="btnStopScan" style="margin-top:.5rem">
              Cerrar cámara
            </button>
          </div>

          <h3 style="margin-top:1.25rem;font-size:.95rem">Últimos movimientos</h3>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>Código</th><th>Tipo</th><th>Material</th><th>Cant.</th><th>Posición</th><th>Modo</th><th>Fecha</th></tr>
              </thead>
              <tbody>
                ${(state.movimientos || []).slice(0, 30).map((m) => `
                  <tr>
                    <td>${esc(m.codigo)}</td>
                    <td>${esc(m.tipo)}</td>
                    <td>${esc(m.material_codigo)}</td>
                    <td>${esc(m.cantidad)} ${esc(m.unidad)}</td>
                    <td>${esc(m.posicion_codigo || '—')}${m.tipo === 'traslado' && m.observaciones ? ` <span class="muted">${esc(m.observaciones)}</span>` : ''}</td>
                    <td>${esc(m.modo_captura)}</td>
                    <td>${esc(String(m.fecha_creacion || '').slice(0, 16))}</td>
                  </tr>
                `).join('') || '<tr><td colspan="7" class="muted">Sin movimientos</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="wms-mobile-bar">
        <button type="button" data-tab-jump="operacion"><i class="fas fa-exchange-alt"></i> Operar</button>
        <button type="button" data-tab-jump="salidas"><i class="fas fa-truck-loading"></i> Salidas</button>
        <button type="button" data-tab-jump="inventario"><i class="fas fa-boxes"></i> Stock</button>
        <button type="button" data-tab-jump="etiquetas"><i class="fas fa-qrcode"></i> QR</button>
      </div>
    `;
  }

  function renderSalidas() {
    if (!state.bodega) {
      return `<div class="card"><div class="card-body">${bodegaSelect()}
        <p class="muted">Selecciona bodega WMS para crear salidas.</p></div></div>`;
    }
    const sal = state.salida;
    return `
      <div class="card">
        <div class="card-header"><h2><i class="fas fa-truck-loading"></i> Documentos de salida</h2></div>
        <div class="card-body">
          ${bodegaSelect()}
          ${kpisHtml()}
          <p class="wms-help">
            Crea una <strong>salida</strong> desde una solicitud en entrega, o manual.
            Al confirmar, el sistema hace pick caótico (multi-posición), genera movimientos
            y actualiza la solicitud a «Guías pendientes».
          </p>

          <div class="wms-ops">
            <div>
              <h3 style="font-size:.95rem;margin:0 0 .65rem">Desde solicitud</h3>
              <div class="form-group">
                <label>Buscar solicitud (estados En Entrega / Asignar Bodeguero)</label>
                <div style="display:flex;gap:.4rem">
                  <input id="solQ" placeholder="Código / proyecto…" style="flex:1">
                  <button type="button" class="btn btn-outline" id="btnBuscarSol"><i class="fas fa-search"></i></button>
                </div>
              </div>
              <div class="table-wrap">
                <table class="data">
                  <thead><tr><th>Código</th><th>Proyecto</th><th>Estado</th><th>Líneas</th><th></th></tr></thead>
                  <tbody>
                    ${(state.solicitudesPend || []).map((s) => `
                      <tr>
                        <td><strong>${esc(s.codigo)}</strong></td>
                        <td>${esc(s.numero_proyecto || '—')}</td>
                        <td>${esc(s.estado_nombre || s.estado_id)}</td>
                        <td>${esc(s.n_lineas)}</td>
                        <td><button type="button" class="btn btn-primary btn-sm" data-crear-sal-sol="${s.id}">
                          <i class="fas fa-plus"></i> Crear salida</button></td>
                      </tr>
                    `).join('') || '<tr><td colspan="5" class="muted">Sin solicitudes pendientes (busca o refresca)</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 style="font-size:.95rem;margin:0 0 .65rem">Salida manual</h3>
              <form id="formSalManual">
                <div id="salManualLines">
                  <div class="form-row cols-3 sal-line">
                    <div class="form-group">
                      <label>Material</label>
                      <input class="sm-mat" required placeholder="SKU" list="dlSalMat">
                    </div>
                    <div class="form-group">
                      <label>Cantidad</label>
                      <input class="sm-qty" type="number" step="0.001" min="0.001" value="1" required>
                    </div>
                    <div class="form-group">
                      <label>Unidad</label>
                      <input class="sm-un" value="UN">
                    </div>
                  </div>
                </div>
                <datalist id="dlSalMat"></datalist>
                <button type="button" class="btn btn-outline btn-sm" id="btnAddSalLine" style="margin-bottom:.75rem">
                  <i class="fas fa-plus"></i> Línea
                </button>
                <div class="form-group">
                  <label>Quién retira</label>
                  <input id="smRetira" placeholder="Nombre">
                </div>
                <div class="form-row cols-2">
                  <div class="form-group">
                    <label>Conductor</label>
                    <input id="smCond">
                  </div>
                  <div class="form-group">
                    <label>Patente</label>
                    <input id="smPat">
                  </div>
                </div>
                <button class="btn btn-primary" type="submit"><i class="fas fa-file-alt"></i> Crear borrador</button>
              </form>
            </div>
          </div>
        </div>
      </div>

      ${sal ? renderSalidaDetalle(sal) : ''}

      <div class="card">
        <div class="card-header"><h2>Historial de salidas</h2></div>
        <div class="card-body table-wrap">
          <table class="data">
            <thead>
              <tr><th>Código</th><th>Origen</th><th>Solicitud</th><th>Estado</th><th>Líneas</th><th>Fecha</th><th></th></tr>
            </thead>
            <tbody>
              ${(state.salidas || []).map((s) => `
                <tr>
                  <td><strong>${esc(s.codigo)}</strong></td>
                  <td>${esc(s.origen)}</td>
                  <td>${esc(s.solicitud_codigo || '—')}</td>
                  <td><span class="wms-pill ${s.estado === 'confirmada' ? 'teal' : 'orange'}">${esc(s.estado)}</span></td>
                  <td>${esc(s.n_lineas)}</td>
                  <td>${esc(String(s.fecha_creacion || '').slice(0, 16))}</td>
                  <td><button type="button" class="btn btn-outline btn-sm" data-open-sal="${s.id}"><i class="fas fa-eye"></i></button></td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="muted">Sin salidas aún</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderSalidaDetalle(sal) {
    const editable = sal.estado === 'borrador' || sal.estado === 'parcial';
    return `
      <div class="card" id="salidaDetalleCard">
        <div class="card-header">
          <h2>Salida ${esc(sal.codigo)}
            <span class="wms-pill ${sal.estado === 'confirmada' ? 'teal' : 'orange'}">${esc(sal.estado)}</span>
            ${sal.solicitud_codigo ? `<span class="wms-pill blue">Sol. ${esc(sal.solicitud_codigo)}</span>` : ''}
          </h2>
        </div>
        <div class="card-body">
          <div class="wms-help" style="margin-bottom:.75rem">
            Pick automático por FIFO caótico. Opcional: indica posición QR/manual por línea antes de confirmar.
          </div>
          <div class="table-wrap">
            <table class="data wms-prop-table">
              <thead>
                <tr>
                  <th>Material</th><th>Nombre</th><th>Pedida</th><th>Despachada</th><th>Unidad</th>
                  <th>Posición (QR/manual)</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                ${(sal.detalle || []).map((d) => `
                  <tr data-linea-id="${d.id}">
                    <td><strong>${esc(d.material_codigo)}</strong></td>
                    <td>${esc(d.material_nombre || '—')}</td>
                    <td>${esc(d.cantidad_solicitada)}</td>
                    <td>${esc(d.cantidad_despachada)}</td>
                    <td>${esc(d.unidad)}</td>
                    <td>
                      ${editable ? `
                        <div style="display:flex;gap:.3rem">
                          <input id="posLn_${d.id}" data-pos-ln="${d.id}" value="${esc(d.posicion_codigo || '')}" placeholder="auto" style="flex:1">
                          <button type="button" class="btn btn-outline btn-sm" data-scan="posLn_${d.id}">
                            <i class="fas fa-qrcode"></i>
                          </button>
                        </div>
                      ` : esc(d.posicion_codigo || '—')}
                    </td>
                    <td>${esc(d.estado)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          ${editable ? `
            <div class="form-row cols-2" style="margin-top:1rem">
              <div class="form-group">
                <label>Quién retira</label>
                <input id="salRetira" value="${esc(sal.quien_retira || '')}">
              </div>
              <div class="form-group">
                <label>Conductor / patente</label>
                <div style="display:flex;gap:.4rem">
                  <input id="salCond" value="${esc(sal.despacho_conductor || '')}" placeholder="Conductor" style="flex:1">
                  <input id="salPat" value="${esc(sal.despacho_patente || '')}" placeholder="Patente" style="width:110px">
                </div>
              </div>
            </div>
            <div class="wms-scan-box" id="scanPanel" hidden style="margin-top:.75rem">
              <strong>Escáner QR posición</strong>
              <div id="wmsQrReader"></div>
              <button type="button" class="btn btn-outline btn-sm" id="btnStopScan" style="margin-top:.5rem">Cerrar</button>
            </div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem">
              <button type="button" class="btn btn-primary" id="btnConfirmarSal" style="background:#c2410c;border-color:#c2410c">
                <i class="fas fa-check-double"></i> Confirmar despacho (baja stock)
              </button>
              <button type="button" class="btn btn-outline" id="btnAnularSal">
                <i class="fas fa-ban"></i> Anular
              </button>
              <button type="button" class="btn btn-outline" onclick="window.print()">
                <i class="fas fa-print"></i> Imprimir
              </button>
            </div>
          ` : `
            <p class="wms-flash ok" style="display:block;margin-top:1rem">
              Confirmada ${esc(String(sal.fecha_confirmacion || '').slice(0, 16))}
            </p>
            <button type="button" class="btn btn-outline" onclick="window.print()">
              <i class="fas fa-print"></i> Imprimir documento
            </button>
          `}

          ${(sal.movimientos || []).length ? `
            <h3 style="margin-top:1.25rem;font-size:.9rem">Movimientos generados</h3>
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>MOV</th><th>Material</th><th>Cant.</th><th>Posición</th><th>Modo</th></tr></thead>
                <tbody>
                  ${sal.movimientos.map((m) => `
                    <tr>
                      <td>${esc(m.codigo)}</td>
                      <td>${esc(m.material_codigo)}</td>
                      <td>${esc(m.cantidad)}</td>
                      <td>${esc(m.posicion_codigo)}</td>
                      <td>${esc(m.modo_captura)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderPosiciones() {
    if (!state.bodega) {
      return `<div class="card"><div class="card-body">${bodegaSelect()}</div></div>`;
    }
    const pos = state.bodega.posiciones || [];
    return `
      <div class="card">
        <div class="card-header"><h2><i class="fas fa-map-marked-alt"></i> Posiciones — bloqueo / cuarentena</h2></div>
        <div class="card-body">
          ${bodegaSelect()}
          ${kpisHtml()}
          <p class="wms-help">
            Bloquea posiciones dañadas, en mantenimiento o en cuarentena. No reciben ingreso ni traslados.
            «Liberar» recalcula según stock real.
          </p>
          <form id="formBloqueo" style="margin-bottom:1rem">
            <div class="form-row cols-3">
              <div class="form-group">
                <label>Posición (código o QR)</label>
                <div style="display:flex;gap:.4rem">
                  <input id="blkPos" required style="flex:1" placeholder="POS-A01-N1">
                  <button type="button" class="btn btn-outline" data-scan="blkPos"><i class="fas fa-qrcode"></i></button>
                </div>
              </div>
              <div class="form-group">
                <label>Acción</label>
                <select id="blkEstado">
                  <option value="bloqueada">Bloquear</option>
                  <option value="reserva">Reservar</option>
                  <option value="libre">Liberar (recalcular)</option>
                </select>
              </div>
              <div class="form-group" style="display:flex;align-items:flex-end">
                <button class="btn btn-primary" type="submit" style="width:100%"><i class="fas fa-lock"></i> Aplicar</button>
              </div>
            </div>
          </form>
          <div class="wms-scan-box" id="scanPanel" hidden>
            <strong>Escáner QR</strong>
            <div id="wmsQrReader"></div>
            <button type="button" class="btn btn-outline btn-sm" id="btnStopScan" style="margin-top:.5rem">Cerrar cámara</button>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>Código</th><th>Tipo</th><th>Nivel</th><th>Dims (m)</th><th>Estado</th><th>Stock</th><th></th></tr>
              </thead>
              <tbody>
                ${pos.map((p) => `
                  <tr>
                    <td><strong>${esc(p.codigo)}</strong></td>
                    <td>${esc(p.tipo)}</td>
                    <td>${esc(p.nivel)}</td>
                    <td>${esc(p.largo_m)}×${esc(p.ancho_m)}×${esc(p.alto_m)}</td>
                    <td><span class="wms-pill ${p.estado === 'bloqueada' ? 'orange' : (p.estado === 'ocupada' ? '' : 'teal')}">${esc(p.estado)}</span></td>
                    <td>${esc(p.stock_total || 0)}</td>
                    <td>
                      ${p.estado !== 'bloqueada'
                        ? `<button type="button" class="btn btn-outline btn-sm" data-blk="${esc(p.codigo)}" data-est="bloqueada" title="Bloquear"><i class="fas fa-ban"></i></button>`
                        : `<button type="button" class="btn btn-outline btn-sm" data-blk="${esc(p.codigo)}" data-est="libre" title="Liberar"><i class="fas fa-unlock"></i></button>`}
                    </td>
                  </tr>
                `).join('') || '<tr><td colspan="7" class="muted">Sin posiciones. Aprueba un layout.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function renderInventario() {
    if (!state.bodega) {
      return `<div class="card"><div class="card-body">${bodegaSelect()}</div></div>`;
    }
    const layout = {
      zonas: state.bodega.zonas || [],
      posiciones: (state.bodega.posiciones || []).map((p) => ({
        ...p,
        estado: Number(p.stock_total) > 0 ? 'ocupada' : 'libre'
      }))
    };
    return `
      <div class="card">
        <div class="card-header"><h2>Inventario caótico — ${esc(state.bodega.codigo)}</h2></div>
        <div class="card-body">
          ${bodegaSelect()}
          ${kpisHtml()}
          <div class="form-group" style="max-width:280px">
            <label>Buscar</label>
            <input type="search" id="invQ" placeholder="SKU, posición, lote…">
          </div>
          ${layoutMapHtml(layout, 10)}
          <div class="table-wrap" style="margin-top:1rem">
            <table class="data">
              <thead>
                <tr><th>Material</th><th>Nombre</th><th>Posición</th><th>Cant.</th><th>Lote</th><th>Ingreso</th></tr>
              </thead>
              <tbody id="invBody">
                ${invRows(state.inventario)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function invRows(rows) {
    if (!rows?.length) return '<tr><td colspan="6" class="muted">Sin stock</td></tr>';
    return rows.map((r) => `
      <tr>
        <td><strong>${esc(r.material_codigo)}</strong></td>
        <td>${esc(r.material_nombre || '—')}</td>
        <td>${esc(r.posicion_codigo)}</td>
        <td>${esc(r.cantidad)} ${esc(r.unidad)}</td>
        <td>${esc(r.lote || '—')}</td>
        <td>${esc(String(r.fecha_ingreso || '').slice(0, 16))}</td>
      </tr>
    `).join('');
  }

  function renderEtiquetas() {
    if (!state.bodega) {
      return `<div class="card"><div class="card-body">${bodegaSelect()}</div></div>`;
    }
    const pos = state.bodega.posiciones || [];
    return `
      <div class="card">
        <div class="card-header">
          <h2><i class="fas fa-qrcode"></i> Etiquetas QR — ${esc(state.bodega.codigo)}</h2>
          <button type="button" class="btn btn-outline btn-sm" onclick="window.print()">
            <i class="fas fa-print"></i> Imprimir
          </button>
        </div>
        <div class="card-body">
          ${bodegaSelect()}
          <p class="wms-help">Cada QR contiene el token único de la posición. Escaneable desde Ingreso/Salida.</p>
          ${pos.length ? `
            <div class="wms-qr-print" id="qrPrint">
              ${pos.map((p) => `
                <div class="wms-qr-card">
                  <div class="qr" data-qr="${esc(p.qr_token)}"></div>
                  <div class="code">${esc(p.codigo)}</div>
                  <div class="muted" style="font-size:.65rem">${esc(p.tipo)} N${esc(p.nivel)}</div>
                </div>
              `).join('')}
            </div>
          ` : '<p class="muted">No hay posiciones. Aprueba una propuesta primero.</p>'}
        </div>
      </div>
    `;
  }

  function paintQrCodes() {
    if (typeof QRCode === 'undefined') return;
    document.querySelectorAll('[data-qr]').forEach((el) => {
      if (el.dataset.done) return;
      el.dataset.done = '1';
      el.innerHTML = '';
      try {
        // eslint-disable-next-line no-new
        new QRCode(el, {
          text: el.getAttribute('data-qr'),
          width: 110,
          height: 110,
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (_) { /* ignore */ }
    });
  }

  async function paint() {
    const root = content();
    if (!root) return;
    let body = '';
    if (state.tab === 'bodegas') body = renderBodegas();
    else if (state.tab === 'diseno') body = renderDiseno();
    else if (state.tab === 'propuesta') body = renderPropuesta();
    else if (state.tab === 'operacion') body = renderOperacion();
    else if (state.tab === 'salidas') body = renderSalidas();
    else if (state.tab === 'inventario') body = renderInventario();
    else if (state.tab === 'posiciones') body = renderPosiciones();
    else if (state.tab === 'etiquetas') body = renderEtiquetas();

    root.innerHTML = `
      <div id="wmsFlash" hidden></div>
      ${tabsHtml()}
      ${body}
    `;
    bind();
    if (state.tab === 'etiquetas') {
      setTimeout(paintQrCodes, 80);
    }
    wireMatAutocomplete('inMat', 'dlInMat');
    wireMatAutocomplete('outMat', 'dlOutMat');
    wireMatAutocomplete('trMat', 'dlTrMat');
    // autocomplete para líneas de salida manual
    document.querySelectorAll('.sm-mat').forEach((inp) => {
      inp.setAttribute('list', 'dlSalMat');
      inp.addEventListener('input', async () => {
        const q = inp.value.trim();
        if (q.length < 1) return;
        try {
          const res = await api('/api/catalogos/materiales?q=' + encodeURIComponent(q));
          const dl = document.getElementById('dlSalMat');
          if (dl) {
            dl.innerHTML = (res.data || []).map((m) =>
              `<option value="${esc(m.codigo)}">${esc(m.nombre || '')}</option>`
            ).join('');
          }
        } catch (_) { /* */ }
      });
    });
  }

  async function loadBodegas() {
    const res = await api('/api/modulos/wms/bodegas');
    state.bodegas = res.data || [];
  }

  async function selectBodega(id) {
    if (!id) {
      state.bodega = null;
      state.propuestas = [];
      state.inventario = [];
      state.movimientos = [];
      state.kpis = null;
      state.salidas = [];
      state.salida = null;
      return;
    }
    const res = await api('/api/modulos/wms/bodegas/' + id);
    state.bodega = res.data;
    const props = await api('/api/modulos/wms/bodegas/' + id + '/propuestas');
    state.propuestas = props.data || [];
    const inv = await api('/api/modulos/wms/bodegas/' + id + '/inventario');
    state.inventario = inv.data || [];
    const mov = await api('/api/modulos/wms/bodegas/' + id + '/movimientos');
    state.movimientos = mov.data || [];
    try {
      const k = await api('/api/modulos/wms/bodegas/' + id + '/kpis');
      state.kpis = k.data;
    } catch (_) {
      state.kpis = null;
    }
    try {
      const sal = await api('/api/modulos/wms/salidas?bodega_id=' + id);
      state.salidas = sal.data || [];
    } catch (_) {
      state.salidas = [];
    }
  }

  async function loadSolicitudesPend(q = '') {
    const res = await api(
      '/api/modulos/wms/solicitudes-pendientes' + (q ? '?q=' + encodeURIComponent(q) : '')
    );
    state.solicitudesPend = res.data || [];
  }

  async function openSalida(id) {
    const res = await api('/api/modulos/wms/salidas/' + id);
    state.salida = res.data;
    state.tab = 'salidas';
    await paint();
    document.getElementById('salidaDetalleCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function openPropuesta(id) {
    const res = await api('/api/modulos/wms/propuestas/' + id);
    state.propuesta = res.data;
    state.tab = 'propuesta';
    await paint();
  }

  async function stopScanner() {
    const panel = document.getElementById('scanPanel');
    if (panel) panel.hidden = true;
    if (state.scanner) {
      try { await state.scanner.stop(); } catch (_) { /* */ }
      try { await state.scanner.clear(); } catch (_) { /* */ }
      state.scanner = null;
    }
  }

  async function startScanner(targetId) {
    state.scanTarget = targetId;
    const panel = document.getElementById('scanPanel');
    if (panel) panel.hidden = false;
    if (typeof Html5Qrcode === 'undefined') {
      flash('Escáner no disponible. Escribe el código manualmente.', false);
      return;
    }
    await stopScanner();
    if (panel) panel.hidden = false;
    const scanner = new Html5Qrcode('wmsQrReader');
    state.scanner = scanner;
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 220, height: 220 } },
        async (decoded) => {
          const text = String(decoded || '').trim();
          const input = document.getElementById(state.scanTarget);
          if (!input) return;
          // Si es token QR, resolver a código de posición
          try {
            const look = await api('/api/modulos/wms/posiciones/lookup?qr=' + encodeURIComponent(text)
              + (state.bodega ? '&bodega_id=' + state.bodega.id : ''));
            if (look.data?.codigo) {
              input.value = look.data.codigo;
              input.dataset.qrToken = look.data.qr_token || text;
            } else {
              input.value = text;
              input.dataset.qrToken = text;
            }
          } catch (_) {
            input.value = text;
            input.dataset.qrToken = text;
          }
          flash('Posición leída: ' + input.value);
          await stopScanner();
        },
        () => {}
      );
    } catch (err) {
      flash(err.message || 'No se pudo abrir la cámara', false);
    }
  }

  function bind() {
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.tab = btn.getAttribute('data-tab');
        await stopScanner();
        if (state.tab === 'salidas') {
          try { await loadSolicitudesPend(document.getElementById('solQ')?.value || ''); } catch (_) { /* */ }
        }
        await paint();
      });
    });
    document.querySelectorAll('[data-tab-jump]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.tab = btn.getAttribute('data-tab-jump');
        if (state.tab === 'salidas') {
          try { await loadSolicitudesPend(); } catch (_) { /* */ }
        }
        await paint();
      });
    });

    document.querySelectorAll('[data-open-bod]').forEach((el) => {
      el.addEventListener('click', async () => {
        await selectBodega(el.getAttribute('data-open-bod'));
        state.tab = 'diseno';
        await paint();
      });
    });

    const bodSel = document.getElementById('wmsBodSel');
    if (bodSel) {
      bodSel.addEventListener('change', async () => {
        await selectBodega(bodSel.value);
        await paint();
      });
    }

    const plano = document.getElementById('bodPlano');
    if (plano) {
      plano.addEventListener('change', async () => {
        const f = plano.files?.[0];
        if (!f) return;
        state.planoDataUrl = await fileToDataUrl(f);
        const prev = document.getElementById('bodPlanoPrev');
        if (prev) {
          prev.hidden = false;
          prev.innerHTML = `<img class="wms-plano-preview" src="${state.planoDataUrl}" alt="Vista previa">`;
        }
      });
    }

    const formBod = document.getElementById('formBod');
    if (formBod) {
      formBod.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api('/api/modulos/wms/bodegas', {
            method: 'POST',
            body: JSON.stringify({
              nombre: document.getElementById('bodNombre').value,
              mercado: document.getElementById('bodMercado').value,
              largo_m: document.getElementById('bodLargo').value,
              ancho_m: document.getElementById('bodAncho').value,
              alto_m: document.getElementById('bodAlto').value,
              tipo_almacenaje: document.getElementById('bodTipo').value,
              planoDataUrl: state.planoDataUrl || null
            })
          });
          state.planoDataUrl = null;
          flash(res.message || 'Bodega creada');
          await loadBodegas();
          await selectBodega(res.data.id);
          state.tab = 'diseno';
          await paint();
        } catch (err) {
          flash(err.message || 'Error al crear', false);
        }
      });
    }

    const formProp = document.getElementById('formProp');
    if (formProp) {
      formProp.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.bodega) return;
        try {
          const res = await api('/api/modulos/wms/bodegas/' + state.bodega.id + '/propuestas', {
            method: 'POST',
            body: JSON.stringify({
              tipo_almacenaje: document.getElementById('propTipo').value,
              niveles: document.getElementById('propNiveles').value,
              pos_largo_m: document.getElementById('propLargo').value,
              pos_ancho_m: document.getElementById('propAncho').value,
              pos_alto_m: document.getElementById('propAlto').value,
              pasillo_m: document.getElementById('propPasillo').value,
              notas: document.getElementById('propNotas').value
            })
          });
          flash(res.message || 'Propuesta generada');
          state.propuesta = res.data;
          state.tab = 'propuesta';
          const props = await api('/api/modulos/wms/bodegas/' + state.bodega.id + '/propuestas');
          state.propuestas = props.data || [];
          await paint();
        } catch (err) {
          flash(err.message || 'Error al generar propuesta', false);
        }
      });
    }

    document.querySelectorAll('[data-open-prop]').forEach((btn) => {
      btn.addEventListener('click', () => openPropuesta(btn.getAttribute('data-open-prop')));
    });

    document.getElementById('btnAddPos')?.addEventListener('click', () => {
      const body = document.getElementById('propPosBody');
      if (!body || !state.propuesta) return;
      const n = body.querySelectorAll('tr[data-idx]').length + 1;
      const p = state.propuesta;
      const html = propRow({
        codigo: `POS-X${String(n).padStart(2, '0')}-N1`,
        tipo: p.tipo_almacenaje === 'piso' ? 'piso' : 'rack',
        fila: 'X',
        columna: String(n),
        nivel: 1,
        largo_m: p.pos_largo_m,
        ancho_m: p.pos_ancho_m,
        alto_m: p.pos_alto_m,
        x_m: 0,
        y_m: 0
      }, n - 1, true);
      if (body.querySelector('td.muted')) body.innerHTML = '';
      body.insertAdjacentHTML('beforeend', html);
      body.querySelectorAll('[data-del-pos]').forEach((b) => {
        b.onclick = () => b.closest('tr')?.remove();
      });
    });

    document.querySelectorAll('[data-del-pos]').forEach((b) => {
      b.addEventListener('click', () => b.closest('tr')?.remove());
    });

    document.getElementById('btnSaveProp')?.addEventListener('click', async () => {
      if (!state.propuesta) return;
      try {
        const posiciones = collectPropRows();
        const res = await api('/api/modulos/wms/propuestas/' + state.propuesta.id, {
          method: 'PUT',
          body: JSON.stringify({ posiciones })
        });
        state.propuesta = res.data;
        flash('Propuesta guardada (' + posiciones.length + ' posiciones)');
        await paint();
      } catch (err) {
        flash(err.message || 'Error al guardar', false);
      }
    });

    document.getElementById('btnAprobar')?.addEventListener('click', async () => {
      if (!state.propuesta) return;
      if (!confirm('¿Aprobar propuesta y crear todas las posiciones con QR?')) return;
      try {
        // Guardar ediciones primero
        const posiciones = collectPropRows();
        if (posiciones.length) {
          await api('/api/modulos/wms/propuestas/' + state.propuesta.id, {
            method: 'PUT',
            body: JSON.stringify({ posiciones })
          });
        }
        const res = await api('/api/modulos/wms/propuestas/' + state.propuesta.id + '/aprobar', {
          method: 'POST',
          body: '{}'
        });
        flash(res.message || 'Aprobada');
        state.propuesta = res.data.propuesta;
        await selectBodega(state.bodega.id);
        state.tab = 'etiquetas';
        await paint();
      } catch (err) {
        flash(err.message || 'Error al aprobar', false);
      }
    });

    document.querySelectorAll('[data-scan]').forEach((btn) => {
      btn.addEventListener('click', () => startScanner(btn.getAttribute('data-scan')));
    });
    document.getElementById('btnStopScan')?.addEventListener('click', () => stopScanner());

    document.getElementById('btnSugiere')?.addEventListener('click', async () => {
      if (!state.bodega) return;
      try {
        const res = await api('/api/modulos/wms/posiciones/lookup?sugerir=1&bodega_id=' + state.bodega.id);
        if (!res.data) {
          flash('No hay posiciones libres', false);
          return;
        }
        const inp = document.getElementById('inPos');
        if (inp) {
          inp.value = res.data.codigo;
          inp.dataset.qrToken = res.data.qr_token || '';
        }
        flash('Sugerida (caótico): ' + res.data.codigo);
      } catch (err) {
        flash(err.message || 'Error', false);
      }
    });

    document.getElementById('btnBuscarUbi')?.addEventListener('click', async () => {
      const mat = document.getElementById('outMat')?.value?.trim();
      const box = document.getElementById('outUbicaciones');
      if (!mat || !state.bodega || !box) return;
      try {
        const res = await api(
          '/api/modulos/wms/bodegas/' + state.bodega.id + '/ubicaciones?material_codigo=' + encodeURIComponent(mat)
        );
        const rows = res.data || [];
        if (!rows.length) {
          box.textContent = 'Sin ubicaciones para ese material';
          return;
        }
        box.innerHTML = rows.map((r) =>
          `<div><button type="button" class="btn btn-outline btn-sm" data-pick-pos="${esc(r.posicion_codigo)}" data-qr="${esc(r.qr_token)}">
            ${esc(r.posicion_codigo)}</button> · ${esc(r.cantidad)} ${esc(r.unidad)}</div>`
        ).join('');
        box.querySelectorAll('[data-pick-pos]').forEach((b) => {
          b.addEventListener('click', () => {
            const out = document.getElementById('outPos');
            if (out) {
              out.value = b.getAttribute('data-pick-pos');
              out.dataset.qrToken = b.getAttribute('data-qr') || '';
            }
          });
        });
      } catch (err) {
        box.textContent = err.message || 'Error';
      }
    });

    document.getElementById('formIngreso')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.bodega) return;
      const posInp = document.getElementById('inPos');
      try {
        const res = await api('/api/modulos/wms/ingreso', {
          method: 'POST',
          body: JSON.stringify({
            bodega_id: state.bodega.id,
            material_codigo: document.getElementById('inMat').value,
            material_nombre: document.getElementById('inNombre').value,
            cantidad: document.getElementById('inQty').value,
            unidad: document.getElementById('inUn').value,
            posicion_codigo: posInp.value || null,
            qr_token: posInp.dataset.qrToken || null,
            lote: document.getElementById('inLote').value,
            documento_ref: document.getElementById('inDoc').value,
            modo_captura: posInp.dataset.qrToken ? 'qr' : (posInp.value ? 'manual' : 'sugerido')
          })
        });
        flash(res.message || 'Ingreso OK');
        e.target.reset();
        delete posInp.dataset.qrToken;
        await selectBodega(state.bodega.id);
        await paint();
      } catch (err) {
        flash(err.message || 'Error en ingreso', false);
      }
    });

    document.getElementById('formSalida')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.bodega) return;
      const posInp = document.getElementById('outPos');
      try {
        const res = await api('/api/modulos/wms/salida', {
          method: 'POST',
          body: JSON.stringify({
            bodega_id: state.bodega.id,
            material_codigo: document.getElementById('outMat').value,
            cantidad: document.getElementById('outQty').value,
            posicion_codigo: posInp.value || null,
            qr_token: posInp.dataset.qrToken || null,
            documento_ref: document.getElementById('outDoc').value,
            modo_captura: posInp.dataset.qrToken ? 'qr' : (posInp.value ? 'manual' : 'sistema')
          })
        });
        flash(res.message || 'Salida OK');
        e.target.reset();
        const ubi = document.getElementById('outUbicaciones');
        if (ubi) ubi.innerHTML = '';
        delete posInp.dataset.qrToken;
        await selectBodega(state.bodega.id);
        await paint();
      } catch (err) {
        flash(err.message || 'Error en salida', false);
      }
    });

    document.getElementById('formTraslado')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.bodega) return;
      const origen = document.getElementById('trOrigen');
      const destino = document.getElementById('trDestino');
      try {
        const res = await api('/api/modulos/wms/traslado', {
          method: 'POST',
          body: JSON.stringify({
            bodega_id: state.bodega.id,
            material_codigo: document.getElementById('trMat').value,
            cantidad: document.getElementById('trQty').value,
            posicion_origen_codigo: origen.value,
            qr_origen: origen.dataset.qrToken || null,
            posicion_destino_codigo: destino.value || null,
            qr_destino: destino.dataset.qrToken || null,
            sugerir_destino: !destino.value,
            modo_captura: (origen.dataset.qrToken || destino.dataset.qrToken) ? 'qr' : 'manual'
          })
        });
        flash(res.message || 'Traslado OK');
        e.target.reset();
        delete origen.dataset.qrToken;
        delete destino.dataset.qrToken;
        await selectBodega(state.bodega.id);
        await paint();
      } catch (err) {
        flash(err.message || 'Error en traslado', false);
      }
    });

    async function applyBloqueo(codigo, estado, qrToken) {
      if (!state.bodega) return;
      const res = await api('/api/modulos/wms/posiciones/estado', {
        method: 'POST',
        body: JSON.stringify({
          bodega_id: state.bodega.id,
          posicion_codigo: codigo || null,
          qr_token: qrToken || null,
          estado
        })
      });
      flash(res.message || 'Estado actualizado');
      await selectBodega(state.bodega.id);
      await paint();
    }

    document.getElementById('formBloqueo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inp = document.getElementById('blkPos');
      try {
        await applyBloqueo(
          inp.value,
          document.getElementById('blkEstado').value,
          inp.dataset.qrToken || null
        );
        e.target.reset();
        delete inp.dataset.qrToken;
      } catch (err) {
        flash(err.message || 'Error', false);
      }
    });

    document.querySelectorAll('[data-blk]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await applyBloqueo(btn.getAttribute('data-blk'), btn.getAttribute('data-est'));
        } catch (err) {
          flash(err.message || 'Error', false);
        }
      });
    });

    /* ---- Salidas ---- */
    document.getElementById('btnBuscarSol')?.addEventListener('click', async () => {
      try {
        await loadSolicitudesPend(document.getElementById('solQ')?.value || '');
        await paint();
      } catch (err) {
        flash(err.message || 'Error al buscar solicitudes', false);
      }
    });

    document.querySelectorAll('[data-crear-sal-sol]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!state.bodega) return;
        try {
          const res = await api('/api/modulos/wms/salidas', {
            method: 'POST',
            body: JSON.stringify({
              bodega_id: state.bodega.id,
              solicitud_id: Number(btn.getAttribute('data-crear-sal-sol'))
            })
          });
          flash(res.message || 'Salida creada');
          state.salida = res.data;
          await selectBodega(state.bodega.id);
          await paint();
        } catch (err) {
          flash(err.message || 'Error', false);
        }
      });
    });

    document.getElementById('btnAddSalLine')?.addEventListener('click', () => {
      const box = document.getElementById('salManualLines');
      if (!box) return;
      box.insertAdjacentHTML('beforeend', `
        <div class="form-row cols-3 sal-line">
          <div class="form-group">
            <label>Material</label>
            <input class="sm-mat" required placeholder="SKU" list="dlSalMat">
          </div>
          <div class="form-group">
            <label>Cantidad</label>
            <input class="sm-qty" type="number" step="0.001" min="0.001" value="1" required>
          </div>
          <div class="form-group">
            <label>Unidad</label>
            <input class="sm-un" value="UN">
          </div>
        </div>
      `);
    });

    document.getElementById('formSalManual')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.bodega) return;
      const lineas = [...document.querySelectorAll('#salManualLines .sal-line')].map((row) => ({
        material_codigo: row.querySelector('.sm-mat')?.value,
        cantidad: row.querySelector('.sm-qty')?.value,
        unidad: row.querySelector('.sm-un')?.value || 'UN'
      })).filter((l) => l.material_codigo && Number(l.cantidad) > 0);
      try {
        const res = await api('/api/modulos/wms/salidas', {
          method: 'POST',
          body: JSON.stringify({
            bodega_id: state.bodega.id,
            lineas,
            quien_retira: document.getElementById('smRetira')?.value,
            despacho_conductor: document.getElementById('smCond')?.value,
            despacho_patente: document.getElementById('smPat')?.value
          })
        });
        flash(res.message || 'Salida creada');
        state.salida = res.data;
        await selectBodega(state.bodega.id);
        await paint();
      } catch (err) {
        flash(err.message || 'Error', false);
      }
    });

    document.querySelectorAll('[data-open-sal]').forEach((btn) => {
      btn.addEventListener('click', () => openSalida(btn.getAttribute('data-open-sal')));
    });

    document.getElementById('btnConfirmarSal')?.addEventListener('click', async () => {
      if (!state.salida) return;
      if (!confirm('¿Confirmar despacho? Se descontará stock de las posiciones (pick caótico).')) return;
      const lineas = (state.salida.detalle || []).map((d) => {
        const inp = document.getElementById('posLn_' + d.id);
        return {
          id: d.id,
          posicion_codigo: inp?.value || null,
          qr_token: inp?.dataset?.qrToken || null
        };
      });
      try {
        const res = await api('/api/modulos/wms/salidas/' + state.salida.id + '/confirmar', {
          method: 'POST',
          body: JSON.stringify({
            lineas,
            quien_retira: document.getElementById('salRetira')?.value,
            despacho_conductor: document.getElementById('salCond')?.value,
            despacho_patente: document.getElementById('salPat')?.value
          })
        });
        flash(res.message || 'Despacho confirmado');
        if (res.data?.errores?.length) {
          flash(res.data.errores.join(' · '), false);
        }
        state.salida = res.data.salida;
        await selectBodega(state.bodega.id);
        await paint();
      } catch (err) {
        flash(err.message || 'Error al confirmar', false);
      }
    });

    document.getElementById('btnAnularSal')?.addEventListener('click', async () => {
      if (!state.salida) return;
      if (!confirm('¿Anular esta salida en borrador?')) return;
      try {
        const res = await api('/api/modulos/wms/salidas/' + state.salida.id + '/anular', {
          method: 'POST',
          body: '{}'
        });
        flash(res.message || 'Anulada');
        state.salida = res.data;
        await selectBodega(state.bodega.id);
        await paint();
      } catch (err) {
        flash(err.message || 'Error', false);
      }
    });

    const invQ = document.getElementById('invQ');
    if (invQ) {
      let t;
      invQ.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          if (!state.bodega) return;
          const q = invQ.value.trim();
          const res = await api(
            '/api/modulos/wms/bodegas/' + state.bodega.id + '/inventario' + (q ? '?q=' + encodeURIComponent(q) : '')
          );
          const body = document.getElementById('invBody');
          if (body) body.innerHTML = invRows(res.data || []);
        }, 250);
      });
    }
  }

  async function boot() {
    const root = content();
    if (!root) return;
    root.innerHTML = '<p class="muted" style="padding:1rem">Cargando WMS…</p>';
    try {
      const meta = await api('/api/modulos/wms/meta');
      state.meta = meta.data;
      await loadBodegas();
      if (state.bodegas.length === 1) await selectBodega(state.bodegas[0].id);
      await paint();
    } catch (err) {
      root.innerHTML = `<div class="card"><div class="card-body">
        <p class="wms-flash err" style="display:block">${esc(err.message || 'No se pudo cargar WMS')}</p>
        <p class="muted">Asegura que el módulo esté habilitado en Configuraciones → roles / módulos empresa.</p>
      </div></div>`;
    }
  }

  window.WmsApp = { boot };
})();
