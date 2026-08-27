/**
 * Alertas tipo WhatsApp: desbloqueo de audio, tono, vibración y Notification API.
 */
(function (global) {
  const PERM_ASKED_KEY = 'esercom_notif_perm_asked';
  let audioCtx = null;
  let unlocked = false;
  let unlockBound = false;

  function getCtx() {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    return audioCtx;
  }

  function unlockAudio() {
    const ctx = getCtx();
    if (!ctx) return Promise.resolve(false);
    const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    return resume
      .then(() => {
        try {
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
        } catch (_) { /* ignore */ }
        unlocked = true;
        return true;
      })
      .catch(() => false);
  }

  function bindUnlockOnce() {
    if (unlockBound) return;
    unlockBound = true;
    const once = () => {
      unlockAudio();
      maybeAskPermission();
    };
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach((ev) => {
      document.addEventListener(ev, once, { once: true, passive: true, capture: true });
    });
  }

  function vibrateWhatsApp() {
    try {
      if (!navigator.vibrate) return;
      // Patrón corto-corto-pausa-largo (similar a WhatsApp)
      navigator.vibrate([40, 60, 40, 60, 40, 120, 220]);
    } catch (_) { /* ignore */ }
  }

  function playTone() {
    const ctx = getCtx();
    if (!ctx) return;
    const run = () => {
      try {
        const now = ctx.currentTime;
        const playBeep = (freq, start, dur, vol) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(vol, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + dur + 0.02);
        };
        // Doble tono ascendente (estilo mensaje)
        playBeep(880, now, 0.12, 0.2);
        playBeep(1319, now + 0.14, 0.16, 0.22);
      } catch (_) { /* ignore */ }
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(run).catch(() => {});
    } else {
      run();
    }
  }

  async function maybeAskPermission() {
    if (!('Notification' in global)) return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(PERM_ASKED_KEY) === '1') return;
    localStorage.setItem(PERM_ASKED_KEY, '1');
    try {
      await Notification.requestPermission();
    } catch (_) { /* ignore */ }
  }

  async function showSystemNotification(alerta) {
    if (!('Notification' in global)) return;
    if (Notification.permission !== 'granted') return;
    // Solo banner de sistema cuando la pestaña no está visible (como WhatsApp en background)
    if (document.visibilityState === 'visible') return;

    const title = alerta?.titulo || 'ESERCOM';
    const body = alerta?.mensaje || 'Tienes una nueva notificación';
    const tag = alerta?.id != null ? `alerta-${alerta.id}` : `alerta-${Date.now()}`;
    const url = alerta?.href || alerta?.url || '/home.html';
    const opts = {
      body,
      tag,
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [40, 60, 40, 60, 40, 120, 220],
      data: { url, alertaId: alerta?.id || null }
    };

    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg?.showNotification) {
        await reg.showNotification(title, opts);
        return;
      }
    } catch (_) { /* fallback */ }

    try {
      const n = new Notification(title, opts);
      n.onclick = () => {
        try {
          global.focus();
          if (url) global.location.assign(url);
        } catch (_) { /* ignore */ }
        n.close();
      };
    } catch (_) { /* ignore */ }
  }

  /**
   * Dispara feedback completo: vibración + sonido + (si aplica) notificación de sistema.
   */
  function notify(alerta) {
    bindUnlockOnce();
    vibrateWhatsApp();
    playTone();
    showSystemNotification(alerta);
  }

  bindUnlockOnce();

  global.EsercomNotif = {
    unlock: unlockAudio,
    notify,
    vibrate: vibrateWhatsApp,
    playTone,
    askPermission: maybeAskPermission,
    showSystemNotification
  };
})(typeof window !== 'undefined' ? window : globalThis);
