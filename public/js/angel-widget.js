/* Widget flotante Angel IA — icono abajo derecha (estilo WhatsApp), chat solo al pulsar */
(function () {
  const WIDGET_ID = 'angel-widget';

  function canUseAngel(user) {
    if (!user) return false;
    const canAccess = window.PagesCatalog?.canAccessPage || (() => true);
    return canAccess(user, 'angel-ia.html');
  }

  function isAngelPage() {
    return /\/angel-ia\.html$/i.test(window.location.pathname);
  }

  function isTrainPage() {
    return /\/(acceso-angel|angel-entrenamiento)\.html$/i.test(window.location.pathname);
  }

  function appendMsg(box, rol, text, downloads) {
    return window.AngelChatUI
      ? AngelChatUI.appendMsg(box, rol, text, downloads)
      : (() => {
        const el = document.createElement('div');
        el.className = `angel-msg ${rol === 'assistant' ? 'bot' : 'me'}`;
        el.innerHTML = '<div class="angel-bubble"></div>';
        el.querySelector('.angel-bubble').textContent = text;
        box.appendChild(el);
        box.scrollTop = box.scrollHeight;
        return el;
      })();
  }

  function createWidget() {
    if (document.getElementById(WIDGET_ID)) return document.getElementById(WIDGET_ID);

    const root = document.createElement('div');
    root.id = WIDGET_ID;
    root.className = 'angel-widget';
    root.innerHTML = `
      <div class="angel-widget-panel" id="angelWidgetPanel" hidden>
        <header class="angel-widget-head">
          <div class="angel-widget-head-info">
            <span class="angel-widget-avatar" aria-hidden="true"><span class="angel-mark"><span class="angel-mark-letter">A</span></span></span>
            <div>
              <strong>Angel</strong>
              <span id="angelWidgetStatus">Agente ESERCOM</span>
            </div>
          </div>
          <div class="angel-widget-head-actions">
            <a href="/angel-ia.html" class="angel-widget-link" title="Abrir chat completo" onclick="event.stopPropagation()">
              <i class="fas fa-up-right-from-square"></i>
            </a>
            <button type="button" class="angel-widget-close" id="angelWidgetClose" aria-label="Minimizar chat">
              <i class="fas fa-chevron-down"></i>
            </button>
          </div>
        </header>
        <div class="angel-widget-body">
          <div class="angel-chat angel-widget-chat" id="angelWidgetChat"></div>
          <form class="angel-compose angel-widget-compose" id="angelWidgetForm">
            <input type="file" id="angelWidgetPhoto" accept="image/jpeg,image/png,image/webp,image/*" hidden>
            <button type="button" class="btn btn-outline angel-attach-btn" id="angelWidgetAttach" title="Adjuntar foto (crea incidencia)" aria-label="Adjuntar foto">
              <i class="fas fa-camera"></i>
            </button>
            <button type="button" class="btn btn-outline angel-mic-btn" id="angelWidgetMic" title="Mensaje de voz" aria-label="Mensaje de voz">
              <i class="fas fa-microphone"></i>
            </button>
            <input id="angelWidgetInput" placeholder="Escribe o habla…" autocomplete="off">
            <button class="btn btn-primary angel-send-btn" type="submit" aria-label="Enviar">
              <i class="fas fa-paper-plane"></i>
            </button>
          </form>
          <div class="angel-attach-preview" id="angelWidgetPreview" hidden></div>
          <div class="angel-suggestions angel-widget-suggestions">
            <button type="button" data-q="¿Qué pendientes tengo?">Pendientes</button>
            <button type="button" data-q="Resume el estado de stock bajo">Stock</button>
            <button type="button" data-q="Genera el Excel semanal por CECO">Excel</button>
            <button type="button" data-q="Quiero reportar un problema">Incidencia</button>
          </div>
        </div>
      </div>
      <button type="button" class="angel-widget-fab" id="angelWidgetFab"
        aria-label="Abrir Angel" aria-expanded="false" title="Angel">
        <span class="angel-widget-fab-icon angel-widget-fab-icon--open" aria-hidden="true">
          <span class="angel-mark angel-mark--fab"><span class="angel-mark-letter">A</span></span>
        </span>
        <span class="angel-widget-fab-icon angel-widget-fab-icon--close" aria-hidden="true">
          <i class="fas fa-times"></i>
        </span>
      </button>
    `;
    document.body.appendChild(root);
    return root;
  }

  window.initAngelWidget = function initAngelWidget(user) {
    if (!canUseAngel(user) || isAngelPage() || isTrainPage()) return;

    const root = createWidget();
    const panel = document.getElementById('angelWidgetPanel');
    const fab = document.getElementById('angelWidgetFab');
    const closeBtn = document.getElementById('angelWidgetClose');
    const chatBox = document.getElementById('angelWidgetChat');
    const form = document.getElementById('angelWidgetForm');
    const input = document.getElementById('angelWidgetInput');
    const statusEl = document.getElementById('angelWidgetStatus');

    let activo = false;
    let loaded = false;
    let sending = false;
    let isOpen = false;
    let voiceAutoplay = true;
    let voiceEnabled = true;

    function setOpen(open) {
      isOpen = !!open;
      if (isOpen) {
        panel.removeAttribute('hidden');
        root.classList.add('is-open');
        root.classList.remove('angel-widget--dodge', 'angel-widget--raised');
        document.documentElement.classList.add('angel-widget-lock');
        fab.setAttribute('aria-expanded', 'true');
        fab.setAttribute('aria-label', 'Cerrar Angel');
        fab.setAttribute('title', 'Cerrar');
        if (!loaded) loadChat();
        setTimeout(() => input?.focus(), 150);
      } else {
        panel.setAttribute('hidden', '');
        root.classList.remove('is-open');
        document.documentElement.classList.remove('angel-widget-lock');
        fab.setAttribute('aria-expanded', 'false');
        fab.setAttribute('aria-label', 'Abrir Angel');
        fab.setAttribute('title', 'Angel');
        scheduleFabClearance();
      }
    }

    /** Evita que el FAB tape botones de gestión (Guardar, Aprobar, etc.). */
    function updateFabClearance() {
      if (isOpen || !fab || fab.offsetParent === null) {
        root.classList.remove('angel-widget--dodge', 'angel-widget--raised');
        return;
      }
      // Quitar dodge temporalmente para medir la posición natural del FAB
      root.classList.remove('angel-widget--dodge', 'angel-widget--raised');
      const fabRect = fab.getBoundingClientRect();
      const pad = 10;
      const zone = {
        left: fabRect.left - pad,
        top: fabRect.top - pad,
        right: fabRect.right + pad,
        bottom: fabRect.bottom + pad
      };
      const nodes = document.querySelectorAll(
        'button, a.btn, input[type="submit"], input[type="button"], .btn, [role="button"]'
      );
      let hit = false;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el || root.contains(el) || el.disabled || el.getAttribute('aria-hidden') === 'true') continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        // Solo importa lo visible en pantalla
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
        const overlaps = !(
          r.right < zone.left
          || r.left > zone.right
          || r.bottom < zone.top
          || r.top > zone.bottom
        );
        if (overlaps) {
          hit = true;
          break;
        }
      }
      if (!hit) return;
      // Preferir desplazar a la izquierda (acciones suelen ir a la derecha).
      // Si no hay espacio, subir el FAB.
      const spaceLeft = fabRect.left;
      if (spaceLeft > fabRect.width + 48) {
        root.classList.add('angel-widget--dodge');
      } else {
        root.classList.add('angel-widget--raised');
      }
    }

    let clearanceTimer = null;
    function scheduleFabClearance() {
      if (clearanceTimer) cancelAnimationFrame(clearanceTimer);
      clearanceTimer = requestAnimationFrame(() => {
        clearanceTimer = null;
        updateFabClearance();
      });
    }

    async function loadChat() {
      try {
        const [status, historial] = await Promise.all([
          Auth.api('/api/angel/status'),
          Auth.api('/api/angel/chat/historial')
        ]);
        activo = !!status.data?.activo;
        voiceEnabled = status.data?.voz?.voz_activa !== false;
        voiceAutoplay = status.data?.voz?.voz_autoplay !== false && voiceEnabled;
        statusEl.textContent = activo ? 'Agente ESERCOM · en línea' : 'Sin API key configurada';
        input.disabled = !activo;
        form.querySelector('button[type="submit"]').disabled = !activo;
        const micBtn = document.getElementById('angelWidgetMic');
        if (micBtn) {
          micBtn.disabled = !activo || !voiceEnabled;
          if (activo && voiceEnabled && window.AngelChatUI?.bindMicButton && !micBtn.dataset.bound) {
            micBtn.dataset.bound = '1';
            AngelChatUI.bindMicButton({
              button: micBtn,
              input,
              async onText(text) {
                await sendMessage(text, null, true);
              }
            });
          }
        }

        chatBox.innerHTML = '';
        const rows = historial.data || [];
        rows.forEach((m) => appendMsg(chatBox, m.rol, m.contenido, m.downloads));
        if (!rows.length) {
          appendMsg(chatBox, 'assistant', 'Hola, soy Angel IA. ¿En qué te ayudo?');
        }
        loaded = true;
      } catch (err) {
        statusEl.textContent = 'No disponible';
        chatBox.innerHTML = '';
        appendMsg(chatBox, 'assistant', err.message || 'No se pudo cargar Angel IA.');
        input.disabled = true;
        form.querySelector('button[type="submit"]').disabled = true;
        loaded = true;
      }
    }

    async function sendMessage(msg, imageDataUrl, viaVoz) {
      if ((!msg && !imageDataUrl) || sending || !activo) return;
      sending = true;
      input.disabled = true;
      form.querySelector('button[type="submit"]').disabled = true;

      const display = imageDataUrl
        ? `${msg || 'Problema con foto'} 📷`
        : (viaVoz ? `🎤 ${msg}` : msg);
      appendMsg(chatBox, 'user', display);
      const thinking = appendMsg(chatBox, 'assistant', 'Pensando…');
      try {
        const r = await Auth.api('/api/angel/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: msg || 'Problema reportado con foto',
            imageDataUrl: imageDataUrl || null,
            via_voz: !!viaVoz
          })
        });
        if (window.AngelChatUI) {
          AngelChatUI.setBubble(thinking, r.data.reply, r.data.downloads);
        } else {
          thinking.querySelector('.angel-bubble').textContent = r.data.reply;
        }
        if (viaVoz && voiceAutoplay && r.data.reply && window.AngelChatUI?.speakText) {
          try { await AngelChatUI.speakText(r.data.reply); } catch (_) { /* */ }
        }
      } catch (err) {
        if (window.AngelChatUI) AngelChatUI.setBubble(thinking, err.message);
        else thinking.querySelector('.angel-bubble').textContent = err.message;
      } finally {
        sending = false;
        pendingPhoto = null;
        const prev = document.getElementById('angelWidgetPreview');
        if (prev) { prev.hidden = true; prev.innerHTML = ''; }
        const ph = document.getElementById('angelWidgetPhoto');
        if (ph) ph.value = '';
        if (activo) {
          input.disabled = false;
          form.querySelector('button[type="submit"]').disabled = false;
          input.focus();
        }
      }
    }

    let pendingPhoto = null;
    const attachBtn = document.getElementById('angelWidgetAttach');
    const photoInput = document.getElementById('angelWidgetPhoto');
    const preview = document.getElementById('angelWidgetPreview');
    attachBtn?.addEventListener('click', () => photoInput?.click());
    photoInput?.addEventListener('change', () => {
      const f = photoInput.files?.[0];
      if (!f) { pendingPhoto = null; if (preview) { preview.hidden = true; preview.innerHTML = ''; } return; }
      const reader = new FileReader();
      reader.onload = () => {
        pendingPhoto = reader.result;
        if (preview) {
          preview.hidden = false;
          preview.innerHTML = `<img src="${pendingPhoto}" alt=""><button type="button" id="angelWidgetClearPhoto" title="Quitar">&times;</button>`;
          document.getElementById('angelWidgetClearPhoto')?.addEventListener('click', () => {
            pendingPhoto = null;
            photoInput.value = '';
            preview.hidden = true;
            preview.innerHTML = '';
          });
        }
      };
      reader.readAsDataURL(f);
    });

    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!isOpen);
    });

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    });

    panel.addEventListener('click', (e) => e.stopPropagation());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = input.value.trim();
      if (!msg && !pendingPhoto) return;
      input.value = '';
      sendMessage(msg, pendingPhoto);
    });

    root.querySelectorAll('[data-q]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!activo) return;
        input.value = btn.dataset.q;
        form.requestSubmit();
      });
    });

    document.addEventListener('click', (e) => {
      if (!isOpen) return;
      if (root.contains(e.target)) return;
      setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) setOpen(false);
    });

    window.addEventListener('scroll', scheduleFabClearance, { passive: true });
    window.addEventListener('resize', scheduleFabClearance, { passive: true });
    document.addEventListener('focusin', scheduleFabClearance, true);
    let moDebounce = null;
    const mo = new MutationObserver((mutations) => {
      if (mutations.every((m) => root.contains(m.target))) return;
      if (moDebounce) clearTimeout(moDebounce);
      moDebounce = setTimeout(scheduleFabClearance, 150);
    });
    const watch = document.getElementById('app-content') || document.body;
    mo.observe(watch, { childList: true, subtree: true });

    // Siempre inicia cerrado — solo icono visible
    setOpen(false);
    scheduleFabClearance();
  };
})();
