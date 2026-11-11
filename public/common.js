(function () {
  const KEYS = {
    admin: 'pdks_admin_token',
    kiosk: 'pdks_kiosk_token',
    emp: 'pdks_emp_token'
  };

  function getToken(role) {
    return localStorage.getItem(KEYS[role] || role) || '';
  }

  function setToken(role, val) {
    const k = KEYS[role] || role;
    if (!val) localStorage.removeItem(k);
    else localStorage.setItem(k, val);
  }

  async function apiFetch(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.role) {
      const tk = getToken(opts.role);
      if (tk) headers['Authorization'] = 'Bearer ' + tk;
    }
    let body = opts.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body
    });
    if (opts.raw) return res;
    const data = await res.json().catch(() => ({ ok: false, error: 'Sunucu yanıtı okunamadı.' }));
    if (!res.ok || data.ok === false) {
      if (res.status === 401) {
        if (opts.role === 'admin') {
          setToken('admin', '');
          if (typeof window !== 'undefined' && typeof window.__showAdminLoginGate === 'function') {
            window.__showAdminLoginGate();
          }
        } else if (opts.role === 'emp') {
          setToken('emp', '');
          if (typeof window !== 'undefined' && typeof window.__showEmpPairGate === 'function') {
            window.__showEmpPairGate();
          }
        }
      }
      const err = new Error(data.error || `Hata (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function makeQrSvg(text, cellSize = 4, margin = 2) {
    if (typeof window.qrcode !== 'function') return '';
    const qr = window.qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    return qr.createSvgTag({ cellSize, margin, scalable: true });
  }

  function toast(msg, kind = '') {
    let box = document.getElementById('toastBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastBox';
      box.className = 'toast-box';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  let audioCtx = null;
  function playTone(kind) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const notes =
        kind === 'in'
          ? [[587.33, 0, 0.11], [880, 0.12, 0.18]]
          : kind === 'out'
          ? [[783.99, 0, 0.11], [523.25, 0.12, 0.18]]
          : [[240, 0, 0.22]];
      for (const [freq, start, dur] of notes) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = kind === 'err' ? 'sawtooth' : 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.16, now + start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur);
      }
    } catch {}
  }

  function speakText(text) {
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'tr-TR';
        utter.rate = 1.0;
        utter.pitch = 1.0;
        window.speechSynthesis.speak(utter);
      }
    } catch {}
  }

  function formatDateTr(dateStr) {
    if (!dateStr || !dateStr.includes('-')) return dateStr || '-';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
  }

  function formatPairCode(c) {
    const s = String(c || '');
    return s.length === 6 ? `${s.slice(0, 3)} ${s.slice(3)}` : s;
  }

  window.PDKS = {
    getToken,
    setToken,
    apiFetch,
    esc,
    makeQrSvg,
    toast,
    playTone,
    speakText,
    formatDateTr,
    formatPairCode
  };
})();
