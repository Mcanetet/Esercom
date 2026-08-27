document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('portalForm');
  const claveInput = document.getElementById('clave');
  const alertContainer = document.getElementById('alertContainer');
  const portalBtn = document.getElementById('portalBtn');
  const empresaSelect = document.getElementById('empresa');
  const themeBtn = document.getElementById('themeToggle');
  const toggleClave = document.getElementById('toggleClave');

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

  toggleClave?.addEventListener('click', () => {
    const type = claveInput.getAttribute('type') === 'password' ? 'text' : 'password';
    claveInput.setAttribute('type', type);
    toggleClave.querySelector('i').classList.toggle('fa-eye');
    toggleClave.querySelector('i').classList.toggle('fa-eye-slash');
  });

  document.querySelectorAll('.company-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.company-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      empresaSelect.value = chip.dataset.slug;
    });
  });

  empresaSelect.addEventListener('change', () => {
    document.querySelectorAll('.company-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.slug === empresaSelect.value);
    });
  });

  function showAlert(message, type = 'danger') {
    alertContainer.innerHTML = `
      <div class="alert alert-${type}">
        <i class="fas fa-${type === 'danger' ? 'exclamation-circle' : 'check-circle'}"></i>
        <span>${message}</span>
      </div>`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const empresa = empresaSelect.value;
    const clave = claveInput.value;
    const remember = document.getElementById('remember').checked;

    if (!empresa || !clave) {
      showAlert('Seleccione empresa e ingrese la clave de entrenamiento');
      return;
    }

    portalBtn.disabled = true;
    portalBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';

    try {
      const res = await fetch('/api/auth/acceso-angel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa, clave, remember })
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        showAlert(result.message || 'Acceso denegado');
        return;
      }
      localStorage.setItem('angel_train_token', result.token);
      localStorage.setItem('angel_train_empresa', result.empresa);
      localStorage.setItem('angel_train_empresa_nombre', result.empresaNombre || result.empresa);
      showAlert('Acceso concedido. Redirigiendo...', 'success');
      setTimeout(() => {
        window.location.replace(result.redirect || '/angel-entrenamiento.html');
      }, 600);
    } catch (_) {
      showAlert('No se pudo conectar con el servidor');
    } finally {
      portalBtn.disabled = false;
      portalBtn.innerHTML = '<span class="btn-text"><i class="fas fa-robot"></i> Entrar a entrenamiento</span>';
    }
  });
});
