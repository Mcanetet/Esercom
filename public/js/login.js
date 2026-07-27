document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const togglePassword = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('password');
  const alertContainer = document.getElementById('alertContainer');
  const loginBtn = document.getElementById('loginBtn');
  const empresaSelect = document.getElementById('empresa');
  const themeBtn = document.getElementById('themeToggle');
  const demoHint = document.getElementById('demoHint');

  // Tema
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  themeBtn?.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }
  });

  // Sesión existente
  const token = localStorage.getItem('auth_token');
  const userRaw = localStorage.getItem('user');
  if (token && userRaw) {
    try {
      const u = JSON.parse(userRaw);
      if (u && u.id) {
        window.location.replace('/home.html');
        return;
      }
    } catch (_) { /* continue */ }
  }

  togglePassword?.addEventListener('click', () => {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    togglePassword.querySelector('i').classList.toggle('fa-eye');
    togglePassword.querySelector('i').classList.toggle('fa-eye-slash');
  });

  function showAlert(message, type = 'danger') {
    alertContainer.innerHTML = `
      <div class="alert alert-${type}">
        <i class="fas fa-${type === 'danger' ? 'exclamation-circle' : 'check-circle'}"></i>
        <span>${message}</span>
      </div>`;
  }

  function updateDemoHint() {
    const slug = empresaSelect.value;
    const map = {
      global: 'admin@globalviapublica.com',
      sercom: 'admin@serviciossercom.cl',
      nexus: 'admin@nexus.cl',
      tactica: 'admin@tactica.cl',
      intercanje: 'admin@intercanje.cl'
    };
    if (demoHint && map[slug]) {
      demoHint.innerHTML = `Demo <strong>${map[slug]}</strong> / <strong>password</strong>`;
    }
  }

  // Chips de empresa
  document.querySelectorAll('.company-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.company-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      empresaSelect.value = chip.dataset.slug;
      updateDemoHint();
    });
  });

  empresaSelect.addEventListener('change', () => {
    document.querySelectorAll('.company-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.slug === empresaSelect.value);
    });
    updateDemoHint();
  });

  updateDemoHint();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const empresa = empresaSelect.value;
    const email = document.getElementById('email').value.trim();
    const password = passwordInput.value;
    const remember = document.getElementById('remember').checked;

    if (!empresa || !email || !password) {
      showAlert('Complete empresa, correo y contraseña');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando sesión...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa, email, password, remember })
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        showAlert(result.message || 'Credenciales incorrectas');
        return;
      }
      localStorage.setItem('user', JSON.stringify(result.user));
      localStorage.setItem('auth_token', result.token);
      showAlert('Inicio de sesión exitoso. Redirigiendo...', 'success');
      setTimeout(() => window.location.replace('/home.html'), 800);
    } catch (err) {
      showAlert('No se pudo conectar con el servidor');
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span class="btn-text">Iniciar Sesión</span>';
    }
  });
});
