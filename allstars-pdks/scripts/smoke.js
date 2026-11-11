#!/usr/bin/env node
/**
 * All Stars PDKS — doğrulama (smoke test)
 *
 * Varsayılan olarak SALT-OKUNUR (read-only) çalışır; canlı veritabanına örnek kayıt veya arşiv yazmaz.
 * İlk kurulum, örnek okutma ve dönem arşivi oluşturma testlerini de çalıştırmak için --mutate bayrağı ekleyin.
 *
 * Kullanım:
 *   ADMIN_PASSWORD="..." node scripts/smoke.js https://allstars-pdks.vercel.app
 *   ADMIN_PASSWORD="..." node scripts/smoke.js http://localhost:3000 --mutate
 */
const args = process.argv.slice(2);
const MUTATE = args.includes('--mutate');
const positional = args.filter((a) => !a.startsWith('--'));
const BASE = (positional[0] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const PASSWORD = process.env.ADMIN_PASSWORD || positional[1] || '';
const SETUP_KEY = process.env.SETUP_KEY || '';

let pass = 0;
let fail = 0;

function ok(name, extra = '') {
  pass += 1;
  console.log(`  ✔ ${name}${extra ? ' — ' + extra : ''}`);
}
function bad(name, extra = '') {
  fail += 1;
  console.log(`  ✖ ${name}${extra ? ' — ' + extra : ''}`);
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

(async () => {
  console.log(`\nAll Stars PDKS doğrulama (${MUTATE ? 'yazma/test modu' : 'salt-okunur mod'}) → ${BASE}\n`);

  // 1) Sayfalar
  console.log('Sayfalar:');
  const pages = [
    ['/', 'Personel Girişi'],
    ['/admin', 'Yönetici'],
    ['/kiosk', 'Kiosk'],
    ['/p', 'Toplantı'],
    ['/marka', 'Kartvizit'],
    ['/marka/kartvizit.html', 'Kartvizit'],
    ['/marka/kapi-afisi.html', 'Kapı QR Afişi'],
    ['/marka/yaka-karti.html', 'Yaka Kartı'],
    ['/marka/marka-rehberi.html', 'Marka Rehberi']
  ];
  for (const [path, needle] of pages) {
    try {
      const { res, text } = await req(path);
      if (res.ok && text.includes(needle)) ok(`${path}`, `${res.status}, ${text.length} bayt`);
      else bad(`${path}`, `${res.status}, beklenen metin bulunamadı`);
    } catch (e) {
      bad(`${path}`, e.message);
    }
  }

  // 2) Sağlık & kurulum
  console.log('\nAPI:');
  let health;
  try {
    health = await req('/api/health');
    if (health.json?.ok) ok('/api/health', `setupDone=${health.json.setupDone}`);
    else bad('/api/health', health.text.slice(0, 120));
  } catch (e) {
    bad('/api/health', e.message);
  }

  let token = '';
  if (PASSWORD) {
    if (health?.json && health.json.setupDone === false) {
      if (MUTATE) {
        const setup = await req('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: PASSWORD, setupKey: SETUP_KEY, companyName: 'All Stars Music' })
        });
        if (setup.json?.ok) ok('İlk kurulum yapıldı', `örnek personel: ${setup.json.seededCount ?? 0}`);
        else bad('İlk kurulum', setup.text.slice(0, 160));
      } else {
        console.log('  • Sistem henüz kurulmamış (salt-okunur modda kurulum atlandı; kurmak için --mutate ekleyin).');
      }
    } else {
      ok('Sistem kurulu');
    }

    if (health?.json?.setupDone || MUTATE) {
      const login = await req('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD, role: 'admin' })
      });
      if (login.json?.ok && login.json.token) {
        token = login.json.token;
        ok('Yönetici girişi');
      } else {
        bad('Yönetici girişi', login.text.slice(0, 160));
      }
    }
  } else {
    console.log('  • ADMIN_PASSWORD verilmedi; yönetici uçları atlanıyor.');
  }

  if (token) {
    const auth = { Authorization: 'Bearer ' + token };

    const checks = [
      ['/api/admin/overview', 'Canlı durum'],
      ['/api/admin/employees', 'Personel listesi'],
      ['/api/admin/punches?from=2026-01-01&to=2030-01-01', 'Giriş-çıkış kayıtları'],
      ['/api/admin/report', 'Puantaj raporu'],
      ['/api/admin/archive/summary', 'Arşiv özeti'],
      ['/api/admin/archive/snapshots', 'Dönem arşivleri'],
      ['/api/admin/archive/files', 'Depo dosyaları'],
      ['/api/meetings', 'Toplantı takvimi (yetkili)']
    ];
    for (const [path, label] of checks) {
      try {
        const r = await req(path, { headers: auth });
        if (r.res.ok && r.json?.ok !== false) ok(label, path);
        else bad(label, `${r.res.status} ${r.text.slice(0, 120)}`);
      } catch (e) {
        bad(label, e.message);
      }
    }

    // Excel
    try {
      const r = await fetch(BASE + '/api/admin/export.xlsx', { headers: auth });
      const buf = await r.arrayBuffer();
      if (r.ok && buf.byteLength > 2000) ok('Excel raporu', `${buf.byteLength} bayt`);
      else bad('Excel raporu', `${r.status}, ${buf.byteLength} bayt`);
    } catch (e) {
      bad('Excel raporu', e.message);
    }

    // Yedek
    try {
      const r = await fetch(BASE + '/api/admin/backup', { headers: auth });
      const text = await r.text();
      const parsed = JSON.parse(text);
      ok('Tam yedek', `${parsed.tables?.punches?.length ?? 0} kayıt, ${parsed.tables?.employees?.length ?? 0} personel`);
    } catch (e) {
      bad('Tam yedek', e.message);
    }

    if (MUTATE) {
      // Kiosk okutma
      try {
        const kt = await req('/api/admin/kiosk-token', { method: 'POST', headers: auth });
        const emp = await req('/api/admin/employees', { headers: auth });
        const first = emp.json?.employees?.[0];
        if (kt.json?.token && first?.code) {
          const punch = await req('/api/kiosk/punch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + kt.json.token },
            body: JSON.stringify({ qr: first.code })
          });
          if (punch.json?.ok) ok('Karekod okutma', `${first.name} · ${punch.json.punch?.type === 'in' ? 'giriş' : 'çıkış'}`);
          else bad('Karekod okutma', punch.text.slice(0, 160));
        } else {
          bad('Kiosk token / personel', 'veri alınamadı');
        }
      } catch (e) {
        bad('Karekod okutma', e.message);
      }

      // Arşiv dönemi
      try {
        const snap = await req('/api/admin/archive/snapshots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify({})
        });
        if (snap.json?.ok) ok('Dönem arşivi oluşturma', `dönem ${snap.json.period}, ${snap.json.rowCount} personel`);
        else bad('Dönem arşivi', snap.text.slice(0, 160));
      } catch (e) {
        bad('Dönem arşivi', e.message);
      }
    }

    await req('/api/logout', { method: 'POST', headers: auth }).catch(() => {});
  }

  console.log(`\nSonuç: ${pass} başarılı, ${fail} başarısız\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('Beklenmeyen hata:', e);
  process.exit(1);
});
