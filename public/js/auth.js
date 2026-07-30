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
    { key: 'telecomunicaciones.html', label: 'Telecomunicaciones' },
    { key: 'seguimiento-contratos.html', label: 'Gestión de Contratos' },
    { key: 'aprobacion-facturas.html', label: 'Aprobación de Facturas' },
    { key: 'reportes.html', label: 'Reportes' },
    { key: 'angel-ia.html', label: 'Angel IA' },
    { key: 'angel-seguridad.html', label: 'Seguridad Angel IA' },
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
    const rol = String(user.rol || '').toLowerCase();
    return user.rol_id === 1 || rol.includes('admin');
  }
  function getAllowedPages(user) {
    if (!user) return [];
    let pages = user.paginas_permitidas;
    try { if (typeof pages === 'string') pages = JSON.parse(pages); } catch (_) { /* ignore */ }
    if (!Array.isArray(pages)) return ['*'];
    return pages;
  }
  function canAccessPage(user, hrefOrKey) {
    if (isAdminUser(user)) return true;
    const pages = getAllowedPages(user);
    if (pages.includes('*')) return true;
    let key = normalizeKey(hrefOrKey);
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

    const res = await fetch(url, { ...options, headers, cache: 'no-store' });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      const hint = String(text || '').trim().slice(0, 180) || 'Respuesta inválida del servidor';
      throw new Error(hint);
    }
    if (res.status === 401) {
      const isAuthRoute = String(url).includes('/api/auth/');
      if (isAuthRoute || options.forceLogout) {
        this.logout();
      }
      throw new Error(data.message || 'Sesión expirada');
    }
    if (!res.ok || data.success === false) {
      throw new Error(data.message || `Error ${res.status}`);
    }
    return data;
  }
};

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value.includes('T') || value.includes(' ') ? value.replace(' ', 'T') : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

function renderShell(activeHref, title, subtitle) {
  const user = Auth.require();
  if (!user) return null;

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
    'telecomunicaciones.html': 'fa-satellite-dish',
    'seguimiento-contratos.html': 'fa-file-contract',
    'aprobacion-facturas.html': 'fa-file-invoice-dollar',
    'reportes.html': 'fa-chart-bar',
    'angel-ia.html': 'fa-robot',
    'angel-seguridad.html': 'fa-shield-halved',
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

  const nav = links.map((l) => {
    const active = l.href === activeHref ? 'active' : '';
    return `<a class="${active}" href="${l.href}"><i class="fas ${l.icon}"></i> ${l.label}</a>`;
  }).join('');

  if (!canAccess(user, activeHref.replace(/^\//, ''))) {
    document.body.innerHTML = '<div class="alert alert-error" style="margin:2rem">No tienes permiso para acceder a esta página.</div>';
    return null;
  }

  const sub = subtitle ? `<p class="page-subtitle">${subtitle}</p>` : '';

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="logo"><i class="fas fa-cube"></i></div>
          <h1>ESERCOM</h1>
          <p>Gestión Integral</p>
          <span class="sidebar-company">${user.empresaNombre || user.empresa || ''}</span>
        </div>
        <nav class="sidebar-nav">${nav}</nav>
        <div class="sidebar-footer">
          <div class="user-name">${user.nombreCompleto || user.nombre}</div>
          <div class="user-role">${user.cargo || user.rol}</div>
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
            <div class="header-user">
              <i class="fas fa-user-circle"></i>
              <span>${user.nombreCompleto || user.email}</span>
            </div>
          </div>
        </header>
        <div class="content" id="app-content"></div>
      </div>
    </div>
  `);

  // Cerrar drawer al navegar o al pasar a desktop
  document.querySelectorAll('.sidebar-nav a').forEach((a) => {
    a.addEventListener('click', () => closeSidebar());
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeSidebar();
  });

  initHeaderAlerts();
  refreshUserSession();

  return user;
}

async function initHeaderAlerts() {
  const badge = document.getElementById('alertBadge');
  const panel = document.getElementById('alertPanel');
  const body = document.getElementById('alertPanelBody');
  const bell = document.getElementById('alertBellBtn');
  const markAll = document.getElementById('alertMarkAll');
  if (!bell || !panel) return;

  async function loadAlerts() {
    try {
      const { data } = await Auth.api('/api/angel/alertas?unread=1');
      const count = data.length;
      if (badge) {
        badge.hidden = count === 0;
        badge.textContent = count > 99 ? '99+' : String(count);
      }
      if (!body) return;
      if (!count) {
        body.innerHTML = '<p class="home-empty">No tienes alertas pendientes</p>';
        return;
      }
      body.innerHTML = data.slice(0, 20).map((a) => `
        <button type="button" class="header-alert-item sev-${a.severidad || 'media'}" data-id="${a.id}">
          <strong>${escapeHtml(a.titulo)}</strong>
          <span>${escapeHtml(a.mensaje)}</span>
        </button>
      `).join('');
      body.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await Auth.api('/api/angel/alertas/' + btn.dataset.id + '/leer', { method: 'POST', body: '{}' });
            loadAlerts();
          } catch (_) { /* ignore */ }
        });
      });
    } catch (_) {
      if (body) body.innerHTML = '<p class="home-empty">No se pudieron cargar alertas</p>';
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.hasAttribute('hidden');
    if (open) {
      panel.removeAttribute('hidden');
      loadAlerts();
    } else {
      panel.setAttribute('hidden', '');
    }
  });

  markAll?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await Auth.api('/api/angel/alertas/leer-todas', { method: 'POST', body: '{}' });
      loadAlerts();
    } catch (_) { /* ignore */ }
  });

  document.addEventListener('click', (e) => {
    if (!panel.hasAttribute('hidden') && !document.getElementById('headerAlerts')?.contains(e.target)) {
      panel.setAttribute('hidden', '');
    }
  });

  loadAlerts();
  setInterval(loadAlerts, 60000);
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

(function loadPwa() {
  if (document.querySelector('script[data-pwa]')) return;
  const s = document.createElement('script');
  s.src = '/js/pwa.js?v=1';
  s.setAttribute('data-pwa', '1');
  document.head.appendChild(s);
})();
