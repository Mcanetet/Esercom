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
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('show');
}

function renderShell(activeHref, title, subtitle) {
  const user = Auth.require();
  if (!user) return null;

  const links = [
    { href: '/home.html', icon: 'fa-tachometer-alt', label: 'Menú Principal' },
    { href: '/solicitud-salida-materiales.html', icon: 'fa-boxes', label: 'Solicitud de Salida Materiales' },
    { href: '#', icon: 'fa-layer-group', label: 'Salida Material por Actividad', soon: true },
    { href: '#', icon: 'fa-dolly-flatbed', label: 'Portal Proveedores', soon: true },
    { href: '#', icon: 'fa-ruler-combined', label: 'Materiales por Receta', soon: true },
    { href: '#', icon: 'fa-shopping-cart', label: 'Solicitud de Compras', soon: true },
    { href: '#', icon: 'fa-database', label: 'Creación Datos Maestros', soon: true },
    { href: '#', icon: 'fa-tasks', label: 'Tareas Operativas', soon: true },
    { href: '#', icon: 'fa-image', label: 'Solicitud de Gráficas', soon: true },
    { href: '#', icon: 'fa-tools', label: 'Servicios Generales', soon: true },
    { href: '#', icon: 'fa-truck-ramp-box', label: 'Agenda Camión Pluma', soon: true },
    { href: '#', icon: 'fa-clipboard-check', label: 'Checklist Flota', soon: true },
    { href: '#', icon: 'fa-satellite-dish', label: 'Telecomunicaciones', soon: true },
    { href: '#', icon: 'fa-file-contract', label: 'Gestión de Contratos', soon: true },
    { href: '#', icon: 'fa-file-invoice-dollar', label: 'Aprobación de Facturas', soon: true },
    { href: '#', icon: 'fa-chart-bar', label: 'Reportes', soon: true },
    { href: '#', icon: 'fa-cog', label: 'Configuraciones', soon: true },
    { href: '#', icon: 'fa-trash-alt', label: 'Papelera', soon: true }
  ];

  const nav = links.map((l) => {
    const active = l.href === activeHref ? 'active' : '';
    const titleAttr = l.soon ? ' title="Próximamente"' : '';
    const href = l.soon ? '#' : l.href;
    return `<a class="${active}" href="${href}"${titleAttr}><i class="fas ${l.icon}"></i> ${l.label}</a>`;
  }).join('');

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
          <div>
            <button class="mobile-toggle" onclick="toggleSidebar()" aria-label="Menú"><i class="fas fa-bars"></i></button>
            <h1 class="page-title" style="display:inline-flex;margin-left:.5rem">${title}</h1>
            ${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ''}
          </div>
          <div class="header-user">
            <i class="fas fa-user-circle"></i>
            <span>${user.nombreCompleto || user.email}</span>
          </div>
        </header>
        <div class="content" id="app-content"></div>
      </div>
    </div>
  `);

  return user;
}

window.Auth = Auth;
window.formatDate = formatDate;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.renderShell = renderShell;
