const {
  query,
  ensureSchema,
  getConfig,
  updateConfig,
  getSiteKey,
  rotateSiteKey
} = require('../lib/db');
const {
  hashPassword,
  verifyPassword,
  makeToken,
  sha256,
  makeEmpCode,
  generateUniquePairCode,
  getZonedParts,
  shiftDateStr,
  zonedToUtc,
  getWorkDate,
  workDateBoundsUtc,
  formatDurationTr,
  haversineMeters,
  calcDayStats,
  recordPunch,
  buildReport,
  seedDemoData,
  seedSampleMeetings
} = require('../lib/logic');
const { buildWorkbook } = require('../lib/xlsx');
const crypto = require('crypto');

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0'
  });
  res.end(body);
}

async function parseBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      const s = req.body.toString('utf8');
      return s ? JSON.parse(s) : {};
    }
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (typeof req.body === 'object') return req.body;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 6 * 1024 * 1024) {
        reject(Object.assign(new Error('İstek boyutu çok büyük.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Geçersiz JSON verisi.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function parseReqUrl(req) {
  const u = new URL(req.url || '/', 'http://localhost');
  const rewritten = u.searchParams.get('__p');
  let route = rewritten ? '/' + rewritten.replace(/^\/+/, '') : u.pathname.replace(/^\/api\/?/, '/');
  if (route.length > 1) route = route.replace(/\/+$/, '');
  return { route, queryParams: u.searchParams };
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/+$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

async function isSetupDone() {
  await ensureSchema();
  const r = await query(`SELECT 1 FROM settings WHERE key = 'admin_auth'`);
  return r.rowCount > 0;
}

async function requireAuth(req, allowedRoles) {
  await ensureSchema();
  const hdr = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(hdr.trim());
  if (!m) {
    throw Object.assign(new Error('Oturum açmanız gerekiyor.'), { status: 401 });
  }
  const tokenHash = sha256(m[1].trim());
  const r = await query(
    `SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash]
  );
  const sess = r.rows[0];
  if (!sess || !allowedRoles.includes(sess.role)) {
    throw Object.assign(new Error('Oturum süresi dolmuş veya yetkisiz erişim.'), { status: 401 });
  }
  query(`UPDATE sessions SET last_seen = now() WHERE token_hash = $1`, [tokenHash]).catch(() => {});
  return sess;
}

function extractEmployeeQrCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('PDKS:')) return s.slice(5).trim();
  try {
    const u = new URL(s);
    const c = u.searchParams.get('code') || u.searchParams.get('c');
    if (c) return c.trim();
  } catch {}
  return s;
}

function extractSiteKey(siteKey, qr) {
  if (siteKey && String(siteKey).trim()) return String(siteKey).trim();
  const s = String(qr || '').trim();
  if (!s) return '';
  if (s.startsWith('DOOR:')) return s.slice(5).trim();
  try {
    const u = new URL(s);
    const k = u.searchParams.get('k');
    if (k) return k.trim();
  } catch {}
  const m = /[?&]k=([^&#\s]+)/.exec(s);
  if (m) return decodeURIComponent(m[1]);
  return s;
}

const SOURCE_LABELS = {
  kiosk: 'Kapı Kiosk',
  phone: 'Telefon QR',
  manual: 'Manuel (Yönetici)'
};

const STATUS_LABELS = {
  inside: 'Şu An İçeride',
  ok: 'Tamamlandı',
  late: 'Geç Giriş',
  early: 'Erken Çıkış',
  missing_out: 'Çıkış Eksik',
  absent: 'Off Day',
  off_day: 'Off Day'
};


// ---------------- ARŞİV / DEPO YARDIMCILARI ----------------
const ARCHIVE_CATEGORIES = [
  { key: 'puantaj', label: 'Puantaj & Mesai' },
  { key: 'rapor', label: 'Raporlar' },
  { key: 'evrak', label: 'Evraklar & Sözleşmeler' },
  { key: 'qr', label: 'QR & Baskı Materyalleri' },
  { key: 'yedek', label: 'Yedekler' },
  { key: 'diger', label: 'Diğer' }
];

function archiveCategoryLabel(key) {
  const found = ARCHIVE_CATEGORIES.find((c) => c.key === key);
  return found ? found.label : 'Diğer';
}

function safeFilename(name) {
  const base = String(name || 'dosya')
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'dosya').slice(-120);
}

function bytesToBuffer(data) {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {
    return Buffer.from(data.data);
  }
  if (typeof data === 'string') return Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64');
  return Buffer.alloc(0);
}

async function buildPeriodSnapshot(fromDate, toDate, config, label) {
  const tz = config.timezone || 'Europe/Istanbul';
  const dayStartHour = Number(config.dayStartHour ?? 4);
  const [startUtc] = workDateBoundsUtc(fromDate, tz, dayStartHour);
  const [, endUtc] = workDateBoundsUtc(toDate, tz, dayStartHour);

  const [empRes, punchRes] = await Promise.all([
    query(`SELECT * FROM employees ORDER BY active DESC, name ASC`),
    query(
      `SELECT p.*, e.name AS employee_name, e.title AS employee_title
       FROM punches p JOIN employees e ON e.id = p.employee_id
       WHERE p.ts >= $1 AND p.ts < $2
       ORDER BY p.ts ASC, p.id ASC`,
      [startUtc.toISOString(), endUtc.toISOString()]
    )
  ]);

  const report = buildReport({
    employees: empRes.rows,
    punches: punchRes.rows,
    config,
    fromDate,
    toDate,
    now: new Date()
  });

  return {
    title: label,
    period: fromDate.slice(0, 7),
    fromDate,
    toDate,
    rowCount: Number(report?.summary?.length || 0),
    payload: {
      fromDate,
      toDate,
      generatedAt: new Date().toISOString(),
      summary: report.summary,
      daily: report.daily,
      punchCount: punchRes.rows.length
    }
  };
}

async function saveSnapshot({ title, period, fromDate, toDate, rowCount, payload }) {
  const checksum = sha256(JSON.stringify(payload || {}));
  const existing = await query(`SELECT id FROM archive_snapshots WHERE period = $1`, [period]);
  if (existing.rowCount > 0) {
    await query(
      `UPDATE archive_snapshots SET title = $1, from_date = $2, to_date = $3, row_count = $4,
              payload = $5, checksum = $6, created_at = now() WHERE period = $7`,
      [title, fromDate, toDate, rowCount, JSON.stringify(payload), checksum, period]
    );
    return { id: existing.rows[0].id, updated: true };
  }
  const ins = await query(
    `INSERT INTO archive_snapshots(title, period, from_date, to_date, row_count, payload, checksum)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [title, period, fromDate, toDate, rowCount, JSON.stringify(payload), checksum]
  );
  return { id: ins.rows[0]?.id, updated: false };
}


// ---------------- ACİL ERİŞİM (kurtarma anahtarı) ----------------
// Vercel'de ADMIN_RECOVERY_KEY tanımlıysa, yönetici şifresi unutulduğunda
// panelden şifre sıfırlanabilir. Anahtar tanımlı değilse uç tamamen kapalıdır.
function recoveryKeyValid(provided) {
  const expected = process.env.ADMIN_RECOVERY_KEY || '';
  if (!expected || expected.length < 12) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const { route, queryParams } = parseReqUrl(req);

  try {
    if (route === '/health' && method === 'GET') {
      const setupDone = await isSetupDone();
      return sendJson(res, 200, { ok: true, setupDone, now: new Date().toISOString() });
    }

    if (route === '/public-info' && method === 'GET') {
      const setupDone = await isSetupDone();
      const config = await getConfig();
      return sendJson(res, 200, {
        ok: true,
        setupDone,
        companyName: config.companyName,
        timezone: config.timezone,
        workStart: config.workStart,
        workEnd: config.workEnd,
        setupKeyRequired: Boolean(process.env.SETUP_KEY),
        publicBaseUrl: getPublicBaseUrl(req),
        serverTime: new Date().toISOString()
      });
    }

    if (route === '/setup' && method === 'POST') {
      if (await isSetupDone()) {
        return sendJson(res, 403, { ok: false, error: 'Kurulum zaten tamamlanmış.' });
      }
      const body = await parseBody(req);
      const expectedSetupKey = process.env.SETUP_KEY || '';
      if (expectedSetupKey) {
        const providedKey = String(body.setupKey || req.headers['x-setup-key'] || '');
        const a = Buffer.from(providedKey);
        const b = Buffer.from(expectedSetupKey);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return sendJson(res, 403, { ok: false, error: 'Geçersiz kurulum anahtarı (SETUP_KEY).' });
        }
      }
      const password = String(body.password || '');
      if (password.length < 6) {
        return sendJson(res, 400, { ok: false, error: 'Şifre en az 6 karakter olmalıdır.' });
      }
      const pwHash = hashPassword(password);
      await query(
        `INSERT INTO settings(key, value, updated_at) VALUES ('admin_auth', $1::jsonb, now())`,
        [JSON.stringify({ hash: pwHash, updatedAt: new Date().toISOString() })]
      );
      if (body.companyName && String(body.companyName).trim()) {
        await updateConfig({ companyName: String(body.companyName).trim() });
      }
      let seededCount = 0;
      const empCheck = await query(`SELECT COUNT(*)::int AS c FROM employees`);
      if (body.seedDemo !== false && empCheck.rows[0].c === 0) {
        seededCount = await seedDemoData(new Date());
        await seedSampleMeetings();
      }
      const token = makeToken(24);
      await query(
        `INSERT INTO sessions(token_hash, role, label, expires_at)
         VALUES ($1, 'admin', 'İlk Kurulum', now() + interval '30 days')`,
        [sha256(token)]
      );
      return sendJson(res, 200, { ok: true, token, seededCount });
    }

    if (route === '/admin/recovery-status' && method === 'GET') {
      const enabled = Boolean((process.env.ADMIN_RECOVERY_KEY || '').length >= 12);
      return sendJson(res, 200, { ok: true, enabled });
    }

    if (route === '/admin/recovery-reset' && method === 'POST') {
      if (!(process.env.ADMIN_RECOVERY_KEY || '')) {
        return sendJson(res, 403, { ok: false, error: 'Kurtarma anahtarı tanımlı değil.' });
      }
      const body = await parseBody(req);
      if (!recoveryKeyValid(body.recoveryKey)) {
        return sendJson(res, 401, { ok: false, error: 'Kurtarma anahtarı hatalı.' });
      }
      const next = String(body.newPassword || '');
      if (next.length < 6) {
        return sendJson(res, 400, { ok: false, error: 'Yeni şifre en az 6 karakter olmalıdır.' });
      }
      await ensureSchema();
      const hash = hashPassword(next);
      const upd = await query(
        `UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'admin_auth'`,
        [JSON.stringify({ hash, updatedAt: new Date().toISOString() })]
      );
      if (!upd.rowCount) {
        await query(
          `INSERT INTO settings(key, value, updated_at) VALUES ('admin_auth', $1::jsonb, now())`,
          [JSON.stringify({ hash, updatedAt: new Date().toISOString() })]
        );
      }
      // Tüm yönetici oturumlarını kapat
      await query(`DELETE FROM sessions WHERE role = 'admin'`).catch(() => {});
      return sendJson(res, 200, { ok: true, message: 'Yönetici şifresi güncellendi, tüm oturumlar kapatıldı.' });
    }

    if (route === '/login' && method === 'POST') {
      if (!(await isSetupDone())) {
        return sendJson(res, 400, { ok: false, error: 'Sistem kurulumu henüz yapılmamış.', needSetup: true });
      }
      const ip = getClientIp(req);
      const thr = await query(`SELECT * FROM login_throttle WHERE ip = $1`, [ip]);
      if (thr.rowCount > 0) {
        const row = thr.rows[0];
        if (new Date(row.reset_at) > new Date() && row.fails >= 8) {
          return sendJson(res, 429, {
            ok: false,
            error: 'Çok fazla hatalı deneme. Lütfen birkaç dakika sonra tekrar deneyin.'
          });
        }
      }

      const body = await parseBody(req);
      const password = String(body.password || '');
      const role = body.role === 'kiosk' ? 'kiosk' : 'admin';
      const label = String(body.label || (role === 'kiosk' ? 'Kapı Kiosk Cihazı' : 'Yönetici Oturumu')).slice(0, 80);

      const authRes = await query(`SELECT value FROM settings WHERE key = 'admin_auth'`);
      const valid = verifyPassword(password, authRes.rows[0]?.value?.hash);
      if (!valid) {
        await query(
          `INSERT INTO login_throttle(ip, fails, reset_at)
           VALUES ($1, 1, now() + interval '10 minutes')
           ON CONFLICT (ip) DO UPDATE SET
             fails = CASE WHEN login_throttle.reset_at < now() THEN 1 ELSE login_throttle.fails + 1 END,
             reset_at = CASE WHEN login_throttle.reset_at < now() THEN now() + interval '10 minutes' ELSE login_throttle.reset_at END`,
          [ip]
        );
        return sendJson(res, 401, { ok: false, error: 'Yönetici şifresi hatalı.' });
      }

      await query(`DELETE FROM login_throttle WHERE ip = $1`, [ip]).catch(() => {});
      const token = makeToken(24);
      const intervalSql = role === 'kiosk' ? `'365 days'` : `'30 days'`;
      await query(
        `INSERT INTO sessions(token_hash, role, label, expires_at)
         VALUES ($1, $2, $3, now() + interval ${intervalSql})`,
        [sha256(token), role, label]
      );
      return sendJson(res, 200, { ok: true, token, role });
    }

    if (route === '/logout' && method === 'POST') {
      const hdr = req.headers.authorization || '';
      const m = /^Bearer\s+(.+)$/i.exec(hdr.trim());
      if (m) {
        await query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(m[1].trim())]).catch(() => {});
      }
      return sendJson(res, 200, { ok: true });
    }

    // --- KIOSK ---
    if (route === '/kiosk/status' && method === 'GET') {
      await requireAuth(req, ['kiosk', 'admin']);
      const config = await getConfig();
      return sendJson(res, 200, {
        ok: true,
        companyName: config.companyName,
        timezone: config.timezone,
        serverTime: new Date().toISOString()
      });
    }

    if (route === '/kiosk/punch' && method === 'POST') {
      await requireAuth(req, ['kiosk', 'admin']);
      const body = await parseBody(req);
      const code = extractEmployeeQrCode(body.qr || body.code);
      if (!code) {
        return sendJson(res, 400, { ok: false, error: 'Geçersiz QR kod.' });
      }
      const empRes = await query(`SELECT id FROM employees WHERE code = $1`, [code]);
      if (empRes.rowCount === 0) {
        return sendJson(res, 404, { ok: false, error: 'Bu QR koda ait personel bulunamadı.' });
      }
      const forcedType = body.forcedType === 'in' || body.forcedType === 'out' ? body.forcedType : null;
      const result = await recordPunch({
        employeeId: empRes.rows[0].id,
        forcedType,
        source: 'kiosk',
        note: ''
      });
      return sendJson(res, 200, result);
    }

    // --- EMPLOYEE PHONE ---
    if (route === '/phone/pair' && method === 'POST') {
      await ensureSchema();
      const ipKey = 'pair:' + getClientIp(req);
      const thr = await query(`SELECT * FROM login_throttle WHERE ip = $1`, [ipKey]);
      if (thr.rowCount > 0) {
        const row = thr.rows[0];
        if (new Date(row.reset_at) > new Date() && row.fails >= 6) {
          return sendJson(res, 429, {
            ok: false,
            error: 'Çok fazla hatalı eşleştirme denemesi. Lütfen 10 dakika sonra tekrar deneyin.'
          });
        }
      }
      const body = await parseBody(req);
      const rawCode = String(body.pairCode || '').replace(/[\s-]/g, '');
      if (!rawCode) {
        return sendJson(res, 400, { ok: false, error: 'Lütfen 6 haneli eşleştirme kodunu girin.' });
      }
      const empRes = await query(`SELECT * FROM employees WHERE pair_code = $1`, [rawCode]);
      const emp = empRes.rows[0];
      if (!emp || !emp.active) {
        await query(
          `INSERT INTO login_throttle(ip, fails, reset_at)
           VALUES ($1, 1, now() + interval '10 minutes')
           ON CONFLICT (ip) DO UPDATE SET
             fails = CASE WHEN login_throttle.reset_at < now() THEN 1 ELSE login_throttle.fails + 1 END,
             reset_at = CASE WHEN login_throttle.reset_at < now() THEN now() + interval '10 minutes' ELSE login_throttle.reset_at END`,
          [ipKey]
        );
        return sendJson(res, 404, {
          ok: false,
          error: 'Geçersiz veya kullanılmış eşleştirme kodu. Yöneticinizden güncel kodu isteyin.'
        });
      }
      await query(`DELETE FROM login_throttle WHERE ip = $1`, [ipKey]).catch(() => {});

      const activeSess = await query(
        `SELECT COUNT(*)::int AS c FROM sessions WHERE role = 'employee' AND employee_id = $1 AND expires_at > now()`,
        [emp.id]
      );
      if (emp.device_bound && activeSess.rows[0].c > 0) {
        return sendJson(res, 409, {
          ok: false,
          error: 'Bu personel zaten başka bir telefona tanımlı. Telefon değiştirdiyseniz yöneticinizden "Cihaz Sıfırla" yapmasını isteyin.'
        });
      }

      const token = makeToken(24);
      const label = String(body.deviceLabel || 'Personel Telefonu').slice(0, 80);
      const nextPairCode = await generateUniquePairCode();

      await query(
        `INSERT INTO sessions(token_hash, role, employee_id, label, expires_at)
         VALUES ($1, 'employee', $2, $3, now() + interval '365 days')`,
        [sha256(token), emp.id, label]
      );
      await query(`UPDATE employees SET device_bound = true, pair_code = $1 WHERE id = $2`, [
        nextPairCode,
        emp.id
      ]);

      let autoPunchResult = null;
      const providedKey = extractSiteKey(body.siteKey, '');
      const realSiteKey = await getSiteKey();
      const config = await getConfig();
      if (providedKey && providedKey === realSiteKey && !config.geoEnabled) {
        autoPunchResult = await recordPunch({
          employeeId: emp.id,
          source: 'phone',
          note: 'Telefon eşleştirme ile ilk okutma'
        });
      }

      return sendJson(res, 200, {
        ok: true,
        token,
        employee: { id: emp.id, name: emp.name, title: emp.title },
        autoPunchResult
      });
    }

    if (route === '/phone/me' && method === 'GET') {
      const sess = await requireAuth(req, ['employee']);
      const config = await getConfig();
      const tz = config.timezone || 'Europe/Istanbul';
      const dayStartHour = Number(config.dayStartHour ?? 4);
      const empRes = await query(`SELECT id, name, title, active FROM employees WHERE id = $1`, [
        sess.employee_id
      ]);
      const emp = empRes.rows[0];
      if (!emp || !emp.active) {
        return sendJson(res, 403, { ok: false, error: 'Personel kaydı aktif değil.' });
      }
      const now = new Date();
      const todayWd = getWorkDate(now, tz, dayStartHour);
      const [startUtc, endUtc] = workDateBoundsUtc(todayWd, tz, dayStartHour);
      const pRes = await query(
        `SELECT id, ts, type, source, note FROM punches WHERE employee_id = $1 AND ts >= $2 AND ts < $3 ORDER BY ts ASC, id ASC`,
        [emp.id, startUtc.toISOString(), endUtc.toISOString()]
      );
      const stats = calcDayStats(pRes.rows, config, todayWd, todayWd, now.getTime());
      const punchesFormatted = pRes.rows.map((p) => ({
        ...p,
        timeStr: getZonedParts(p.ts, tz).timeStr
      }));

      return sendJson(res, 200, {
        ok: true,
        companyName: config.companyName,
        geoEnabled: Boolean(config.geoEnabled),
        employee: emp,
        todayStats: {
          ...stats,
          workedText: formatDurationTr(stats.workedMinutes)
        },
        todayPunches: punchesFormatted
      });
    }

    if (route === '/phone/punch' && method === 'POST') {
      const sess = await requireAuth(req, ['employee']);
      const body = await parseBody(req);
      const config = await getConfig();
      const realSiteKey = await getSiteKey();
      let givenKey = extractSiteKey(body.siteKey, body.qr);

      // Check if user scanned door key OR their own employee code
      const isDoorValid = Boolean(
        realSiteKey && givenKey && (
          givenKey === realSiteKey ||
          decodeURIComponent(givenKey) === realSiteKey ||
          (givenKey.length >= realSiteKey.length && givenKey.includes(realSiteKey))
        )
      );

      // Güvenlik: Telefonla okutmada yalnızca iş yeri kapısındaki QR afişi (siteKey) geçerlidir.
      // Yaka kartları (PDKS:...) yalnızca iş yerindeki sabit Kiosk terminalinden okutulabilir.
      if (!isDoorValid) {
        return sendJson(res, 403, {
          ok: false,
          error: 'Geçersiz QR kodu! Telefonla giriş-çıkış için yalnızca iş yeri kapısındaki QR afişini okutabilirsiniz.'
        });
      }

      const meta = {};
      if (body.lat && body.lng) {
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          meta.lat = lat;
          meta.lng = lng;
          meta.mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
          if (config.geoEnabled && config.geoLat != null && config.geoLng != null) {
            const dist = Math.round(haversineMeters(lat, lng, Number(config.geoLat), Number(config.geoLng)));
            const maxR = Number(config.geoRadiusMeters || 150);
            if (dist > maxR) {
              return sendJson(res, 403, {
                ok: false,
                error: `İş yeri konum alanı dışındasınız (Mesafeniz: ${dist} m, İzin verilen: ${maxR} m).`
              });
            }
            meta.distanceMeters = dist;
          }
        }
      } else if (config.geoEnabled && config.geoLat != null && config.geoLng != null) {
        return sendJson(res, 400, {
          ok: false,
          error: 'İş yeri konum doğrulaması açık. Lütfen tarayıcıdan konum izni verin.'
        });
      }

      const forcedType = body.forcedType === 'in' || body.forcedType === 'out' ? body.forcedType : null;
      const result = await recordPunch({
        employeeId: sess.employee_id,
        forcedType,
        source: 'phone',
        meta
      });
      return sendJson(res, 200, result);
    }

    // --- MEETINGS (AUTHENTICATED EMPLOYEE / KIOSK / ADMIN) ---
    if (route === '/meetings' && method === 'GET') {
      await requireAuth(req, ['employee', 'kiosk', 'admin']);
      const day = queryParams.get('day');
      let sql = `SELECT * FROM meetings ORDER BY day_of_week ASC, start_time ASC`;
      let params = [];
      if (day !== null && day !== undefined && day !== '') {
        sql = `SELECT * FROM meetings WHERE day_of_week = $1 ORDER BY start_time ASC`;
        params = [Number(day)];
      }
      const r = await query(sql, params);
      return sendJson(res, 200, { ok: true, meetings: r.rows });
    }

    if (route === '/meetings' && method === 'POST') {
      await requireAuth(req, ['employee', 'admin']);
      const body = await parseBody(req);
      const title = String(body.title || '').trim();
      if (!title) {
        return sendJson(res, 400, { ok: false, error: 'Toplantı konusu / başlığı zorunludur.' });
      }
      const dayOfWeek = Number(body.dayOfWeek ?? 1);
      const meetingDate = String(body.meetingDate || '').trim();
      const startTime = String(body.startTime || '10:00').trim();
      const endTime = String(body.endTime || '11:00').trim();
      const participants = String(body.participants || '').trim();
      const room = String(body.room || '').trim();
      const description = String(body.description || '').trim();
      const color = String(body.color || 'blue').trim();

      const ins = await query(
        `INSERT INTO meetings(title, description, day_of_week, meeting_date, start_time, end_time, participants, room, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, description, dayOfWeek, meetingDate, startTime, endTime, participants, room, color]
      );
      return sendJson(res, 200, { ok: true, meeting: ins.rows[0] });
    }

    // --- ADMIN ROUTES ---
    await requireAuth(req, ['admin']);

    if (route === '/admin/meetings' && method === 'GET') {
      const r = await query(`SELECT * FROM meetings ORDER BY day_of_week ASC, start_time ASC`);
      return sendJson(res, 200, { ok: true, meetings: r.rows });
    }

    if (route === '/admin/meetings' && method === 'POST') {
      const body = await parseBody(req);
      const title = String(body.title || '').trim();
      if (!title) {
        return sendJson(res, 400, { ok: false, error: 'Toplantı konusu / başlığı zorunludur.' });
      }
      const dayOfWeek = Number(body.dayOfWeek ?? 1);
      const meetingDate = String(body.meetingDate || '').trim();
      const startTime = String(body.startTime || '10:00').trim();
      const endTime = String(body.endTime || '11:00').trim();
      const participants = String(body.participants || '').trim();
      const room = String(body.room || '').trim();
      const description = String(body.description || '').trim();
      const color = String(body.color || 'blue').trim();

      const ins = await query(
        `INSERT INTO meetings(title, description, day_of_week, meeting_date, start_time, end_time, participants, room, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, description, dayOfWeek, meetingDate, startTime, endTime, participants, room, color]
      );
      return sendJson(res, 200, { ok: true, meeting: ins.rows[0] });
    }

    if (route.startsWith('/admin/meetings/') && method === 'PUT') {
      const id = Number(route.split('/').pop());
      if (!id) return sendJson(res, 400, { ok: false, error: 'Geçersiz ID.' });
      const body = await parseBody(req);
      const title = String(body.title || '').trim();
      if (!title) {
        return sendJson(res, 400, { ok: false, error: 'Toplantı konusu / başlığı zorunludur.' });
      }
      const dayOfWeek = Number(body.dayOfWeek ?? 1);
      const meetingDate = String(body.meetingDate || '').trim();
      const startTime = String(body.startTime || '10:00').trim();
      const endTime = String(body.endTime || '11:00').trim();
      const participants = String(body.participants || '').trim();
      const room = String(body.room || '').trim();
      const description = String(body.description || '').trim();
      const color = String(body.color || 'blue').trim();

      const r = await query(
        `UPDATE meetings SET title = $1, description = $2, day_of_week = $3, meeting_date = $4, start_time = $5, end_time = $6, participants = $7, room = $8, color = $9 WHERE id = $10 RETURNING *`,
        [title, description, dayOfWeek, meetingDate, startTime, endTime, participants, room, color, id]
      );
      if (r.rowCount === 0) return sendJson(res, 404, { ok: false, error: 'Toplantı bulunamadı.' });
      return sendJson(res, 200, { ok: true, meeting: r.rows[0] });
    }

    if (route.startsWith('/admin/meetings/') && method === 'DELETE') {
      const id = Number(route.split('/').pop());
      if (!id) return sendJson(res, 400, { ok: false, error: 'Geçersiz ID.' });
      await query(`DELETE FROM meetings WHERE id = $1`, [id]);
      return sendJson(res, 200, { ok: true, deletedId: id });
    }

    if (route === '/admin/meetings/seed' && method === 'POST') {
      const count = await seedSampleMeetings();
      const r = await query(`SELECT * FROM meetings ORDER BY day_of_week ASC, start_time ASC`);
      return sendJson(res, 200, { ok: true, count, meetings: r.rows });
    }

    if (route === '/admin/overview' && method === 'GET') {
      const config = await getConfig();
      const siteKey = await getSiteKey();
      const tz = config.timezone || 'Europe/Istanbul';
      const dayStartHour = Number(config.dayStartHour ?? 4);
      const now = new Date();
      const todayWd = getWorkDate(now, tz, dayStartHour);
      const [startUtc, endUtc] = workDateBoundsUtc(todayWd, tz, dayStartHour);

      const [empRes, todayRes, recentRes, demoRes] = await Promise.all([
        query(`SELECT * FROM employees ORDER BY active DESC, name ASC`),
        query(
          `SELECT * FROM punches WHERE ts >= $1 AND ts < $2 ORDER BY ts ASC, id ASC`,
          [startUtc.toISOString(), endUtc.toISOString()]
        ),
        query(
          `SELECT p.*, e.name AS employee_name, e.title AS employee_title
           FROM punches p JOIN employees e ON e.id = p.employee_id
           ORDER BY p.ts DESC, p.id DESC LIMIT 35`
        ),
        query(
          `SELECT (EXISTS(SELECT 1 FROM employees WHERE is_demo = true) OR EXISTS(SELECT 1 FROM punches WHERE is_demo = true)) AS has_demo`
        )
      ]);

      const byEmp = new Map();
      for (const p of todayRes.rows) {
        if (!byEmp.has(p.employee_id)) byEmp.set(p.employee_id, []);
        byEmp.get(p.employee_id).push(p);
      }

      let totalActive = 0;
      let insideNow = 0;
      let arrivedToday = 0;
      let lateToday = 0;
      let notArrivedYet = 0;

      const staffStatus = [];
      for (const emp of empRes.rows) {
        if (!emp.active) continue;
        totalActive++;
        const list = byEmp.get(emp.id) || [];
        const st = calcDayStats(list, config, todayWd, todayWd, now.getTime());
        if (list.length > 0) arrivedToday++;
        else notArrivedYet++;
        if (st.insideNow) insideNow++;
        if (st.lateMinutes > 0) lateToday++;

        const lastPunch = list[list.length - 1];
        const lastMeta = lastPunch ? (typeof lastPunch.meta === 'string' ? JSON.parse(lastPunch.meta || '{}') : lastPunch.meta || {}) : {};

        staffStatus.push({
          id: emp.id,
          name: emp.name,
          title: emp.title,
          phone: emp.phone,
          code: emp.code,
          pairCode: emp.pair_code,
          deviceBound: emp.device_bound,
          isDemo: emp.is_demo,
          state: list.length === 0 ? 'not_arrived' : st.insideNow ? 'inside' : 'out',
          firstInTime: st.firstInTime,
          lastOutTime: st.lastOutTime,
          workedMinutes: st.workedMinutes,
          workedText: formatDurationTr(st.workedMinutes),
          lateMinutes: st.lateMinutes,
          punchCount: list.length,
          lat: lastMeta.lat || null,
          lng: lastMeta.lng || null,
          mapUrl: lastMeta.mapUrl || (lastMeta.lat && lastMeta.lng ? `https://www.google.com/maps?q=${lastMeta.lat},${lastMeta.lng}` : null)
        });
      }

      const recentPunches = recentRes.rows.map((r) => {
        const zp = getZonedParts(r.ts, tz);
        const meta = typeof r.meta === 'string' ? JSON.parse(r.meta || '{}') : r.meta || {};
        return {
          id: r.id,
          employeeId: r.employee_id,
          employeeName: r.employee_name,
          employeeTitle: r.employee_title,
          ts: r.ts,
          dateStr: zp.dateStr,
          timeStr: zp.timeStr,
          type: r.type,
          source: r.source,
          note: r.note,
          lat: meta.lat || null,
          lng: meta.lng || null,
          mapUrl: meta.mapUrl || (meta.lat && meta.lng ? `https://www.google.com/maps?q=${meta.lat},${meta.lng}` : null)
        };
      });

      return sendJson(res, 200, {
        ok: true,
        serverTime: now.toISOString(),
        todayWorkDate: todayWd,
        publicBaseUrl: getPublicBaseUrl(req),
        config,
        siteKey,
        hasDemo: Boolean(demoRes.rows[0]?.has_demo),
        dbNotice: {
          isClaimable: Boolean(process.env.NEON_PROJECT_ID && process.env.NEON_IDENTITY_ASSERTION),
          projectId: process.env.NEON_PROJECT_ID || null,
          expiresAt: process.env.NEON_EXPIRES_AT || null
        },
        counts: {
          totalActive,
          insideNow,
          arrivedToday,
          lateToday,
          notArrivedYet,
          todayPunches: todayRes.rowCount
        },
        staffStatus,
        recentPunches
      });
    }

    if (route === '/admin/employees' && method === 'GET') {
      const r = await query(`SELECT * FROM employees ORDER BY active DESC, name ASC`);
      return sendJson(res, 200, { ok: true, employees: r.rows });
    }

    if (route === '/admin/employees' && method === 'POST') {
      const body = await parseBody(req);
      const name = String(body.name || '').trim();
      const title = String(body.title || '').trim();
      const phone = String(body.phone || '').trim();
      if (!name) return sendJson(res, 400, { ok: false, error: 'Personel adı soyadı zorunludur.' });

      const code = makeEmpCode();
      const pairCode = await generateUniquePairCode();
      const r = await query(
        `INSERT INTO employees(name, title, phone, code, pair_code, active, is_demo)
         VALUES ($1, $2, $3, $4, $5, true, false) RETURNING *`,
        [name, title, phone, code, pairCode]
      );
      return sendJson(res, 200, { ok: true, employee: r.rows[0] });
    }

    if (route === '/admin/employees' && method === 'PUT') {
      const body = await parseBody(req);
      const id = Number(body.id);
      const name = String(body.name || '').trim();
      if (!id || !name) return sendJson(res, 400, { ok: false, error: 'Geçersiz personel bilgisi.' });

      const r = await query(
        `UPDATE employees SET name = $1, title = $2, phone = $3, active = $4, is_demo = false WHERE id = $5 RETURNING *`,
        [name, String(body.title || '').trim(), String(body.phone || '').trim(), body.active !== false, id]
      );
      if (r.rowCount === 0) return sendJson(res, 404, { ok: false, error: 'Personel bulunamadı.' });
      return sendJson(res, 200, { ok: true, employee: r.rows[0] });
    }

    if (route === '/admin/employees' && method === 'DELETE') {
      const id = Number(queryParams.get('id'));
      if (!id) return sendJson(res, 400, { ok: false, error: 'Personel ID gerekli.' });
      await query(`DELETE FROM employees WHERE id = $1`, [id]);
      return sendJson(res, 200, { ok: true });
    }

    if (route === '/admin/employees/regenerate-qr' && method === 'POST') {
      const body = await parseBody(req);
      const id = Number(body.id);
      const code = makeEmpCode();
      const r = await query(`UPDATE employees SET code = $1 WHERE id = $2 RETURNING *`, [code, id]);
      if (r.rowCount === 0) return sendJson(res, 404, { ok: false, error: 'Personel bulunamadı.' });
      return sendJson(res, 200, { ok: true, employee: r.rows[0] });
    }

    if (route === '/admin/employees/reset-device' && method === 'POST') {
      const body = await parseBody(req);
      const id = Number(body.id);
      const pairCode = await generateUniquePairCode();
      await query(`DELETE FROM sessions WHERE role = 'employee' AND employee_id = $1`, [id]);
      const r = await query(
        `UPDATE employees SET device_bound = false, pair_code = $1 WHERE id = $2 RETURNING *`,
        [pairCode, id]
      );
      if (r.rowCount === 0) return sendJson(res, 404, { ok: false, error: 'Personel bulunamadı.' });
      return sendJson(res, 200, { ok: true, employee: r.rows[0] });
    }

    if (route === '/admin/punches' && method === 'GET') {
      const config = await getConfig();
      const tz = config.timezone || 'Europe/Istanbul';
      const dayStartHour = Number(config.dayStartHour ?? 4);
      const todayWd = getWorkDate(new Date(), tz, dayStartHour);
      const fromDate = queryParams.get('from') || shiftDateStr(todayWd, -7);
      const toDate = queryParams.get('to') || todayWd;
      const empId = Number(queryParams.get('employeeId') || 0);
      const typeFilter = queryParams.get('type') || '';

      const [startUtc] = workDateBoundsUtc(fromDate, tz, dayStartHour);
      const [, endUtc] = workDateBoundsUtc(toDate, tz, dayStartHour);

      const params = [startUtc.toISOString(), endUtc.toISOString()];
      let where = `p.ts >= $1 AND p.ts < $2`;
      if (empId > 0) {
        params.push(empId);
        where += ` AND p.employee_id = $${params.length}`;
      }
      if (typeFilter === 'in' || typeFilter === 'out') {
        params.push(typeFilter);
        where += ` AND p.type = $${params.length}`;
      }

      const r = await query(
        `SELECT p.*, e.name AS employee_name, e.title AS employee_title
         FROM punches p JOIN employees e ON e.id = p.employee_id
         WHERE ${where}
         ORDER BY p.ts DESC, p.id DESC LIMIT 1000`,
        params
      );

      const rows = r.rows.map((row) => {
        const zp = getZonedParts(row.ts, tz);
        const meta = typeof row.meta === 'string' ? JSON.parse(row.meta || '{}') : row.meta || {};
        return {
          id: row.id,
          employeeId: row.employee_id,
          employeeName: row.employee_name,
          employeeTitle: row.employee_title,
          ts: row.ts,
          dateStr: zp.dateStr,
          timeStr: zp.timeStr,
          type: row.type,
          source: row.source,
          note: row.note,
          lat: meta.lat || null,
          lng: meta.lng || null,
          mapUrl: meta.mapUrl || (meta.lat && meta.lng ? `https://www.google.com/maps?q=${meta.lat},${meta.lng}` : null)
        };
      });

      return sendJson(res, 200, { ok: true, fromDate, toDate, punches: rows });
    }

    if (route === '/admin/punches' && method === 'POST') {
      const body = await parseBody(req);
      if (body.simulateEmployeeId) {
        const result = await recordPunch({
          employeeId: Number(body.simulateEmployeeId),
          forcedType: body.forcedType === 'in' || body.forcedType === 'out' ? body.forcedType : null,
          source: body.source || 'kiosk',
          note: body.note || 'Hızlı test okutması',
          meta: { bypassCooldown: true }
        });
        return sendJson(res, 200, result);
      }

      const config = await getConfig();
      const tz = config.timezone || 'Europe/Istanbul';
      const empId = Number(body.employeeId);
      const dateStr = String(body.dateStr || '');
      const timeStr = String(body.timeStr || '');
      const type = body.type === 'out' ? 'out' : 'in';
      const note = String(body.note || '').trim();

      if (!empId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) {
        return sendJson(res, 400, { ok: false, error: 'Personel, tarih ve saat bilgisi zorunludur.' });
      }
      const [hh, mm] = timeStr.split(':').map(Number);
      const ts = zonedToUtc(dateStr, hh, mm, tz);

      const ins = await query(
        `INSERT INTO punches(employee_id, ts, type, source, note, is_demo)
         VALUES ($1, $2, $3, 'manual', $4, false) RETURNING *`,
        [empId, ts.toISOString(), type, note]
      );
      return sendJson(res, 200, { ok: true, punch: ins.rows[0] });
    }

    if (route === '/admin/punches' && method === 'PUT') {
      const body = await parseBody(req);
      const config = await getConfig();
      const tz = config.timezone || 'Europe/Istanbul';
      const id = Number(body.id);
      const dateStr = String(body.dateStr || '');
      const timeStr = String(body.timeStr || '');
      const type = body.type === 'out' ? 'out' : 'in';
      const note = String(body.note || '').trim();

      if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) {
        return sendJson(res, 400, { ok: false, error: 'Geçersiz kayıt bilgisi.' });
      }
      const [hh, mm] = timeStr.split(':').map(Number);
      const ts = zonedToUtc(dateStr, hh, mm, tz);

      const r = await query(
        `UPDATE punches SET ts = $1, type = $2, note = $3, is_demo = false WHERE id = $4 RETURNING *`,
        [ts.toISOString(), type, note, id]
      );
      if (r.rowCount === 0) return sendJson(res, 404, { ok: false, error: 'Kayıt bulunamadı.' });
      return sendJson(res, 200, { ok: true, punch: r.rows[0] });
    }

    if (route === '/admin/punches' && method === 'DELETE') {
      const id = Number(queryParams.get('id'));
      if (!id) return sendJson(res, 400, { ok: false, error: 'Kayıt ID gerekli.' });
      await query(`DELETE FROM punches WHERE id = $1`, [id]);
      return sendJson(res, 200, { ok: true });
    }

    if ((route === '/admin/report' || route === '/admin/export.xlsx') && method === 'GET') {
      const config = await getConfig();
      const tz = config.timezone || 'Europe/Istanbul';
      const dayStartHour = Number(config.dayStartHour ?? 4);
      const now = new Date();
      const todayWd = getWorkDate(now, tz, dayStartHour);
      const fromDate = queryParams.get('from') || shiftDateStr(todayWd, -6);
      const toDate = queryParams.get('to') || todayWd;

      const [startUtc] = workDateBoundsUtc(fromDate, tz, dayStartHour);
      const [, endUtc] = workDateBoundsUtc(toDate, tz, dayStartHour);

      const [empRes, punchRes] = await Promise.all([
        query(`SELECT * FROM employees ORDER BY active DESC, name ASC`),
        query(
          `SELECT p.*, e.name AS employee_name, e.title AS employee_title
           FROM punches p JOIN employees e ON e.id = p.employee_id
           WHERE p.ts >= $1 AND p.ts < $2
           ORDER BY p.ts ASC, p.id ASC`,
          [startUtc.toISOString(), endUtc.toISOString()]
        )
      ]);

      const report = buildReport({
        employees: empRes.rows,
        punches: punchRes.rows,
        config,
        fromDate,
        toDate,
        now
      });

      if (route === '/admin/report') {
        return sendJson(res, 200, { ok: true, config, ...report });
      }

      const summaryRows = [
        [
          'Personel Adı Soyadı',
          'Görev / Bölüm',
          'Durum',
          'Geldiği Gün',
          'Toplam Mesai',
          'Toplam Saat (Ondalık)',
          'Geç Kalma (Adet)',
          'Toplam Geç Kalma (Dk)',
          'Erken Çıkış (Adet)',
          'Eksik Çıkış (Adet)',
          'Devamsızlık (Gün)'
        ],
        ...report.summary.map((s) => [
          s.name,
          s.title,
          s.active ? 'Aktif' : 'Pasif',
          s.daysPresent,
          s.totalText,
          Number((s.totalMinutes / 60).toFixed(2)),
          s.lateCount,
          s.lateMinutes,
          s.earlyCount,
          s.missingOutCount,
          s.absentCount
        ])
      ];

      const dailyRows = [
        [
          'Tarih',
          'Personel Adı Soyadı',
          'Görev / Bölüm',
          'İlk Giriş',
          'Son Çıkış',
          'Çalışma Süresi',
          'Geç Kalma (Dk)',
          'Erken Çıkış (Dk)',
          'Durum'
        ],
        ...report.daily.map((d) => [
          d.workDate,
          d.employeeName,
          d.employeeTitle,
          d.firstInTime || '-',
          d.lastOutTime || '-',
          d.workedText,
          d.lateMinutes,
          d.earlyMinutes,
          STATUS_LABELS[d.status] || d.status
        ])
      ];

      const rawRows = [
        ['Tarih', 'Saat', 'Personel Adı Soyadı', 'Görev', 'İşlem', 'Kaynak', 'Not'],
        ...[...punchRes.rows].reverse().map((p) => {
          const zp = getZonedParts(p.ts, tz);
          return [
            zp.dateStr,
            zp.timeStr,
            p.employee_name,
            p.employee_title,
            p.type === 'in' ? 'GİRİŞ' : 'ÇIKIŞ',
            SOURCE_LABELS[p.source] || p.source,
            p.note || ''
          ];
        })
      ];

      const xlsxBuf = buildWorkbook([
        { name: 'Mesai Ozeti', rows: summaryRows, widths: [24, 20, 10, 13, 16, 18, 16, 20, 16, 16, 16] },
        { name: 'Gunluk Puantaj', rows: dailyRows, widths: [14, 24, 20, 12, 12, 16, 15, 15, 18] },
        { name: 'Ham Giris Cikislar', rows: rawRows, widths: [14, 10, 24, 20, 12, 18, 28] }
      ]);

      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="mesai-raporu-${fromDate}_${toDate}.xlsx"`,
        'Cache-Control': 'no-store'
      });
      return res.end(xlsxBuf);
    }

    if (route === '/admin/settings' && method === 'PUT') {
      const body = await parseBody(req);
      const patch = {};
      if (typeof body.companyName === 'string' && body.companyName.trim()) {
        patch.companyName = body.companyName.trim().slice(0, 80);
      }
      if (/^\d{2}:\d{2}$/.test(body.workStart || '')) patch.workStart = body.workStart;
      if (/^\d{2}:\d{2}$/.test(body.workEnd || '')) patch.workEnd = body.workEnd;
      if (body.lateToleranceMin !== undefined) {
        patch.lateToleranceMin = Math.max(0, Math.min(180, Number(body.lateToleranceMin) || 0));
      }
      if (body.earlyToleranceMin !== undefined) {
        patch.earlyToleranceMin = Math.max(0, Math.min(180, Number(body.earlyToleranceMin) || 0));
      }
      if (body.dayStartHour !== undefined) {
        patch.dayStartHour = Math.max(0, Math.min(12, Number(body.dayStartHour) || 0));
      }
      if (body.cooldownSec !== undefined) {
        patch.cooldownSec = Math.max(5, Math.min(600, Number(body.cooldownSec) || 60));
      }
      if (Array.isArray(body.workDays)) {
        patch.workDays = body.workDays.map(Number).filter((n) => n >= 0 && n <= 6);
      }
      if (typeof body.geoEnabled === 'boolean') patch.geoEnabled = body.geoEnabled;
      if (body.geoLat !== undefined) patch.geoLat = body.geoLat === '' || body.geoLat === null ? null : Number(body.geoLat);
      if (body.geoLng !== undefined) patch.geoLng = body.geoLng === '' || body.geoLng === null ? null : Number(body.geoLng);
      if (body.geoRadiusMeters !== undefined) {
        patch.geoRadiusMeters = Math.max(25, Math.min(5000, Number(body.geoRadiusMeters) || 150));
      }

      const next = await updateConfig(patch);
      return sendJson(res, 200, { ok: true, config: next });
    }

    if (route === '/admin/rotate-site-key' && method === 'POST') {
      const siteKey = await rotateSiteKey();
      return sendJson(res, 200, { ok: true, siteKey });
    }

    if (route === '/admin/change-password' && method === 'POST') {
      const body = await parseBody(req);
      const cur = String(body.currentPassword || '');
      const next = String(body.newPassword || '');
      if (next.length < 6) {
        return sendJson(res, 400, { ok: false, error: 'Yeni şifre en az 6 karakter olmalıdır.' });
      }
      const authRes = await query(`SELECT value FROM settings WHERE key = 'admin_auth'`);
      if (!verifyPassword(cur, authRes.rows[0]?.value?.hash)) {
        return sendJson(res, 401, { ok: false, error: 'Mevcut şifre hatalı.' });
      }
      await query(
        `UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'admin_auth'`,
        [JSON.stringify({ hash: hashPassword(next), updatedAt: new Date().toISOString() })]
      );
      return sendJson(res, 200, { ok: true });
    }

    if (route === '/admin/kiosk-token' && method === 'POST') {
      const body = await parseBody(req);
      const token = makeToken(24);
      const label = String(body.label || 'Kiosk Ekranı (Panelden Yetkilendirildi)').slice(0, 80);
      await query(
        `INSERT INTO sessions(token_hash, role, label, expires_at)
         VALUES ($1, 'kiosk', $2, now() + interval '365 days')`,
        [sha256(token), label]
      );
      return sendJson(res, 200, { ok: true, token });
    }

    if (route === '/admin/sessions' && method === 'GET') {
      const r = await query(
        `SELECT s.token_hash, s.role, s.employee_id, s.label, s.created_at, s.last_seen, e.name AS employee_name
         FROM sessions s LEFT JOIN employees e ON e.id = s.employee_id
         WHERE s.expires_at > now()
         ORDER BY s.last_seen DESC`
      );
      const list = r.rows.map((s) => ({
        id: s.token_hash.slice(0, 16),
        role: s.role,
        label: s.label,
        employeeName: s.employee_name || null,
        createdAt: s.created_at,
        lastSeen: s.last_seen
      }));
      return sendJson(res, 200, { ok: true, sessions: list });
    }

    if (route === '/admin/sessions' && method === 'DELETE') {
      const prefix = String(queryParams.get('id') || '');
      if (!prefix || prefix.length < 8) {
        return sendJson(res, 400, { ok: false, error: 'Geçersiz oturum kimliği.' });
      }
      await query(`DELETE FROM sessions WHERE token_hash LIKE $1`, [`${prefix}%`]);
      return sendJson(res, 200, { ok: true });
    }

    if (route === '/admin/clear-demo' && method === 'POST') {
      const pDel = await query(`DELETE FROM punches WHERE is_demo = true`);
      const eDel = await query(`DELETE FROM employees WHERE is_demo = true`);
      return sendJson(res, 200, {
        ok: true,
        deletedEmployees: eDel.rowCount,
        deletedPunches: pDel.rowCount
      });
    }

    if (route === '/admin/seed-demo' && method === 'POST') {
      const count = await seedDemoData(new Date());
      return sendJson(res, 200, { ok: true, seededCount: count });
    }

    if (route === '/admin/neon-claim' && method === 'POST') {
      const assertion = process.env.NEON_IDENTITY_ASSERTION;
      const projectId = process.env.NEON_PROJECT_ID;
      if (!assertion || !projectId) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Bu veritabanı zaten kalıcı bir hesaba bağlı veya aktarım bilgisi tanımlı değil.'
        });
      }
      const tokRes = await fetch('https://claimable.neon.tech/v1/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
          resource: 'https://claimable.neon.tech/'
        }).toString()
      });
      const tokData = await tokRes.json();
      if (!tokRes.ok || !tokData.access_token) {
        return sendJson(res, 400, {
          ok: false,
          error: tokData?.error?.message || 'Aktarım anahtarı doğrulanamadı (veritabanı zaten aktarılmış olabilir).'
        });
      }
      const claimRes = await fetch(`https://claimable.neon.tech/v1/projects/${projectId}/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokData.access_token}` }
      });
      const claimData = await claimRes.json();
      if (!claimRes.ok) {
        return sendJson(res, 400, {
          ok: false,
          error: claimData?.error?.message || 'Aktarım bağlantısı oluşturulamadı.'
        });
      }
      return sendJson(res, 200, {
        ok: true,
        claimUrl: claimData.verification_uri_complete,
        userCode: claimData.user_code,
        expiresInSec: claimData.expires_in
      });
    }



    // ---------------- TAM YEDEK (taşınabilir JSON) ----------------
    if (route === '/admin/backup' && method === 'GET') {
      await requireAuth(req, ['admin']);
      const [empRes, punchRes, meetRes, setRes] = await Promise.all([
        query(`SELECT * FROM employees ORDER BY id ASC`),
        query(`SELECT * FROM punches ORDER BY id ASC`),
        query(`SELECT * FROM meetings ORDER BY id ASC`),
        query(`SELECT key, value FROM settings`)
      ]);
      const payload = {
        format: 'allstars-pdks-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        tables: {
          employees: empRes.rows,
          punches: punchRes.rows,
          meetings: meetRes.rows,
          settings: setRes.rows
        }
      };
      const body = JSON.stringify(payload, null, 2);
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="pdks-yedek-${stamp}.json"`,
        'Content-Length': String(Buffer.byteLength(body)),
        'Cache-Control': 'no-store'
      });
      return res.end(body);
    }

    if (route === '/admin/restore' && method === 'POST') {
      await requireAuth(req, ['admin']);
      let data;
      try {
        data = await parseBody(req);
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'Yedek dosyası okunamadı (geçerli JSON gerekli).' });
      }
      const backup = data && data.backup ? data.backup : data;
      if (!backup || backup.format !== 'allstars-pdks-backup' || !backup.tables) {
        return sendJson(res, 400, { ok: false, error: 'Bu dosya geçerli bir PDKS yedeği değil.' });
      }
      if (data.confirm !== 'GERI YUKLE' && backup.confirm !== 'GERI YUKLE') {
        return sendJson(res, 400, { ok: false, error: 'Onay gerekli: "confirm": "GERI YUKLE" alanı eksik.' });
      }
      const t = backup.tables;
      const emps = Array.isArray(t.employees) ? t.employees : [];
      const punches = Array.isArray(t.punches) ? t.punches : [];
      const meetings = Array.isArray(t.meetings) ? t.meetings : [];
      const settings = Array.isArray(t.settings) ? t.settings : [];

      // Mevcut veri temizlenir ve yedek yazılır.
      await query(`DELETE FROM punches`);
      await query(`DELETE FROM meetings`);
      await query(`DELETE FROM employees`);

      let empCount = 0;
      for (const e of emps) {
        await query(
          `INSERT INTO employees(id, name, title, phone, code, pair_code, device_bound, active, is_demo, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            Number(e.id) || null,
            String(e.name || '').slice(0, 120),
            String(e.title || ''),
            String(e.phone || ''),
            String(e.code || ''),
            e.pair_code || null,
            Boolean(e.device_bound),
            e.active === undefined ? true : Boolean(e.active),
            Boolean(e.is_demo),
            e.created_at || new Date().toISOString()
          ]
        ).catch(() => {});
        empCount += 1;
      }

      let punchCount = 0;
      for (const p of punches) {
        await query(
          `INSERT INTO punches(id, employee_id, ts, type, source, note, is_demo, meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            Number(p.id) || null,
            Number(p.employee_id) || null,
            p.ts,
            p.type === 'out' ? 'out' : 'in',
            String(p.source || 'manual'),
            String(p.note || ''),
            Boolean(p.is_demo),
            JSON.stringify(p.meta || {})
          ]
        ).catch(() => {});
        punchCount += 1;
      }

      let meetCount = 0;
      for (const m of meetings) {
        await query(
          `INSERT INTO meetings(title, description, day_of_week, meeting_date, start_time, end_time, participants, room, color)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            String(m.title || ''), String(m.description || ''), Number(m.day_of_week) || 1,
            String(m.meeting_date || ''), String(m.start_time || '09:00'), String(m.end_time || '10:00'),
            String(m.participants || ''), String(m.room || ''), String(m.color || 'blue')
          ]
        ).catch(() => {});
        meetCount += 1;
      }

      for (const st of settings) {
        const key = String(st.key || '');
        if (key === 'admin_auth' || key === 'site_key' || key === 'config') continue; // güvenlik: mevcut ayarlar korunur
        const val = typeof st.value === 'string' ? st.value : JSON.stringify(st.value);
        await query(
          `INSERT INTO settings(key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, val]
        ).catch(() => {});
      }

      if (require('../lib/db').hasPostgresUrl()) {
        await query(`SELECT setval(pg_get_serial_sequence('employees', 'id'), COALESCE((SELECT MAX(id) FROM employees), 1), (SELECT COUNT(*) > 0 FROM employees))`).catch(() => {});
        await query(`SELECT setval(pg_get_serial_sequence('punches', 'id'), COALESCE((SELECT MAX(id) FROM punches), 1), (SELECT COUNT(*) > 0 FROM punches))`).catch(() => {});
        await query(`SELECT setval(pg_get_serial_sequence('meetings', 'id'), COALESCE((SELECT MAX(id) FROM meetings), 1), (SELECT COUNT(*) > 0 FROM meetings))`).catch(() => {});
      }

      return sendJson(res, 200, {
        ok: true,
        restored: { employees: empCount, punches: punchCount, meetings: meetCount },
        note: 'Yönetici şifresi ve site anahtarı korunmuştur. Personel eşleştirmeleri sıfırlanmış olabilir; gerekirse cihaz kilitlerini sıfırlayın.'
      });
    }

    // ---------------- ARŞİV / DEPO ----------------
    if (route === '/admin/archive/summary' && method === 'GET') {
      await requireAuth(req, ['admin']);

      // Otomatik dönem arşivi: geçen ayın arşivi yoksa kendiliğinden oluşturulur.
      try {
        const cfg = await getConfig();
        const todayWd = getWorkDate(new Date(), cfg.timezone || 'Europe/Istanbul', Number(cfg.dayStartHour ?? 4));
        const [ty, tm] = todayWd.split('-').map(Number);
        const prev = tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, '0')}`;
        const exists = await query(`SELECT id FROM archive_snapshots WHERE period = $1`, [prev]);
        if (!exists.rowCount) {
          const [py, pm] = prev.split('-').map(Number);
          const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
          const autoSnap = await buildPeriodSnapshot(
            `${prev}-01`,
            `${prev}-${String(lastDay).padStart(2, '0')}`,
            cfg,
            `Dönem Arşivi ${prev}`
          );
          await saveSnapshot(autoSnap);
        }
      } catch (e) {
        // Otomatik arşiv başarısız olsa da depo ekranı açılmaya devam eder.
      }

      const [fileRes, snapRes, sizeRes] = await Promise.all([
        query(`SELECT COUNT(*) AS cnt FROM archive_files`),
        query(`SELECT COUNT(*) AS cnt FROM archive_snapshots`),
        query(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM archive_files`)
      ]);
      const byCat = await query(
        `SELECT category, COUNT(*) AS cnt, COALESCE(SUM(size_bytes),0) AS bytes
         FROM archive_files GROUP BY category`
      );
      const count = (r) => Number(r.rows[0]?.cnt || r.rows[0]?.count || 0);
      return sendJson(res, 200, {
        ok: true,
        storage: require('../lib/db').hasPostgresUrl() ? 'PostgreSQL (kalıcı bulut)' : 'Yerel SQLite (yedek)',
        files: count(fileRes),
        snapshots: count(snapRes),
        bytes: Number(sizeRes.rows[0]?.total || 0),
        categories: ARCHIVE_CATEGORIES,
        byCategory: byCat.rows.map((r) => ({
          category: r.category,
          label: archiveCategoryLabel(r.category),
          count: Number(r.cnt || 0),
          bytes: Number(r.bytes || 0)
        }))
      });
    }

    if (route === '/admin/archive/files' && method === 'GET') {
      await requireAuth(req, ['admin']);
      const category = String(queryParams.get('category') || '').trim();
      const q = String(queryParams.get('q') || '').trim();
      const limit = Math.max(1, Math.min(300, Number(queryParams.get('limit') || 120)));

      const where = [];
      const params = [];
      if (category) {
        params.push(category);
        where.push(`category = $${params.length}`);
      }
      if (q) {
        params.push(`%${q.toLowerCase()}%`);
        where.push(`(LOWER(title) LIKE $${params.length} OR LOWER(tag) LIKE $${params.length} OR LOWER(period) LIKE $${params.length})`);
      }
      params.push(limit);
      const sql = `SELECT id, title, category, tag, period, note, filename, mime, size_bytes,
                          checksum, uploaded_by, created_at
                   FROM archive_files
                   ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY created_at DESC, id DESC
                   LIMIT $${params.length}`;
      const r = await query(sql, params);
      return sendJson(res, 200, {
        ok: true,
        files: r.rows.map((f) => ({ ...f, categoryLabel: archiveCategoryLabel(f.category) }))
      });
    }

    if (route === '/admin/archive/files' && method === 'POST') {
      await requireAuth(req, ['admin']);
      const body = await parseBody(req);
      const filename = safeFilename(body.filename || 'dosya');
      const buf = bytesToBuffer(body.data);
      if (!buf.length) {
        return sendJson(res, 400, { ok: false, error: 'Dosya içeriği boş.' });
      }
      if (buf.length > 4.4 * 1024 * 1024) {
        return sendJson(res, 413, {
          ok: false,
          error: 'Dosya boyutu en fazla 4 MB olabilir. Daha büyük dosyalar için dönem arşivi veya harici depolama kullanın.'
        });
      }
      const category = ARCHIVE_CATEGORIES.some((c) => c.key === body.category)
        ? body.category
        : 'diger';
      const title = String(body.title || filename).trim().slice(0, 160) || filename;
      const tag = String(body.tag || '').trim().slice(0, 60);
      const period = String(body.period || '').trim().slice(0, 20);
      const note = String(body.note || '').trim().slice(0, 500);
      const checksum = sha256(buf.toString('base64'));
      const mime = String(body.mime || 'application/octet-stream').slice(0, 120);

      let ins;
      if (require('../lib/db').hasPostgresUrl()) {
        ins = await query(
          `INSERT INTO archive_files(title, category, tag, period, note, filename, mime, size_bytes, data, checksum)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [title, category, tag, period, note, filename, mime, buf.length, buf, checksum]
        );
      } else {
        ins = await query(
          `INSERT INTO archive_files(title, category, tag, period, note, filename, mime, size_bytes, data, checksum)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [title, category, tag, period, note, filename, mime, buf.length, buf.toString('base64'), checksum]
        );
      }
      return sendJson(res, 200, {
        ok: true,
        id: ins.rows[0]?.id,
        file: { title, filename, category, size_bytes: buf.length, checksum }
      });
    }

    if (route.startsWith('/admin/archive/files/') && method === 'GET') {
      await requireAuth(req, ['admin']);
      const id = Number(route.split('/').pop());
      if (!id) return sendJson(res, 400, { ok: false, error: 'Geçersiz dosya.' });
      const r = await query(`SELECT * FROM archive_files WHERE id = $1`, [id]);
      const f = r.rows[0];
      if (!f) return sendJson(res, 404, { ok: false, error: 'Dosya bulunamadı.' });
      const buf = bytesToBuffer(f.data);
      res.writeHead(200, {
        'Content-Type': f.mime || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(f.filename)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store'
      });
      return res.end(buf);
    }

    if (route.startsWith('/admin/archive/files/') && method === 'DELETE') {
      await requireAuth(req, ['admin']);
      const id = Number(route.split('/').pop());
      if (!id) return sendJson(res, 400, { ok: false, error: 'Geçersiz dosya.' });
      const r = await query(`DELETE FROM archive_files WHERE id = $1`, [id]);
      if (!r.rowCount) return sendJson(res, 404, { ok: false, error: 'Dosya bulunamadı.' });
      return sendJson(res, 200, { ok: true });
    }

    if (route === '/admin/archive/snapshots' && method === 'GET') {
      await requireAuth(req, ['admin']);
      const r = await query(
        `SELECT id, title, period, from_date, to_date, row_count, checksum, is_demo, created_at
         FROM archive_snapshots ORDER BY period DESC`
      );
      return sendJson(res, 200, { ok: true, snapshots: r.rows });
    }

    if (route === '/admin/archive/snapshots' && method === 'POST') {
      await requireAuth(req, ['admin']);
      const body = await parseBody(req);
      const config = await getConfig();
      const tz = config.timezone || 'Europe/Istanbul';
      const todayWd = getWorkDate(new Date(), tz, Number(config.dayStartHour ?? 4));

      let period = String(body.period || '').trim();
      if (!/^\d{4}-\d{2}$/.test(period)) {
        period = todayWd.slice(0, 7);
      }
      const [yy, mm] = period.split('-').map(Number);
      const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const fromDate = `${period}-01`;
      const toDate = `${period}-${String(lastDay).padStart(2, '0')}`;
      const title = String(body.title || '').trim() || `Dönem Arşivi ${period}`;

      const snap = await buildPeriodSnapshot(fromDate, toDate, config, title);
      const saved = await saveSnapshot(snap);
      return sendJson(res, 200, { ok: true, ...saved, period: snap.period, rowCount: snap.rowCount });
    }

    if (route.startsWith('/admin/archive/snapshots/') && route.endsWith('/excel') && method === 'GET') {
      await requireAuth(req, ['admin']);
      const id = Number(route.split('/')[4]);
      const r = await query(`SELECT * FROM archive_snapshots WHERE id = $1`, [id]);
      const snap = r.rows[0];
      if (!snap) return sendJson(res, 404, { ok: false, error: 'Arşiv kaydı bulunamadı.' });
      const payload = typeof snap.payload === 'string' ? JSON.parse(snap.payload) : snap.payload;
      const summaryRows = [
        ['Dönem', 'Personel Adı Soyadı', 'Görev / Bölüm', 'Geldiği Gün', 'Toplam Mesai',
         'Toplam Saat (Ondalık)', 'Geç Kalma (Adet)', 'Erken Çıkış (Adet)', 'Devamsızlık (Gün)'],
        ...(payload.summary || []).map((s) => [
          snap.period, s.name, s.title, s.daysPresent, s.totalText,
          Number(((s.totalMinutes || 0) / 60).toFixed(2)),
          s.lateCount, s.earlyCount, s.absentCount
        ])
      ];
      const dailyRows = [
        ['Tarih', 'Personel', 'Görev', 'İlk Giriş', 'Son Çıkış', 'Çalışma Süresi', 'Durum'],
        ...(payload.daily || []).map((d) => [
          d.workDate, d.employeeName, d.employeeTitle,
          d.firstInTime || '-', d.lastOutTime || '-', d.workedText, STATUS_LABELS[d.status] || d.status
        ])
      ];
      const buf = buildWorkbook([
        { name: 'Donem Ozeti', rows: summaryRows, widths: [10, 24, 20, 13, 16, 18, 16, 16, 16] },
        { name: 'Gunluk Puantaj', rows: dailyRows, widths: [14, 24, 20, 12, 12, 16, 18] }
      ]);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="arsiv-${snap.period}.xlsx"`,
        'Cache-Control': 'no-store'
      });
      return res.end(buf);
    }

    if (route.startsWith('/admin/archive/snapshots/') && method === 'GET') {
      await requireAuth(req, ['admin']);
      const id = Number(route.split('/').pop());
      const r = await query(`SELECT * FROM archive_snapshots WHERE id = $1`, [id]);
      const snap = r.rows[0];
      if (!snap) return sendJson(res, 404, { ok: false, error: 'Arşiv kaydı bulunamadı.' });
      const payload = typeof snap.payload === 'string' ? JSON.parse(snap.payload) : snap.payload;
      return sendJson(res, 200, { ok: true, snapshot: { ...snap, payload } });
    }

    if (route === '/admin/archive/purge' && method === 'POST') {
      await requireAuth(req, ['admin']);
      const body = await parseBody(req);
      const cutoff = String(body.before || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
        return sendJson(res, 400, { ok: false, error: 'Geçerli bir tarih (YYYY-AA-GG) girin.' });
      }
      const [y, m, d] = cutoff.split('-').map(Number);
      const cutoffIso = new Date(Date.UTC(y, m - 1, d)).toISOString();
      const r = await query(`DELETE FROM punches WHERE ts < $1`, [cutoffIso]);
      return sendJson(res, 200, { ok: true, deleted: Number(r.rowCount || 0), cutoff });
    }

    return sendJson(res, 404, { ok: false, error: `API uç noktası bulunamadı: ${method} ${route}` });
  } catch (err) {
    const rawMsg = String(err && err.message ? err.message : '');
    const isDbIssue =
      err.code === 'NO_DB_URL' ||
      /unable to open database file|ECONNREFUSED|ENOTFOUND|getaddrinfo|password authentication failed|does not exist|connect ETIMEDOUT/i.test(rawMsg);

    if (!isDbIssue) {
      const status = err.status || 500;
      return sendJson(res, status, { ok: false, error: rawMsg || 'Sunucu hatası oluştu.' });
    }

    return sendJson(res, 503, {
      ok: false,
      code: 'DB_NOT_READY',
      error:
        'Veritabanı bağlantısı henüz tanımlı değil. Vercel projesinde DATABASE_URL ortam değişkenini ' +
        '(PostgreSQL bağlantı adresi) ekleyip yeniden dağıtın. Ayrıntı: /kurulum',
      detail: process.env.VERCEL ? undefined : rawMsg
    });
  }
};
