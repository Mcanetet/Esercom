/**
 * Catálogo de páginas — roles, sidebar y home (paginas_permitidas en BD).
 */
(function () {
  const PAGES = [
    { key: 'home.html', label: 'Menú Principal' },
    { key: 'solicitud-salida-materiales.html', label: 'Solicitud de Salida Materiales' },
    { key: 'salida-material-por-actividad.html', label: 'Salida Material por Actividad' },
    { key: 'portal-proveedores.html', label: 'Portal Proveedores' },
    { key: 'materiales-por-receta.html', label: 'Materiales por Receta' },
    { key: 'solicitud-de-compras.html', label: 'Solicitud de Compras' },
    { key: 'creacion-datos-maestros.html', label: 'Creación Datos Maestros' },
    { key: 'tareas-operativas.html', label: 'Tareas Operativas' },
    { key: 'solicitud-de-graficas.html', label: 'Solicitud de Gráficas' },
    { key: 'serviciosgenerales.html', label: 'Servicios Generales' },
    { key: 'agenda-camion-pluma.html', label: 'Agenda Camión Pluma' },
    { key: 'checklist-flota.html', label: 'Checklist Flota' },
    { key: 'inspeccion.html', label: 'Inspección' },
    { key: 'wms.html', label: 'WMS Bodega' },
    { key: 'catalogo-g.html', label: 'Catálogo G', empresas: ['global'] },
    { key: 'catalogo-s.html', label: 'Catálogo S', empresas: ['sercom'] },
    { key: 'catalogo-n.html', label: 'Catálogo N', empresas: ['nexus'] },
    { key: 'catalogo-t.html', label: 'Catálogo T', empresas: ['tactica'] },
    { key: 'telecomunicaciones.html', label: 'Telecomunicaciones' },
    { key: 'seguimiento-contratos.html', label: 'Gestión de Contratos' },
    { key: 'aprobacion-facturas.html', label: 'Aprobación de Facturas' },
    { key: 'reportes.html', label: 'Reportes' },
    { key: 'angel-ia.html', label: 'Angel IA' },
    { key: 'incidencias.html', label: 'Incidencias' },
    { key: 'configuraciones.html', label: 'Configuraciones' },
    { key: 'papelera.html', label: 'Papelera' }
  ];
  const IMPLIED = {
    'ver-solicitud.html': 'solicitud-salida-materiales.html',
    'ver-compras.html': 'solicitud-de-compras.html'
  };
  function normalizeKey(raw) {
    const s = String(raw || '').trim().replace(/^\//, '');
    if (!s || s === '*') return s || '*';
    return s;
  }
  function keysMatch(allowed, target) {
    const a = normalizeKey(allowed);
    const t = normalizeKey(target);
    if (!a || !t) return false;
    if (a === t) return true;
    return a.replace(/\.html$/i, '') === t.replace(/\.html$/i, '');
  }
  function isAdminUser(user) {
    if (!user) return false;
    if (user.rol_id === 1) return true;
    if (Array.isArray(user.rol_ids) && user.rol_ids.map(Number).includes(1)) return true;
    const names = [
      user.rol,
      ...(Array.isArray(user.roles) ? user.roles : [])
    ].join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    return /\badmin|\badministrador|\bsubadmin|\bsubadministrador|\bsub-administrador/.test(names)
      || names.includes('admin');
  }
  function getAllowedPages(user) {
    if (!user) return [];
    let pages = user.paginas_permitidas;
    try { if (typeof pages === 'string') pages = JSON.parse(pages); } catch (_) { /* ignore */ }
    if (!Array.isArray(pages)) return ['*'];
    return pages;
  }
  function canAccessPage(user, hrefOrKey) {
    if (!user) return false;
    let key = normalizeKey(hrefOrKey);
    // Perfil propio: siempre permitido para cualquier usuario autenticado
    if (keysMatch(key, 'perfil.html') || keysMatch(key, 'mi-perfil.html')) return true;
    // Incidencias: cualquier usuario autenticado puede reportar / ver las suyas
    if (keysMatch(key, 'incidencias.html')) return true;

    const page = PAGES.find((p) => keysMatch(p.key, key));
    if (page?.empresas?.length) {
      const emp = String(user.empresa || '').toLowerCase();
      if (!page.empresas.map((e) => String(e).toLowerCase()).includes(emp)) return false;
    }

    // Techo de módulos por empresa (Configuraciones → Módulos visibles)
    const techo = user.modulos_empresa;
    const compartidos = user.modulos_compartidos;
    const isCompartido = Array.isArray(compartidos)
      && compartidos.some((p) => keysMatch(p, key) || (IMPLIED[key] && keysMatch(p, IMPLIED[key])));
    if (Array.isArray(techo) && techo.length && !techo.includes('*')) {
      const always = /^(home|configuraciones|perfil|incidencias)(\.html)?$/i;
      const parent = IMPLIED[key];
      const inTecho = isCompartido
        || techo.some((p) => keysMatch(p, key))
        || (parent && techo.some((p) => keysMatch(p, parent)))
        || always.test(String(key).replace(/^\//, ''));
      if (!inTecho) return false;
      // Catálogo G: si pasó techo y es módulo solo-global, ok para esa empresa
      if (page?.empresas?.length) return true;
    } else if (page?.empresas?.length) {
      return true;
    }

    if (isAdminUser(user)) return true;
    const pages = getAllowedPages(user);
    if (pages.includes('*')) return true;
    if (pages.some((p) => keysMatch(p, key))) return true;
    const parent = IMPLIED[key];
    if (parent && pages.some((p) => keysMatch(p, parent))) return true;
    return false;
  }
  function pageCheckboxId(key) {
    return 'rp_' + String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
  }
  window.PAGES_CATALOG = PAGES;
  window.PagesCatalog = {
    PAGES, IMPLIED, normalizeKey, keysMatch, isAdminUser, getAllowedPages, canAccessPage, pageCheckboxId
  };
})();

/* Auth helpers shared across pages */
const Auth = {
  _getCache: new Map(),
  getToken() {
    return localStorage.getItem('auth_token');
  },
  getUser() {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  setSession(user, token) {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('auth_token', token);
  },
  clear() {
    localStorage.removeItem('user');
    localStorage.removeItem('auth_token');
    this._getCache.clear();
  },
  invalidateApiCache() {
    this._getCache.clear();
  },
  require() {
    const token = this.getToken();
    const user = this.getUser();
    if (!token || !user) {
      window.location.replace('/login.html');
      return null;
    }
    return user;
  },
  logout() {
    this.clear();
    window.location.replace('/login.html');
  },
  async api(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const ttl = options.cacheTtl != null ? options.cacheTtl : 45000;
    if (method === 'GET' && !options.noCache && ttl > 0) {
      const hit = this._getCache.get(url);
      if (hit && Date.now() - hit.t < ttl) return hit.data;
    }

    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      options.headers || {}
    );
    const token = this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      // Algunos proxies/Apache no reenvían Authorization; duplicamos en header custom
      headers['X-Auth-Token'] = token;
    }

    const { cacheTtl, noCache, forceLogout, ...fetchOpts } = options;
    const res = await fetch(url, {
      ...fetchOpts,
      method,
      headers,
      cache: method === 'GET' ? 'default' : 'no-store'
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      const raw = String(text || '');
      if (res.status === 413 || /413|Request Entity Too Large|entity too large/i.test(raw)) {
        throw new Error('La foto es demasiado grande. Se comprimirá al guardar; prueba de nuevo.');
      }
      if (/<!DOCTYPE|<html/i.test(raw)) {
        throw new Error(res.status === 413
          ? 'La foto es demasiado grande'
          : (`Error del servidor (${res.status || '?'})`));
      }
      const hint = raw.trim().slice(0, 180) || 'Respuesta inválida del servidor';
      throw new Error(hint);
    }
    if (res.status === 401) {
      const isAuthRoute = String(url).includes('/api/auth/');
      if (isAuthRoute || forceLogout) {
        this.logout();
      }
      throw new Error(data.message || 'Sesión expirada');
    }
    if (res.status === 413) {
      throw new Error(data.message || 'La foto es demasiado grande');
    }
    if (!res.ok || data.success === false) {
      throw new Error(data.message || `Error ${res.status}`);
    }
    if (method === 'GET' && !noCache && ttl > 0) {
      this._getCache.set(url, { t: Date.now(), data });
    } else if (method !== 'GET') {
      this._getCache.clear();
    }
    return data;
  }
};

function formatDate(value) {
  if (!value) return '—';
  const s = String(value).trim();
  // YYYY-MM-DD (o medianoche): fecha de calendario, sin convertir zona (evita “día anterior” en Chile)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const hasTime = m[4] != null;
    const isMidnight = !hasTime || (m[4] === '00' && m[5] === '00' && (!m[6] || m[6] === '00'));
    if (isMidnight) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const raw = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Fecha local YYYY-MM-DD (Chile / navegador). No usar toISOString(). */
function localTodayYmd() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  } catch (_) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebarOverlay')?.classList.toggle('show');
  document.body.classList.toggle('nav-open');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('show');
  document.body.classList.remove('nav-open');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderShell(activeHref, title, subtitle) {
  const user = Auth.require();
  if (!user) return null;

  // Refrescar techo de módulos de la empresa (sesiones anteriores / cambios de admin)
  if (!window.__modulosEmpresaRefreshed) {
    window.__modulosEmpresaRefreshed = true;
    Auth.api('/api/modulos/config/modulos-empresa')
      .then((res) => {
        const visibles = res.data?.visibles;
        if (!Array.isArray(visibles)) return;
        const u = Auth.getUser();
        if (!u) return;
        const configured = !!res.data?.configured;
        const compartidos = Array.isArray(res.data?.compartidos) ? res.data.compartidos : [];
        u.modulos_compartidos = compartidos;
        // Sin configuración guardada: no forzar lista (null = todos visibles)
        if (!configured && !Array.isArray(u.modulos_empresa)) {
          Auth.setUser(u);
          return;
        }
        const prevTecho = JSON.stringify(u.modulos_empresa || null);
        const nextTecho = configured ? JSON.stringify(visibles) : 'null';
        u.modulos_empresa = configured ? visibles : null;
        u.modulos_empresa_configured = configured;
        Auth.setUser(u);
        if (prevTecho === nextTecho) return;
        const href = (location.pathname.split('/').pop() || 'home.html').toLowerCase();
        if (href && href !== 'login.html' && !PagesCatalog.canAccessPage(u, href)) {
          location.href = '/home.html';
          return;
        }
        if (configured) location.reload();
      })
      .catch(() => {});
  }

  const catalog = window.PAGES_CATALOG || [];
  const canAccess = window.PagesCatalog?.canAccessPage || (() => true);

  const iconByKey = {
    'home.html': 'fa-tachometer-alt',
    'solicitud-salida-materiales.html': 'fa-boxes',
    'salida-material-por-actividad.html': 'fa-layer-group',
    'portal-proveedores.html': 'fa-dolly-flatbed',
    'materiales-por-receta.html': 'fa-ruler-combined',
    'solicitud-de-compras.html': 'fa-shopping-cart',
    'creacion-datos-maestros.html': 'fa-database',
    'tareas-operativas.html': 'fa-tasks',
    'solicitud-de-graficas.html': 'fa-image',
    'serviciosgenerales.html': 'fa-tools',
    'agenda-camion-pluma.html': 'fa-truck-ramp-box',
    'checklist-flota.html': 'fa-clipboard-check',
    'inspeccion.html': 'fa-clipboard-list',
    'wms.html': 'fa-warehouse',
    'catalogo-g.html': 'fa-boxes-stacked',
    'catalogo-s.html': 'fa-boxes-stacked',
    'catalogo-n.html': 'fa-boxes-stacked',
    'catalogo-t.html': 'fa-boxes-stacked',
    'telecomunicaciones.html': 'fa-satellite-dish',
    'seguimiento-contratos.html': 'fa-file-contract',
    'aprobacion-facturas.html': 'fa-file-invoice-dollar',
    'reportes.html': 'fa-chart-bar',
    'angel-ia.html': 'fa-comment-dots',
    'incidencias.html': 'fa-life-ring',
    'configuraciones.html': 'fa-cog',
    'papelera.html': 'fa-trash-alt'
  };

  const links = catalog
    .map((p) => ({
      href: '/' + p.key,
      icon: iconByKey[p.key] || 'fa-circle',
      label: p.label,
      key: p.key
    }))
    .filter((l) => canAccess(user, l.key));

  const ADMIN_KEYS = new Set(['configuraciones.html', 'papelera.html']);
  const linkHtml = (l) => {
    const active = l.href === activeHref ? 'active' : '';
    return `<a class="${active}" href="${l.href}"><i class="fas ${l.icon}"></i> ${l.label}</a>`;
  };
  const mainLinks = links.filter((l) => !ADMIN_KEYS.has(l.key));
  const adminLinks = links.filter((l) => ADMIN_KEYS.has(l.key));
  const nav = mainLinks.map(linkHtml).join('')
    + (adminLinks.length
      ? `<div class="sidebar-nav-divider" aria-hidden="true"></div>${adminLinks.map(linkHtml).join('')}`
      : '');

  if (!canAccess(user, activeHref.replace(/^\//, ''))) {
    document.body.innerHTML = '<div class="alert alert-error" style="margin:2rem">No tienes permiso para acceder a esta página.</div>';
    return null;
  }

  const sub = subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : '';

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="logo"><i class="fas fa-cube"></i></div>
          <h1>ESERCOM</h1>
          <p>Gestión Integral</p>
          <span class="sidebar-company">${escapeHtml(user.empresaNombre || user.empresa || '')}</span>
        </div>
        <nav class="sidebar-nav">${nav}</nav>
        <div class="sidebar-footer">
          <a class="sidebar-profile${activeHref === '/perfil.html' ? ' active' : ''}" href="/perfil.html" id="sidebarProfileLink" title="Ver mi perfil">
            <i class="fas fa-user-circle"></i>
            <span>
              <strong class="user-name">${escapeHtml(user.nombreCompleto || user.nombre || '')}</strong>
              <em class="user-role">Mi perfil</em>
            </span>
            <i class="fas fa-chevron-right sidebar-profile-arrow" aria-hidden="true"></i>
          </a>
          <button class="btn-logout" onclick="Auth.logout()"><i class="fas fa-sign-out-alt"></i> Cerrar Sesión</button>
        </div>
      </aside>
      <div class="main">
        <header class="top-header">
          <div class="header-left-wrap">
            <button class="mobile-toggle" type="button" onclick="toggleSidebar()" aria-label="Abrir menú"><i class="fas fa-bars"></i></button>
            <div>
              <h1 class="page-title">${title}</h1>
              ${sub}
            </div>
          </div>
          <div class="header-right-wrap">
            <div class="header-alerts" id="headerAlerts">
              <button type="button" class="header-alert-btn" id="alertBellBtn" aria-label="Alertas" title="Mis alertas">
                <i class="fas fa-bell"></i>
                <span class="header-alert-badge" id="alertBadge" hidden>0</span>
              </button>
              <div class="header-alert-panel" id="alertPanel" hidden>
                <div class="header-alert-panel-head">
                  <strong>Mis alertas</strong>
                  <button type="button" class="linkish" id="alertMarkAll">Marcar todas</button>
                </div>
                <div class="header-alert-panel-body" id="alertPanelBody">
                  <p class="home-empty">Cargando…</p>
                </div>
                <a class="header-alert-panel-foot" href="/angel-ia.html">Ver en Angel IA</a>
              </div>
            </div>
            <a class="header-profile${activeHref === '/perfil.html' ? ' active' : ''}" href="/perfil.html" title="Ver mi perfil">
              <i class="fas fa-user-circle"></i>
              <span class="header-profile-name">${escapeHtml(user.nombreCompleto || user.nombre || user.email || '')}</span>
              <i class="fas fa-chevron-down header-profile-arrow" aria-hidden="true"></i>
            </a>
          </div>
        </header>
        <div class="content" id="app-content"></div>
      </div>
    </div>
  `);

  // Prefetch + navegación forzada (el SW no debe bloquear HTML)
  document.querySelectorAll('.sidebar-nav a, .sidebar-profile, a.header-profile').forEach((a) => {
    a.addEventListener('pointerenter', () => {
      if (a.dataset.prefetched) return;
      a.dataset.prefetched = '1';
      const href = a.getAttribute('href');
      if (!href || href === activeHref) return;
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = href;
      document.head.appendChild(link);
    }, { once: true });
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (!href) return;
      closeSidebar();
      if (a.classList.contains('active') && href === activeHref) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      a.classList.add('nav-going');
      window.location.assign(href);
    });
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeSidebar();
  });

  // No bloquear el paint: alertas / sesión / Angel en idle
  const defer = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  defer(() => {
    initHeaderAlerts();
    refreshUserSession();
    loadAngelWidget(user);
  }, { timeout: 1800 });

  return user;
}

async function initHeaderAlerts() {
  const badge = document.getElementById('alertBadge');
  const panel = document.getElementById('alertPanel');
  const body = document.getElementById('alertPanelBody');
  const bell = document.getElementById('alertBellBtn');
  const markAll = document.getElementById('alertMarkAll');
  if (!bell || !panel) return;

  // Panel siempre cerrado hasta que se pulse la campana
  panel.setAttribute('hidden', '');

  let knownIds = null; // null = primera carga (sin sonido)
  let pollTimer = null;
  let toastTimer = null;
  let lastToastAlert = null;

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Resuelve a qué pantalla ir según módulo/referencia de la alerta */
  function resolveAlertHref(alerta) {
    if (!alerta) return null;
    const mod = String(alerta.modulo || '').toLowerCase();
    const ref = String(alerta.referencia || '').trim();
    const titulo = String(alerta.titulo || '');
    const blob = `${mod} ${ref} ${titulo} ${alerta.mensaje || ''}`.toLowerCase();

    const solmat = ref.match(/^solmat:(\d+)/i);
    if (solmat) return `/ver-solicitud.html?id=${solmat[1]}`;

    const compra = ref.match(/^compra:(\d+)/i);
    if (compra) return `/solicitud-de-compras.html?id=${compra[1]}`;

    if (/^\d+$/.test(ref) && /material|solmat|salida/.test(blob)) {
      return `/ver-solicitud.html?id=${ref}`;
    }

    // Referencias antiguas: CODIGO:estado (ej. SOLMAT-00012:Pendiente)
    if (ref && /material|solmat|salida|solicitud/.test(blob)) {
      const code = ref.split(':')[0].trim();
      if (code && !/^solmat$/i.test(code)) {
        return `/ver-solicitud.html?codigo=${encodeURIComponent(code)}`;
      }
    }

    const codeInTitle = titulo.match(/\b(SOLMAT-\d+|SM-?\d+)\b/i);
    if (codeInTitle && /material|solmat|salida|solicitud|aprob/.test(blob)) {
      return `/ver-solicitud.html?codigo=${encodeURIComponent(codeInTitle[1])}`;
    }

    if (mod.includes('checklist') || /checklist/.test(blob)) return '/checklist-flota.html';
    if (mod.includes('compra') || /compra/.test(blob)) return '/solicitud-de-compras.html';
    if (mod.includes('agenda') || mod.includes('camion') || /pluma|agenda/.test(blob)) {
      return '/agenda-camion-pluma.html';
    }
    if (mod.includes('inspeccion') || /inspecci/.test(blob)) return '/inspeccion.html';
    if (mod.includes('wms') || /bodega|almacen|warehouse/.test(blob)) return '/wms.html';
    if (mod.includes('catalogo-flota') || /patente/.test(blob)) return '/configuraciones.html';
    if (mod.includes('material') || mod.includes('solicitud-salida')) {
      return '/solicitud-salida-materiales.html';
    }
    return null;
  }

  async function openAlertTarget(alerta) {
    const href = resolveAlertHref(alerta);
    hideToast();
    closePanel();
    if (alerta?.id) {
      try {
        await Auth.api('/api/angel/alertas/' + alerta.id + '/leer', { method: 'POST', body: '{}' });
        if (knownIds) knownIds.delete(String(alerta.id));
      } catch (_) { /* ignore */ }
    }
    if (href) {
      window.location.assign(href);
      return;
    }
    await refreshAlerts({ render: true, playSound: false });
  }

  function ensureToastEl() {
    let el = document.getElementById('alertToast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'alertToast';
    el.className = 'alert-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <button type="button" class="alert-toast-card" id="alertToastBtn">
        <span class="alert-toast-icon"><i class="fas fa-bell"></i></span>
        <span class="alert-toast-text">
          <strong id="alertToastTitle">Nueva alerta</strong>
          <em id="alertToastMsg"></em>
        </span>
      </button>`;
    document.body.appendChild(el);
    document.getElementById('alertToastBtn')?.addEventListener('click', () => {
      const target = lastToastAlert;
      hideToast();
      if (target) openAlertTarget(target);
      else openPanel();
    });
    return el;
  }

  function hideToast() {
    const el = document.getElementById('alertToast');
    if (!el) return;
    el.classList.remove('is-visible');
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function showToastBanner(alerta) {
    const el = ensureToastEl();
    lastToastAlert = alerta || null;
    const title = document.getElementById('alertToastTitle');
    const msg = document.getElementById('alertToastMsg');
    if (title) title.textContent = alerta?.titulo || 'Nueva alerta';
    if (msg) msg.textContent = alerta?.mensaje || 'Toca para ver el detalle';
    // restart animation
    el.classList.remove('is-visible');
    void el.offsetWidth;
    el.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5500);
  }

  function notifyNewAlert(alerta) {
    showToastBanner(alerta);
    const href = resolveAlertHref(alerta);
    const payload = href ? { ...alerta, href } : alerta;
    if (window.EsercomNotif?.notify) {
      window.EsercomNotif.notify(payload);
      return;
    }
    try {
      if (navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 40, 120, 220]);
    } catch (_) { /* ignore */ }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const playBeep = (freq, start, dur) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      };
      playBeep(880, now, 0.12);
      playBeep(1319, now + 0.14, 0.16);
      setTimeout(() => { try { ctx.close(); } catch (_) { /* ignore */ } }, 600);
    } catch (_) { /* ignore */ }
  }

  function renderList(data) {
    if (!body) return;
    if (!data.length) {
      body.innerHTML = '<p class="home-empty">No tienes alertas pendientes</p>';
      return;
    }
    body.innerHTML = data.slice(0, 20).map((a) => `
      <button type="button" class="header-alert-item sev-${a.severidad || 'media'}"
        data-id="${a.id}"
        data-modulo="${escapeHtml(a.modulo || '')}"
        data-ref="${escapeHtml(a.referencia || '')}"
        data-titulo="${escapeHtml(a.titulo || '')}"
        data-mensaje="${escapeHtml(a.mensaje || '')}">
        <strong>${escapeHtml(a.titulo)}</strong>
        <span>${escapeHtml(a.mensaje)}</span>
      </button>
    `).join('');
    body.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        await openAlertTarget({
          id: btn.dataset.id,
          modulo: btn.dataset.modulo,
          referencia: btn.dataset.ref,
          titulo: btn.dataset.titulo,
          mensaje: btn.dataset.mensaje
        });
      });
    });
  }

  function setBadge(count) {
    if (!badge) return;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
  }

  async function refreshAlerts({ render = false, playSound = true } = {}) {
    try {
      const { data } = await Auth.api('/api/angel/alertas?unread=1', { cacheTtl: 0, noCache: true });
      const list = Array.isArray(data) ? data : [];
      const ids = list.map((a) => String(a.id));
      const count = list.length;
      setBadge(count);

      // Solo banner/sonido/vibración si llegan alertas nuevas (no en la 1ª carga)
      if (knownIds !== null && playSound) {
        const newest = list.find((a) => !knownIds.has(String(a.id)));
        if (newest) notifyNewAlert(newest);
      }
      knownIds = new Set(ids);

      const panelOpen = !panel.hasAttribute('hidden');
      if (render || panelOpen) renderList(list);
    } catch (_) {
      if (render && body) body.innerHTML = '<p class="home-empty">No se pudieron cargar alertas</p>';
    }
  }

  function openPanel() {
    panel.removeAttribute('hidden');
    hideToast();
    refreshAlerts({ render: true, playSound: false });
  }

  function closePanel() {
    panel.setAttribute('hidden', '');
  }

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.hasAttribute('hidden')) openPanel();
    else closePanel();
  });

  markAll?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await Auth.api('/api/angel/alertas/leer-todas', { method: 'POST', body: '{}' });
      refreshAlerts({ render: true, playSound: false });
    } catch (_) { /* ignore */ }
  });

  document.addEventListener('click', (e) => {
    if (!panel.hasAttribute('hidden') && !document.getElementById('headerAlerts')?.contains(e.target)) {
      closePanel();
    }
  });

  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    // Visible: ~8s (casi tiempo real). En background: 20s para ahorrar batería.
    const ms = document.visibilityState === 'visible' ? 8000 : 20000;
    pollTimer = setInterval(() => {
      refreshAlerts({ render: false, playSound: true });
    }, ms);
  }

  // Primera carga: solo badge, sin abrir panel ni sonar
  refreshAlerts({ render: false, playSound: false });
  schedulePoll();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      window.EsercomNotif?.unlock?.();
      refreshAlerts({ render: false, playSound: true });
    }
    schedulePoll();
  });

  window.addEventListener('focus', () => {
    refreshAlerts({ render: false, playSound: true });
  });

  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
  }, { once: true });
}

/** Actualiza flags/perfil desde el servidor (Configuraciones) */
async function refreshUserSession() {
  try {
    const data = await Auth.api('/api/auth/me');
    if (data?.user) {
      const token = Auth.getToken();
      Auth.setSession(data.user, token);
      Object.assign(Auth.getUser() || {}, data.user);
    }
  } catch (_) { /* ignore */ }
}

window.Auth = Auth;
window.formatDate = formatDate;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.renderShell = renderShell;
window.initHeaderAlerts = initHeaderAlerts;
window.refreshUserSession = refreshUserSession;

(function loadNotifAlert() {
  if (document.querySelector('script[data-notif-alert]')) return;
  const s = document.createElement('script');
  s.src = '/js/notif-alert.js?v=2';
  s.setAttribute('data-notif-alert', '1');
  document.head.appendChild(s);
})();

(function loadPwa() {
  if (document.querySelector('script[data-pwa]')) return;
  const s = document.createElement('script');
  s.src = '/js/pwa.js?v=notif1';
  s.setAttribute('data-pwa', '1');
  document.head.appendChild(s);
})();

function loadAngelWidget(user) {
  if (/\/(acceso-angel|angel-entrenamiento)\.html$/i.test(window.location.pathname)) return;
  if (document.querySelector('script[data-angel-widget]')) return;
  const bumpCss = () => {
    const links = document.querySelectorAll('link[rel="stylesheet"][href*="/css/app.css"]');
    links.forEach((el) => {
      const u = new URL(el.href, window.location.origin);
      if (u.searchParams.get('v') === 'mob2') return;
      u.searchParams.set('v', 'mob2');
      el.href = u.pathname + u.search;
    });
  };
  bumpCss();
  const loadWidget = () => {
    const s = document.createElement('script');
    s.src = '/js/angel-widget.js?v=fab3';
    s.setAttribute('data-angel-widget', '1');
    document.querySelectorAll('link[rel="stylesheet"][href*="app.css"]').forEach((link) => {
      try {
        const u = new URL(link.href, window.location.origin);
        u.searchParams.set('v', 'fab3');
        link.href = u.pathname + '?' + u.searchParams.toString();
      } catch (_) { /* ignore */ }
    });
    s.onload = () => {
      if (typeof window.initAngelWidget === 'function') window.initAngelWidget(user);
    };
    document.head.appendChild(s);
  };
  if (!document.querySelector('script[data-angel-chat-ui]')) {
    const ui = document.createElement('script');
    ui.src = '/js/angel-chat-ui.js?v=voz3';
    ui.setAttribute('data-angel-chat-ui', '1');
    ui.onload = loadWidget;
    document.head.appendChild(ui);
  } else {
    loadWidget();
  }
}
