document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const togglePassword = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('password');
  const alertContainer = document.getElementById('alertContainer');
  const loginBtn = document.getElementById('loginBtn');
  const empresaSelect = document.getElementById('empresa');
  const themeBtn = document.getElementById('themeToggle');
  const recoverPanel = document.getElementById('recoverPanel');
  const recoverAlert = document.getElementById('recoverAlert');
  const recoverSub = document.getElementById('recoverSub');

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

  function showRecoverAlert(message, type = 'danger') {
    if (!recoverAlert) return;
    recoverAlert.innerHTML = `
      <div class="alert alert-${type}">
        <i class="fas fa-${type === 'danger' ? 'exclamation-circle' : 'check-circle'}"></i>
        <span>${message}</span>
      </div>`;
  }

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

  function setRecoverStep(step) {
    document.querySelectorAll('.recover-step').forEach((el) => {
      el.hidden = Number(el.dataset.step) !== step;
    });
    if (recoverSub) {
      recoverSub.textContent = step === 1
        ? 'Te enviaremos un código de 6 dígitos a tu correo.'
        : 'Ingresa el código recibido y tu nueva contraseña.';
    }
  }

  function openRecover() {
    form.hidden = true;
    recoverPanel.hidden = false;
    recoverAlert.innerHTML = '';
    const emailLogin = document.getElementById('email')?.value?.trim();
    if (emailLogin) document.getElementById('recoverEmail').value = emailLogin;
    setRecoverStep(1);
  }

  function closeRecover() {
    recoverPanel.hidden = true;
    form.hidden = false;
    recoverAlert.innerHTML = '';
  }

  document.getElementById('btnForgot')?.addEventListener('click', openRecover);
  document.getElementById('recoverBack')?.addEventListener('click', closeRecover);

  async function sendCode() {
    const empresa = empresaSelect.value;
    const email = document.getElementById('recoverEmail').value.trim();
    if (!empresa || !email) {
      showRecoverAlert('Ingrese su correo electrónico');
      return;
    }
    const btn = document.getElementById('btnSendCode');
    const btnResend = document.getElementById('btnResendCode');
    [btn, btnResend].forEach((b) => { if (b) b.disabled = true; });
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando…';
    try {
      const res = await fetch('/api/auth/recuperar/enviar-codigo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa, email })
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        showRecoverAlert(result.message || 'No se pudo enviar el código');
        return;
      }
      showRecoverAlert(result.message || 'Código enviado', 'success');
      setRecoverStep(2);
    } catch (_) {
      showRecoverAlert('No se pudo conectar con el servidor');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-text">Enviar código</span>';
      }
      if (btnResend) btnResend.disabled = false;
    }
  }

  document.getElementById('btnSendCode')?.addEventListener('click', sendCode);
  document.getElementById('btnResendCode')?.addEventListener('click', sendCode);

  document.getElementById('btnResetPass')?.addEventListener('click', async () => {
    const empresa = empresaSelect.value;
    const email = document.getElementById('recoverEmail').value.trim();
    const codigo = document.getElementById('recoverCode').value.trim();
    const password_nueva = document.getElementById('recoverPass').value;
    const password_confirmar = document.getElementById('recoverPass2').value;
    if (!codigo || codigo.length < 6) {
      showRecoverAlert('Ingrese el código de 6 dígitos');
      return;
    }
    if (!password_nueva || password_nueva.length < 6) {
      showRecoverAlert('La nueva contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password_nueva !== password_confirmar) {
      showRecoverAlert('La confirmación no coincide');
      return;
    }
    const btn = document.getElementById('btnResetPass');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
    try {
      const res = await fetch('/api/auth/recuperar/restablecer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa, email, codigo, password_nueva, password_confirmar })
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        showRecoverAlert(result.message || 'No se pudo restablecer');
        return;
      }
      showRecoverAlert(result.message || 'Contraseña actualizada', 'success');
      document.getElementById('email').value = email;
      setTimeout(() => {
        closeRecover();
        showAlert('Contraseña actualizada. Inicie sesión con la nueva clave.', 'success');
      }, 900);
    } catch (_) {
      showRecoverAlert('No se pudo conectar con el servidor');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-text">Guardar nueva contraseña</span>';
    }
  });

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
      const home = `${window.location.origin}/home.html`;
      setTimeout(() => window.location.replace(home), 500);
    } catch (err) {
      showAlert('No se pudo conectar con el servidor');
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span class="btn-text">Iniciar Sesión</span>';
    }
  });
});
