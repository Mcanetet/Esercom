/**
 * Helpers UI de chat Angel: bubbles + card de descarga autenticada.
 */
(function () {
  if (!document.getElementById('angel-dl-card-css')) {
    const s = document.createElement('style');
    s.id = 'angel-dl-card-css';
    s.textContent = `
.angel-dl-card{margin-top:.65rem;padding:.7rem .75rem;border-radius:12px;background:#f0fdf4;border:1px solid #86efac;display:flex;flex-wrap:wrap;align-items:center;gap:.55rem .75rem}
.angel-dl-card-body{flex:1 1 140px;min-width:0;display:flex;flex-direction:column;gap:.15rem}
.angel-dl-card-body strong{font-size:.86rem;color:#166534;display:flex;align-items:center;gap:.35rem}
.angel-dl-card-body small{font-size:.72rem;color:#64748b;word-break:break-all}
.angel-dl-card .angel-dl-btn{flex:0 0 auto}
.angel-msg.me .angel-dl-card{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.35)}
.angel-msg.me .angel-dl-card-body strong{color:#fff}
.angel-msg.me .angel-dl-card-body small{color:rgba(255,255,255,.75)}`;
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function authToken() {
    return window.Auth?.getToken?.()
      || window.AngelTrainAuth?.getToken?.()
      || localStorage.getItem('auth_token')
      || localStorage.getItem('angel_train_token');
  }

  async function downloadAuth(url, name) {
    const token = authToken();
    const headers = {};
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Angel-Train-Token'] = token;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('No se pudo descargar el Excel');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || 'reporte_angel.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function appendDownloadCards(bubble, downloads) {
    if (!bubble || !Array.isArray(downloads) || !downloads.length) return;
    downloads.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'angel-dl-card';
      const title = d.titulo || d.archivo || 'Informe Excel';
      const meta = [
        d.total != null ? `${d.total} filas` : null,
        d.archivo || null
      ].filter(Boolean).join(' · ');
      card.innerHTML = `
        <div class="angel-dl-card-body">
          <strong><i class="fas fa-file-excel"></i> ${esc(title)}</strong>
          ${meta ? `<small>${esc(meta)}</small>` : ''}
        </div>
        <button type="button" class="btn btn-primary btn-sm angel-dl-btn">
          <i class="fas fa-download"></i> Descargar
        </button>`;
      card.querySelector('.angel-dl-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await downloadAuth(d.download, d.archivo || 'reporte_angel.xlsx');
        } catch (err) {
          if (window.UI?.flash) UI.flash(err.message, true);
          else alert(err.message);
        } finally {
          btn.disabled = false;
        }
      });
      bubble.appendChild(card);
    });
  }

  function setBubble(el, text, downloads) {
    const bubble = el?.querySelector?.('.angel-bubble');
    if (!bubble) return;
    bubble.textContent = text || '';
    bubble.querySelectorAll('.angel-dl-card').forEach((n) => n.remove());
    bubble.querySelectorAll('.angel-speak-btn').forEach((n) => n.remove());
    appendDownloadCards(bubble, downloads);
    if (el?.classList?.contains('bot') && text && text !== 'Pensando…') {
      attachSpeakButton(bubble, text);
    }
  }

  function appendMsg(box, rol, text, downloads) {
    const el = document.createElement('div');
    el.className = `angel-msg ${rol === 'assistant' ? 'bot' : 'me'}`;
    el.innerHTML = '<div class="angel-bubble"></div>';
    const bubble = el.querySelector('.angel-bubble');
    bubble.textContent = text || '';
    if (rol === 'assistant') {
      appendDownloadCards(bubble, downloads);
      if (text && text !== 'Pensando…') attachSpeakButton(bubble, text);
    }
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  let _voiceCfg = null;
  let _audioEl = null;

  function authApi() {
    if (window.Auth?.api) return window.Auth.api.bind(window.Auth);
    if (window.AngelTrainAuth?.api) return window.AngelTrainAuth.api.bind(window.AngelTrainAuth);
    return null;
  }

  async function loadVoiceConfig(force) {
    if (_voiceCfg && !force) return _voiceCfg;
    try {
      const api = authApi();
      if (!api) return null;
      const r = await api('/api/angel/voice/config', { noCache: true });
      _voiceCfg = r.data || null;
    } catch (_) {
      _voiceCfg = null;
    }
    return _voiceCfg;
  }

  function stopSpeaking() {
    if (_audioEl) {
      try { _audioEl.pause(); } catch (_) { /* */ }
      _audioEl = null;
    }
  }

  async function speakText(text, opts = {}) {
    const clean = String(text || '').trim();
    if (!clean || clean === 'Pensando…') return;
    stopSpeaking();
    const token = authToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Angel-Train-Token'] = token;
    }
    const res = await fetch('/api/angel/voice/speak', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: clean })
    });
    if (!res.ok) {
      let msg = 'No se pudo reproducir la voz';
      try {
        const j = await res.json();
        if (j.message) msg = j.message;
      } catch (_) { /* */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    _audioEl = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (_audioEl === audio) _audioEl = null;
      opts.onEnd?.();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (_audioEl === audio) _audioEl = null;
      opts.onError?.(new Error('Error al reproducir audio'));
    };
    await audio.play();
    return audio;
  }

  function attachSpeakButton(bubble, text) {
    if (!bubble || bubble.querySelector('.angel-speak-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'angel-speak-btn';
    btn.title = 'Escuchar respuesta';
    btn.innerHTML = '<i class="fas fa-volume-up"></i>';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      btn.classList.add('playing');
      try {
        await speakText(text, {
          onEnd: () => { btn.disabled = false; btn.classList.remove('playing'); },
          onError: () => { btn.disabled = false; btn.classList.remove('playing'); }
        });
      } catch (err) {
        btn.disabled = false;
        btn.classList.remove('playing');
        if (window.UI?.flash) UI.flash(err.message, true);
      }
    });
    bubble.appendChild(btn);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer el audio'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Micrófono: click para grabar / click para enviar.
   * opts: { button, input, onText(text), apiPath? }
   */
  function bindMicButton(opts) {
    const btn = opts.button;
    if (!btn) return { destroy() {} };
    let recorder = null;
    let chunks = [];
    let stream = null;
    let recording = false;

    async function stop() {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === 'inactive') {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          chunks = [];
          resolve(blob);
        };
        try { recorder.stop(); } catch (_) { resolve(null); }
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
        }
      });
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Este navegador no permite micrófono');
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1
        }
      });
      // Priorizar formatos que Whisper acepta bien en móvil (iOS = mp4/m4a)
      const candidates = [
        'audio/mp4',
        'audio/aac',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];
      const mime = candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      // timeslice: algunos móviles no entregan blob hasta stop sin esto
      try {
        recorder.start(250);
      } catch (_) {
        recorder.start();
      }
      recording = true;
      btn.classList.add('recording');
      btn.title = 'Detener y enviar';
      btn.setAttribute('aria-pressed', 'true');
    }

    async function finishAndTranscribe() {
      recording = false;
      btn.classList.remove('recording');
      btn.title = 'Mensaje de voz';
      btn.setAttribute('aria-pressed', 'false');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      try {
        const blob = await stop();
        if (!blob || blob.size < 200) throw new Error('Grabación muy corta');
        const dataUrl = await blobToBase64(blob);
        const api = authApi();
        if (!api) throw new Error('Sesión no disponible');
        const mimeType = (blob.type || recorder?.mimeType || 'audio/mp4').split(';')[0].trim();
        const r = await api('/api/angel/voice/transcribe', {
          method: 'POST',
          body: JSON.stringify({
            audioBase64: dataUrl,
            mimeType
          })
        });
        const text = String(r.data?.text || '').trim();
        if (!text) throw new Error('No se entendió el audio');
        if (opts.input) opts.input.value = text;
        if (typeof opts.onText === 'function') await opts.onText(text);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
      }
    }

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (recording) await finishAndTranscribe();
        else await start();
      } catch (err) {
        recording = false;
        btn.classList.remove('recording');
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
        btn.disabled = false;
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
        }
        if (window.UI?.flash) UI.flash(err.message, true);
        else alert(err.message);
      }
    });

    return {
      destroy() {
        stopSpeaking();
        if (stream) stream.getTracks().forEach((t) => t.stop());
      }
    };
  }

  window.AngelChatUI = {
    appendMsg, setBubble, downloadAuth, appendDownloadCards,
    loadVoiceConfig, speakText, stopSpeaking, bindMicButton, attachSpeakButton
  };
})();
