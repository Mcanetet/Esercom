/* Registro PWA + banner "Instalar app" en móvil */
(function () {
  const DISMISS_KEY = 'esercom_pwa_install_dismissed';
  let deferredPrompt = null;

  function injectHeadTags() {
    if (document.querySelector('link[rel="manifest"]')) return;
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/manifest.webmanifest';
    document.head.appendChild(manifest);

    const theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#0ea5e9';
    document.head.appendChild(theme);

    const appleCapable = document.createElement('meta');
    appleCapable.name = 'apple-mobile-web-app-capable';
    appleCapable.content = 'yes';
    document.head.appendChild(appleCapable);

    const appleTitle = document.createElement('meta');
    appleTitle.name = 'apple-mobile-web-app-title';
    appleTitle.content = 'ESERCOM';
    document.head.appendChild(appleTitle);

    const appleIcon = document.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = '/icons/icon-192.png';
    document.head.appendChild(appleIcon);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (window.innerWidth <= 768 && 'ontouchstart' in window);
  }

  function removeBanner() {
    document.getElementById('pwa-install-bar')?.remove();
  }

  function showBanner() {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === '1') return;
    if (document.getElementById('pwa-install-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'pwa-install-bar';
    bar.className = 'pwa-install-bar';
    bar.innerHTML = `
      <div class="pwa-install-inner">
        <div class="pwa-install-text">
          <strong>Instalar ESERCOM</strong>
          <span>Acceso rápido desde tu celular</span>
        </div>
        <div class="pwa-install-actions">
          <button type="button" class="btn btn-primary btn-sm" id="pwaInstallBtn">Instalar</button>
          <button type="button" class="btn btn-secondary btn-sm" id="pwaDismissBtn" aria-label="Cerrar">✕</button>
        </div>
      </div>
      <p class="pwa-install-hint" id="pwaIosHint" hidden>
        En iPhone: toca <strong>Compartir</strong> → <strong>Añadir a pantalla de inicio</strong>
      </p>`;
    document.body.appendChild(bar);

    document.getElementById('pwaDismissBtn')?.addEventListener('click', () => {
      localStorage.setItem(DISMISS_KEY, '1');
      removeBanner();
    });

    document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        removeBanner();
        return;
      }
      const hint = document.getElementById('pwaIosHint');
      if (hint) hint.hidden = false;
    });
  }

  async function registerSw() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js?v=5', { scope: '/' });
      reg.update().catch(() => {});
    } catch (err) {
      console.warn('[PWA] SW no registrado:', err.message);
    }
  }

  window.initPwa = function initPwa() {
    injectHeadTags();
    registerSw();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (isMobile()) showBanner();
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      removeBanner();
    });

    if (isMobile() && !isStandalone() && !deferredPrompt) {
      setTimeout(showBanner, 1500);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.initPwa());
  } else {
    window.initPwa();
  }
})();
