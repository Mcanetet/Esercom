/**
 * Catálogo por letra — UI (usa window.CATALOGO_CFG).
 */
(function () {
  const CFG = Object.assign({
    letter: 'G',
    slug: 'global',
    page: 'catalogo-g.html',
    api: '/api/modulos/catalogo-g',
    label: 'Catálogo G',
    empresaNombre: 'Global',
    storageKey: 'cg_view',
    pageExport: 'CatalogoGPage'
  }, window.CATALOGO_CFG || {});


  const ESTADOS_FALLBACK = ['Nuevo', 'Usado', 'Chatarra', 'Venta a Tercero', 'Revisar'];
  const state = {
    canEdit: false,
    estados: ESTADOS_FALLBACK,
    bodegas: [],
    stats: { total: 0, total_cantidad: 0, por_estado: [], por_bodega: [] },
    rows: [],
    q: '',
    filtroEstado: '',
    filtroBodega: '',
    view: localStorage.getItem(CFG.storageKey) || 'list',
    editId: null,
    fotosPendientes: [], // { id, src, hash, tipo: 'articulo'|'marca' }
    fotoTipoActivo: 'articulo',
    fotoAlerta: null,
    forzarFotoDup: false,
    modalMode: null // 'item' | 'excel' | 'detail'
  };

  let fotoSeq = 1;

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colorEstado(e) {
    if (e === 'Nuevo') return '#059669';
    if (e === 'Usado') return '#2563eb';
    if (e === 'Chatarra') return '#64748b';
    if (e === 'Venta a Tercero') return '#b45309';
    if (e === 'Revisar') return '#ca8a04';
    return '#475569';
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });
  }

  /** Comprime a JPEG bajo ~400KB para evitar 413 del hosting. */
  function compressDataUrl(dataUrl, maxSide = 1280, quality = 0.72, maxChars = 520000) {
    return new Promise((resolve) => {
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        resolve(dataUrl);
        return;
      }
      if (/image\/(gif|svg)/i.test(dataUrl.slice(0, 40))) {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          let side = maxSide;
          let q = quality;
          let best = dataUrl;
          for (let i = 0; i < 8; i++) {
            let w = img.width;
            let h = img.height;
            if (!w || !h) break;
            const scale = Math.min(1, side / Math.max(w, h));
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const out = canvas.toDataURL('image/jpeg', q);
            if (out) best = out;
            if (best.length <= maxChars) break;
            side = Math.max(640, Math.round(side * 0.78));
            q = Math.max(0.45, q - 0.08);
          }
          resolve(best);
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function sha256FromDataUrl(dataUrl) {
    const m = String(dataUrl || '').match(/^data:image\/[^;]+;base64,(.+)$/i);
    if (!m) return null;
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!window.crypto?.subtle) return null;
    const dig = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function statusFotoOkHtml() {
    return '<div class="cg-alerta-box is-ok"><i class="fas fa-check-circle"></i> <strong>OK</strong> — foto lista, sin duplicados.</div>';
  }

  function statusFotoRevisandoHtml() {
    return '<div class="cg-alerta-box"><i class="fas fa-spinner fa-spin"></i> Revisando foto…</div>';
  }

  function statusAngelLeyendoHtml() {
    return '<div class="cg-alerta-box"><i class="fas fa-robot"></i> <i class="fas fa-spinner fa-spin"></i> Angel está leyendo la foto…</div>';
  }

  function statusAngelOkHtml(sug) {
    const bits = [sug.descripcion, sug.marca, sug.modelo].filter(Boolean).join(' · ');
    return `<div class="cg-alerta-box is-ok"><i class="fas fa-robot"></i> <strong>Angel</strong> — ${esc(bits || 'datos detectados')}${sug.nota ? `<br><span style="font-size:.85em;opacity:.85">${esc(sug.nota)}</span>` : ''}</div>`;
  }

  function litField(id, value, delayMs) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const el = document.getElementById(id);
        if (!el || !value) {
          resolve(false);
          return;
        }
        const empty = !String(el.value || '').trim();
        if (!empty) {
          resolve(false);
          return;
        }
        el.value = value;
        el.classList.remove('cg-ai-lit');
        // force reflow for animation restart
        void el.offsetWidth;
        el.classList.add('cg-ai-lit');
        resolve(true);
      }, delayMs || 0);
    });
  }

  async function applyAngelSuggestion(sug) {
    if (!sug) return;
    let n = 0;
    if (await litField('cgDescripcion', sug.descripcion, 120)) n += 1;
    if (await litField('cgMarca', sug.marca, 320)) n += 1;
    if (await litField('cgModelo', sug.modelo, 520)) n += 1;
    if (n) UI.flash('Angel completó ' + n + ' campo' + (n === 1 ? '' : 's'));
  }

  function filteredRows() {
    const q = state.q.trim().toLowerCase();
    return state.rows.filter((r) => {
      if (state.filtroEstado && String(r.estado) !== state.filtroEstado) return false;
      if (state.filtroBodega) {
        const b = String(r.bodega || '').trim() || 'Sin bodega';
        if (b !== state.filtroBodega) return false;
      }
      if (!q) return true;
      const hay = [r.codigo, r.empresa, r.descripcion, r.bodega, r.estado, r.marca, r.modelo]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }

  function bodegaOptions(selected) {
    const sel = String(selected || '');
    const opts = state.bodegas.map((b) => {
      const n = b.nombre || '';
      return `<option value="${esc(n)}" ${sel === n ? 'selected' : ''}>${esc(n)}</option>`;
    }).join('');
    const extra = sel && !state.bodegas.some((b) => b.nombre === sel)
      ? `<option value="${esc(sel)}" selected>${esc(sel)}</option>`
      : '';
    return `<option value="">Seleccione bodega…</option>${extra}${opts}`;
  }

  function heroHtml() {
    const s = state.stats;
    return `
      <section class="cg-hero">
        <div class="cg-hero-top">
          <div>
            <h2>Inventario Global</h2>
            <p>Explora por tipo y bodega. Toca un chip para filtrar, cambia entre grilla o lista.</p>
          </div>
          <div class="cg-hero-metrics">
            <div class="cg-hero-metric"><b>${s.total || 0}</b><span>Artículos</span></div>
            <div class="cg-hero-metric"><b>${Number(s.total_cantidad || 0)}</b><span>Unidades</span></div>
            <div class="cg-hero-metric"><b>${(s.por_bodega || []).length}</b><span>Bodegas</span></div>
          </div>
        </div>
      </section>`;
  }

  function toolbarHtml() {
    return `
      <div class="cg-toolbar">
        <div class="cg-search">
          <i class="fas fa-search"></i>
          <input id="cgSearch" type="search" placeholder="Buscar producto, empresa, código…" value="${esc(state.q)}" autocomplete="off">
        </div>
        <div class="cg-view-toggle" role="group" aria-label="Vista">
          <button type="button" data-view="grid" class="${state.view === 'grid' ? 'is-active' : ''}" title="Grilla"><i class="fas fa-border-all"></i></button>
          <button type="button" data-view="list" class="${state.view === 'list' ? 'is-active' : ''}" title="Lista"><i class="fas fa-list"></i></button>
        </div>
        ${state.canEdit ? `
          <div class="cg-actions">
            <button type="button" class="cg-btn cg-btn-primary" id="cgBtnNuevo"><i class="fas fa-plus"></i> Nuevo</button>
            <button type="button" class="cg-btn cg-btn-success" id="cgBtnExcel"><i class="fas fa-file-excel"></i> Excel</button>
            <button type="button" class="cg-btn cg-btn-ghost" id="cgBtnPlantilla"><i class="fas fa-download"></i> Plantilla</button>
          </div>` : ''}
      </div>`;
  }

  function filtersHtml() {
    const estados = (state.stats.por_estado || []).map((s) => `
      <button type="button" class="cg-chip ${state.filtroEstado === s.estado ? 'is-active' : ''}"
        data-kind="estado" data-tone="${esc(s.estado)}" data-value="${esc(s.estado)}">
        ${esc(s.estado)} <span class="cg-count">${s.articulos}</span>
      </button>`).join('');
    const bodegas = (state.stats.por_bodega || []).map((s) => `
      <button type="button" class="cg-chip ${state.filtroBodega === s.bodega ? 'is-active' : ''}"
        data-kind="bodega" data-value="${esc(s.bodega)}">
        <i class="fas fa-warehouse" style="font-size:.7rem;opacity:.7"></i>
        ${esc(s.bodega)} <span class="cg-count">${s.articulos}</span>
      </button>`).join('');
    return `
      <div class="cg-filters">
        <div class="cg-filter-block">
          <h3>Por tipo</h3>
          <div class="cg-chips">
            <button type="button" class="cg-chip cg-chip-all ${!state.filtroEstado ? 'is-active' : ''}" data-kind="estado" data-value="">
              Todos <span class="cg-count">${state.stats.total || 0}</span>
            </button>
            ${estados}
          </div>
        </div>
        <div class="cg-filter-block">
          <h3>Por bodega</h3>
          <div class="cg-chips">
            <button type="button" class="cg-chip cg-chip-all ${!state.filtroBodega ? 'is-active' : ''}" data-kind="bodega" data-value="">
              Todas
            </button>
            ${bodegas || '<span style="color:var(--cg-muted);font-size:.85rem">Sin bodegas aún</span>'}
          </div>
        </div>
      </div>`;
  }

  function correlativoLabel(r) {
    if (r.correlativo) return String(r.correlativo).padStart(5, '0');
    const m = String(r.codigo || '').match(/(\d+)\s*$/);
    if (m) return m[1].padStart(5, '0');
    return String(r.id || '—').padStart(5, '0');
  }

  function cardHtml(r, i) {
    const estado = r.estado || 'Nuevo';
    const all = itemFotos(r);
    const gallery = JSON.stringify(all.map((f) => f.src)).replace(/"/g, '&quot;');
    const media = all[0]
      ? `<img src="${esc(all[0].src)}" alt="" loading="lazy">`
      : `<div class="cg-card-ph"><i class="fas fa-box-open"></i></div>`;
    const fotoBtn = all.length
      ? `<button type="button" class="cg-foto-btn cg-foto-btn-card" data-zoom-gallery="${gallery}" title="Ver fotos" onclick="event.stopPropagation()">
           <i class="fas fa-camera"></i>${all.length > 1 ? `<span class="cg-foto-count">${all.length}</span>` : ''}
         </button>`
      : '';
    const marcaLine = [r.marca, r.modelo].filter(Boolean).join(' · ');
    return `
      <article class="cg-card" data-id="${r.id}" style="animation-delay:${Math.min(i, 12) * 0.03}s" tabindex="0">
        <div class="cg-card-media">
          <span class="cg-badge" style="background:${colorEstado(estado)}">${esc(estado)}</span>
          <span class="cg-qty">${esc(r.cantidad)} uds</span>
          ${fotoBtn}
          ${media}
        </div>
        <div class="cg-card-body">
          <div class="cg-card-code">N° ${esc(correlativoLabel(r))} · ${esc(r.codigo || '')}</div>
          <h3 class="cg-card-title">${esc(r.descripcion)}</h3>
          ${marcaLine ? `<div class="cg-card-marca"><i class="fas fa-tag"></i> ${esc(marcaLine)}</div>` : ''}
          <div class="cg-card-meta">
            <span class="cg-pill"><i class="fas fa-building"></i> ${esc(r.empresa || '—')}</span>
            <span class="cg-pill"><i class="fas fa-warehouse"></i> ${esc(r.bodega || 'Sin bodega')}</span>
          </div>
          ${state.canEdit ? `
            <div class="cg-card-actions" onclick="event.stopPropagation()">
              <button type="button" class="cg-btn cg-btn-ghost" data-edit="${r.id}"><i class="fas fa-pen"></i> Editar</button>
              <button type="button" class="cg-btn cg-btn-danger" data-del="${r.id}"><i class="fas fa-trash"></i></button>
            </div>` : ''}
        </div>
      </article>`;
  }

  function itemFotos(item) {
    if (!item) return [];
    if (Array.isArray(item.fotos) && item.fotos.length) {
      return item.fotos.map((f) => ({
        id: 'ex-' + (f.ruta || Math.random()),
        src: f.ruta,
        hash: f.hash || null,
        tipo: f.tipo === 'marca' ? 'marca' : 'articulo'
      }));
    }
    if (item.foto) {
      return [{ id: 'ex-main', src: item.foto, hash: item.foto_hash || null, tipo: 'articulo' }];
    }
    return [];
  }

  function fotosDeTipo(tipo) {
    return state.fotosPendientes.filter((f) => f.tipo === tipo);
  }

  function fotoStripHtml(tipo, titulo, hint) {
    const fotos = fotosDeTipo(tipo);
    const thumbs = fotos.map((f) => `
      <div class="cg-thumb">
        <img src="${esc(f.src)}" alt="" data-zoom="${esc(f.src)}">
        <button type="button" class="cg-thumb-del" data-foto-del="${esc(f.id)}" title="Quitar">&times;</button>
        <span class="cg-thumb-tag">${tipo === 'marca' ? 'Marca' : 'Art.'}</span>
      </div>`).join('');
    return `
      <div class="form-group cg-fotos-block" data-foto-tipo="${tipo}">
        <label>${esc(titulo)} <span class="muted">(${fotos.length}/6)</span></label>
        <div class="cg-thumbs" id="cgThumbs-${tipo}">${thumbs || '<p class="cg-fotos-empty">Sin fotos aún</p>'}</div>
        <div class="cg-foto-actions">
          <input type="file" class="cg-foto-input" data-tipo="${tipo}" data-mode="camara" accept="image/*" capture="environment" hidden multiple>
          <input type="file" class="cg-foto-input" data-tipo="${tipo}" data-mode="galeria" accept="image/*" hidden multiple>
          <button type="button" class="cg-btn cg-btn-primary" data-foto-pick="${tipo}" data-mode="camara">
            <i class="fas fa-camera"></i> Cámara
          </button>
          <button type="button" class="cg-btn cg-btn-ghost" data-foto-pick="${tipo}" data-mode="galeria">
            <i class="fas fa-images"></i> Galería
          </button>
          <p class="cg-foto-hint">${esc(hint)}</p>
        </div>
      </div>`;
  }

  function rowHtml(r, i) {
    const estado = r.estado || 'Nuevo';
    const all = itemFotos(r);
    const gallery = JSON.stringify(all.map((f) => f.src)).replace(/"/g, '&quot;');
    const fotoBtn = all.length
      ? `<button type="button" class="cg-foto-btn" data-zoom-gallery="${gallery}" title="Ver fotos (${all.length})" aria-label="Ver fotos">
           <i class="fas fa-camera"></i>
           ${all.length > 1 ? `<span class="cg-foto-count">${all.length}</span>` : ''}
         </button>`
      : `<span class="cg-foto-btn is-empty" title="Sin foto"><i class="fas fa-image"></i></span>`;
    const marcaLine = [r.marca, r.modelo].filter(Boolean).join(' · ');
    return `
      <article class="cg-row" data-id="${r.id}" style="animation-delay:${Math.min(i, 12) * 0.025}s" tabindex="0">
        <div class="cg-row-foto" onclick="event.stopPropagation()">${fotoBtn}</div>
        <div class="cg-row-main">
          <div class="cg-row-top">
            <span class="cg-row-code">N° ${esc(correlativoLabel(r))}</span>
            <span class="cg-badge-inline" style="background:${colorEstado(estado)}">${esc(estado)}</span>
            <strong class="cg-row-qty">${esc(r.cantidad)} uds</strong>
          </div>
          <h4>${esc(r.descripcion)}</h4>
          ${marcaLine ? `<p class="cg-row-marca"><i class="fas fa-tag"></i> ${esc(marcaLine)}</p>` : ''}
          <p>${esc(r.codigo || '—')} · ${esc(r.empresa || '—')} · ${esc(r.bodega || 'Sin bodega')}</p>
        </div>
        ${state.canEdit ? `
          <div class="cg-row-actions" onclick="event.stopPropagation()">
            <button type="button" class="cg-btn cg-btn-ghost" data-edit="${r.id}" title="Editar"><i class="fas fa-pen"></i></button>
            <button type="button" class="cg-btn cg-btn-danger" data-del="${r.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
          </div>` : ''}
      </article>`;
  }

  function catalogHtml(rows) {
    if (!rows.length) {
      return `
        <div class="cg-empty">
          <i class="fas fa-boxes-stacked"></i>
          <h3>No hay artículos con estos filtros</h3>
          <p>Prueba quitar filtros o crea un ítem nuevo.</p>
          ${state.canEdit ? `<button type="button" class="cg-btn cg-btn-primary" id="cgEmptyNuevo"><i class="fas fa-plus"></i> Crear primero</button>` : ''}
        </div>`;
    }
    if (state.view === 'list') {
      return `<div class="cg-list">${rows.map(rowHtml).join('')}</div>`;
    }
    return `<div class="cg-grid">${rows.map(cardHtml).join('')}</div>`;
  }

  function resultBarHtml(n) {
    const active = state.filtroEstado || state.filtroBodega || state.q;
    return `
      <div class="cg-result-bar">
        <span><strong>${n}</strong> resultado${n === 1 ? '' : 's'}</span>
        ${active ? `<button type="button" class="cg-clear" id="cgClearFilters">Limpiar filtros</button>` : ''}
      </div>`;
  }

  function itemFormHtml(item) {
    const isEdit = !!(item && item.id);
    const corr = item ? correlativoLabel(item) : '(nuevo)';
    const alerta = state.fotoAlerta;
    return `
      <form id="cgForm" class="cg-form-grid">
        <div class="cg-corr-banner">
          <i class="fas fa-hashtag"></i>
          Correlativo: <strong>${isEdit ? 'N° ' + esc(corr) : 'Se asignará al guardar'}</strong>
          ${isEdit && item?.codigo ? `<span class="muted">· ${esc(item.codigo)}</span>` : ''}
        </div>
        <div class="form-group"><label>Empresa *</label>
          <input id="cgEmpresa" required value="${esc(item?.empresa || 'Global')}">
        </div>
        <div class="form-group"><label>Descripción del producto *</label>
          <textarea id="cgDescripcion" required rows="3">${esc(item?.descripcion || '')}</textarea>
        </div>
        <div class="form-row cols-2">
          <div class="form-group"><label>Cantidad *</label>
            <input id="cgCantidad" type="number" step="0.01" min="0" required value="${esc(item?.cantidad ?? 1)}">
          </div>
          <div class="form-group"><label>Bodega *</label>
            <select id="cgBodega" required>${bodegaOptions(item?.bodega)}</select>
          </div>
        </div>
        <div class="form-group"><label>Estado / tipo *</label>
          <select id="cgEstado">${state.estados.map((e) =>
            `<option value="${esc(e)}" ${(item?.estado || 'Nuevo') === e ? 'selected' : ''}>${esc(e)}</option>`
          ).join('')}</select>
        </div>
        <div class="form-row cols-2">
          <div class="form-group"><label>Marca</label>
            <input id="cgMarca" placeholder="Ej: Bosch, Samsung…" value="${esc(item?.marca || '')}">
          </div>
          <div class="form-group"><label>Modelo</label>
            <input id="cgModelo" placeholder="Ej: GSB 13 RE…" value="${esc(item?.modelo || '')}">
          </div>
        </div>
        <div class="form-group"><label>Observación</label>
          <textarea id="cgObservaciones" rows="2" placeholder="Detalle, condición, ubicación, notas…">${esc(item?.observaciones || '')}</textarea>
        </div>
        ${fotoStripHtml('articulo', 'Fotos del artículo', 'Angel lee la foto y completa nombre / marca / modelo si están vacío.')}
        ${fotoStripHtml('marca', 'Fotos de marca / modelo', 'Angel prioriza etiqueta, logo o placa de marca/modelo.')}
        <div id="cgFotoAlerta" class="cg-foto-alerta" ${alerta || state.fotosPendientes.length ? '' : 'hidden'}>
          ${alerta ? fotoAlertaHtml(alerta) : (state.fotosPendientes.length ? statusFotoOkHtml() : '')}
        </div>
      </form>`;
  }

  function fotoAlertaHtml(alerta) {
    const dups = (alerta.duplicados || []).map((d) =>
      `<li><strong>${esc(d.codigo || ('N° ' + d.correlativo))}</strong> — ${esc(d.descripcion || '')}</li>`
    ).join('');
    return `
      <div class="cg-alerta-box ${alerta.nivel === 'exacta' ? 'is-exact' : 'is-similar'}">
        <div class="cg-alerta-title"><i class="fas fa-exclamation-triangle"></i> <strong>Artículo duplicado — revisar</strong></div>
        <p style="margin:.35rem 0 0;font-size:.9rem">${esc(alerta.mensaje || 'Esta foto ya existe en otro artículo.')}</p>
        ${dups ? `<ul>${dups}</ul>` : ''}
        <label class="cg-force-dup">
          <input type="checkbox" id="cgForzarFoto" ${state.forzarFotoDup ? 'checked' : ''}>
          Usar esta foto de todas formas
        </label>
      </div>`;
  }

  function excelFormHtml() {
    return `
      <div class="cg-form-grid">
        <p style="margin:0;color:var(--cg-muted);font-size:.9rem">
          Columnas: <strong>Empresa</strong>, <strong>Descripcion</strong>, <strong>Cantidad</strong>, <strong>Bodega</strong>, <strong>Estado</strong>.
          Los ítems se agregan al inventario actual.
        </p>
        <div class="cg-drop" id="cgDrop">
          <i class="fas fa-cloud-arrow-up"></i>
          <p><strong>Arrastra tu Excel aquí</strong><br>o toca para seleccionar (.xlsx)</p>
          <input type="file" id="cgExcelFile" accept=".xlsx,.xls" hidden>
        </div>
        <button type="button" class="cg-btn cg-btn-ghost" id="cgModalPlantilla" style="justify-content:center">
          <i class="fas fa-download"></i> Descargar plantilla
        </button>
      </div>`;
  }

  function detailHtml(item) {
    if (!item) return '';
    const estado = item.estado || 'Nuevo';
    const all = itemFotos(item);
    const arts = all.filter((f) => f.tipo === 'articulo');
    const marcas = all.filter((f) => f.tipo === 'marca');
    const strip = (arr, label) => !arr.length ? '' : `
      <div class="cg-detail-fotos">
        <h4>${esc(label)}</h4>
        <div class="cg-thumbs">
          ${arr.map((f) => `<button type="button" class="cg-thumb is-btn" data-zoom="${esc(f.src)}"><img src="${esc(f.src)}" alt=""></button>`).join('')}
        </div>
      </div>`;
    return `
      <div class="cg-form-grid">
        ${all[0]
          ? `<div class="cg-card-media" style="border-radius:12px;aspect-ratio:16/10">
               <img src="${esc(all[0].src)}" alt="" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in" data-zoom="${esc(all[0].src)}">
               <span class="cg-badge" style="background:${colorEstado(estado)}">${esc(estado)}</span>
             </div>`
          : `<div class="cg-card-media" style="border-radius:12px;aspect-ratio:16/10"><div class="cg-card-ph"><i class="fas fa-box-open"></i></div>
               <span class="cg-badge" style="background:${colorEstado(estado)}">${esc(estado)}</span></div>`}
        <div>
          <div class="cg-card-code">N° ${esc(correlativoLabel(item))} · ${esc(item.codigo || '—')}</div>
          <h3 style="margin:.25rem 0 .65rem">${esc(item.descripcion)}</h3>
          <div class="cg-card-meta">
            <span class="cg-pill" style="background:${colorEstado(estado)};color:#fff"><i class="fas fa-circle"></i> ${esc(estado)}</span>
            <span class="cg-pill"><i class="fas fa-building"></i> ${esc(item.empresa || '—')}</span>
            <span class="cg-pill"><i class="fas fa-warehouse"></i> ${esc(item.bodega || 'Sin bodega')}</span>
            <span class="cg-pill"><i class="fas fa-cubes"></i> ${esc(item.cantidad)} uds</span>
            ${item.marca ? `<span class="cg-pill"><i class="fas fa-tag"></i> ${esc(item.marca)}</span>` : ''}
            ${item.modelo ? `<span class="cg-pill"><i class="fas fa-barcode"></i> ${esc(item.modelo)}</span>` : ''}
          </div>
          <div class="cg-detail-obs">
            <h4>Observación</h4>
            <p>${item.observaciones ? esc(item.observaciones) : '<span class="muted">Sin observación</span>'}</p>
          </div>
        </div>
        ${strip(arts, 'Fotos del artículo')}
        ${strip(marcas, 'Marca / modelo')}
      </div>`;
  }

  function modalHtml() {
    if (!state.modalMode) return '<div id="cgOverlay" class="cg-overlay" hidden></div>';
    let title = '';
    let body = '';
    let foot = '';
    if (state.modalMode === 'item') {
      const item = state.editId ? state.rows.find((x) => Number(x.id) === Number(state.editId)) : null;
      title = item ? 'Editar artículo' : 'Nuevo artículo';
      body = itemFormHtml(item);
      foot = `
        <button type="button" class="cg-btn cg-btn-ghost" data-close-modal>Cancelar</button>
        <button type="submit" form="cgForm" class="cg-btn cg-btn-primary">${item ? 'Guardar' : 'Crear'}</button>`;
    } else if (state.modalMode === 'excel') {
      title = 'Cargar inventario Excel';
      body = excelFormHtml();
      foot = `<button type="button" class="cg-btn cg-btn-ghost" data-close-modal>Cerrar</button>`;
    } else if (state.modalMode === 'detail') {
      const item = state.rows.find((x) => Number(x.id) === Number(state.editId));
      title = 'Detalle';
      body = detailHtml(item);
      foot = `
        <button type="button" class="cg-btn cg-btn-ghost" data-close-modal>Cerrar</button>
        ${state.canEdit ? `<button type="button" class="cg-btn cg-btn-primary" data-edit="${state.editId}"><i class="fas fa-pen"></i> Editar</button>` : ''}`;
    }
    return `
      <div id="cgOverlay" class="cg-overlay" role="dialog" aria-modal="true">
        <div class="cg-sheet" onclick="event.stopPropagation()">
          <div class="cg-sheet-head">
            <h3>${title}</h3>
            <button type="button" class="cg-sheet-close" data-close-modal aria-label="Cerrar"><i class="fas fa-times"></i></button>
          </div>
          <div class="cg-sheet-body">${body}</div>
          <div class="cg-sheet-foot">${foot}</div>
        </div>
      </div>`;
  }

  function paint() {
    const content = document.getElementById('app-content');
    if (!content) return;
    const rows = filteredRows();
    content.innerHTML = `
      <div class="cg-page">
        <div id="flash"></div>
        ${heroHtml()}
        ${toolbarHtml()}
        ${filtersHtml()}
        ${resultBarHtml(rows.length)}
        ${!state.canEdit ? `<div class="alert alert-info" style="margin-bottom:.85rem">Solo lectura. Edición: Admin / Subadmin, rol ${CFG.label} o permiso editor.</div>` : ''}
        ${catalogHtml(rows)}
        ${modalHtml()}
        <div id="cgLightbox" hidden>
          <button type="button" class="cg-lb-nav prev" data-lb-nav="-1" aria-label="Anterior"><i class="fas fa-chevron-left"></i></button>
          <img alt="Foto ampliada">
          <button type="button" class="cg-lb-nav next" data-lb-nav="1" aria-label="Siguiente"><i class="fas fa-chevron-right"></i></button>
          <div class="cg-lb-caption"></div>
        </div>
      </div>`;
    bind();
  }

  function openItemModal(id) {
    state.modalMode = 'item';
    state.editId = id || null;
    const item = id ? state.rows.find((x) => Number(x.id) === Number(id)) : null;
    state.fotosPendientes = itemFotos(item);
    state.fotoTipoActivo = 'articulo';
    state.fotoAlerta = null;
    state.forzarFotoDup = false;
    paint();
  }

  function closeModal() {
    state.modalMode = null;
    state.editId = null;
    state.fotosPendientes = [];
    state.fotoAlerta = null;
    state.forzarFotoDup = false;
    paint();
  }

  async function downloadPlantilla() {
    const token = Auth.getToken();
    const res = await fetch(CFG.api + '/plantilla', {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    if (!res.ok) throw new Error('No se pudo descargar la plantilla');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plantilla_' + CFG.api.split('/').pop() + '.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importExcel(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name) && !/\.xls$/i.test(file.name)) {
      UI.flash('Seleccione un archivo Excel (.xlsx)', true);
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    const res = await Auth.api(CFG.api + '/import-excel', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, filename: file.name })
    });
    UI.flash(`Excel cargado: ${res.total} ítems`);
    state.modalMode = null;
    await boot(false);
  }

  async function saveItem(item) {
    const exactDup = state.fotoAlerta && state.fotoAlerta.nivel === 'exacta';
    state.forzarFotoDup = !!document.getElementById('cgForzarFoto')?.checked;
    if (exactDup && !state.forzarFotoDup) {
      throw new Error('Foto duplicada detectada. Marca «Usar esta foto de todas formas» o elige otra.');
    }

    const existing = [];
    const dataUrls = [];
    for (const f of state.fotosPendientes) {
      if (String(f.src || '').startsWith('/uploads/')) {
        existing.push({ ruta: f.src, hash: f.hash || null, tipo: f.tipo });
      } else if (String(f.src || '').startsWith('data:')) {
        const compressed = await compressDataUrl(f.src);
        dataUrls.push({ dataUrl: compressed, tipo: f.tipo });
      }
    }

    const body = {
      empresa: document.getElementById('cgEmpresa').value.trim(),
      descripcion: document.getElementById('cgDescripcion').value.trim(),
      cantidad: Number(document.getElementById('cgCantidad').value),
      bodega: document.getElementById('cgBodega').value.trim() || null,
      marca: document.getElementById('cgMarca')?.value.trim() || null,
      modelo: document.getElementById('cgModelo')?.value.trim() || null,
      observaciones: document.getElementById('cgObservaciones')?.value.trim() || null,
      estado: document.getElementById('cgEstado').value,
      fotos: existing,
      foto: existing.find((x) => x.tipo === 'articulo')?.ruta || existing[0]?.ruta || null,
      foto_hash: existing.find((x) => x.tipo === 'articulo')?.hash || existing[0]?.hash || null,
      forzar_foto_duplicada: state.forzarFotoDup
    };
    if (dataUrls.length) body.dataUrls = dataUrls;

    try {
      if (state.editId) {
        await Auth.api(CFG.api + '/' + state.editId, { method: 'POST', body: JSON.stringify(body) });
        UI.flash('Ítem actualizado');
      } else {
        const r = await Auth.api(CFG.api, { method: 'POST', body: JSON.stringify(body) });
        UI.flash('Creado ' + (r.data?.codigo || '') + (r.data?.correlativo ? ' · N° ' + String(r.data.correlativo).padStart(5, '0') : ''));
      }
    } catch (err) {
      const msg = String(err.message || '');
      if (/duplicad|Foto duplicada|FOTO_DUPLICADA/i.test(msg)) {
        state.fotoAlerta = state.fotoAlerta || { nivel: 'exacta', mensaje: msg, duplicados: [] };
        const box = document.getElementById('cgFotoAlerta');
        if (box) {
          box.hidden = false;
          box.innerHTML = fotoAlertaHtml(state.fotoAlerta);
          document.getElementById('cgForzarFoto')?.addEventListener('change', (e) => {
            state.forzarFotoDup = !!e.target.checked;
          });
        }
      }
      throw err;
    }
    state.modalMode = null;
    state.editId = null;
    state.fotosPendientes = [];
    state.fotoAlerta = null;
    state.forzarFotoDup = false;
    state.view = 'list';
    localStorage.setItem(CFG.storageKey, 'list');
    await boot(false);
  }

  function bind() {
    const search = document.getElementById('cgSearch');
    if (search) {
      let t;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.q = search.value;
          paint();
          const el = document.getElementById('cgSearch');
          if (el) {
            el.focus();
            const len = el.value.length;
            el.setSelectionRange(len, len);
          }
        }, 160);
      });
    }

    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.view = btn.getAttribute('data-view') || 'grid';
        localStorage.setItem(CFG.storageKey, state.view);
        paint();
      });
    });

    document.querySelectorAll('.cg-chip[data-kind]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const kind = chip.getAttribute('data-kind');
        const value = chip.getAttribute('data-value') || '';
        if (kind === 'estado') state.filtroEstado = value;
        if (kind === 'bodega') state.filtroBodega = value;
        paint();
      });
    });

    const clear = document.getElementById('cgClearFilters');
    if (clear) {
      clear.onclick = () => {
        state.q = '';
        state.filtroEstado = '';
        state.filtroBodega = '';
        paint();
      };
    }

    const btnNuevo = document.getElementById('cgBtnNuevo');
    const emptyNuevo = document.getElementById('cgEmptyNuevo');
    if (btnNuevo) btnNuevo.onclick = () => openItemModal(null);
    if (emptyNuevo) emptyNuevo.onclick = () => openItemModal(null);

    const btnExcel = document.getElementById('cgBtnExcel');
    if (btnExcel) {
      btnExcel.onclick = () => {
        state.modalMode = 'excel';
        state.editId = null;
        paint();
      };
    }

    const btnPlantilla = document.getElementById('cgBtnPlantilla');
    if (btnPlantilla) {
      btnPlantilla.onclick = async () => {
        try { await downloadPlantilla(); } catch (e) { UI.flash(e.message, true); }
      };
    }

    document.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openItemModal(Number(btn.getAttribute('data-edit')));
      });
    });

    document.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(btn.getAttribute('data-del'));
        if (!confirm('¿Eliminar este ítem del ' + CFG.label + '?')) return;
        try {
          await Auth.api(CFG.api + '/' + id + '/eliminar', { method: 'POST', body: '{}' });
          UI.flash('Eliminado');
          await boot(false);
        } catch (err) {
          UI.flash(err.message, true);
        }
      });
    });

    document.querySelectorAll('.cg-card[data-id], .cg-row[data-id]').forEach((el) => {
      const open = () => {
        state.modalMode = 'detail';
        state.editId = Number(el.getAttribute('data-id'));
        paint();
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });

    const overlay = document.getElementById('cgOverlay');
    if (overlay && state.modalMode) {
      overlay.addEventListener('click', closeModal);
      overlay.querySelectorAll('[data-close-modal]').forEach((b) => {
        b.addEventListener('click', closeModal);
      });
    }

    const form = document.getElementById('cgForm');
    if (form) {
      const item = state.editId ? state.rows.find((x) => Number(x.id) === Number(state.editId)) : null;

      function friendlyFotoError(err) {
        const m = String(err?.message || err || '');
        if (/413|too large|demasiado grande|Entity Too Large/i.test(m) || /<!DOCTYPE|<html/i.test(m)) {
          return 'Foto lista (revisión omitida por tamaño). Puedes crear el artículo.';
        }
        return m.slice(0, 120) || 'Revisión omitida. Puedes crear el artículo.';
      }

      function refreshFotoStrip() {
        // Re-render solo el formulario de fotos: más simple volver a paint manteniendo campos
        const emp = document.getElementById('cgEmpresa')?.value;
        const des = document.getElementById('cgDescripcion')?.value;
        const cant = document.getElementById('cgCantidad')?.value;
        const bod = document.getElementById('cgBodega')?.value;
        const est = document.getElementById('cgEstado')?.value;
        const marca = document.getElementById('cgMarca')?.value;
        const modelo = document.getElementById('cgModelo')?.value;
        const obs = document.getElementById('cgObservaciones')?.value;
        paint();
        const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
        set('cgEmpresa', emp);
        set('cgDescripcion', des);
        set('cgCantidad', cant);
        set('cgBodega', bod);
        set('cgEstado', est);
        set('cgMarca', marca);
        set('cgModelo', modelo);
        set('cgObservaciones', obs);
      }

      async function addFiles(tipo, fileList) {
        const files = Array.from(fileList || []).filter(Boolean);
        if (!files.length) return;
        const box = document.getElementById('cgFotoAlerta');
        const current = fotosDeTipo(tipo).length;
        const room = Math.max(0, 6 - current);
        if (!room) {
          UI.flash('Máximo 6 fotos de ' + (tipo === 'marca' ? 'marca/modelo' : 'artículo'), true);
          return;
        }
        if (box) {
          box.hidden = false;
          box.innerHTML = statusFotoRevisandoHtml();
        }
        let lastDup = null;
        let lastCompressed = null;
        for (const file of files.slice(0, room)) {
          if (!String(file.type || '').startsWith('image/') && file.type !== '') {
            if (!/\.(jpe?g|png|webp|gif|heic)$/i.test(file.name || '')) continue;
          }
          try {
            const raw = await fileToDataUrl(file);
            const compressed = await compressDataUrl(raw);
            lastCompressed = compressed;
            const hash = await sha256FromDataUrl(compressed);
            state.fotosPendientes.push({
              id: 'f' + (fotoSeq++),
              src: compressed,
              hash: hash || null,
              tipo
            });
            if (hash) {
              try {
                const check = await Auth.api(CFG.api + '/check-foto', {
                  method: 'POST',
                  body: JSON.stringify({ hash, exclude_id: state.editId || null })
                });
                if (check?.alerta_foto && check.nivel === 'exacta') lastDup = check;
              } catch (_) { /* no bloquear */ }
            }
          } catch (_) { /* skip file */ }
        }
        if (lastDup) {
          state.fotoAlerta = lastDup;
          UI.flash('Artículo duplicado — revisar', true);
        } else {
          state.fotoAlerta = null;
        }
        refreshFotoStrip();

        // Angel sugiere nombre / marca / modelo y "prende" los campos vacíos
        if (lastCompressed && !lastDup) {
          const alertBox = document.getElementById('cgFotoAlerta');
          if (alertBox) {
            alertBox.hidden = false;
            alertBox.innerHTML = statusAngelLeyendoHtml();
          }
          try {
            const sug = await Auth.api(CFG.api + '/sugerir-foto', {
              method: 'POST',
              body: JSON.stringify({ dataUrl: lastCompressed, tipo })
            });
            if (sug?.sugerido) {
              await applyAngelSuggestion(sug);
              const b = document.getElementById('cgFotoAlerta');
              if (b) {
                b.hidden = false;
                b.innerHTML = statusAngelOkHtml(sug) + statusFotoOkHtml();
              }
            } else if (alertBox) {
              alertBox.innerHTML = statusFotoOkHtml() +
                `<p style="margin:.35rem 0 0;font-size:.8rem;color:var(--cg-muted)">${esc(sug?.message || 'Angel no sugirió datos')}</p>`;
            }
          } catch (err) {
            const b = document.getElementById('cgFotoAlerta');
            if (b) {
              b.hidden = false;
              b.innerHTML = statusFotoOkHtml() +
                `<p style="margin:.35rem 0 0;font-size:.8rem;color:var(--cg-muted)">${esc(friendlyFotoError(err))}</p>`;
            }
          }
        }
      }

      form.querySelectorAll('[data-foto-pick]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tipo = btn.getAttribute('data-foto-pick');
          const mode = btn.getAttribute('data-mode');
          const input = form.querySelector(`.cg-foto-input[data-tipo="${tipo}"][data-mode="${mode}"]`);
          input?.click();
        });
      });
      form.querySelectorAll('.cg-foto-input').forEach((input) => {
        input.onchange = async () => {
          const tipo = input.getAttribute('data-tipo') || 'articulo';
          await addFiles(tipo, input.files);
          input.value = '';
        };
      });
      form.querySelectorAll('[data-foto-del]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute('data-foto-del');
          state.fotosPendientes = state.fotosPendientes.filter((f) => f.id !== id);
          refreshFotoStrip();
        });
      });

      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.closest('.cg-sheet')?.querySelector('.cg-sheet-foot [type="submit"], .cg-sheet-foot button.cg-btn-primary')
          || document.querySelector('.cg-sheet-foot .cg-btn-primary');
        if (btn) {
          btn.disabled = true;
          btn.dataset._old = btn.innerHTML;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
        }
        try {
          await saveItem(item);
        } catch (err) {
          UI.flash(err.message || friendlyFotoError(err), true);
        } finally {
          if (btn) {
            btn.disabled = false;
            if (btn.dataset._old) btn.innerHTML = btn.dataset._old;
          }
        }
      };
    }

    const drop = document.getElementById('cgDrop');
    const excelFile = document.getElementById('cgExcelFile');
    if (drop && excelFile) {
      drop.onclick = () => excelFile.click();
      ['dragenter', 'dragover'].forEach((ev) => {
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add('is-drag');
        });
      });
      ['dragleave', 'drop'].forEach((ev) => {
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove('is-drag');
        });
      });
      drop.addEventListener('drop', async (e) => {
        const f = e.dataTransfer?.files?.[0];
        try { await importExcel(f); } catch (err) { UI.flash(err.message, true); }
      });
      excelFile.onchange = async () => {
        try { await importExcel(excelFile.files?.[0]); } catch (err) { UI.flash(err.message, true); }
        finally { excelFile.value = ''; }
      };
    }

    const modalPlantilla = document.getElementById('cgModalPlantilla');
    if (modalPlantilla) {
      modalPlantilla.onclick = async () => {
        try { await downloadPlantilla(); } catch (e) { UI.flash(e.message, true); }
      };
    }

    state.lbGallery = [];
    state.lbIndex = 0;

    function openLightbox(srcs, index) {
      const list = (Array.isArray(srcs) ? srcs : [srcs]).filter(Boolean);
      if (!list.length) return;
      state.lbGallery = list;
      state.lbIndex = Math.max(0, Math.min(Number(index) || 0, list.length - 1));
      const lb = document.getElementById('cgLightbox');
      const im = lb?.querySelector('img');
      const cap = lb?.querySelector('.cg-lb-caption');
      if (!lb || !im) return;
      im.src = list[state.lbIndex];
      if (cap) cap.textContent = list.length > 1 ? `${state.lbIndex + 1} / ${list.length}` : '';
      lb.classList.toggle('has-nav', list.length > 1);
      lb.hidden = false;
    }

    document.querySelectorAll('[data-zoom]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLightbox([el.getAttribute('data-zoom')], 0);
      });
    });
    document.querySelectorAll('[data-zoom-gallery]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        let list = [];
        try {
          list = JSON.parse(el.getAttribute('data-zoom-gallery') || '[]');
        } catch (_) {
          list = String(el.getAttribute('data-zoom-gallery') || '').split('|').filter(Boolean);
        }
        openLightbox(list, 0);
      });
    });
    const lb = document.getElementById('cgLightbox');
    if (lb) {
      lb.onclick = (e) => {
        if (e.target === lb || e.target.tagName === 'IMG') lb.hidden = true;
      };
      lb.querySelectorAll('[data-lb-nav]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const dir = Number(btn.getAttribute('data-lb-nav') || 0);
          if (!state.lbGallery.length) return;
          state.lbIndex = (state.lbIndex + dir + state.lbGallery.length) % state.lbGallery.length;
          const im = lb.querySelector('img');
          const cap = lb.querySelector('.cg-lb-caption');
          if (im) im.src = state.lbGallery[state.lbIndex];
          if (cap) cap.textContent = `${state.lbIndex + 1} / ${state.lbGallery.length}`;
        });
      });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const lb = document.getElementById('cgLightbox');
    if (lb && !lb.hidden) {
      lb.hidden = true;
      return;
    }
    if (state.modalMode) closeModal();
  });

  async function boot(showShellError) {
    const content = document.getElementById('app-content');
    const user = Auth.getUser();
    if (String(user?.empresa || '').toLowerCase() !== CFG.slug) {
      content.innerHTML = `<div class="alert alert-error">${esc(CFG.label)} solo está disponible para la empresa ${esc(CFG.empresaNombre)}.</div>`;
      return;
    }
    try {
      const res = await Auth.api(CFG.api);
      state.canEdit = !!res.can_edit;
      state.estados = Array.isArray(res.estados) && res.estados.length ? res.estados : ESTADOS_FALLBACK;
      state.bodegas = Array.isArray(res.bodegas) ? res.bodegas : [];
      state.stats = res.stats || { total: 0, total_cantidad: 0, por_estado: [], por_bodega: [] };
      state.rows = res.data || [];
      paint();
    } catch (e) {
      if (showShellError !== false) {
        content.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
      } else {
        UI.flash(e.message, true);
      }
    }
  }

  window[CFG.pageExport] = { boot };
  window.CatalogoLetraPage = { boot };
})();
