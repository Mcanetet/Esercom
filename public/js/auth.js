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
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Respuesta inválida del servidor');
    }
    if (res.status === 401) {
      this.logout();
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

  const links = [
    { href: '/home.html', icon: 'fa-tachometer-alt', label: 'Menú Principal' },
    { href: '/solicitud-salida-materiales.html', icon: 'fa-boxes', label: 'Solicitud de Salida Materiales' },
    { href: '/salida-material-por-actividad.html', icon: 'fa-layer-group', label: 'Salida Material por Actividad' },
    { href: '/portal-proveedores.html', icon: 'fa-dolly-flatbed', label: 'Portal Proveedores' },
    { href: '/materiales-por-receta.html', icon: 'fa-ruler-combined', label: 'Materiales por Receta' },
    { href: '/solicitud-de-compras.html', icon: 'fa-shopping-cart', label: 'Solicitud de Compras' },
    { href: '/creacion-datos-maestros.html', icon: 'fa-database', label: 'Creación Datos Maestros' },
    { href: '/tareas-operativas.html', icon: 'fa-tasks', label: 'Tareas Operativas' },
    { href: '/solicitud-de-graficas.html', icon: 'fa-image', label: 'Solicitud de Gráficas' },
    { href: '/serviciosgenerales.html', icon: 'fa-tools', label: 'Servicios Generales' },
    { href: '/agenda-camion-pluma.html', icon: 'fa-truck-ramp-box', label: 'Agenda Camión Pluma' },
    { href: '/checklist-flota.html', icon: 'fa-clipboard-check', label: 'Checklist Flota' },
    { href: '/telecomunicaciones.html', icon: 'fa-satellite-dish', label: 'Telecomunicaciones' },
    { href: '/seguimiento-contratos.html', icon: 'fa-file-contract', label: 'Gestión de Contratos' },
    { href: '/aprobacion-facturas.html', icon: 'fa-file-invoice-dollar', label: 'Aprobación de Facturas' },
    { href: '/reportes.html', icon: 'fa-chart-bar', label: 'Reportes' },
    { href: '/angel-ia.html', icon: 'fa-robot', label: 'Angel IA' },
    { href: '/angel-seguridad.html', icon: 'fa-shield-halved', label: 'Seguridad Angel IA' },
    { href: '/configuraciones.html', icon: 'fa-cog', label: 'Configuraciones' },
    { href: '/papelera.html', icon: 'fa-trash-alt', label: 'Papelera' }
  ];

  const nav = links.map((l) => {
    const active = l.href === activeHref ? 'active' : '';
    return `<a class="${active}" href="${l.href}"><i class="fas ${l.icon}"></i> ${l.label}</a>`;
  }).join('');

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
