(function () {
  const { apiFetch, getToken, setToken, esc, makeQrSvg, toast, playTone, formatDateTr, formatPairCode } =
    window.PDKS;

  let state = {
    tab: 'overview',
    overview: null,
    employees: [],
    punches: [],
    meetings: [],
    activeMeetingDay: 'all',
    meetingView: 'grid',
    lastTopPunchId: null,
    pollTimer: null
  };

  const authView = document.getElementById('adminAuthView');
  const appView = document.getElementById('adminAppView');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalContent = document.getElementById('modalContent');

  const SOURCE_TR = {
    kiosk: 'Kapı Kiosk',
    phone: 'Telefon QR',
    manual: 'Manuel'
  };

  const STATUS_BADGE = {
    inside: ['badge-in', 'Şu An İçeride'],
    ok: ['badge-out', 'Tamamlandı'],
    late: ['badge-warn', 'Geç Giriş'],
    early: ['badge-warn', 'Erken Çıkış'],
    missing_out: ['badge-err', 'Çıkış Eksik'],
    absent: ['badge-neutral', 'Off Day'],
    off_day: ['badge-neutral', 'Off Day']
  };

  function openModal(html) {
    modalContent.innerHTML = html;
    modalBackdrop.classList.remove('hidden');
  }

  function closeModal() {
    modalBackdrop.classList.add('hidden');
    modalContent.innerHTML = '';
  }


  // --- ŞİFRE KURTARMA ---
  document.getElementById('forgotPassBtn')?.addEventListener('click', async () => {
    let enabled = false;
    try {
      const st = await apiFetch('/api/admin/recovery-status');
      enabled = Boolean(st.enabled);
    } catch {}

    if (!enabled) {
      openModal(`
        <div style="font-weight:800;font-size:16px;margin-bottom:8px;">Şifre kurtarma kapalı</div>
        <p style="font-size:13.5px;color:var(--muted);line-height:1.6;">
          Güvenlik için şifre sıfırlama yalnızca sunucuda <b>ADMIN_RECOVERY_KEY</b> tanımlıysa çalışır.
          Vercel → proje → Settings → Environment Variables bölümüne en az 12 karakterlik bir kurtarma
          anahtarı ekleyip yeniden dağıtın; ardından bu ekran şifre sıfırlamaya izin verir.
        </p>
        <div style="text-align:right;margin-top:10px;"><button class="btn" data-close-modal>Kapat</button></div>
      `);
      return;
    }

    openModal(`
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;">Yönetici Şifresini Sıfırla</div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">
        Kurtarma anahtarınızı ve yeni şifrenizi girin. Tüm açık yönetici oturumları kapatılır.
      </p>
      <form id="recoveryForm" style="display:flex;flex-direction:column;gap:10px;">
        <div class="field">
          <label>Kurtarma Anahtarı</label>
          <input class="input" type="password" id="recoveryKeyInput" required autocomplete="off">
        </div>
        <div class="field">
          <label>Yeni Şifre (en az 6 karakter)</label>
          <input class="input" type="password" id="recoveryNewPass" minlength="6" required autocomplete="new-password">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" class="btn" data-close-modal>Vazgeç</button>
          <button type="submit" class="btn btn-primary">Şifreyi Sıfırla</button>
        </div>
      </form>
    `);

    document.getElementById('recoveryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await apiFetch('/api/admin/recovery-reset', {
          method: 'POST',
          body: {
            recoveryKey: document.getElementById('recoveryKeyInput').value,
            newPassword: document.getElementById('recoveryNewPass').value
          }
        });
        closeModal();
        toast('Şifre güncellendi. Yeni şifrenizle giriş yapabilirsiniz.', 'ok');
        document.getElementById('adminPassInput').focus();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop || e.target.closest('[data-close-modal]')) closeModal();
  });

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#adminTabs [data-tab]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.classList.toggle('hidden', p.id !== `tab-${tab}`);
    });
    closeSidebar();
    if (tab === 'overview') loadOverview();
    if (tab === 'punches') loadPunches();
    if (tab === 'reports') loadReport();
    if (tab === 'meetings') loadMeetings();
    if (tab === 'employees') loadEmployees();
    if (tab === 'archive') loadArchive();
    if (tab === 'qrcenter') renderQrCenter();
    if (tab === 'settings') loadSettingsTab();
  }

  const sidebar = document.getElementById('adminSidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('hidden');
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
  }

  if (toggleSidebarBtn) toggleSidebarBtn.addEventListener('click', openSidebar);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

  document.getElementById('adminTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.getAttribute('data-tab'));
  });



  // --- TAM YEDEK / GERİ YÜKLEME ---
  document.getElementById('downloadBackupBtn')?.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/admin/backup', { role: 'admin', raw: true });
      if (!res.ok) throw new Error('Yedek alınamadı.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pdks-yedek-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Tam yedek indirildi. Dosyayı güvenli bir yerde saklayın.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  document.getElementById('restoreBackupBtn')?.addEventListener('click', () => {
    document.getElementById('restoreFileInput')?.click();
  });

  document.getElementById('restoreFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('DİKKAT: Mevcut personel, giriş-çıkış kayıtları ve toplantılar silinip yedekteki veriler yüklenecek. Devam edilsin mi?')) return;
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Dosya geçerli bir JSON değil.');
      }
      const res = await apiFetch('/api/admin/restore', {
        method: 'POST',
        role: 'admin',
        body: { ...parsed, confirm: 'GERI YUKLE' }
      });
      toast(
        `Geri yükleme tamam: ${res.restored.employees} personel, ${res.restored.punches} kayıt, ${res.restored.meetings} toplantı.`,
        'ok'
      );
      loadArchive();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  // --- ARŞİV & DEPO ---
  function fmtBytes(n) {
    const b = Number(n || 0);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function fileIcon(mime, filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'picture_as_pdf';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'table_chart';
    if (['doc', 'docx'].includes(ext)) return 'description';
    if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) return 'image';
    if (['zip', 'gz', 'rar', '7z'].includes(ext)) return 'folder_zip';
    return 'draft';
  }

  async function loadArchive() {
    try {
      const sum = await apiFetch('/api/admin/archive/summary', { role: 'admin' });
      document.getElementById('archiveStorage').textContent = 'Depo: ' + (sum.storage || 'PostgreSQL');
      document.getElementById('archiveSnapCount').textContent = sum.snapshots || 0;
      document.getElementById('archiveFileCount').textContent = sum.files || 0;
      document.getElementById('archiveUsedBytes').textContent = fmtBytes(sum.bytes);
    } catch (e) {
      toast(e.message, 'err');
    }
    loadSnapshots();
    loadArchiveFiles();
  }

  async function loadSnapshots() {
    const box = document.getElementById('snapshotList');
    try {
      const res = await apiFetch('/api/admin/archive/snapshots', { role: 'admin' });
      const list = res.snapshots || [];
      if (!list.length) {
        box.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:10px 0;">Henüz dönem arşivi yok. Yukarıdan bir ay seçip “Arşive Al” butonuna basın.</div>`;
        return;
      }
      box.innerHTML = list
        .map(
          (s) => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;">${esc(s.title || 'Dönem Arşivi')}</div>
            <div style="font-size:11.5px;color:var(--muted);">
              ${esc(s.from_date)} → ${esc(s.to_date)} · ${s.row_count} personel ·
              ${new Date(s.created_at).toLocaleString('tr-TR')}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn btn-sm" data-snap-xlsx="${s.id}" title="Excel indir">
              <span class="material-symbols-outlined" style="font-size:16px;">download</span>
            </button>
            <button class="btn btn-sm" data-snap-view="${s.id}" title="Detay">
              <span class="material-symbols-outlined" style="font-size:16px;">visibility</span>
            </button>
          </div>
        </div>`
        )
        .join('');
    } catch (e) {
      box.innerHTML = `<div style="color:var(--red);font-size:13px;">${esc(e.message)}</div>`;
    }
  }

  async function loadArchiveFiles() {
    const body = document.getElementById('archiveFilesBody');
    const cat = document.getElementById('archiveCatFilter')?.value || '';
    const q = document.getElementById('archiveSearch')?.value || '';
    try {
      const res = await apiFetch(
        `/api/admin/archive/files?category=${encodeURIComponent(cat)}&q=${encodeURIComponent(q)}`,
        { role: 'admin' }
      );
      const files = res.files || [];
      if (!files.length) {
        body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:22px;font-size:13px;">Depoda dosya bulunmuyor.</td></tr>`;
        return;
      }
      body.innerHTML = files
        .map(
          (f) => `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:7px;font-weight:600;font-size:13.5px;">
              <span class="material-symbols-outlined" style="font-size:18px;color:var(--primary);">${fileIcon(f.mime, f.filename)}</span>
              <span>${esc(f.title)}</span>
            </div>
          </td>
          <td><span class="badge badge-neutral" style="font-size:11px;">${esc(f.categoryLabel || f.category)}</span></td>
          <td style="font-size:12.5px;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.filename)}</td>
          <td style="font-size:12.5px;">${fmtBytes(f.size_bytes)}</td>
          <td style="font-size:12.5px;">${esc(f.period || '-')}</td>
          <td style="font-size:12px;color:var(--muted);">${new Date(f.created_at).toLocaleString('tr-TR')}</td>
          <td style="text-align:right;white-space:nowrap;">
            <button class="btn btn-sm" data-file-dl="${f.id}" title="İndir">
              <span class="material-symbols-outlined" style="font-size:16px;">download</span>
            </button>
            <button class="btn btn-sm btn-danger" data-file-del="${f.id}" title="Sil">
              <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
            </button>
          </td>
        </tr>`
        )
        .join('');
    } catch (e) {
      body.innerHTML = `<tr><td colspan="7" style="color:var(--red);padding:16px;">${esc(e.message)}</td></tr>`;
    }
  }

  document.getElementById('snapshotForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const period = document.getElementById('snapshotPeriod').value;
    try {
      const res = await apiFetch('/api/admin/archive/snapshots', {
        method: 'POST',
        role: 'admin',
        body: { period }
      });
      toast(res.updated ? `${res.period} arşivi güncellendi.` : `${res.period} dönemi arşive alındı.`, 'ok');
      loadArchive();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.getElementById('uploadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('uploadFile');
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      return toast('Dosya 4 MB sınırını aşıyor.', 'err');
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('Dosya okunamadı.'));
        fr.readAsDataURL(file);
      });
      await apiFetch('/api/admin/archive/files', {
        method: 'POST',
        role: 'admin',
        body: {
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          title: document.getElementById('uploadTitle').value || file.name,
          category: document.getElementById('uploadCategory').value,
          period: document.getElementById('uploadPeriod').value,
          data: dataUrl
        }
      });
      toast('Dosya depoya yüklendi.', 'ok');
      e.target.reset();
      loadArchive();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('archiveCatFilter')?.addEventListener('change', loadArchiveFiles);
  document.getElementById('archiveSearch')?.addEventListener('input', () => {
    clearTimeout(state.archiveSearchTimer);
    state.archiveSearchTimer = setTimeout(loadArchiveFiles, 300);
  });

  document.getElementById('tab-archive')?.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-file-dl]');
    if (dl) {
      const id = dl.getAttribute('data-file-dl');
      try {
        const res = await apiFetch(`/api/admin/archive/files/${id}`, { role: 'admin', raw: true });
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition') || '';
        const m = /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="([^"]+)"/.exec(cd);
        const name = m ? decodeURIComponent(m[1]) : 'dosya';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (err) {
        toast(err.message || 'İndirme başarısız.', 'err');
      }
      return;
    }

    const del = e.target.closest('[data-file-del]');
    if (del) {
      if (!confirm('Bu dosya depodan kalıcı olarak silinsin mi?')) return;
      try {
        await apiFetch(`/api/admin/archive/files/${del.getAttribute('data-file-del')}`, {
          method: 'DELETE',
          role: 'admin'
        });
        toast('Dosya silindi.', 'ok');
        loadArchive();
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }

    const xl = e.target.closest('[data-snap-xlsx]');
    if (xl) {
      const id = xl.getAttribute('data-snap-xlsx');
      try {
        const res = await apiFetch(`/api/admin/archive/snapshots/${id}/excel`, { role: 'admin', raw: true });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `arsiv-${id}.xlsx`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (err) {
        toast(err.message || 'İndirme başarısız.', 'err');
      }
      return;
    }

    const view = e.target.closest('[data-snap-view]');
    if (view) {
      const id = view.getAttribute('data-snap-view');
      try {
        const res = await apiFetch(`/api/admin/archive/snapshots/${id}`, { role: 'admin' });
        const p = res.snapshot.payload || {};
        const rows = (p.summary || [])
          .map(
            (s) => `
          <tr>
            <td>${esc(s.name)}</td>
            <td>${esc(s.title || '-')}</td>
            <td style="text-align:center;">${s.daysPresent}</td>
            <td style="text-align:right;font-weight:700;">${esc(s.totalText || '0 sa')}</td>
            <td style="text-align:center;">${s.lateCount}</td>
            <td style="text-align:center;">${s.absentCount}</td>
          </tr>`
          )
          .join('');
        openModal(`
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div style="font-weight:800;font-size:16px;">${esc(res.snapshot.title)}</div>
            <button class="btn btn-sm" data-close-modal>Kapat</button>
          </div>
          <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px;">
            ${esc(res.snapshot.from_date)} → ${esc(res.snapshot.to_date)} ·
            ${res.snapshot.row_count} personel · ${(p.punchCount || 0)} okutma kaydı
          </div>
          <div class="table-wrap" style="max-height:50vh;overflow:auto;">
            <table>
              <thead><tr><th>Personel</th><th>Görev</th><th>Gün</th><th>Mesai</th><th>Geç</th><th>Devamsız</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:var(--muted);">Kayıt yok</td></tr>'}</tbody>
            </table>
          </div>`);
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  });

  // --- OVERVIEW ---
  async function loadOverview(silent = false) {
    try {
      const d = await apiFetch('/api/admin/overview', { role: 'admin' });
      state.overview = d;

      document.getElementById('navCompanyName').textContent = d.config.companyName;
      document.getElementById('navWorkHours').textContent = `Mesai: ${d.config.workStart} - ${d.config.workEnd} (${d.config.lateToleranceMin} dk tolerans)`;

      document.getElementById('demoBanner').classList.toggle('hidden', !d.hasDemo);
      document.getElementById('dbBanner').classList.toggle('hidden', !d.dbNotice?.isClaimable);

      document.getElementById('kpiInside').textContent = d.counts.insideNow;
      document.getElementById('kpiTotalSub').textContent = `Toplam ${d.counts.totalActive} aktif personel`;
      document.getElementById('kpiArrived').textContent = d.counts.arrivedToday;
      document.getElementById('kpiPunchesSub').textContent = `Bugün ${d.counts.todayPunches} giriş/çıkış hareketi`;
      document.getElementById('kpiLate').textContent = d.counts.lateToday;
      document.getElementById('kpiNotArrived').textContent = d.counts.notArrivedYet;

      // Staff Status Table
      const sb = document.getElementById('overviewStaffBody');
      if (d.staffStatus.length === 0) {
        sb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">Henüz personel eklenmemiş. "Personeller" sekmesinden ekleyebilirsiniz.</td></tr>`;
      } else {
        sb.innerHTML = d.staffStatus
          .map((s) => {
            const stBadge =
              s.state === 'inside'
                ? `<span class="badge badge-in"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:text-bottom;">login</span> İçeride</span>`
                : s.state === 'out'
                ? `<span class="badge badge-out"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:text-bottom;">logout</span> Çıkış Yaptı</span>`
                : `<span class="badge badge-neutral"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:text-bottom;">schedule</span> Off Day</span>`;
            const lateTag =
              s.lateMinutes > 0
                ? ` <span class="badge badge-warn" style="font-size:11px;">+${s.lateMinutes} dk geç</span>`
                : '';
            const locTag = s.mapUrl
              ? `<a href="${esc(s.mapUrl)}" target="_blank" rel="noopener" class="badge" style="background:#eff6ff;color:#2563eb;text-decoration:none;font-size:11px;padding:3px 7px;margin-left:4px;display:inline-flex;align-items:center;gap:3px;" title="Haritada konumu aç"><span class="material-symbols-outlined" style="font-size:13px;">location_on</span> Konum</a>`
              : '';
            const nextAction = s.state === 'inside' ? 'Çıkış Okut' : 'Giriş Okut';
            return `
            <tr>
              <td>
                <div style="font-weight:600;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">${esc(s.name)}${locTag}</div>
                <div style="font-size:12px;color:var(--muted);">${esc(s.title)}</div>
              </td>
              <td>${stBadge}</td>
              <td><strong>${esc(s.firstInTime || '--:--')}</strong>${lateTag}</td>
              <td>${esc(s.lastOutTime || '--:--')}</td>
              <td><strong>${esc(s.workedText)}</strong></td>
              <td>
                <button class="btn btn-sm" data-sim-emp="${s.id}" title="Anında test giriş/çıkış kaydı düşür">${nextAction}</button>
              </td>
            </tr>`;
          })
          .join('');
      }

      // Recent Feed
      const topId = d.recentPunches[0]?.id || null;
      const isNewArrival = state.lastTopPunchId !== null && topId !== null && topId > state.lastTopPunchId;
      if (isNewArrival && silent) playTone('in');
      state.lastTopPunchId = topId;

      const fl = document.getElementById('recentFeedList');
      if (d.recentPunches.length === 0) {
        fl.innerHTML = `<div style="color:var(--muted);font-size:13.5px;text-align:center;padding:24px;">Henüz giriş-çıkış hareketi yok.</div>`;
      } else {
        fl.innerHTML = d.recentPunches
          .map(
            (p, idx) => `
          <div class="feed-item ${idx === 0 && isNewArrival ? 'flash' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;width:100%;">
              <div>
                <div style="font-weight:600;font-size:13.5px;display:flex;align-items:center;gap:6px;">
                  <span>${esc(p.employeeName)}</span>
                  ${p.mapUrl ? `<a href="${esc(p.mapUrl)}" target="_blank" rel="noopener" class="badge" style="background:#eff6ff;color:#2563eb;text-decoration:none;font-size:10.5px;padding:2px 6px;display:inline-flex;align-items:center;gap:3px;" title="Haritada konumu aç"><span class="material-symbols-outlined" style="font-size:13px;">location_on</span> Konum</a>` : ''}
                </div>
                <div style="font-size:12px;color:var(--muted);margin-top:2px;">
                  ${formatDateTr(p.dateStr)} • ${esc(SOURCE_TR[p.source] || p.source)}${p.note ? ' • ' + esc(p.note) : ''}
                </div>
              </div>
              <div style="text-align:right;">
                <span class="badge ${p.type === 'in' ? 'badge-in' : 'badge-out'}">${p.type === 'in' ? 'GİRİŞ' : 'ÇIKIŞ'}</span>
                <div style="font-weight:800;font-size:14.5px;margin-top:2px;">${esc(p.timeStr)}</div>
              </div>
            </div>
          </div>`
          )
          .join('');
      }

      // Initialize default filter dates if empty
      if (!document.getElementById('fltFrom').value) {
        const today = d.todayWorkDate;
        const weekAgo = shiftDaysClient(today, -6);
        document.getElementById('fltFrom').value = weekAgo;
        document.getElementById('fltTo').value = today;
        document.getElementById('repFrom').value = weekAgo;
        document.getElementById('repTo').value = today;
      }
    } catch (err) {
      if (err.status === 401) {
        setToken('admin', '');
        showLoginGate();
      } else if (!silent) {
        toast(err.message, 'err');
      }
    }
  }

  function shiftDaysClient(dateStr, delta) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    return dt.toISOString().slice(0, 10);
  }

  // Quick simulate scan on overview
  document.getElementById('overviewStaffBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-sim-emp]');
    if (!btn) return;
    btn.disabled = true;
    try {
      const empId = Number(btn.getAttribute('data-sim-emp'));
      const res = await apiFetch('/api/admin/punches', {
        method: 'POST',
        role: 'admin',
        body: { simulateEmployeeId: empId, source: 'kiosk', note: 'Panelden hızlı okutma' }
      });
      playTone(res.punch?.type === 'out' ? 'out' : 'in');
      toast(
        `${res.employee.name}: ${res.punch.type === 'in' ? 'GİRİŞ' : 'ÇIKIŞ'} kaydedildi (${res.punch.timeStr})`,
        'ok'
      );
      await loadOverview(true);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // --- PUNCHES TAB ---
  async function ensureEmployeeDropdown() {
    const r = await apiFetch('/api/admin/employees', { role: 'admin' });
    state.employees = r.employees;
    const sel = document.getElementById('fltEmp');
    const cur = sel.value;
    sel.innerHTML =
      `<option value="">Tüm Personeller</option>` +
      state.employees.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    sel.value = cur;
  }

  async function loadPunches() {
    try {
      await ensureEmployeeDropdown();
      const from = document.getElementById('fltFrom').value;
      const to = document.getElementById('fltTo').value;
      const emp = document.getElementById('fltEmp').value;
      const type = document.getElementById('fltType').value;
      const qs = new URLSearchParams({ from, to, employeeId: emp, type });
      const d = await apiFetch(`/api/admin/punches?${qs.toString()}`, { role: 'admin' });
      state.punches = d.punches;

      const tb = document.getElementById('punchesTableBody');
      if (d.punches.length === 0) {
        tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">Seçilen tarih aralığında kayıt bulunamadı.</td></tr>`;
        return;
      }
      tb.innerHTML = d.punches
        .map(
          (p) => `
        <tr>
          <td>${formatDateTr(p.dateStr)}</td>
          <td><strong>${esc(p.timeStr)}</strong></td>
          <td>
            <div style="font-weight:600;">${esc(p.employeeName)}</div>
            <div style="font-size:12px;color:var(--muted);">${esc(p.employeeTitle)}</div>
          </td>
          <td><span class="badge ${p.type === 'in' ? 'badge-in' : 'badge-out'}">${p.type === 'in' ? 'GİRİŞ' : 'ÇIKIŞ'}</span></td>
          <td>
            ${esc(SOURCE_TR[p.source] || p.source)}
            ${p.mapUrl ? `<br><a href="${esc(p.mapUrl)}" target="_blank" rel="noopener" class="badge" style="background:#eff6ff;color:#2563eb;text-decoration:none;font-size:10.5px;padding:2px 6px;margin-top:2px;display:inline-flex;align-items:center;gap:3px;" title="Haritada konumu aç"><span class="material-symbols-outlined" style="font-size:13px;">location_on</span> Konum</a>` : ''}
          </td>
          <td>${esc(p.note || '-')}</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm" data-edit-punch="${p.id}">Düzenle</button>
              <button class="btn btn-sm btn-danger" data-del-punch="${p.id}">Sil</button>
            </div>
          </td>
        </tr>`
        )
        .join('');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  document.getElementById('applyPunchFilterBtn').addEventListener('click', loadPunches);

  async function openPunchModal(existing = null) {
    if (!state.employees.length) await ensureEmployeeDropdown();
    const today = state.overview?.todayWorkDate || new Date().toISOString().slice(0, 10);
    const nowHm = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date());

    openModal(`
      <h3 style="margin:0 0 14px;font-size:17px;">${existing ? 'Giriş/Çıkış Kaydını Düzenle' : 'Manuel Giriş/Çıkış Kaydı Ekle'}</h3>
      <form id="punchModalForm" style="display:flex;flex-direction:column;gap:12px;">
        ${
          existing
            ? `<div style="font-weight:600;padding:8px 10px;background:var(--surface-2);border-radius:8px;">${esc(existing.employeeName)}</div>`
            : `<div class="field">
                <label>Personel</label>
                <select class="input" id="pmEmp" required>
                  ${state.employees
                    .filter((e) => e.active)
                    .map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.title)})</option>`)
                    .join('')}
                </select>
              </div>`
        }
        <div class="form-row">
          <div class="field">
            <label>Tarih</label>
            <input type="date" class="input" id="pmDate" value="${esc(existing ? existing.dateStr : today)}" required>
          </div>
          <div class="field">
            <label>Saat</label>
            <input type="time" class="input" id="pmTime" value="${esc(existing ? existing.timeStr : nowHm)}" required>
          </div>
        </div>
        <div class="field">
          <label>İşlem Türü</label>
          <select class="input" id="pmType">
            <option value="in" ${existing?.type === 'in' ? 'selected' : ''}>GİRİŞ</option>
            <option value="out" ${existing?.type === 'out' ? 'selected' : ''}>ÇIKIŞ</option>
          </select>
        </div>
        <div class="field">
          <label>Açıklama / Not (İsteğe bağlı)</label>
          <input class="input" id="pmNote" value="${esc(existing ? existing.note : '')}" placeholder="Örn: Kartını unuttu">
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
          <button type="button" class="btn" data-close-modal>İptal</button>
          <button type="submit" class="btn btn-primary">Kaydet</button>
        </div>
      </form>
    `);

    document.getElementById('punchModalForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const payload = {
          id: existing?.id,
          employeeId: existing ? existing.employeeId : Number(document.getElementById('pmEmp').value),
          dateStr: document.getElementById('pmDate').value,
          timeStr: document.getElementById('pmTime').value,
          type: document.getElementById('pmType').value,
          note: document.getElementById('pmNote').value
        };
        await apiFetch('/api/admin/punches', {
          method: existing ? 'PUT' : 'POST',
          role: 'admin',
          body: payload
        });
        closeModal();
        toast('Kayıt başarıyla kaydedildi.', 'ok');
        if (state.tab === 'punches') loadPunches();
        else loadOverview();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  }

  document.getElementById('openAddPunchBtn').addEventListener('click', () => openPunchModal(null));
  document.getElementById('goAddPunchFromOverview').addEventListener('click', () => openPunchModal(null));

  document.getElementById('punchesTableBody').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-punch]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-edit-punch'));
      const item = state.punches.find((x) => x.id === id);
      if (item) openPunchModal(item);
      return;
    }
    const delBtn = e.target.closest('[data-del-punch]');
    if (delBtn) {
      const id = Number(delBtn.getAttribute('data-del-punch'));
      if (!confirm('Bu giriş/çıkış kaydı silinsin mi?')) return;
      try {
        await apiFetch(`/api/admin/punches?id=${id}`, { method: 'DELETE', role: 'admin' });
        toast('Kayıt silindi.', 'ok');
        loadPunches();
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  });

  // --- REPORTS TAB ---
  async function loadReport() {
    try {
      const from = document.getElementById('repFrom').value;
      const to = document.getElementById('repTo').value;
      const d = await apiFetch(`/api/admin/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        role: 'admin'
      });

      const sumBody = document.getElementById('repSummaryBody');
      sumBody.innerHTML = d.summary
        .map(
          (s) => `
        <tr>
          <td>
            <div style="font-weight:600;">${esc(s.name)}</div>
            <div style="font-size:12px;color:var(--muted);">${esc(s.title)}</div>
          </td>
          <td>${s.daysPresent} gün</td>
          <td><strong style="color:var(--primary);">${esc(s.totalText)}</strong></td>
          <td>${
            s.lateCount > 0
              ? `<span class="badge badge-warn">${s.lateCount} kez (${s.lateMinutes} dk)</span>`
              : '<span style="color:var(--muted);">Yok</span>'
          }</td>
          <td>${s.earlyCount > 0 ? `<span class="badge badge-warn">${s.earlyCount} kez</span>` : '-'}</td>
          <td>${s.missingOutCount > 0 ? `<span class="badge badge-err">${s.missingOutCount} gün</span>` : '-'}</td>
          <td>${s.absentCount > 0 ? `<span class="badge badge-err">${s.absentCount} gün</span>` : '-'}</td>
        </tr>`
        )
        .join('');

      const dailyBody = document.getElementById('repDailyBody');
      if (d.daily.length === 0) {
        dailyBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Bu tarih aralığında kayıt yok.</td></tr>`;
      } else {
        dailyBody.innerHTML = d.daily
          .map((row) => {
            const [cls, label] = STATUS_BADGE[row.status] || ['badge-neutral', row.status];
            const extra =
              row.lateMinutes > 0
                ? ` (${row.lateMinutes} dk geç)`
                : row.earlyMinutes > 0
                ? ` (${row.earlyMinutes} dk erken)`
                : '';
            return `
            <tr>
              <td>${formatDateTr(row.workDate)}</td>
              <td><strong>${esc(row.employeeName)}</strong> <span style="color:var(--muted);font-size:12px;">${esc(row.employeeTitle)}</span></td>
              <td><strong>${esc(row.firstInTime || '-')}</strong></td>
              <td><strong>${esc(row.lastOutTime || '-')}</strong></td>
              <td>${esc(row.workedText)}</td>
              <td><span class="badge ${cls}">${esc(label + extra)}</span></td>
            </tr>`;
          })
          .join('');
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  document.getElementById('repRunBtn').addEventListener('click', loadReport);

  document.getElementById('tab-reports').addEventListener('click', (e) => {
    const presetBtn = e.target.closest('[data-rep-preset]');
    if (!presetBtn) return;
    const p = presetBtn.getAttribute('data-rep-preset');
    const today = state.overview?.todayWorkDate || new Date().toISOString().slice(0, 10);
    if (p === 'today') {
      document.getElementById('repFrom').value = today;
      document.getElementById('repTo').value = today;
    } else if (p === 'week') {
      document.getElementById('repFrom').value = shiftDaysClient(today, -6);
      document.getElementById('repTo').value = today;
    } else if (p === 'month') {
      document.getElementById('repFrom').value = today.slice(0, 8) + '01';
      document.getElementById('repTo').value = today;
    }
    loadReport();
  });

  document.getElementById('exportXlsxBtn').addEventListener('click', async () => {
    try {
      const from = document.getElementById('repFrom').value;
      const to = document.getElementById('repTo').value;
      const res = await apiFetch(
        `/api/admin/export.xlsx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { role: 'admin', raw: true }
      );
      if (!res.ok) throw new Error('Excel dosyası oluşturulamadı.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mesai-raporu-${from}_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Excel raporu indirildi.', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  // --- MEETINGS CALENDAR TAB (REAL DATES) ---
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

  const COLOR_BADGES = {
    blue: 'color-blue',
    emerald: 'color-emerald',
    purple: 'color-purple',
    amber: 'color-amber',
    rose: 'color-rose',
    indigo: 'color-indigo'
  };

  function getMondayOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(date.setDate(diff));
    mon.setHours(0, 0, 0, 0);
    return mon;
  }

  state.currentMonday = getMondayOfWeek(new Date());

  async function loadMeetings() {
    try {
      const d = await apiFetch('/api/admin/meetings', { role: 'admin' });
      state.meetings = d.meetings || [];
      renderMeetings();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function renderMeetings() {
    const badge = document.getElementById('meetingCountBadge');
    if (badge) badge.textContent = `${state.meetings.length} Toplantı`;

    renderMeetingGrid();
    renderMeetingList();
  }

  function getWeekDates() {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(state.currentMonday.getTime() + i * 86400000);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const dayNum = String(dt.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${dayNum}`;
      const dow = dt.getDay();
      dates.push({
        date: dt,
        dateStr,
        dow,
        dayNum: dt.getDate(),
        monthName: MONTH_NAMES_TR[dt.getMonth()],
        dayName: DAY_NAMES[dow]
      });
    }
    return dates;
  }

  function renderMeetingGrid() {
    const grid = document.getElementById('meetingGridView');
    if (!grid) return;

    const weekDates = getWeekDates();
    const titleEl = document.getElementById('calCurrentRangeTitle');
    if (titleEl && weekDates.length === 7) {
      const start = weekDates[0];
      const end = weekDates[6];
      titleEl.textContent = `${start.dayNum} ${start.monthName} - ${end.dayNum} ${end.monthName} ${end.date.getFullYear()}`;
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    const filteredDays =
      state.activeMeetingDay === 'all'
        ? weekDates
        : weekDates.filter((wd) => String(wd.dow) === String(state.activeMeetingDay));

    grid.innerHTML = filteredDays
      .map((wd) => {
        const isToday = wd.dateStr === todayStr;

        // Matching: explicit date match or recurring day-of-week match
        const dayMeetings = state.meetings.filter((m) => {
          if (m.meeting_date && m.meeting_date.trim()) {
            return m.meeting_date === wd.dateStr;
          }
          return Number(m.day_of_week) === wd.dow;
        });

        let itemsHtml = '';
        if (dayMeetings.length === 0) {
          itemsHtml = `<div class="meeting-list-empty">Planlanmış toplantı yok</div>`;
        } else {
          itemsHtml = dayMeetings
            .map((m) => {
              const colorClass = COLOR_BADGES[m.color] || 'color-blue';
              const isSpecific = Boolean(m.meeting_date && m.meeting_date.trim());
              return `
              <div class="meeting-item ${colorClass}">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span class="meeting-item-time" style="display:inline-flex;align-items:center;gap:3px;"><span class="material-symbols-outlined" style="font-size:13px;">schedule</span> ${esc(m.start_time)} - ${esc(m.end_time)}</span>
                  ${isSpecific ? `<span class="badge" style="font-size:10px;padding:1px 5px;background:#f1f5f9;color:#475569;">Özel Tarih</span>` : `<span class="badge" style="font-size:10px;padding:1px 5px;background:#f8fafc;color:#64748b;">Haftalık</span>`}
                </div>
                <div class="meeting-item-title">${esc(m.title)}</div>
                <div class="meeting-item-meta">
                  ${m.participants ? `<div style="display:flex;align-items:center;gap:3px;"><span class="material-symbols-outlined" style="font-size:13px;">group</span> <strong>${esc(m.participants)}</strong></div>` : ''}
                  ${m.room ? `<div style="display:flex;align-items:center;gap:3px;"><span class="material-symbols-outlined" style="font-size:13px;">meeting_room</span> ${esc(m.room)}</div>` : ''}
                  ${m.description ? `<div style="color:var(--muted);margin-top:2px;font-style:italic;">${esc(m.description)}</div>` : ''}
                </div>
                <div class="meeting-item-actions">
                  <button type="button" data-edit-meet="${m.id}" title="Düzenle">Düzenle</button>
                  <button type="button" class="del" data-del-meet="${m.id}" title="Sil">Sil</button>
                </div>
              </div>`;
            })
            .join('');
        }

        return `
        <div class="meeting-day-card ${isToday ? 'is-today' : ''}">
          <div class="meeting-day-header">
            <div class="meeting-day-title">
              <span style="font-size:18px;font-weight:800;color:${isToday ? 'var(--primary)' : 'var(--text)'};">${wd.dayNum}</span>
              <div>
                <div style="font-size:13.5px;font-weight:700;line-height:1.1;">${wd.dayName}</div>
                <div style="font-size:11px;color:var(--muted);">${wd.monthName}</div>
              </div>
              ${isToday ? `<span class="badge badge-in" style="font-size:10.5px;padding:2px 6px;margin-left:auto;">Bugün</span>` : ''}
            </div>
            <span class="meeting-day-badge">${dayMeetings.length} toplantı</span>
          </div>
          <div style="flex:1;">
            ${itemsHtml}
          </div>
          <button class="btn btn-sm" style="margin-top:10px;width:100%;font-size:12px;background:#f8fafc;" data-quick-add-date="${wd.dateStr}" data-quick-add-day="${wd.dow}">+ Toplantı Ekle</button>
        </div>`;
      })
      .join('');
  }

  function renderMeetingList() {
    const tb = document.getElementById('meetingTableBody');
    if (!tb) return;
    if (state.meetings.length === 0) {
      tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">Kayıtlı toplantı bulunamadı.</td></tr>`;
      return;
    }
    tb.innerHTML = state.meetings
      .map((m) => {
        const dayName = DAY_NAMES[m.day_of_week] || 'Bilinmiyor';
        const dateDisplay = m.meeting_date ? `<strong>${m.meeting_date}</strong> (${dayName})` : `Her ${dayName}`;
        return `
        <tr>
          <td>${dateDisplay}</td>
          <td><span class="meeting-item-time" style="display:inline-flex;align-items:center;gap:3px;"><span class="material-symbols-outlined" style="font-size:13px;">schedule</span> ${esc(m.start_time)} - ${esc(m.end_time)}</span></td>
          <td>
            <div style="font-weight:700;">${esc(m.title)}</div>
          </td>
          <td>${esc(m.participants || '-')}</td>
          <td>${esc(m.room || '-')}</td>
          <td style="color:var(--muted);font-size:12.5px;">${esc(m.description || '-')}</td>
          <td>
            <div style="display:flex;gap:4px;">
              <button class="btn btn-sm" data-edit-meet="${m.id}"><span class="material-symbols-outlined" style="font-size:15px;">edit</span></button>
              <button class="btn btn-sm" style="color:var(--red);" data-del-meet="${m.id}"><span class="material-symbols-outlined" style="font-size:15px;">delete</span></button>
            </div>
          </td>
        </tr>`;
      })
      .join('');
  }

  const meetingModal = document.getElementById('meetingModal');
  const meetingForm = document.getElementById('meetingForm');

  function openMeetingModal(meeting = null, defaultDow = 1, defaultDate = '') {
    document.getElementById('meetId').value = meeting ? meeting.id : '';
    document.getElementById('meetingModalTitle').textContent = meeting ? 'Toplantıyı Düzenle' : 'Yeni Toplantı Ekle';
    document.getElementById('meetTitle').value = meeting ? meeting.title : '';
    document.getElementById('meetDate').value = meeting ? meeting.meeting_date || '' : defaultDate;
    document.getElementById('meetDayOfWeek').value = meeting ? String(meeting.day_of_week) : String(defaultDow);
    document.getElementById('meetStartTime').value = meeting ? meeting.start_time : '10:00';
    document.getElementById('meetEndTime').value = meeting ? meeting.end_time : '11:00';
    document.getElementById('meetParticipants').value = meeting ? meeting.participants || '' : '';
    document.getElementById('meetRoom').value = meeting ? meeting.room || '' : '';
    document.getElementById('meetDescription').value = meeting ? meeting.description || '' : '';
    document.getElementById('meetColor').value = meeting ? meeting.color || 'blue' : 'blue';

    meetingModal.classList.remove('hidden');
  }

  document.getElementById('meetDate')?.addEventListener('change', (e) => {
    if (e.target.value) {
      const dt = new Date(e.target.value + 'T00:00:00');
      document.getElementById('meetDayOfWeek').value = String(dt.getDay());
    }
  });

  function closeMeetingModal() {
    meetingModal.classList.add('hidden');
  }

  document.getElementById('closeMeetingModalBtn')?.addEventListener('click', closeMeetingModal);
  document.getElementById('cancelMeetingBtn')?.addEventListener('click', closeMeetingModal);
  meetingModal?.addEventListener('click', (e) => {
    if (e.target === meetingModal) closeMeetingModal();
  });

  // Week Navigator buttons
  document.getElementById('calPrevWeekBtn')?.addEventListener('click', () => {
    state.currentMonday = new Date(state.currentMonday.getTime() - 7 * 86400000);
    renderMeetingGrid();
  });
  document.getElementById('calNextWeekBtn')?.addEventListener('click', () => {
    state.currentMonday = new Date(state.currentMonday.getTime() + 7 * 86400000);
    renderMeetingGrid();
  });
  document.getElementById('calTodayBtn')?.addEventListener('click', () => {
    state.currentMonday = getMondayOfWeek(new Date());
    renderMeetingGrid();
  });

  document.getElementById('openAddMeetingBtn')?.addEventListener('click', () => openMeetingModal());

  document.getElementById('seedMeetingsBtn')?.addEventListener('click', async () => {
    if (!confirm('Varsayılan örnek toplantı programı yüklensin mi?')) return;
    try {
      const r = await apiFetch('/api/admin/meetings/seed', { method: 'POST', role: 'admin' });
      toast(r.count > 0 ? `${r.count} örnek toplantı yüklendi.` : 'Toplantılar zaten mevcut.', 'ok');
      await loadMeetings();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  // Day filters
  document.getElementById('meetingDayFilters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day]');
    if (!btn) return;
    document.querySelectorAll('#meetingDayFilters .filter-chip').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    state.activeMeetingDay = btn.getAttribute('data-day');
    renderMeetingGrid();
  });

  // Grid / List toggles
  document.getElementById('viewGridBtn')?.addEventListener('click', () => {
    state.meetingView = 'grid';
    document.getElementById('viewGridBtn').classList.add('active');
    document.getElementById('viewListBtn').classList.remove('active');
    document.getElementById('meetingGridView').classList.remove('hidden');
    document.getElementById('meetingListView').classList.add('hidden');
  });
  document.getElementById('viewListBtn')?.addEventListener('click', () => {
    state.meetingView = 'list';
    document.getElementById('viewListBtn').classList.add('active');
    document.getElementById('viewGridBtn').classList.remove('active');
    document.getElementById('meetingListView').classList.remove('hidden');
    document.getElementById('meetingGridView').classList.add('hidden');
  });

  // Delegation for edit / delete / quick-add
  document.getElementById('tab-meetings')?.addEventListener('click', async (e) => {
    const quickBtn = e.target.closest('[data-quick-add-day]');
    if (quickBtn) {
      const dow = Number(quickBtn.getAttribute('data-quick-add-day'));
      const dt = quickBtn.getAttribute('data-quick-add-date') || '';
      openMeetingModal(null, dow, dt);
      return;
    }
    const editBtn = e.target.closest('[data-edit-meet]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-edit-meet'));
      const m = state.meetings.find((x) => x.id === id);
      if (m) openMeetingModal(m, m.day_of_week, m.meeting_date);
      return;
    }
    const delBtn = e.target.closest('[data-del-meet]');
    if (delBtn) {
      const id = Number(delBtn.getAttribute('data-del-meet'));
      if (!confirm('Bu toplantıyı silmek istediğinize emin misiniz?')) return;
      try {
        await apiFetch(`/api/admin/meetings/${id}`, { method: 'DELETE', role: 'admin' });
        toast('Toplantı silindi.', 'ok');
        await loadMeetings();
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }
  });

  // Form submit
  meetingForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('meetId').value;
    const payload = {
      title: document.getElementById('meetTitle').value.trim(),
      meetingDate: document.getElementById('meetDate').value.trim(),
      dayOfWeek: Number(document.getElementById('meetDayOfWeek').value),
      startTime: document.getElementById('meetStartTime').value,
      endTime: document.getElementById('meetEndTime').value,
      participants: document.getElementById('meetParticipants').value.trim(),
      room: document.getElementById('meetRoom').value.trim(),
      description: document.getElementById('meetDescription').value.trim(),
      color: document.getElementById('meetColor').value
    };

    try {
      if (id) {
        await apiFetch(`/api/admin/meetings/${id}`, {
          method: 'PUT',
          role: 'admin',
          body: payload
        });
        toast('Toplantı güncellendi.', 'ok');
      } else {
        await apiFetch('/api/admin/meetings', {
          method: 'POST',
          role: 'admin',
          body: payload
        });
        toast('Yeni toplantı eklendi.', 'ok');
      }
      closeMeetingModal();
      await loadMeetings();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  // --- EMPLOYEES TAB ---
  async function loadEmployees() {
    try {
      const d = await apiFetch('/api/admin/employees', { role: 'admin' });
      state.employees = d.employees;
      const baseUrl = state.overview?.publicBaseUrl || window.location.origin;

      const tb = document.getElementById('empTableBody');
      if (d.employees.length === 0) {
        tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">Henüz personel yok. Sağ üstten yeni personel ekleyin.</td></tr>`;
        return;
      }

      tb.innerHTML = d.employees
        .map((emp) => {
          const pairUrl = `${baseUrl}/p?pair=${emp.pair_code}`;
          const deviceCell = emp.device_bound
            ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="badge badge-in"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:text-bottom;">smartphone</span> Telefon Eşleşti</span>
                <button class="btn btn-sm" data-reset-dev="${emp.id}">Cihaz Sıfırla</button>
               </div>`
            : `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="badge badge-neutral" style="font-size:13px;letter-spacing:0.05em;">Kod: <strong>${esc(formatPairCode(emp.pair_code))}</strong></span>
                <button class="btn btn-sm" data-copy-pair="${esc(pairUrl)}"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:text-bottom;">content_copy</span> Link Kopyala</button>
               </div>`;

          return `
          <tr>
            <td><strong>${esc(emp.name)}</strong></td>
            <td>${esc(emp.title || '-')}</td>
            <td>${esc(emp.phone || '-')}</td>
            <td>${deviceCell}</td>
            <td>${emp.active ? '<span class="badge badge-in">Aktif</span>' : '<span class="badge badge-neutral">Pasif</span>'}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm" data-edit-emp="${emp.id}">Düzenle</button>
                <button class="btn btn-sm btn-danger" data-del-emp="${emp.id}">Sil</button>
              </div>
            </td>
          </tr>`;
        })
        .join('');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function openEmpModal(emp = null) {
    openModal(`
      <h3 style="margin:0 0 14px;font-size:17px;">${emp ? 'Personel Bilgilerini Düzenle' : 'Yeni Personel Ekle'}</h3>
      <form id="empModalForm" style="display:flex;flex-direction:column;gap:12px;">
        <div class="field">
          <label>Adı Soyadı</label>
          <input class="input" id="emName" value="${esc(emp ? emp.name : '')}" placeholder="Örn: Ahmet Yılmaz" required>
        </div>
        <div class="field">
          <label>Görevi / Bölümü</label>
          <input class="input" id="emTitle" value="${esc(emp ? emp.title : '')}" placeholder="Örn: Üretim Sorumlusu">
        </div>
        <div class="field">
          <label>Telefon Numarası</label>
          <input class="input" id="emPhone" value="${esc(emp ? emp.phone : '')}" placeholder="05XX XXX XX XX">
        </div>
        ${
          emp
            ? `<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;">
                <input type="checkbox" id="emActive" ${emp.active ? 'checked' : ''}> Aktif çalışan
               </label>`
            : ''
        }
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
          <button type="button" class="btn" data-close-modal>İptal</button>
          <button type="submit" class="btn btn-primary">Kaydet</button>
        </div>
      </form>
    `);

    document.getElementById('empModalForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const body = {
          id: emp?.id,
          name: document.getElementById('emName').value,
          title: document.getElementById('emTitle').value,
          phone: document.getElementById('emPhone').value,
          active: emp ? document.getElementById('emActive').checked : true
        };
        await apiFetch('/api/admin/employees', {
          method: emp ? 'PUT' : 'POST',
          role: 'admin',
          body
        });
        closeModal();
        toast(emp ? 'Personel güncellendi.' : 'Yeni personel eklendi.', 'ok');
        loadEmployees();
        loadOverview(true);
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  }

  document.getElementById('openAddEmpBtn').addEventListener('click', () => openEmpModal(null));

  document.getElementById('empTableBody').addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy-pair]');
    if (copyBtn) {
      const link = copyBtn.getAttribute('data-copy-pair');
      await navigator.clipboard.writeText(link).catch(() => {});
      toast('Tek tıkla eşleştirme linki kopyalandı! WhatsApp ile personele gönderebilirsiniz.', 'ok');
      return;
    }
    const resetBtn = e.target.closest('[data-reset-dev]');
    if (resetBtn) {
      const id = Number(resetBtn.getAttribute('data-reset-dev'));
      if (!confirm('Bu personelin telefon eşleştirmesi sıfırlanıp yeni 6 haneli kod üretilsin mi?')) return;
      await apiFetch('/api/admin/employees/reset-device', { method: 'POST', role: 'admin', body: { id } });
      toast('Cihaz kilidi sıfırlandı ve yeni eşleştirme kodu üretildi.', 'ok');
      loadEmployees();
      return;
    }
    const editBtn = e.target.closest('[data-edit-emp]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-edit-emp'));
      const emp = state.employees.find((x) => x.id === id);
      if (emp) openEmpModal(emp);
      return;
    }
    const delBtn = e.target.closest('[data-del-emp]');
    if (delBtn) {
      const id = Number(delBtn.getAttribute('data-del-emp'));
      if (!confirm('Bu personel ve tüm giriş-çıkış geçmişi kalıcı olarak silinsin mi?')) return;
      await apiFetch(`/api/admin/employees?id=${id}`, { method: 'DELETE', role: 'admin' });
      toast('Personel silindi.', 'ok');
      loadEmployees();
      loadOverview(true);
    }
  });

  // --- QR CENTER ---
  async function renderQrCenter() {
    if (!state.overview) await loadOverview(true);
    const dEmp = await apiFetch('/api/admin/employees', { role: 'admin' });
    state.employees = dEmp.employees;

    const baseUrl = state.overview?.publicBaseUrl || window.location.origin;
    const siteKey = state.overview?.siteKey || '';
    const doorUrl = `${baseUrl}/p?k=${encodeURIComponent(siteKey)}`;

    document.getElementById('posterCompanyName').textContent = (
      state.overview?.config?.companyName || 'İŞ YERİ'
    ).toUpperCase();
    document.getElementById('doorPosterSvgWrap').innerHTML = makeQrSvg(doorUrl, 6, 2);
    document.getElementById('doorPosterUrlText').textContent = doorUrl;

    const grid = document.getElementById('empQrCardsGrid');
    const activeEmps = state.employees.filter((e) => e.active);
    grid.innerHTML = activeEmps
      .map((emp) => {
        const payload = `PDKS:${emp.code}`;
        return `
        <div class="qr-badge-card">
          <img src="/allstar-logo.png" alt="All Stars Music" style="width:120px;height:auto;display:block;margin:0 auto 4px;">
          ${makeQrSvg(payload, 4, 2)}
          <div style="font-weight:800;font-size:15px;">${esc(emp.name)}</div>
          <div style="font-size:12.5px;color:var(--muted);">${esc(emp.title || 'Personel')}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${esc(payload)}</div>
        </div>`;
      })
      .join('');
  }

  document.getElementById('printDoorPosterBtn').addEventListener('click', () => {
    document.body.classList.remove('print-mode-cards');
    document.body.classList.add('print-mode-poster');
    window.print();
  });

  document.getElementById('printEmpCardsBtn').addEventListener('click', () => {
    document.body.classList.remove('print-mode-poster');
    document.body.classList.add('print-mode-cards');
    window.print();
  });

  document.getElementById('rotateSiteKeyBtn').addEventListener('click', async () => {
    if (!confirm('Kapı QR kodu yenilensin mi? Duvara astığınız eski afiş geçersiz olacaktır.')) return;
    const r = await apiFetch('/api/admin/rotate-site-key', { method: 'POST', role: 'admin' });
    state.overview.siteKey = r.siteKey;
    renderQrCenter();
    toast('Yeni kapı QR afişi oluşturuldu.', 'ok');
  });

  // --- SETTINGS TAB ---
  async function loadSettingsTab() {
    if (!state.overview) await loadOverview(true);
    const c = state.overview.config;
    document.getElementById('setCompanyName').value = c.companyName || '';
    document.getElementById('setWorkStart').value = c.workStart || '09:00';
    document.getElementById('setWorkEnd').value = c.workEnd || '18:00';
    document.getElementById('setLateTol').value = c.lateToleranceMin ?? 10;
    document.getElementById('setEarlyTol').value = c.earlyToleranceMin ?? 10;
    document.getElementById('setCooldown').value = c.cooldownSec ?? 60;

    const wdSet = new Set((c.workDays || [1, 2, 3, 4, 5]).map(Number));
    document.querySelectorAll('#setWorkDaysBox input[type="checkbox"]').forEach((cb) => {
      cb.checked = wdSet.has(Number(cb.value));
    });

    document.getElementById('setGeoEnabled').checked = Boolean(c.geoEnabled);
    document.getElementById('setGeoLat').value = c.geoLat ?? '';
    document.getElementById('setGeoLng').value = c.geoLng ?? '';
    document.getElementById('setGeoRadius').value = c.geoRadiusMeters ?? 150;

    // Sessions
    const sr = await apiFetch('/api/admin/sessions', { role: 'admin' });
    const sb = document.getElementById('sessionsListBox');
    sb.innerHTML = sr.sessions
      .map(
        (s) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface-2);border-radius:8px;gap:8px;">
        <div>
          <strong>${esc(s.role === 'admin' ? 'Yönetici' : s.role === 'kiosk' ? 'Kapı Kiosk' : s.employeeName || 'Telefon')}</strong>
          <div style="font-size:11.5px;color:var(--muted);">${esc(s.label)}</div>
        </div>
        <button class="btn btn-sm btn-danger" data-revoke-sess="${esc(s.id)}">İptal Et</button>
      </div>`
      )
      .join('');
  }

  document.getElementById('fillCurrentGeoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Tarayıcı konum desteklemiyor.', 'err');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('setGeoLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('setGeoLng').value = pos.coords.longitude.toFixed(6);
        document.getElementById('setGeoEnabled').checked = true;
        toast('Mevcut konumunuz iş yeri koordinatı olarak dolduruldu.', 'ok');
      },
      () => toast('Konum izni alınamadı.', 'err')
    );
  });

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const workDays = [];
    document.querySelectorAll('#setWorkDaysBox input[type="checkbox"]:checked').forEach((cb) => {
      workDays.push(Number(cb.value));
    });
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        role: 'admin',
        body: {
          companyName: document.getElementById('setCompanyName').value,
          workStart: document.getElementById('setWorkStart').value,
          workEnd: document.getElementById('setWorkEnd').value,
          lateToleranceMin: Number(document.getElementById('setLateTol').value),
          earlyToleranceMin: Number(document.getElementById('setEarlyTol').value),
          cooldownSec: Number(document.getElementById('setCooldown').value),
          workDays,
          geoEnabled: document.getElementById('setGeoEnabled').checked,
          geoLat: document.getElementById('setGeoLat').value,
          geoLng: document.getElementById('setGeoLng').value,
          geoRadiusMeters: Number(document.getElementById('setGeoRadius').value)
        }
      });
      toast('Ayarlar kaydedildi.', 'ok');
      await loadOverview(true);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.getElementById('changePassForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/change-password', {
        method: 'POST',
        role: 'admin',
        body: {
          currentPassword: document.getElementById('curPassInp').value,
          newPassword: document.getElementById('newPassInp').value
        }
      });
      document.getElementById('curPassInp').value = '';
      document.getElementById('newPassInp').value = '';
      toast('Yönetici şifreniz güncellendi.', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.getElementById('sessionsListBox')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-revoke-sess]');
    if (!btn) return;
    const id = btn.getAttribute('data-revoke-sess');
    await apiFetch(`/api/admin/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE', role: 'admin' });
    toast('Oturum sonlandırıldı.', 'ok');
    loadSettingsTab();
  });

  document.getElementById('mintClaimLinkBtn')?.addEventListener('click', async () => {
    try {
      const r = await apiFetch('/api/admin/neon-claim', { method: 'POST', role: 'admin' });
      const box = document.getElementById('claimResultBox');
      box.classList.remove('hidden');
      box.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;">Aktarım Bağlantınız Hazır (15 dk geçerli):</div>
        <a href="${esc(r.claimUrl)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="margin-bottom:8px;">Neon Hesabına Aktar ↗</a>
        <div style="font-size:12px;line-height:1.45;">
          <strong>Önemli:</strong> Aktarımı onayladığınızda güvenlik gereği eski veritabanı şifresi iptal edilir. Neon panelinden alacağınız yeni <code>DATABASE_URL</code> bağlantısını Vercel proje ayarlarınıza (Environment Variables) yapıştırıp yeniden yayınlayın.
        </div>`;
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  // --- GLOBAL ACTIONS ---
  document.getElementById('clearDemoBtn')?.addEventListener('click', async () => {
    if (!confirm('10 örnek personel ve örnek mesai verileri temizlensin mi? (Eklediğiniz gerçek personeller silinmez.)'))
      return;
    const r = await apiFetch('/api/admin/clear-demo', { method: 'POST', role: 'admin' });
    toast(`${r.deletedEmployees} örnek personel ve ${r.deletedPunches} örnek kayıt temizlendi.`, 'ok');
    loadOverview();
  });

  document.getElementById('goDbSettingsBtn')?.addEventListener('click', () => switchTab('settings'));
  document.getElementById('refreshNowBtn')?.addEventListener('click', () => switchTab(state.tab));

  document.getElementById('launchKioskBtn')?.addEventListener('click', async () => {
    try {
      const r = await apiFetch('/api/admin/kiosk-token', {
        method: 'POST',
        role: 'admin',
        body: { label: 'Yönetici Panelinden Başlatıldı' }
      });
      setToken('kiosk', r.token);
      window.location.href = '/kiosk';
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
    await apiFetch('/api/logout', { method: 'POST', role: 'admin' }).catch(() => {});
    setToken('admin', '');
    showLoginGate();
  });

  // --- AUTH GATE ---
  function showLoginGate(needSetup = false) {
    clearInterval(state.pollTimer);
    appView.classList.add('hidden');
    authView.classList.remove('hidden');
    document.getElementById('adminLoginForm').classList.toggle('hidden', needSetup);
    document.getElementById('adminSetupForm').classList.toggle('hidden', !needSetup);
    document.getElementById('loginTitle').textContent = needSetup ? 'İlk Sistem Kurulumu' : 'Yönetici Girişi';
    // Yönetici oturumu olmayan ama personel olarak eşleştirilmiş telefonları
    // tek dokunuşla kendi ekranına (/p) göndermek için yönlendirme kartını göster
    document.getElementById('adminEmpRedirectHint')?.classList.toggle('hidden', !getToken('emp') || Boolean(getToken('admin')));
  }

  function startApp() {
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    let initialTab = 'overview';
    try {
      const pending = localStorage.getItem('pdks_open_tab');
      if (pending && document.getElementById('tab-' + pending)) {
        initialTab = pending;
        localStorage.removeItem('pdks_open_tab');
      }
    } catch (e) {}
    switchTab(initialTab);
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (!document.hidden && state.tab === 'overview' && getToken('admin')) {
        loadOverview(true);
      }
    }, 10000);
  }

  document.getElementById('adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await apiFetch('/api/login', {
        method: 'POST',
        body: { password: document.getElementById('adminPassInput').value, role: 'admin' }
      });
      setToken('admin', r.token);
      document.getElementById('adminPassInput').value = '';
      startApp();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.getElementById('adminSetupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await apiFetch('/api/setup', {
        method: 'POST',
        body: {
          companyName: document.getElementById('setupCompanyInput').value,
          password: document.getElementById('setupPassInput').value,
          setupKey: document.getElementById('setupKeyInput')?.value || '',
          seedDemo: document.getElementById('setupSeedCheck').checked
        }
      });
      setToken('admin', r.token);
      toast('Kurulum tamamlandı!', 'ok');
      startApp();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  async function init() {
    window.__showAdminLoginGate = () => showLoginGate(false);
    const pub = await apiFetch('/api/public-info').catch(() => null);
    if (pub && !pub.setupDone) {
      if (pub.setupKeyRequired) {
        document.getElementById('setupKeyFieldWrap')?.classList.remove('hidden');
      }
      showLoginGate(true);
      return;
    }
    if (pub?.companyName) {
      document.getElementById('loginSub').textContent = pub.companyName;
    }
    const token = getToken('admin');
    if (!token) {
      showLoginGate(false);
      return;
    }
    try {
      await apiFetch('/api/admin/overview', { role: 'admin' });
      startApp();
    } catch {
      setToken('admin', '');
      showLoginGate(false);
    }
  }

  init();
})();
