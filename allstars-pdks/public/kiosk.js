(function () {
  const { apiFetch, getToken, setToken, toast, playTone } = window.PDKS;

  let scanner = null;
  let facingMode = 'environment';
  let forcedMode = 'auto';
  let busy = false;
  let overlayTimer = null;

  const authView = document.getElementById('kioskAuthView');
  const mainView = document.getElementById('kioskMainView');
  const videoEl = document.getElementById('kioskVideo');
  const fallbackBox = document.getElementById('camFallbackMsg');
  const fallbackText = document.getElementById('camFallbackText');

  function updateClock() {
    const now = new Date();
    document.getElementById('kioskClock').textContent = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(now);
    document.getElementById('kioskDate').textContent = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(now);
  }
  updateClock();
  setInterval(updateClock, 1000);

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
    } catch {}
  }

  function showOverlay({ cls, icon, action, name, title, time, sub }) {
    const ov = document.getElementById('resultOverlay');
    const card = document.getElementById('resultCard');
    card.className = 'scan-result-card ' + cls;
    const resIconEl = document.getElementById('resIcon');
    resIconEl.className = 'material-symbols-outlined';
    resIconEl.style.fontSize = '48px';
    resIconEl.textContent = icon;
    document.getElementById('resAction').textContent = action;
    document.getElementById('resName').textContent = name;
    document.getElementById('resTitle').textContent = title || '';
    document.getElementById('resTime').textContent = time || '--:--';
    document.getElementById('resSub').textContent = sub || '';
    ov.classList.remove('hidden');
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
      ov.classList.add('hidden');
      busy = false;
    }, 2600);
  }

  async function handleQrScan(rawText) {
    if (busy || !rawText) return;
    busy = true;
    try {
      const res = await apiFetch('/api/kiosk/punch', {
        method: 'POST',
        role: getToken('kiosk') ? 'kiosk' : 'admin',
        body: {
          qr: rawText,
          forcedType: forcedMode === 'auto' ? null : forcedMode
        }
      });

      if (forcedMode !== 'auto') setMode('auto');

      if (res.duplicate) {
        playTone('err');
        showOverlay({
          cls: 'res-dup',
          icon: 'hourglass_empty',
          action: 'AZ ÖNCE OKUTULDU',
          name: res.employee.name,
          title: res.employee.title,
          time: res.lastPunch.timeStr,
          sub: `Çift okutma koruması aktif (${res.waitSeconds} sn bekleyin)`
        });
        return;
      }

      const isIn = res.punch.type === 'in';
      playTone(isIn ? 'in' : 'out');
      showOverlay({
        cls: isIn ? 'res-in' : 'res-out',
        icon: isIn ? 'check_circle' : 'logout',
        action: isIn ? 'GİRİŞ YAPILDI' : 'ÇIKIŞ YAPILDI',
        name: res.employee.name,
        title: res.employee.title,
        time: res.punch.timeStr,
        sub: isIn
          ? 'Hoş geldiniz! Kaydınız sisteme iletildi.'
          : `İyi günler! Bugünkü toplam mesainiz: ${res.durationText}`
      });
    } catch (err) {
      playTone('err');
      if (err.status === 401) {
        setToken('kiosk', '');
        toast('Kiosk oturumu sona erdi, lütfen tekrar giriş yapın.', 'err');
        busy = false;
        showAuth();
        return;
      }
      showOverlay({
        cls: 'res-err',
        icon: 'error_outline',
        action: 'OKUTMA HATASI',
        name: 'Tanımsız Kart',
        title: '',
        time: '--:--',
        sub: err.message
      });
    }
  }

  async function startCamera() {
    if (!window.QrScanner) {
      fallbackBox.classList.remove('hidden');
      fallbackText.textContent = 'QR okuyucu kütüphanesi yüklenemedi.';
      return;
    }
    window.QrScanner.WORKER_PATH = '/vendor/qr-scanner-worker.min.js';
    try {
      if (scanner) {
        await scanner.stop();
        scanner.destroy();
        scanner = null;
      }
      scanner = new window.QrScanner(
        videoEl,
        (result) => {
          const data = typeof result === 'string' ? result : result?.data;
          if (data) handleQrScan(data);
        },
        {
          preferredCamera: facingMode,
          highlightScanRegion: false,
          maxScansPerSecond: 8
        }
      );
      await scanner.start();
      fallbackBox.classList.add('hidden');
    } catch (e) {
      fallbackBox.classList.remove('hidden');
      fallbackText.textContent =
        'Kamera erişimi sağlanamadı. Tarayıcıdan kamera izni verin veya alttaki kod alanını / USB okuyucuyu kullanın.';
    }
  }

  function setMode(m) {
    forcedMode = m;
    document.querySelectorAll('#modePills .mode-pill').forEach((btn) => {
      const bm = btn.getAttribute('data-mode');
      btn.className = 'mode-pill';
      if (bm === m) {
        btn.classList.add(m === 'in' ? 'active-in' : m === 'out' ? 'active-out' : 'active');
      }
    });
  }

  function showAuth() {
    if (scanner) {
      scanner.stop().catch(() => {});
    }
    mainView.classList.add('hidden');
    authView.classList.remove('hidden');
  }

  async function showMain() {
    authView.classList.add('hidden');
    mainView.classList.remove('hidden');
    requestWakeLock();
    startCamera();
  }

  document.getElementById('modePills').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) setMode(btn.getAttribute('data-mode'));
  });

  document.getElementById('switchCamBtn').addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
  });

  document.getElementById('retryCamBtn').addEventListener('click', () => startCamera());

  document.getElementById('manualScanForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('manualCodeInput');
    const v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    handleQrScan(v);
  });

  document.getElementById('kioskLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('kioskPassInput').value;
    const label = document.getElementById('kioskLabelInput').value;
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        body: { password, role: 'kiosk', label }
      });
      setToken('kiosk', res.token);
      document.getElementById('kioskPassInput').value = '';
      toast('Kiosk terminali etkinleştirildi.', 'ok');
      init();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.getElementById('kioskLogoutBtn').addEventListener('click', async () => {
    if (!confirm('Bu cihazdaki Kiosk oturumu kapatılsın mı?')) return;
    await apiFetch('/api/logout', { method: 'POST', role: 'kiosk' }).catch(() => {});
    setToken('kiosk', '');
    showAuth();
  });

  document.getElementById('resultOverlay').addEventListener('click', () => {
    clearTimeout(overlayTimer);
    document.getElementById('resultOverlay').classList.add('hidden');
    busy = false;
  });

  async function init() {
    const pub = await apiFetch('/api/public-info').catch(() => null);
    if (pub?.companyName) {
      document.getElementById('kioskCompanyTitle').textContent = pub.companyName + ' — Kiosk';
      document.getElementById('authCompanySub').textContent = pub.companyName;
    }
    const activeRole = getToken('kiosk') ? 'kiosk' : getToken('admin') ? 'admin' : '';
    if (!activeRole) {
      showAuth();
      return;
    }
    try {
      await apiFetch('/api/kiosk/status', { role: activeRole });
      showMain();
    } catch {
      if (activeRole === 'kiosk') setToken('kiosk', '');
      showAuth();
    }
  }

  init();
})();
