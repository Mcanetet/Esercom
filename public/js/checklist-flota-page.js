/**
 * Checklist Flota — UI (11 ítems, fotos, modales, paginación).
 */
(function () {
  const EST = ['OK', 'Observación', 'Falla'];
  const EST_META = {
    OK: { icon: 'fa-check', title: 'OK' },
    'Observación': { icon: 'fa-exclamation', title: 'Observación' },
    Falla: { icon: 'fa-times', title: 'Falla' }
  };
  /** Catálogo local para pintar la UI sin esperar /meta */
  const DEFAULT_ITEMS = [
    { key: 'neumaticos', label: 'Estado de neumáticos' },
    { key: 'luces', label: 'Luces' },
    { key: 'frenos', label: 'Sistema de frenos' },
    { key: 'nivel_combustible', label: 'Nivel de combustible' },
    { key: 'limpieza_interior', label: 'Limpieza interior' },
    { key: 'limpieza_exterior', label: 'Limpieza exterior' },
    { key: 'documentacion', label: 'Documentación al día', alt: 'documentos' },
    { key: 'kit_emergencia', label: 'Kit de emergencia' },
    { key: 'extintor', label: 'Extintor vigente' },
    { key: 'rueda_repuesto', label: 'Rueda de repuesto' },
    { key: 'nivel_aceite', label: '¿Choque o colisión?', inverted: true }
  ];
  const DEFAULT_FOTOS = [
    { key: 'foto_frontal', label: 'Vista frontal', required: true },
    { key: 'foto_lateral_izq', label: 'Lateral izquierdo', required: true },
    { key: 'foto_lateral_der', label: 'Lateral derecho', required: true },
    { key: 'foto_trasera', label: 'Vista trasera', required: true },
    { key: 'foto_rueda', label: 'Rueda de repuesto', required: true },
    { key: 'foto_kit_herramientas', label: 'Kit herramientas', required: true },
    { key: 'foto_colision', label: 'Colisión (si aplica)', required: false }
  ];
  const PHOTO_LABELS = {
    foto_frontal: 'Vista frontal',
    foto_lateral_izq: 'Lateral izquierdo',
    foto_lateral_der: 'Lateral derecho',
    foto_trasera: 'Vista trasera',
    foto_rueda: 'Rueda de repuesto',
    foto_kit_herramientas: 'Kit herramientas',
    foto_colision: 'Colisión'
  };

  const PHOTO_SVGS = {
    foto_frontal: `<svg viewBox="0 0 100 80" width="100" height="80"><rect x="20" y="20" width="60" height="45" fill="#2563eb" stroke="#333" stroke-width="2" rx="5"/><rect x="30" y="30" width="18" height="25" fill="#E3F2FD" stroke="#333" stroke-width="1.5"/><rect x="52" y="30" width="18" height="25" fill="#E3F2FD" stroke="#333" stroke-width="1.5"/><circle cx="35" cy="60" r="8" fill="#333"/><circle cx="65" cy="60" r="8" fill="#333"/><text x="50" y="15" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold">FRONTAL</text></svg>`,
    foto_lateral_izq: `<svg viewBox="0 0 100 80" width="100" height="80"><ellipse cx="30" cy="55" rx="8" ry="8" fill="#333"/><ellipse cx="70" cy="55" rx="8" ry="8" fill="#333"/><path d="M 15 25 L 25 25 L 35 35 L 65 35 L 75 25 L 85 25 L 85 55 L 80 55 L 78 50 L 72 50 L 70 55 L 30 55 L 28 50 L 22 50 L 20 55 L 15 55 Z" fill="#2563eb" stroke="#333" stroke-width="2"/><rect x="40" y="28" width="15" height="10" fill="#E3F2FD" stroke="#333" stroke-width="1.5"/><text x="50" y="15" text-anchor="middle" font-size="9" fill="#2563eb" font-weight="bold">LATERAL IZQ</text></svg>`,
    foto_lateral_der: `<svg viewBox="0 0 100 80" width="100" height="80"><ellipse cx="30" cy="55" rx="8" ry="8" fill="#333"/><ellipse cx="70" cy="55" rx="8" ry="8" fill="#333"/><path d="M 85 25 L 75 25 L 65 35 L 35 35 L 25 25 L 15 25 L 15 55 L 20 55 L 22 50 L 28 50 L 30 55 L 70 55 L 72 50 L 78 50 L 80 55 L 85 55 Z" fill="#1d4ed8" stroke="#333" stroke-width="2"/><rect x="45" y="28" width="15" height="10" fill="#E3F2FD" stroke="#333" stroke-width="1.5"/><text x="50" y="15" text-anchor="middle" font-size="9" fill="#1d4ed8" font-weight="bold">LATERAL DER</text></svg>`,
    foto_trasera: `<svg viewBox="0 0 100 80" width="100" height="80"><rect x="20" y="20" width="60" height="45" fill="#1d4ed8" stroke="#333" stroke-width="2" rx="5"/><rect x="30" y="30" width="18" height="20" fill="#E3F2FD" stroke="#333" stroke-width="1.5"/><rect x="52" y="30" width="18" height="20" fill="#E3F2FD" stroke="#333" stroke-width="1.5"/><rect x="25" y="55" width="12" height="8" fill="#ff4444" stroke="#333" stroke-width="1"/><rect x="63" y="55" width="12" height="8" fill="#ff4444" stroke="#333" stroke-width="1"/><circle cx="35" cy="67" r="8" fill="#333"/><circle cx="65" cy="67" r="8" fill="#333"/><text x="50" y="15" text-anchor="middle" font-size="10" fill="#1d4ed8" font-weight="bold">TRASERA</text></svg>`,
    foto_rueda: `<svg viewBox="0 0 100 80" width="100" height="80"><circle cx="50" cy="40" r="25" fill="#333" stroke="#111" stroke-width="3"/><circle cx="50" cy="40" r="15" fill="#f8fafc" stroke="#111" stroke-width="2"/><line x1="50" y1="15" x2="50" y2="25" stroke="#333" stroke-width="2"/><line x1="50" y1="55" x2="50" y2="65" stroke="#333" stroke-width="2"/><line x1="25" y1="40" x2="35" y2="40" stroke="#333" stroke-width="2"/><line x1="65" y1="40" x2="75" y2="40" stroke="#333" stroke-width="2"/><text x="50" y="75" text-anchor="middle" font-size="10" fill="#2563eb" font-weight="bold">RUEDA REP.</text></svg>`,
    foto_kit_herramientas: `<svg viewBox="0 0 100 80" width="100" height="80"><rect x="25" y="25" width="50" height="35" rx="4" fill="#2563eb" stroke="#333" stroke-width="2"/><rect x="32" y="32" width="12" height="12" fill="#dbeafe" stroke="#333" stroke-width="1"/><rect x="48" y="32" width="12" height="12" fill="#dbeafe" stroke="#333" stroke-width="1"/><rect x="64" y="32" width="12" height="12" fill="#dbeafe" stroke="#333" stroke-width="1"/><path d="M 35 50 L 45 50 L 45 58 L 35 58 Z" fill="#1e3a5f" stroke="#333" stroke-width="1"/><path d="M 52 50 L 62 50 L 62 58 L 52 58 Z" fill="#1e3a5f" stroke="#333" stroke-width="1"/><text x="50" y="72" text-anchor="middle" font-size="9" fill="#2563eb" font-weight="bold">KIT HERRAM.</text></svg>`,
    foto_colision: `<svg viewBox="0 0 100 80" width="100" height="80"><rect x="20" y="25" width="26" height="20" rx="4" fill="#2563eb" stroke="#333" stroke-width="2"/><rect x="54" y="35" width="26" height="20" rx="4" fill="#ef4444" stroke="#333" stroke-width="2"/><line x1="46" y1="35" x2="54" y2="45" stroke="#333" stroke-width="2"/><text x="50" y="72" text-anchor="middle" font-size="9" fill="#2563eb" font-weight="bold">COLISIÓN</text></svg>`
  };

  let state = {
    page: 1,
    limit: 10,
    canCreate: false,
    canAssign: false,
    canManageCatalog: false,
    catalogo: { total: 0, ultima_carga: null, alert_email: '' },
    flota: [],
    items: [],
    fotos: [],
    photoPaths: {},
    current: null,
    patenteOk: false,
    patenteTimer: null,
    vehiculo: null
  };

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function photoImg(url, key) {
    const base = esc((url || '').split('/').pop());
    const src = esc(url);
    const fb = `/uploads/fotos_checklist/${base}`;
    const fb2 = `/uploads/checklist/${base}`;
    return `<img src="${src}" alt="${esc(key)}" loading="lazy"
      onerror="if(!this.dataset.f1){this.dataset.f1=1;this.src='${fb}'}else if(!this.dataset.f2){this.dataset.f2=1;this.src='${fb2}'}else{this.parentElement.classList.add('no-img')}">`;
  }

  function mountModals() {
    if (document.getElementById('ckModalVer')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="cfg-modal" id="ckModalVer" aria-hidden="true">
        <div class="cfg-modal-backdrop" onclick="CkFlota.cerrarVer()"></div>
        <div class="cfg-modal-panel cfg-modal-lg ck-modal-panel">
          <div class="cfg-modal-head">
            <div><h2 id="ckVerTitle">Detalle checklist</h2><p id="ckVerSub"></p></div>
            <button type="button" class="cfg-modal-x" onclick="CkFlota.cerrarVer()">&times;</button>
          </div>
          <div class="cfg-modal-body" id="ckVerBody"></div>
          <div class="cfg-modal-footer" id="ckVerFooter"></div>
        </div>
      </div>
      <div class="cfg-modal" id="ckModalEdit" aria-hidden="true">
        <div class="cfg-modal-backdrop" onclick="CkFlota.cerrarEdit()"></div>
        <div class="cfg-modal-panel cfg-modal-lg ck-modal-panel">
          <div class="cfg-modal-head">
            <div><h2 id="ckEditTitle">Editar checklist</h2><p id="ckEditSub"></p></div>
            <button type="button" class="cfg-modal-x" onclick="CkFlota.cerrarEdit()">&times;</button>
          </div>
          <div class="cfg-modal-body" id="ckEditBody"></div>
          <div class="cfg-modal-footer">
            <button type="button" class="btn btn-secondary" onclick="CkFlota.cerrarEdit()">Cancelar</button>
            <button type="button" class="btn btn-primary" id="ckBtnSaveEdit"><i class="fas fa-save"></i> Guardar</button>
          </div>
        </div>
      </div>`);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { cerrarVer(); cerrarEdit(); }
    });
  }

  function openVer() {
    document.getElementById('ckModalVer').classList.add('is-open');
    document.body.classList.add('modal-open');
  }
  function cerrarVer() {
    document.getElementById('ckModalVer')?.classList.remove('is-open');
    document.body.classList.remove('modal-open');
  }
  function openEdit() {
    document.getElementById('ckModalEdit').classList.add('is-open');
    document.body.classList.add('modal-open');
  }
  function cerrarEdit() {
    document.getElementById('ckModalEdit')?.classList.remove('is-open');
    if (!document.getElementById('ckModalVer')?.classList.contains('is-open')) {
      document.body.classList.remove('modal-open');
    }
  }

  function itemSelect(id, label, val, opts = {}) {
    const selected = val || '';
    const inverted = !!opts.inverted;
    let toggles;
    if (inverted) {
      // Pregunta Sí/No: No = sin colisión (OK), Sí = hubo colisión (Falla)
      const optsYn = [
        { val: 'OK', cls: 'ok', title: 'No hubo colisión', text: 'No' },
        { val: 'Falla', cls: 'falla', title: 'Sí hubo colisión', text: 'Sí' }
      ];
      toggles = optsYn.map((o) => {
        const on = selected === o.val ? ' is-on' : '';
        return `<button type="button" class="ck-tog ck-tog-text ck-tog-${o.cls}${on}" data-val="${o.val}" title="${o.title}" aria-pressed="${selected === o.val ? 'true' : 'false'}">${o.text}</button>`;
      }).join('');
    } else {
      toggles = EST.map((e) => {
        const m = EST_META[e];
        const on = selected === e ? ' is-on' : '';
        return `<button type="button" class="ck-tog ck-tog-${e === 'Observación' ? 'obs' : e.toLowerCase()}${on}" data-val="${e}" title="${m.title}" aria-pressed="${selected === e ? 'true' : 'false'}"><i class="fas ${m.icon}"></i></button>`;
      }).join('');
    }
    const hint = inverted
      ? '<span class="ck-item-hint">No = sin colisión · Sí = hubo colisión (pide foto)</span>'
      : '';
    return `
      <div class="ck-item${inverted ? ' ck-item-yn' : ''}" data-item="${id}" data-inverted="${inverted ? '1' : '0'}">
        <label class="ck-item-label" for="${id}">${label}</label>
        <div class="ck-item-toggles" role="group" aria-label="${esc(label)}">${toggles}</div>
        ${hint}
        <input type="hidden" id="${id}" class="ck-item-select" value="${esc(selected)}" required>
      </div>`;
  }

  function wireItemToggles(root) {
    const scope = root || document;
    scope.querySelectorAll('.ck-item').forEach((row) => {
      if (row.dataset.wired) return;
      row.dataset.wired = '1';
      const input = row.querySelector('.ck-item-select');
      row.querySelectorAll('.ck-tog').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          if (input) input.value = val;
          row.querySelectorAll('.ck-tog').forEach((b) => {
            const on = b.dataset.val === val;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          updateProgress();
          toggleColisionPhoto();
        });
      });
    });
  }

  function fileToJpegDataUrl(file, maxSide = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const name = String(file?.name || '').toLowerCase();
      const type = String(file?.type || '').toLowerCase();
      if (/heic|heif/.test(name) || /heic|heif/.test(type)) {
        reject(new Error('Tu iPhone envió HEIC. En Ajustes → Cámara → Formatos elige «Más compatible», o toma la foto desde esta app.'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) throw new Error('Imagen inválida');
          const scale = Math.min(1, maxSide / Math.max(w, h));
          w = Math.round(w * scale);
          h = Math.round(h * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la imagen. Usa JPG/PNG (evita HEIC de iPhone).'));
      };
      img.src = url;
    });
  }

  function showPhotoPreview(key, dataUrl) {
    const prev = document.getElementById('prev_' + key);
    const box = document.getElementById('box_' + key);
    const wrap = document.getElementById('wrap_' + key);
    if (!prev || !box) return;
    prev.src = dataUrl;
    prev.removeAttribute('hidden');
    box.classList.add('uploaded');
    if (wrap) wrap.classList.add('is-uploaded');
    const icon = box.querySelector('.ck-photo-icon');
    if (icon) icon.style.display = 'none';
    const pick = document.querySelector(`[data-pick="${key}"]`);
    if (pick) {
      pick.classList.add('ck-photo-btn-ok');
      pick.innerHTML = '<i class="fas fa-check"></i> Listo';
    }
  }

  function clearPhotoPreview(key) {
    const prev = document.getElementById('prev_' + key);
    const box = document.getElementById('box_' + key);
    const wrap = document.getElementById('wrap_' + key);
    if (prev) {
      prev.removeAttribute('src');
      prev.setAttribute('hidden', '');
    }
    if (box) {
      box.classList.remove('uploaded');
      const icon = box.querySelector('.ck-photo-icon');
      if (icon) icon.style.display = '';
      const meta = box.querySelector('.ck-photo-meta');
      if (meta) meta.textContent = meta.dataset.default || '';
    }
    if (wrap) wrap.classList.remove('is-uploaded');
    const pick = document.querySelector(`[data-pick="${key}"]`);
    if (pick) {
      pick.classList.remove('ck-photo-btn-ok');
      pick.innerHTML = '<i class="fas fa-camera"></i> Foto';
    }
    delete state.photoPaths[key];
  }

  function photoBox(key, label, required) {
    const svg = PHOTO_SVGS[key] || '';
    const hidden = key === 'foto_colision' ? ' hidden' : '';
    const reqTxt = required ? 'Obligatoria' : 'Si aplica';
    return `
      <div class="ck-photo" data-photo="${key}" id="wrap_${key}"${hidden}>
        <div class="ck-photo-box" id="box_${key}">
          <div class="ck-photo-ticket" aria-hidden="true">
            <i class="fas fa-check-circle"></i>
            <span>Listo</span>
          </div>
          <div class="ck-photo-icon">${svg}</div>
          <img class="ck-photo-preview" id="prev_${key}" alt="${esc(label)}" hidden>
          <strong class="ck-photo-label">${esc(label)}</strong>
          <span class="ck-photo-meta" data-default="${esc(reqTxt)}">${esc(reqTxt)}</span>
        </div>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/*" capture="environment" id="file_${key}" hidden>
        <div class="ck-photo-actions">
          <button type="button" class="btn btn-outline btn-sm ck-photo-btn" data-pick="${key}"><i class="fas fa-camera"></i> Foto</button>
          <button type="button" class="btn btn-outline btn-sm ck-photo-clear" data-clear="${key}" title="Quitar foto"><i class="fas fa-times"></i></button>
        </div>
      </div>`;
  }

  function vehiculoReadonly(id, label, placeholder) {
    return `<div class="form-group">
      <label>${label}</label>
      <input type="text" id="${id}" class="ck-readonly" readonly tabindex="-1" placeholder="${placeholder || '—'}">
    </div>`;
  }

  function clearVehiculoInfo() {
    state.vehiculo = null;
    ['vehiculo_marca', 'vehiculo_modelo', 'vehiculo_tipo', 'vehiculo_anio', 'propietario_nombre', 'propietario_rut'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const wrap = document.getElementById('ckVehiculoInfo');
    if (wrap) wrap.hidden = true;
  }

  function fillVehiculoInfo(v) {
    if (!v || (!v.marca && !v.modelo && !v.tipo && !v.anio && !v.propietario)) {
      clearVehiculoInfo();
      return;
    }
    state.vehiculo = v;
    const map = {
      vehiculo_marca: v.marca || '',
      vehiculo_modelo: v.modelo || '',
      vehiculo_tipo: v.tipo || '',
      vehiculo_anio: v.anio ? String(v.anio) : '',
      propietario_nombre: v.propietario || '',
      propietario_rut: v.propietario_rut || ''
    };
    Object.entries(map).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
    const wrap = document.getElementById('ckVehiculoInfo');
    if (wrap) wrap.hidden = false;
  }

  function vehiculoPayload() {
    const v = state.vehiculo || {};
    return {
      vehiculo_marca: v.marca || document.getElementById('vehiculo_marca')?.value || null,
      vehiculo_modelo: v.modelo || document.getElementById('vehiculo_modelo')?.value || null,
      vehiculo_tipo: v.tipo || document.getElementById('vehiculo_tipo')?.value || null,
      vehiculo_anio: v.anio || document.getElementById('vehiculo_anio')?.value || null,
      propietario_nombre: v.propietario || document.getElementById('propietario_nombre')?.value || null,
      propietario_rut: v.propietario_rut || document.getElementById('propietario_rut')?.value || null
    };
  }

  function toggleColisionPhoto() {
    const sel = document.getElementById('nivel_aceite');
    const wrap = document.getElementById('wrap_foto_colision');
    if (!sel || !wrap) return;
    const show = sel.value === 'Falla';
    wrap.hidden = !show;
    if (!show) delete state.photoPaths.foto_colision;
  }

  let patenteTimer = null;
  async function validarPatenteInput() {
    const input = document.getElementById('patente');
    const status = document.getElementById('patenteStatus');
    if (!input || !status) return;
    const raw = input.value.trim();
    if (raw.length < 5) {
      status.innerHTML = '';
      state.patenteOk = false;
      clearVehiculoInfo();
      return;
    }
    status.innerHTML = '<span class="ck-patente-loading"><i class="fas fa-spinner fa-spin"></i> Verificando patente…</span>';
    try {
      const res = await Auth.api('/api/modulos/checklist/validar-patente?patente=' + encodeURIComponent(raw));
      state.patenteOk = !!res.valid;
      if (!res.valid) {
        status.innerHTML = `<span class="ck-patente-bad"><i class="fas fa-times-circle"></i> ${esc(res.message)}</span>`;
        clearVehiculoInfo();
        return;
      }
      fillVehiculoInfo(res.vehiculo || null);
      let extra = esc(res.message || '');
      if (res.vehiculo) {
        const v = res.vehiculo;
        extra = [v.marca, v.modelo, v.tipo, v.anio].filter(Boolean).map(esc).join(' · ');
        if (v.propietario) extra += (extra ? ' · ' : '') + 'Dueño: ' + esc(v.propietario);
      }
      if (res.fuente === 'catalogo_flota') {
        extra = (extra ? extra + ' · ' : '') + 'Catálogo flota';
      }
      let cls = res.verificado ? 'ck-patente-ok' : 'ck-patente-warn';
      let icon = res.verificado ? 'check-circle' : 'info-circle';
      if (res.alerta_catalogo && !res.email_enviado) cls = 'ck-patente-warn';
      if (res.alerta_catalogo && res.email_enviado) cls = 'ck-patente-warn';
      status.innerHTML = `<span class="${cls}"><i class="fas fa-${icon}"></i> ${extra}</span>`;
      if (res.alerta_catalogo) {
        const alertMsg = res.email_enviado
          ? `<div class="ck-patente-alert"><i class="fas fa-envelope"></i> Patente no está en el Excel de flota. Aviso enviado a ${esc(res.email_destino || state.catalogo.alert_email)}.</div>`
          : `<div class="ck-patente-alert"><i class="fas fa-exclamation-triangle"></i> Patente no está en el catálogo Excel cargado.</div>`;
        status.innerHTML += alertMsg;
      }
      if (res.patente) input.value = res.patente;
    } catch (err) {
      state.patenteOk = false;
      clearVehiculoInfo();
      status.innerHTML = `<span class="ck-patente-bad"><i class="fas fa-times-circle"></i> ${esc(err.message)}</span>`;
    }
  }

  function formatDateTime(v) {
    if (!v) return '—';
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      const hasTime = m[4] != null;
      const isMidnight = !hasTime || (m[4] === '00' && m[5] === '00' && (!m[6] || m[6] === '00'));
      if (isMidnight) return `${m[3]}/${m[2]}/${m[1]}`;
    }
    const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString('es-CL', { timeZone: 'America/Santiago' });
  }

  async function loadCatalogoInfo() {
    try {
      const res = await Auth.api('/api/modulos/checklist/catalogo');
      state.canManageCatalog = !!res.can_manage;
      state.catalogo = {
        total: res.total || 0,
        ultima_carga: res.ultima_carga || null,
        archivo_nombre: res.archivo_nombre || null,
        cargado_por_nombre: res.cargado_por_nombre || null,
        alert_email: res.alert_email || 'flota@serviciossercom.cl'
      };
      const el = document.getElementById('ckCatalogoStats');
      if (el) {
        el.innerHTML = state.catalogo.archivo_nombre
          ? `<i class="fas fa-file-excel"></i> <b>${esc(state.catalogo.archivo_nombre)}</b> · ${state.catalogo.total} vehículos · ${formatDateTime(state.catalogo.ultima_carga)}`
          : `<b>${state.catalogo.total}</b> vehículos · Sin Excel cargado · Alertas: ${esc(state.catalogo.alert_email)}`;
      }
      const tab = document.getElementById('ckTabCatalogo');
      if (tab) tab.hidden = !state.canManageCatalog;
    } catch (_) { /* opcional */ }
  }

  async function downloadPlantillaFlota() {
    const token = Auth.getToken();
    const res = await fetch('/api/modulos/checklist/catalogo/plantilla', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('No se pudo descargar la plantilla');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plantilla_flota_esercom.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function wireCatalogoUpload() {
    document.getElementById('ckBtnPlantilla')?.addEventListener('click', async () => {
      try { await downloadPlantillaFlota(); }
      catch (err) { UI.flash(err.message, true); }
    });
    document.getElementById('ckBtnEliminarExcel')?.addEventListener('click', async () => {
      const name = state.catalogo.archivo_nombre || 'el catálogo';
      if (!confirm(`¿Eliminar ${name} y todos los vehículos cargados?`)) return;
      try {
        await Auth.api('/api/modulos/checklist/catalogo/eliminar', { method: 'POST', body: '{}' });
        UI.flash('Catálogo eliminado');
        await loadCatalogoInfo();
      } catch (err) { UI.flash(err.message, true); }
    });
    const input = document.getElementById('ckExcelFile');
    document.getElementById('ckBtnSubirExcel')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!/\.xlsx$/i.test(file.name) && !/\.xls$/i.test(file.name)) {
        UI.flash('Seleccione un archivo Excel (.xlsx)', true);
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await Auth.api('/api/modulos/checklist/catalogo/import', {
            method: 'POST',
            body: JSON.stringify({ dataUrl: reader.result, filename: file.name })
          });
          UI.flash(`Excel «${file.name}» cargado: ${res.total} vehículos`);
          await loadCatalogoInfo();
        } catch (err) { UI.flash(err.message, true); }
        finally { input.value = ''; }
      };
      reader.readAsDataURL(file);
    });
  }

  function wirePatente() {
    const input = document.getElementById('patente');
    if (!input) return;
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      clearTimeout(patenteTimer);
      patenteTimer = setTimeout(validarPatenteInput, 600);
    });
    input.addEventListener('blur', validarPatenteInput);
  }

  function renderPagination(p) {
    if (!p || p.totalPages <= 1) return '';
    const pages = [];
    for (let i = 1; i <= p.totalPages; i++) {
      if (i === 1 || i === p.totalPages || Math.abs(i - p.page) <= 1) pages.push(i);
      else if (pages[pages.length - 1] !== '…') pages.push('…');
    }
    return `
      <div class="pager">
        <span class="pager-info">${((p.page - 1) * p.limit) + 1}–${Math.min(p.page * p.limit, p.total)} de ${p.total}</span>
        <div class="pager-btns">
          <button type="button" class="btn btn-outline btn-sm" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
          ${pages.map((n) => typeof n === 'number'
            ? `<button type="button" class="btn btn-sm ${n === p.page ? 'btn-primary' : 'btn-outline'}" data-page="${n}">${n}</button>`
            : `<span class="pager-dots">…</span>`).join('')}
          <button type="button" class="btn btn-outline btn-sm" data-page="${p.page + 1}" ${p.page >= p.totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
        </div>
      </div>`;
  }

  function actionBtns(r) {
    const pending = r.requiere_atencion && !r.tecnico_asignado_id;
    const canEdit = state.canAssign;
    return `
      <div class="ck-action-btns">
        <button type="button" class="btn btn-outline btn-sm" title="Ver" onclick="CkFlota.ver(${r.id})"><i class="fas fa-eye"></i></button>
        ${canEdit ? `<button type="button" class="btn btn-outline btn-sm" title="Editar proceso" onclick="CkFlota.editar(${r.id})"><i class="fas fa-edit"></i></button>` : ''}
        ${state.canAssign && pending ? `<button type="button" class="btn btn-secondary btn-sm" title="Tomar" onclick="CkFlota.tomar(${r.id})"><i class="fas fa-hand-paper"></i></button>` : ''}
        ${state.canCreate ? `<button type="button" class="btn btn-outline btn-sm" title="Anular" onclick="CkFlota.anular(${r.id})"><i class="fas fa-ban"></i></button>` : ''}
      </div>`;
  }

  function renderRows(rows) {
    if (!rows.length) return UI.emptyRow(10, 'Sin registros de checklist');
    return rows.map((r) => `
      <tr>
        <td>${formatDate(r.fecha)}</td>
        <td><strong>${r.codigo || '—'}</strong></td>
        <td><strong>${r.patente}</strong></td>
        <td>${r.kilometraje || 0}</td>
        <td>${UI.badge(r.estado_general, UI.statusColor(/excelente|ok/i.test(r.estado_general) ? 'OK' : r.estado_general))}</td>
        <td>${r.items_buenos}/${r.items_total || 11}</td>
        <td>${r.tiene_fotos ? `<span class="badge" style="background:#059669"><i class="fas fa-camera"></i> ${r.foto_count}</span>` : '—'}</td>
        <td>${r.conductor || '—'}</td>
        <td>${r.tecnico || (r.requiere_atencion ? '<span class="badge" style="background:#d97706">Pendiente</span>' : '—')}</td>
        <td>${actionBtns(r)}</td>
      </tr>`).join('');
  }

  async function loadList() {
    const inc = document.getElementById('ckFiltroInc')?.checked ? '1' : '';
    const q = document.getElementById('ckBuscar')?.value?.trim() || '';
    const params = new URLSearchParams({ page: state.page, limit: state.limit });
    if (inc) params.set('incidencias', '1');
    if (q) params.set('q', q);
    const pack = await Auth.api('/api/modulos/checklist?' + params.toString());
    state.canCreate = pack.can_create;
    state.canAssign = pack.can_assign_flota;
    document.getElementById('ckTbody').innerHTML = renderRows(pack.data || []);
    document.getElementById('ckPager').innerHTML = renderPagination(pack.pagination);
    document.querySelectorAll('#ckPager [data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (p >= 1 && p <= (pack.pagination?.totalPages || 1)) {
          state.page = p;
          loadList();
        }
      });
    });
  }

  function renderVerModal(data) {
    state.current = data;
    document.getElementById('ckVerTitle').textContent = (data.codigo || 'Checklist') + ' · ' + data.patente;
    document.getElementById('ckVerSub').textContent = `${formatDate(data.fecha)} · ${data.estado_general} · ${data.items_buenos}/${data.items_total} ítems OK`;

    const itemsHtml = state.items.map((i) => {
      const val = data[i.key] || data[i.alt] || '—';
      let display = val;
      let bad = /falla|malo|observaci/i.test(String(val));
      if (i.inverted) {
        // nivel_aceite = colisión: Falla = Sí hubo, OK = No
        bad = String(val).toLowerCase() === 'falla';
        display = bad ? 'Sí' : (String(val).toLowerCase() === 'ok' ? 'No' : val);
      }
      return `<span class="ck-tag ${bad ? 'bad' : 'ok'}">${i.label}: ${esc(display)}</span>`;
    }).join('');

    const fotosEntries = Object.entries(data.fotos || {});
    const fotosHtml = fotosEntries.length
      ? fotosEntries.map(([k, url]) => `
        <a href="${esc(url)}" target="_blank" rel="noopener" class="ck-modal-photo">
          ${photoImg(url, k)}
          <span>${PHOTO_LABELS[k] || k.replace('foto_', '').replace(/_/g, ' ')}</span>
        </a>`).join('')
      : '<p class="home-empty">Sin fotografías registradas</p>';

    document.getElementById('ckVerBody').innerHTML = `
      <div class="ck-modal-grid">
        <p><strong>Marca / Modelo:</strong> ${esc([data.vehiculo_marca, data.vehiculo_modelo].filter(Boolean).join(' ')) || '—'}</p>
        <p><strong>Tipo:</strong> ${esc(data.vehiculo_tipo) || '—'}</p>
        <p><strong>Año:</strong> ${esc(data.vehiculo_anio) || '—'}</p>
        <p><strong>Dueño:</strong> ${esc(data.propietario_nombre) || '—'}${data.propietario_rut ? ` <span class="ck-muted">(${esc(data.propietario_rut)})</span>` : ''}</p>
        <p><strong>Kilometraje:</strong> ${data.kilometraje || 0} km</p>
        <p><strong>Conductor:</strong> ${esc(data.conductor) || '—'}</p>
        <p><strong>Encargado flota:</strong> ${esc(data.tecnico) || '—'}</p>
        <p><strong>Seguimiento:</strong> ${esc(data.estado_seguimiento) || '—'}</p>
        <p class="ck-modal-full"><strong>Observaciones:</strong> ${esc(data.observaciones) || '—'}</p>
      </div>
      <h4 class="ck-modal-h4">Ítems inspeccionados</h4>
      <div class="ck-tags">${itemsHtml}</div>
      <h4 class="ck-modal-h4"><i class="fas fa-camera"></i> Fotografías (${fotosEntries.length})</h4>
      <div class="ck-modal-photos">${fotosHtml}</div>`;

    const pending = data.requiere_atencion && !data.tecnico_asignado_id;
    const canEdit = state.canAssign;
    document.getElementById('ckVerFooter').innerHTML = `
      <button type="button" class="btn btn-secondary" onclick="CkFlota.cerrarVer()">Cerrar</button>
      ${canEdit ? `<button type="button" class="btn btn-outline" onclick="CkFlota.editar(${data.id})"><i class="fas fa-edit"></i> Editar proceso</button>` : ''}
      ${state.canAssign && pending ? `<button type="button" class="btn btn-primary" onclick="CkFlota.tomar(${data.id}, true)"><i class="fas fa-hand-paper"></i> Tomar requerimiento</button>` : ''}
      ${state.canCreate ? `<button type="button" class="btn btn-outline" onclick="CkFlota.anular(${data.id}, true)"><i class="fas fa-ban"></i> Anular</button>` : ''}`;
    openVer();
  }

  async function ver(id) {
    try {
      const { data } = await Auth.api('/api/modulos/checklist/' + id);
      renderVerModal(data);
    } catch (err) { UI.flash(err.message, true); }
  }

  async function editar(id) {
    try {
      const { data } = await Auth.api('/api/modulos/checklist/' + id);
      state.current = data;
      cerrarVer();
      document.getElementById('ckEditTitle').textContent = 'Editar · ' + (data.codigo || data.patente);
      document.getElementById('ckEditSub').textContent = data.patente + ' · ' + formatDate(data.fecha);
      document.getElementById('ckEditBody').innerHTML = `
        <div class="ck-items">${state.items.map((i) => itemSelect('ed_' + i.key, i.label, data[i.key] || data[i.alt] || 'OK', { inverted: !!i.inverted })).join('')}</div>
        <div class="form-row cols-2" style="margin-top:1rem">
          <div class="form-group">
            <label>Estado seguimiento</label>
            <select id="ed_seguimiento">
              <option value="sin_revisar">Sin revisar</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_gestion">En gestión</option>
              <option value="resuelto">Resuelto</option>
            </select>
          </div>
          <div class="form-group">
            <label>Encargado flota</label>
            <select id="ed_tecnico"><option value="">Sin asignar</option>
              ${UI.optionList(state.flota, 'id', (x) => x.nombre + ' ' + x.apellido)}
            </select>
          </div>
        </div>
        <div class="form-group"><label>Observaciones</label><textarea id="ed_obs" rows="3">${esc(data.observaciones || '')}</textarea></div>`;
      document.getElementById('ed_seguimiento').value = data.estado_seguimiento || 'sin_revisar';
      if (data.tecnico_asignado_id) document.getElementById('ed_tecnico').value = data.tecnico_asignado_id;
      document.getElementById('ckBtnSaveEdit').onclick = () => guardarEdit(data.id);
      wireItemToggles(document.getElementById('ckEditBody'));
      openEdit();
    } catch (err) { UI.flash(err.message, true); }
  }

  async function guardarEdit(id) {
    const body = {
      observaciones: document.getElementById('ed_obs').value || null,
      estado_seguimiento: document.getElementById('ed_seguimiento').value,
      tecnico_asignado_id: document.getElementById('ed_tecnico').value
        ? Number(document.getElementById('ed_tecnico').value) : null
    };
    state.items.forEach((i) => {
      const el = document.getElementById('ed_' + i.key);
      if (el) body[i.key] = el.value;
    });
    try {
      await Auth.api('/api/modulos/checklist/' + id, { method: 'PUT', body: JSON.stringify(body) });
      UI.flash('Checklist actualizado');
      cerrarEdit();
      if (document.getElementById('ckPanelHistorial') && !document.getElementById('ckPanelHistorial').hidden) loadList();
    } catch (err) { UI.flash(err.message, true); }
  }

  async function tomar(id, fromModal) {
    try {
      await Auth.api('/api/modulos/checklist/' + id + '/asignar', { method: 'POST', body: JSON.stringify({}) });
      UI.flash('Requerimiento tomado correctamente');
      if (fromModal) cerrarVer();
      loadList();
    } catch (err) { UI.flash(err.message, true); }
  }

  async function anular(id, fromModal) {
    if (!confirm('¿Anular este checklist?')) return;
    try {
      await Auth.api('/api/modulos/checklist/' + id + '/anular', { method: 'POST', body: '{}' });
      UI.flash('Checklist anulado');
      if (fromModal) cerrarVer();
      loadList();
    } catch (err) { UI.flash(err.message, true); }
  }

  function wirePhotos() {
    document.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => document.getElementById('file_' + btn.dataset.pick)?.click());
    });
    document.querySelectorAll('.ck-photo-box').forEach((box) => {
      box.classList.add('ck-photo-box-click');
      box.setAttribute('role', 'button');
      box.setAttribute('tabindex', '0');
      box.title = 'Tocar para tomar / subir foto';
      const pick = () => {
        const wrap = box.closest('[data-photo]');
        const key = wrap?.dataset.photo;
        if (key) document.getElementById('file_' + key)?.click();
      };
      box.addEventListener('click', pick);
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    });
    document.querySelectorAll('[data-clear]').forEach((btn) => {
      btn.addEventListener('click', () => clearPhotoPreview(btn.dataset.clear));
    });
    state.fotos.forEach((f) => {
      const input = document.getElementById('file_' + f.key);
      if (!input) return;
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const patente = document.getElementById('patente')?.value?.trim();
        if (!patente) {
          UI.flash('Primero ingresa y valida la patente, luego sube las fotos', true);
          input.value = '';
          return;
        }
        const pick = document.querySelector(`[data-pick="${f.key}"]`);
        if (pick) {
          pick.disabled = true;
          pick.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo…';
        }
        try {
          const dataUrl = await fileToJpegDataUrl(file);
          showPhotoPreview(f.key, dataUrl);
          state.photoPaths[f.key] = dataUrl;
          try {
            const res = await Auth.api('/api/modulos/checklist/upload-foto', {
              method: 'POST',
              body: JSON.stringify({ patente, tipo: f.key, dataUrl })
            });
            if (res.ruta) state.photoPaths[f.key] = res.ruta;
            UI.flash('✓ Foto subida: ' + f.label);
          } catch (err) {
            // Mantener preview local: al guardar el checklist se reintenta subir
            UI.flash('Foto lista en pantalla. Al guardar se enviará al servidor (' + err.message + ')', true);
          }
        } catch (err) {
          clearPhotoPreview(f.key);
          UI.flash(err.message || 'No se pudo procesar la imagen', true);
        } finally {
          if (pick && state.photoPaths[f.key]) {
            pick.disabled = false;
            pick.classList.add('ck-photo-btn-ok');
            pick.innerHTML = '<i class="fas fa-check"></i> Subida';
          } else if (pick) {
            pick.disabled = false;
            pick.classList.remove('ck-photo-btn-ok');
            pick.innerHTML = '<i class="fas fa-camera"></i> Foto';
          }
          input.value = '';
        }
      });
    });
  }

  function updateProgress() {
    const selects = document.querySelectorAll('#ckPanelNuevo .ck-item-select');
    let done = 0;
    selects.forEach((s) => { if (s.value) done += 1; });
    const bar = document.getElementById('ckProgress');
    const txt = document.getElementById('ckProgressTxt');
    if (bar) bar.style.width = Math.round((done / Math.max(selects.length, 1)) * 100) + '%';
    if (txt) txt.textContent = `${done} / ${selects.length} ítems`;
  }

  async function boot() {
    mountModals();
    const content = document.getElementById('app-content');
    try {
      // Pintar al instante con catálogo local; meta/flota/excel en segundo plano
      state.items = DEFAULT_ITEMS.slice();
      state.fotos = DEFAULT_FOTOS.slice();
      // Ticket de página o atributo Checklist Flota → pueden generar
      const u = Auth.getUser();
      state.canCreate = !!(window.PagesCatalog?.canAccessPage?.(u, 'checklist-flota.html')
        || UI.hasFlag(u, 'flag_checklist'));
      state.canAssign = false;
      state.canManageCatalog = false;
      state.catalogo = {
        total: 0,
        ultima_carga: null,
        archivo_nombre: null,
        cargado_por_nombre: null,
        alert_email: 'flota@serviciossercom.cl'
      };

      content.innerHTML = `
        <div id="flash"></div>
        <div class="ck-stats">
          <div class="ck-stat"><i class="fas fa-clipboard-check"></i><div><b>${state.items.length}</b><span>Ítems inspección</span></div></div>
          <div class="ck-stat"><i class="fas fa-camera"></i><div><b>${state.fotos.length}</b><span>Fotos vehículo</span></div></div>
          <div class="ck-stat"><i class="fas fa-file-excel"></i><div><b id="ckStatCatalogo">0</b><span>Vehículos en Excel</span></div></div>
        </div>
        <div class="ck-tabs">
          <button type="button" class="ck-tab active" data-tab="nuevo"><i class="fas fa-plus"></i> Nuevo checklist</button>
          <button type="button" class="ck-tab" data-tab="historial"><i class="fas fa-list"></i> Requerimientos</button>
          <button type="button" class="ck-tab" id="ckTabCatalogo" data-tab="catalogo" ${state.canManageCatalog ? '' : 'hidden'}><i class="fas fa-file-excel"></i> Catálogo Excel</button>
        </div>
        <div id="ckPanelNuevo" class="ck-panel">
          <div class="card ck-card">
            <div class="card-header"><h2><i class="fas fa-car"></i> Inspección vehicular</h2></div>
            <div class="card-body">
              <div class="ck-vehicle">
                <div class="form-group ck-patente-wrap">
                  <label>Patente *</label>
                  <input id="patente" required placeholder="ABCD12" maxlength="7" autocomplete="off">
                  <div id="patenteStatus" class="ck-patente-status"></div>
                </div>
                <div class="form-group"><label>Kilometraje</label><input type="number" id="kilometraje" min="0" value="0"></div>
                <div class="form-group"><label>Fecha</label><input type="date" id="fecha" value="${typeof localTodayYmd === 'function' ? localTodayYmd() : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })}"></div>
              </div>
              <div id="ckVehiculoInfo" class="ck-vehicle-info" hidden>
                ${vehiculoReadonly('vehiculo_marca', 'Marca', 'Se autocompleta')}
                ${vehiculoReadonly('vehiculo_modelo', 'Modelo', 'Se autocompleta')}
                ${vehiculoReadonly('vehiculo_tipo', 'Tipo de vehículo', 'Se autocompleta')}
                ${vehiculoReadonly('vehiculo_anio', 'Año', 'Se autocompleta')}
                ${vehiculoReadonly('propietario_nombre', 'Dueño / Propietario', 'Se autocompleta')}
                ${vehiculoReadonly('propietario_rut', 'RUT propietario', 'Se autocompleta')}
              </div>
              <div class="ck-progress-wrap">
                <div class="ck-progress-bar"><div class="ck-progress-fill" id="ckProgress"></div></div>
                <span id="ckProgressTxt">0 / ${state.items.length} ítems</span>
              </div>
              <div class="ck-items">${state.items.map((i) => itemSelect(i.key, i.label, '', { inverted: !!i.inverted })).join('')}</div>
              <h3 class="ck-subtitle"><i class="fas fa-camera"></i> Registro fotográfico</h3>
              <div class="ck-photos">${state.fotos.map((f) => photoBox(f.key, f.label, f.required)).join('')}</div>
              <div class="form-row" style="margin-top:1rem">
                <div class="form-group"><label>Observaciones</label><textarea id="observaciones" rows="2"></textarea></div>
              </div>
              <button type="button" class="btn btn-primary" id="btnGuardarCk"><i class="fas fa-save"></i> Guardar checklist</button>
            </div>
          </div>
        </div>
        <div id="ckPanelHistorial" class="ck-panel" hidden>
          <div class="card ck-card">
            <div class="card-header">
              <h2><i class="fas fa-list"></i> Requerimientos e historial</h2>
              <div class="ck-toolbar">
                <input type="search" id="ckBuscar" placeholder="Buscar patente / código…">
                <label class="ck-check"><input type="checkbox" id="ckFiltroInc"> Solo incidencias</label>
                <button type="button" class="btn btn-secondary btn-sm" id="ckBtnBuscar"><i class="fas fa-search"></i></button>
              </div>
            </div>
            <div class="card-body">
              <div class="table-wrap">
                <table class="data ck-table">
                  <thead><tr>
                    <th>Fecha</th><th>Código</th><th>Patente</th><th>Km</th><th>Estado</th>
                    <th>Ítems</th><th>Fotos</th><th>Conductor</th><th>Encargado</th><th>Acciones</th>
                  </tr></thead>
                  <tbody id="ckTbody"></tbody>
                </table>
              </div>
              <div id="ckPager"></div>
            </div>
          </div>
        </div>
        <div id="ckPanelCatalogo" class="ck-panel" hidden>
          <div class="card ck-card">
            <div class="card-header"><h2><i class="fas fa-file-excel"></i> Catálogo de flota (Excel)</h2></div>
            <div class="card-body ck-catalogo">
              <p class="ck-catalogo-intro">También puede cargar el Excel desde <a href="/configuraciones.html">Configuraciones → Catálogo flota (Excel)</a>. Al ingresar una patente en el checklist, se autocompletará desde este archivo. Si la patente <strong>no está</strong> en el catálogo, se envía un aviso a <strong>${esc(state.catalogo.alert_email)}</strong>.</p>
              <div class="ck-catalogo-stats" id="ckCatalogoStats">
                ${state.catalogo.archivo_nombre
                  ? `<i class="fas fa-file-excel"></i> <b>${esc(state.catalogo.archivo_nombre)}</b> · ${state.catalogo.total || 0} vehículos · ${formatDateTime(state.catalogo.ultima_carga)}`
                  : `<b>${state.catalogo.total || 0}</b> vehículos · Sin Excel cargado`}
              </div>
              <div class="ck-catalogo-actions">
                <button type="button" class="btn btn-outline" id="ckBtnPlantilla"><i class="fas fa-download"></i> Descargar plantilla</button>
                <input type="file" id="ckExcelFile" accept=".xlsx,.xls" hidden>
                <button type="button" class="btn btn-primary" id="ckBtnSubirExcel"><i class="fas fa-upload"></i> ${state.catalogo.archivo_nombre ? 'Reemplazar Excel' : 'Subir Excel'}</button>
                ${state.catalogo.archivo_nombre ? `<button type="button" class="btn btn-danger" id="ckBtnEliminarExcel"><i class="fas fa-trash"></i> Eliminar</button>` : ''}
              </div>
              <div class="ck-catalogo-help">
                <h4>Columnas</h4>
                <ul>
                  <li><strong>Patente</strong> — obligatoria (se leen todas las hojas)</li>
                  <li><strong>Modelo</strong> / Marca — recomendadas</li>
                  <li>Opcionales: Tipo, Año, Propietario, RUT</li>
                </ul>
                <p class="ck-muted">En el checklist, al escribir la patente se consulta este catálogo automáticamente.</p>
              </div>
            </div>
          </div>
        </div>`;

      document.querySelectorAll('.ck-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.ck-tab').forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');
          const tabName = tab.dataset.tab;
          document.getElementById('ckPanelNuevo').hidden = tabName !== 'nuevo';
          document.getElementById('ckPanelHistorial').hidden = tabName !== 'historial';
          document.getElementById('ckPanelCatalogo').hidden = tabName !== 'catalogo';
          if (tabName === 'historial') loadList();
          if (tabName === 'catalogo') loadCatalogoInfo();
        });
      });

      wireItemToggles(document.getElementById('ckPanelNuevo'));
      wirePhotos();
      wirePatente();
      wireCatalogoUpload();
      document.getElementById('ckBtnBuscar')?.addEventListener('click', () => { state.page = 1; loadList(); });
      document.getElementById('ckBuscar')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.page = 1; loadList(); } });
      document.getElementById('ckFiltroInc')?.addEventListener('change', () => { state.page = 1; loadList(); });

      // Datos secundarios sin bloquear la UI
      Promise.all([
        Auth.api('/api/modulos/checklist/meta').catch(() => null),
        UI.loadUsuarios('flota').catch(() => []),
        Auth.api('/api/modulos/checklist/catalogo').catch(() => ({ total: 0, can_manage: false }))
      ]).then(([meta, flota, catalogo]) => {
        state.flota = flota || [];
        if (meta?.items?.length) state.items = meta.items;
        if (meta?.fotos?.length) state.fotos = meta.fotos;
        state.canManageCatalog = !!catalogo.can_manage;
        state.catalogo = {
          total: catalogo.total || 0,
          ultima_carga: catalogo.ultima_carga || null,
          archivo_nombre: catalogo.archivo_nombre || null,
          cargado_por_nombre: catalogo.cargado_por_nombre || null,
          alert_email: catalogo.alert_email || state.catalogo.alert_email
        };
        const stat = document.getElementById('ckStatCatalogo');
        if (stat) stat.textContent = String(state.catalogo.total || 0);
        const tab = document.getElementById('ckTabCatalogo');
        if (tab) tab.hidden = !state.canManageCatalog;
        const statsEl = document.getElementById('ckCatalogoStats');
        if (statsEl) {
          statsEl.innerHTML = state.catalogo.archivo_nombre
            ? `<i class="fas fa-file-excel"></i> <b>${esc(state.catalogo.archivo_nombre)}</b> · ${state.catalogo.total || 0} vehículos · ${formatDateTime(state.catalogo.ultima_carga)}`
            : `<b>${state.catalogo.total || 0}</b> vehículos · Sin Excel cargado`;
        }
      });

      document.getElementById('btnGuardarCk')?.addEventListener('click', async () => {
        const patente = document.getElementById('patente').value.trim();
        if (!patente) return UI.flash('Patente requerida', true);
        if (!state.patenteOk) {
          await validarPatenteInput();
          if (!state.patenteOk) return UI.flash('Patente no válida o no verificada', true);
        }
        for (const i of state.items) {
          const el = document.getElementById(i.key);
          if (!el || !el.value) return UI.flash('Seleccione estado en: ' + i.label, true);
        }
        const colision = document.getElementById('nivel_aceite')?.value === 'Falla';
        const requiredPhotos = state.fotos.filter((x) => x.required || (x.key === 'foto_colision' && colision));
        for (const f of requiredPhotos) {
          if (!state.photoPaths[f.key]) {
            if (f.key === 'foto_colision') {
              return UI.flash('Marcó «Sí» en choque/colisión: adjunta la foto de colisión, o marca «No» si no hubo choque.', true);
            }
            return UI.flash('Falta foto: ' + f.label, true);
          }
        }
        const body = {
          patente, kilometraje: Number(document.getElementById('kilometraje').value) || 0,
          fecha: document.getElementById('fecha').value,
          observaciones: document.getElementById('observaciones').value || null,
          fotos: { ...state.photoPaths },
          ...vehiculoPayload()
        };
        state.items.forEach((i) => { const el = document.getElementById(i.key); if (el) body[i.key] = el.value; });
        try {
          const res = await Auth.api('/api/modulos/checklist', { method: 'POST', body: JSON.stringify(body) });
          UI.flash('Checklist ' + (res.data?.codigo || '') + ' guardado');
          state.photoPaths = {};
          document.getElementById('patente').value = '';
          clearVehiculoInfo();
          document.getElementById('patenteStatus').innerHTML = '';
          document.querySelectorAll('.ck-photo-preview').forEach((img) => {
            img.setAttribute('hidden', '');
            img.removeAttribute('src');
          });
          document.querySelectorAll('.ck-photo-box').forEach((b) => {
            b.classList.remove('uploaded');
            const icon = b.querySelector('.ck-photo-icon');
            if (icon) icon.style.display = '';
            const meta = b.querySelector('.ck-photo-meta');
            if (meta) meta.textContent = meta.dataset.default || '';
          });
          document.querySelectorAll('.ck-photo').forEach((w) => w.classList.remove('is-uploaded'));
          document.querySelectorAll('[data-pick]').forEach((b) => {
            b.classList.remove('ck-photo-btn-ok');
            b.disabled = false;
            b.innerHTML = 'Tomar / subir';
          });
          document.querySelectorAll('#ckPanelNuevo .ck-item').forEach((row) => {
            const input = row.querySelector('.ck-item-select');
            if (input) input.value = '';
            row.querySelectorAll('.ck-tog').forEach((b) => {
              b.classList.remove('is-on');
              b.setAttribute('aria-pressed', 'false');
            });
          });
          updateProgress();
          toggleColisionPhoto();
        } catch (err) { UI.flash(err.message, true); }
      });

      // Confirmar permisos reales desde API (crear vs tomar/editar proceso)
      try {
        const pack = await Auth.api('/api/modulos/checklist?page=1&limit=1');
        state.canCreate = !!pack.can_create;
        state.canAssign = !!pack.can_assign_flota;
        const panel = document.getElementById('ckPanelNuevo');
        if (!state.canCreate && panel && !panel.querySelector('.alert')) {
          panel.innerHTML =
            '<div class="alert alert-ok">Tu rol no tiene acceso a Checklist Flota para registrar inspecciones. Pide el ticket en Configuraciones → Roles.</div>';
          document.querySelector('.ck-tab[data-tab="historial"]')?.click();
        }
      } catch (_) { /* keep local estimate */ }
    } catch (e) {
      content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
  }

  window.CkFlota = { boot, ver, editar, cerrarVer, cerrarEdit, tomar, anular };
})();
