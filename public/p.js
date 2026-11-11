(function () {
  const { apiFetch, getToken, setToken, esc, toast, playTone, speakText } = window.PDKS;

  const params = new URLSearchParams(window.location.search);
  let pendingSiteKey = params.get('k') || '';
  const initialPairCode = params.get('pair') || '';

  if (window.location.search) {
    window.history.replaceState({}, '', window.location.pathname);
  }

  let scanner = null;
  let geoRequired = false;

  const pairView = document.getElementById('pairView');
  const empView = document.getElementById('empView');
  const fbBox = document.getElementById('punchFeedback');

  function showFeedback(kind, icon, title, sub) {
    fbBox.className = 'punch-feedback ' + kind;
    document.getElementById('fbIcon').textContent = icon;
    document.getElementById('fbTitle').textContent = title;
    document.getElementById('fbSub').textContent = sub;
    fbBox.classList.remove('hidden');
  }

  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Konum izni penceresi hiç yanıtlanmazsa (uygulama içi tarayıcılar vb.) sayfa sonsuza kadar
  // beklemesin: sert zaman aşımı ekliyoruz.
  function getGeoCoords(maxMs) {
    const geo = new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(new Error('Tarayıcınız konum özelliğini desteklemiyor.'));
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject(new Error('Konum izni alınamadı. Lütfen konum izni verip tekrar deneyin.')),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    });
    return withTimeout(geo, maxMs, 'Konum alınamadı (zaman aşımı). Konum iznini kontrol edip tekrar deneyin.');
  }

  async function submitDoorPunch({ siteKey = '', qr = '' }) {
    try {
      let coords = {};
      try {
        coords = await getGeoCoords(geoRequired ? 15000 : 3000);
      } catch (e) {
        if (geoRequired) throw e;
      }
      const res = await apiFetch('/api/phone/punch', {
        method: 'POST',
        role: 'emp',
        body: { siteKey, qr, ...coords }
      });
      pendingSiteKey = '';
      document.getElementById('pendingDoorBox').classList.add('hidden');

      if (res.duplicate) {
        playTone('err');
        showFeedback(
          'fb-warn',
          'hourglass_empty',
          'AZ ÖNCE KAYDEDİLDİ',
          `Son işleminiz (${res.lastPunch.timeStr}) zaten kayıtlı. (${res.waitSeconds} sn koruma)`
        );
      } else {
        const isIn = res.punch.type === 'in';
        playTone(isIn ? 'in' : 'out');
        const empName = (document.getElementById('empName')?.textContent || '').trim();
        const firstName = empName && empName !== '-' ? empName.split(' ')[0] : '';

        if (isIn) {
          const msg = firstName ? `İyi çalışmalar, mutlu günler ${firstName}!` : 'İyi çalışmalar, mutlu günler!';
          showFeedback('fb-in', 'login', `GİRİŞ YAPILDI (${res.punch.timeStr})`, msg);
          if (typeof speakText === 'function') speakText(msg);
        } else {
          const msg = firstName ? `İyi akşamlar ${firstName}!` : 'İyi akşamlar!';
          showFeedback('fb-out', 'logout', `ÇIKIŞ YAPILDI (${res.punch.timeStr})`, `${msg} Mesai: ${res.durationText}`);
          if (typeof speakText === 'function') speakText(msg);
        }
      }
      await refreshProfile(false);
    } catch (err) {
      playTone('err');
      toast(err.message, 'err');
      if (pendingSiteKey) {
        document.getElementById('pendingDoorBox').classList.remove('hidden');
      }
    }
  }

  async function refreshProfile(autoTriggerDoor = true) {
    try {
      const data = await apiFetch('/api/phone/me', { role: 'emp' });
      geoRequired = Boolean(data.geoEnabled);
      const titleEl = document.getElementById('phoneCompanyTitle');
      if (titleEl && data.companyName) {
        titleEl.textContent = data.companyName;
      }

      pairView.classList.add('hidden');
      empView.classList.remove('hidden');

      document.getElementById('empName').textContent = data.employee.name;
      document.getElementById('empRole').textContent = data.employee.title || 'Personel';
      document.getElementById('stFirstIn').textContent = data.todayStats.firstInTime || '--:--';
      document.getElementById('stLastOut').textContent = data.todayStats.lastOutTime || '--:--';
      document.getElementById('stWorked').textContent = data.todayStats.workedText || 'Off Day';

      const badge = document.getElementById('empStateBadge');
      if (data.todayStats.insideNow) {
        badge.className = 'badge badge-in';
        badge.textContent = 'İçeridesiniz';
      } else if (data.todayPunches.length > 0) {
        badge.className = 'badge badge-out';
        badge.textContent = 'Çıkış Yapıldı';
      } else {
        badge.className = 'badge badge-neutral';
        badge.textContent = 'Off Day';
      }

      const listEl = document.getElementById('empPunchList');
      if (data.todayPunches.length === 0) {
        listEl.innerHTML = `<div style="color:var(--muted);padding:6px 0;">Bugün henüz giriş-çıkış kaydınız bulunmuyor.</div>`;
      } else {
        listEl.innerHTML = [...data.todayPunches]
          .reverse()
          .map(
            (p) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface-2);border-radius:8px;">
            <span class="badge ${p.type === 'in' ? 'badge-in' : 'badge-out'}">${p.type === 'in' ? 'GİRİŞ' : 'ÇIKIŞ'}</span>
            <strong style="font-size:15px;">${esc(p.timeStr)}</strong>
          </div>`
          )
          .join('');
      }

      if (autoTriggerDoor && pendingSiteKey) {
        if (geoRequired) {
          document.getElementById('pendingDoorBox').classList.remove('hidden');
        } else {
          await submitDoorPunch({ siteKey: pendingSiteKey });
        }
      }

      loadMeetingsForPhone();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        setToken('emp', '');
        empView.classList.add('hidden');
        pairView.classList.remove('hidden');
      } else {
        toast(err.message, 'err');
      }
    }
  }

  async function doPair(code) {
    try {
      const ua = navigator.userAgent || '';
      const deviceLabel = /iPhone|iPad/i.test(ua)
        ? 'iPhone'
        : /Android/i.test(ua)
        ? 'Android Telefon'
        : 'Mobil Tarayıcı';
      const res = await apiFetch('/api/phone/pair', {
        method: 'POST',
        body: {
          pairCode: code,
          deviceLabel,
          siteKey: pendingSiteKey
        }
      });
      setToken('emp', res.token);
      toast(`Telefonunuz ${res.employee.name} adına eşleştirildi!`, 'ok');

      if (res.autoPunchResult && !res.autoPunchResult.duplicate) {
        pendingSiteKey = '';
        const p = res.autoPunchResult.punch;
        playTone('in');
        showFeedback(
          'fb-in',
          'check_circle',
          `${p.type === 'in' ? 'GİRİŞ' : 'ÇIKIŞ'} YAPILDI (${p.timeStr})`,
          'Telefonunuz eşleştirildi ve ilk kaydınız alındı!'
        );
      }
      await refreshProfile(Boolean(pendingSiteKey));
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  document.getElementById('pairForm').addEventListener('submit', (e) => {
    e.preventDefault();
    doPair(document.getElementById('pairCodeInput').value);
  });

  document.getElementById('confirmDoorPunchBtn').addEventListener('click', () => {
    if (pendingSiteKey) submitDoorPunch({ siteKey: pendingSiteKey });
  });

  async function stopPhoneCam() {
    if (scanner) {
      await scanner.stop().catch(() => {});
      scanner.destroy();
      scanner = null;
    }
    document.getElementById('phoneCamWrap').classList.add('hidden');
    document.getElementById('openPhoneCamBtn').classList.remove('hidden');
  }

  document.getElementById('openPhoneCamBtn').addEventListener('click', async () => {
    if (!window.QrScanner) return toast('QR okuyucu yüklenemedi.', 'err');
    window.QrScanner.WORKER_PATH = '/vendor/qr-scanner-worker.min.js';
    document.getElementById('openPhoneCamBtn').classList.add('hidden');
    const pickBtn = document.getElementById('pickQrPhotoBtn');
    if (pickBtn) pickBtn.classList.add('hidden');
    document.getElementById('phoneCamWrap').classList.remove('hidden');
    try {
      scanner = new window.QrScanner(
        document.getElementById('phoneVideo'),
        async (result) => {
          const text = typeof result === 'string' ? result : result?.data;
          if (!text) return;
          await stopPhoneCam();
          await submitDoorPunch({ qr: text });
        },
        { preferredCamera: 'environment', maxScansPerSecond: 6 }
      );
      await withTimeout(scanner.start(), 8000, 'Kamera açılamadı (zaman aşımı).');
    } catch {
      await stopPhoneCam();
      toast('Canlı kamera açılamadı. "Foto Çek / Yükle" butonunu kullanarak kapı QR fotoğrafını çekebilirsiniz.', 'err');
    }
  });

  document.getElementById('pickQrPhotoBtn')?.addEventListener('click', () => {
    document.getElementById('qrPhotoInput')?.click();
  });

  document.getElementById('qrPhotoInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      toast('Karekod taranıyor...', 'ok');
      window.QrScanner.WORKER_PATH = '/vendor/qr-scanner-worker.min.js';
      const text = await window.QrScanner.scanImage(file, { returnDetailedScanResult: false });
      if (text) {
        await submitDoorPunch({ qr: text });
      } else {
        toast('Görselde geçerli bir QR kod bulunamadı.', 'err');
      }
    } catch (err) {
      toast('Karekod okunamadı. Lütfen afişe daha yakın ve net bir fotoğraf çekin.', 'err');
    } finally {
      e.target.value = '';
    }
  });

  async function stopPhoneCam() {
    if (scanner) {
      await scanner.stop().catch(() => {});
      scanner.destroy();
      scanner = null;
    }
    document.getElementById('phoneCamWrap').classList.add('hidden');
    document.getElementById('openPhoneCamBtn').classList.remove('hidden');
    const pickBtn = document.getElementById('pickQrPhotoBtn');
    if (pickBtn) pickBtn.classList.remove('hidden');
  }

  document.getElementById('closePhoneCamBtn')?.addEventListener('click', stopPhoneCam);

  async function init() {
    window.__showEmpPairGate = () => {
      empView.classList.add('hidden');
      pairView.classList.remove('hidden');
    };

    const pub = await apiFetch('/api/public-info').catch(() => null);
    const titleEl = document.getElementById('phoneCompanyTitle');
    if (titleEl && pub?.companyName) {
      titleEl.textContent = pub.companyName;
    }


    if (initialPairCode && !getToken('emp')) {
      const pInp = document.getElementById('pairCodeInput');
      if (pInp) pInp.value = initialPairCode;
      pairView.classList.remove('hidden');
      await doPair(initialPairCode);
      return;
    }

    if (getToken('emp')) {
      await refreshProfile(true);
    } else {
      pairView.classList.remove('hidden');
    }
  }

  const DAY_NAMES = {
    1: 'Pazartesi',
    2: 'Salı',
    3: 'Çarşamba',
    4: 'Perşembe',
    5: 'Cuma',
    6: 'Cumartesi',
    0: 'Pazar'
  };

  const MONTH_NAMES_TR = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
  ];

  async function loadMeetingsForPhone() {
    try {
      const role = getToken('emp') ? 'emp' : getToken('admin') ? 'admin' : '';
      if (!role) return;
      const res = await apiFetch('/api/meetings', { role });
      const list = res.meetings || [];
      const badge = document.getElementById('pMeetingCount');
      if (badge) badge.textContent = `${list.length} Toplantı`;

      const listEl = document.getElementById('pMeetingList');
      if (!listEl) return;
      if (list.length === 0) {
        listEl.innerHTML = `<div style="color:var(--muted);padding:8px 0;text-align:center;">Planlanmış toplantı bulunmuyor.</div>`;
        return;
      }

      const now = new Date();
      const todayDow = now.getDay();
      const todayStr = now.toISOString().slice(0, 10);

      listEl.innerHTML = list
        .map((m) => {
          const isToday =
            (m.meeting_date && m.meeting_date === todayStr) ||
            (!m.meeting_date && Number(m.day_of_week) === todayDow);

          const dayName = DAY_NAMES[m.day_of_week] || 'Gün';
          let dateBadge = `Her ${dayName}`;
          if (m.meeting_date) {
            const parts = m.meeting_date.split('-');
            if (parts.length === 3) {
              const mIdx = Number(parts[1]) - 1;
              dateBadge = `${Number(parts[2])} ${MONTH_NAMES_TR[mIdx] || ''} (${dayName})`;
            }
          }

          return `
          <div style="padding:12px;border-radius:12px;border:1px solid ${isToday ? 'var(--primary)' : 'var(--border)'};border-left:5px solid ${
            isToday ? 'var(--primary)' : '#94a3b8'
          };background:${isToday ? '#f8faff' : '#fff'};box-shadow:0 2px 5px rgba(0,0,0,0.03);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-weight:700;font-size:12.5px;color:${isToday ? 'var(--primary)' : 'var(--text)'};display:inline-flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:15px;">event</span> ${esc(dateBadge)}</span>
                ${isToday ? '<span class="badge badge-in" style="font-size:10px;padding:2px 6px;font-weight:700;">BUGÜN</span>' : ''}
              </div>
              <span style="font-size:11.5px;font-weight:700;background:#f1f5f9;color:#0f172a;padding:2px 7px;border-radius:5px;display:inline-flex;align-items:center;gap:3px;"><span class="material-symbols-outlined" style="font-size:14px;">schedule</span> ${esc(
                m.start_time
              )} - ${esc(m.end_time)}</span>
            </div>
            <div style="font-weight:700;font-size:14.5px;color:#0f172a;margin-bottom:3px;">${esc(m.title)}</div>
            ${m.participants ? `<div style="font-size:12px;color:#475569;display:inline-flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:14px;">group</span> <strong>${esc(m.participants)}</strong></div>` : ''}
            ${m.room ? `<div style="font-size:12px;color:#64748b;display:inline-flex;align-items:center;gap:4px;margin-left:8px;"><span class="material-symbols-outlined" style="font-size:14px;">meeting_room</span> ${esc(m.room)}</div>` : ''}
            ${m.description ? `<div style="font-size:11.5px;color:#94a3b8;margin-top:2px;font-style:italic;">${esc(m.description)}</div>` : ''}
          </div>`;
        })
        .join('');
    } catch {}
  }

  init();
})();
