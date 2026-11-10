const crypto = require('crypto');
const { query, getConfig } = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hex] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function makeToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

function makeEmpCode() {
  return crypto.randomBytes(9).toString('base64url');
}

async function generateUniquePairCode() {
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(100000, 999999));
    const r = await query(`SELECT 1 FROM employees WHERE pair_code = $1`, [code]);
    if (r.rowCount === 0) return code;
  }
  return String(crypto.randomInt(100000, 999999));
}

function getZonedParts(date, tz = 'Europe/Istanbul') {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const map = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  const second = Number(map.second || 0);
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour,
    minute,
    second,
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${map.hour}:${map.minute}`,
    minutesOfDay: hour * 60 + minute
  };
}

function shiftDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function zonedToUtc(dateStr, hour = 0, minute = 0, tz = 'Europe/Istanbul') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const p1 = getZonedParts(new Date(guess), tz);
  const asUtc1 = Date.UTC(+p1.year, +p1.month - 1, +p1.day, p1.hour, p1.minute, p1.second);
  const first = guess - (asUtc1 - guess);
  const p2 = getZonedParts(new Date(first), tz);
  const asUtc2 = Date.UTC(+p2.year, +p2.month - 1, +p2.day, p2.hour, p2.minute, p2.second);
  return new Date(first - (asUtc2 - guess));
}

function getWorkDate(date, tz = 'Europe/Istanbul', dayStartHour = 4) {
  const p = getZonedParts(date, tz);
  if (p.hour < dayStartHour) return shiftDateStr(p.dateStr, -1);
  return p.dateStr;
}

function workDateBoundsUtc(workDateStr, tz = 'Europe/Istanbul', dayStartHour = 4) {
  const start = zonedToUtc(workDateStr, dayStartHour, 0, tz);
  const end = zonedToUtc(shiftDateStr(workDateStr, 1), dayStartHour, 0, tz);
  return [start, end];
}

function parseHm(hm, fallback = 540) {
  if (!hm || typeof hm !== 'string' || !hm.includes(':')) return fallback;
  const [h, m] = hm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  return h * 60 + m;
}

function formatDurationTr(mins) {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} dk`;
  if (rem === 0) return `${h} sa`;
  return `${h} sa ${rem} dk`;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function minutesInWorkday(ts, workDate, config) {
  const tz = config.timezone || 'Europe/Istanbul';
  const p = getZonedParts(ts, tz);
  let mins = p.minutesOfDay;
  if (p.dateStr !== workDate) mins += 1440;
  return mins;
}

function calcDayStats(punchesAsc, config, workDate, todayWorkDate, nowMs = Date.now()) {
  const tz = config.timezone || 'Europe/Istanbul';
  const workStartMin = parseHm(config.workStart, 540);
  const workEndMin = parseHm(config.workEnd, 1080);
  const lateTol = Number(config.lateToleranceMin ?? 10);
  const earlyTol = Number(config.earlyToleranceMin ?? 10);

  let firstIn = null;
  let lastOut = null;
  let closedMs = 0;
  let openInMs = null;
  let anomalies = 0;

  for (const p of punchesAsc) {
    const t = new Date(p.ts).getTime();
    if (p.type === 'in') {
      if (!firstIn) firstIn = p.ts;
      if (openInMs !== null) anomalies++;
      openInMs = t;
    } else {
      lastOut = p.ts;
      if (openInMs !== null && t >= openInMs) {
        closedMs += t - openInMs;
        openInMs = null;
      } else {
        anomalies++;
      }
    }
  }

  const insideNow = workDate === todayWorkDate && openInMs !== null;
  const missingOut = workDate < todayWorkDate && openInMs !== null;
  const liveExtraMs = insideNow && nowMs > openInMs ? nowMs - openInMs : 0;

  const closedMinutes = Math.round(closedMs / 60000);
  const liveMinutes = Math.round((closedMs + liveExtraMs) / 60000);

  let lateMinutes = 0;
  if (firstIn) {
    const inMin = minutesInWorkday(firstIn, workDate, config);
    if (inMin > workStartMin + lateTol) lateMinutes = inMin - workStartMin;
  }

  let earlyMinutes = 0;
  if (!insideNow && !missingOut && lastOut) {
    const outMin = minutesInWorkday(lastOut, workDate, config);
    if (outMin < workEndMin - earlyTol) earlyMinutes = workEndMin - outMin;
  }

  let status = 'ok';
  if (punchesAsc.length === 0) status = 'absent';
  else if (insideNow) status = 'inside';
  else if (missingOut) status = 'missing_out';
  else if (lateMinutes > 0) status = 'late';
  else if (earlyMinutes > 0) status = 'early';

  return {
    workDate,
    firstIn,
    firstInTime: firstIn ? getZonedParts(firstIn, tz).timeStr : null,
    lastOut,
    lastOutTime: lastOut ? getZonedParts(lastOut, tz).timeStr : null,
    workedMinutes: insideNow ? liveMinutes : closedMinutes,
    closedMinutes,
    liveMinutes,
    insideNow,
    missingOut,
    lateMinutes,
    earlyMinutes,
    anomalies,
    status,
    punchCount: punchesAsc.length
  };
}

async function recordPunch({ employeeId, forcedType = null, source = 'kiosk', note = '', meta = {}, now = new Date() }) {
  const config = await getConfig();
  const tz = config.timezone || 'Europe/Istanbul';
  const dayStartHour = Number(config.dayStartHour ?? 4);
  const cooldownSec = Number(config.cooldownSec ?? 60);

  const empRes = await query(`SELECT * FROM employees WHERE id = $1`, [employeeId]);
  const emp = empRes.rows[0];
  if (!emp) {
    const err = new Error('Personel bulunamadı.');
    err.status = 404;
    throw err;
  }
  if (!emp.active) {
    const err = new Error('Bu personel kaydı pasif durumda.');
    err.status = 403;
    throw err;
  }

  const todayWorkDate = getWorkDate(now, tz, dayStartHour);
  const [startUtc, endUtc] = workDateBoundsUtc(todayWorkDate, tz, dayStartHour);

  const dayRes = await query(
    `SELECT * FROM punches WHERE employee_id = $1 AND ts >= $2 AND ts < $3 ORDER BY ts ASC, id ASC`,
    [emp.id, startUtc.toISOString(), endUtc.toISOString()]
  );
  const todayPunches = dayRes.rows;
  const last = todayPunches[todayPunches.length - 1] || null;

  if (last && source !== 'manual' && !meta?.bypassCooldown) {
    const diffSec = (now.getTime() - new Date(last.ts).getTime()) / 1000;
    if (diffSec >= 0 && diffSec < cooldownSec) {
      const stats = calcDayStats(todayPunches, config, todayWorkDate, todayWorkDate, now.getTime());
      return {
        ok: true,
        duplicate: true,
        waitSeconds: Math.max(1, Math.ceil(cooldownSec - diffSec)),
        employee: { id: emp.id, name: emp.name, title: emp.title },
        lastPunch: {
          id: last.id,
          type: last.type,
          ts: last.ts,
          timeStr: getZonedParts(last.ts, tz).timeStr
        },
        dayStats: stats
      };
    }
  }

  let type = 'in';
  if (forcedType === 'in' || forcedType === 'out') {
    type = forcedType;
  } else if (last && last.type === 'in') {
    type = 'out';
  }

  const ins = await query(
    `INSERT INTO punches(employee_id, ts, type, source, note, is_demo, meta)
     VALUES ($1, $2, $3, $4, $5, false, $6::jsonb)
     RETURNING *`,
    [emp.id, now.toISOString(), type, source, note || '', JSON.stringify(meta || {})]
  );
  const created = ins.rows[0];
  const updatedList = [...todayPunches, created];
  const dayStats = calcDayStats(updatedList, config, todayWorkDate, todayWorkDate, now.getTime());

  return {
    ok: true,
    duplicate: false,
    punch: {
      ...created,
      timeStr: getZonedParts(created.ts, tz).timeStr,
      dateStr: getZonedParts(created.ts, tz).dateStr
    },
    employee: { id: emp.id, name: emp.name, title: emp.title },
    dayStats,
    durationText: formatDurationTr(dayStats.workedMinutes)
  };
}

function listDatesInclusive(fromDate, toDate) {
  const out = [];
  let cur = fromDate;
  let guard = 0;
  while (cur <= toDate && guard < 400) {
    out.push(cur);
    cur = shiftDateStr(cur, 1);
    guard++;
  }
  return out;
}

function buildReport({ employees, punches, config, fromDate, toDate, now = new Date() }) {
  const tz = config.timezone || 'Europe/Istanbul';
  const dayStartHour = Number(config.dayStartHour ?? 4);
  const todayWorkDate = getWorkDate(now, tz, dayStartHour);
  const nowMs = now.getTime();
  const workDaysSet = new Set((config.workDays || [1, 2, 3, 4, 5]).map(Number));
  const nowParts = getZonedParts(now, tz);
  const workEndMin = parseHm(config.workEnd, 1080);

  const grouped = new Map();
  const firstSeenDate = new Map();

  const sortedPunches = [...punches].sort((a, b) => new Date(a.ts) - new Date(b.ts) || a.id - b.id);
  for (const p of sortedPunches) {
    const wd = getWorkDate(p.ts, tz, dayStartHour);
    if (wd < fromDate || wd > toDate) continue;
    const key = `${p.employee_id}:${wd}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p);
    if (!firstSeenDate.has(p.employee_id) || wd < firstSeenDate.get(p.employee_id)) {
      firstSeenDate.set(p.employee_id, wd);
    }
  }

  const dates = listDatesInclusive(fromDate, toDate);
  const summary = [];
  const daily = [];

  for (const emp of employees) {
    const empCreatedWd = getWorkDate(emp.created_at || now, tz, dayStartHour);
    const activeSince =
      firstSeenDate.has(emp.id) && firstSeenDate.get(emp.id) < empCreatedWd
        ? firstSeenDate.get(emp.id)
        : empCreatedWd;

    let daysPresent = 0;
    let totalMinutes = 0;
    let lateCount = 0;
    let lateMinutesTotal = 0;
    let earlyCount = 0;
    let missingOutCount = 0;
    let absentCount = 0;
    let insideNow = false;
    let todayStats = null;

    for (const d of dates) {
      if (d > todayWorkDate) continue;
      const list = grouped.get(`${emp.id}:${d}`) || [];
      const st = calcDayStats(list, config, d, todayWorkDate, nowMs);
      if (d === todayWorkDate) todayStats = st;

      if (list.length > 0) {
        daysPresent++;
        totalMinutes += st.workedMinutes;
        if (st.lateMinutes > 0) {
          lateCount++;
          lateMinutesTotal += st.lateMinutes;
        }
        if (st.earlyMinutes > 0) earlyCount++;
        if (st.missingOut) missingOutCount++;
        if (st.insideNow) insideNow = true;

        daily.push({
          employeeId: emp.id,
          employeeName: emp.name,
          employeeTitle: emp.title,
          ...st,
          workedText: formatDurationTr(st.workedMinutes)
        });
      } else if (emp.active && d >= activeSince && workDaysSet.has(dayOfWeek(d))) {
        const countAsAbsent = d < todayWorkDate || (d === todayWorkDate && nowParts.minutesOfDay > workEndMin);
        if (countAsAbsent) {
          absentCount++;
          daily.push({
            employeeId: emp.id,
            employeeName: emp.name,
            employeeTitle: emp.title,
            ...st,
            status: 'off_day',
            firstInTime: '-',
            lastOutTime: '-',
            workedText: 'Off Day'
          });
        } else if (d === todayWorkDate) {
          daily.push({
            employeeId: emp.id,
            employeeName: emp.name,
            employeeTitle: emp.title,
            ...st,
            status: 'off_day',
            firstInTime: '-',
            lastOutTime: '-',
            workedText: 'Henüz Giriş Yok'
          });
        }
      } else if (emp.active && d >= activeSince && !workDaysSet.has(dayOfWeek(d))) {
        daily.push({
          employeeId: emp.id,
          employeeName: emp.name,
          employeeTitle: emp.title,
          ...st,
          status: 'off_day',
          firstInTime: '-',
          lastOutTime: '-',
          workedText: 'Off Day'
        });
      }
    }

    summary.push({
      employeeId: emp.id,
      name: emp.name,
      title: emp.title,
      active: emp.active,
      daysPresent,
      totalMinutes,
      totalText: formatDurationTr(totalMinutes),
      lateCount,
      lateMinutes: lateMinutesTotal,
      earlyCount,
      missingOutCount,
      absentCount,
      insideNow,
      todayFirstIn: todayStats?.firstInTime || null,
      todayLastOut: todayStats?.lastOutTime || null,
      todayWorkedText: todayStats ? formatDurationTr(todayStats.workedMinutes) : '0 dk'
    });
  }

  daily.sort((a, b) => (a.workDate === b.workDate ? a.employeeName.localeCompare(b.employeeName, 'tr') : b.workDate.localeCompare(a.workDate)));

  return { fromDate, toDate, todayWorkDate, summary, daily };
}

const DEMO_STAFF = [
  ['Ahmet Yılmaz', 'Üretim Sorumlusu', '0532 410 11 22'],
  ['Ayşe Kaya', 'Muhasebe Uzmanı', '0533 512 34 56'],
  ['Mehmet Demir', 'Depo Sorumlusu', '0542 618 77 88'],
  ['Zeynep Çelik', 'Satış Temsilcisi', '0535 724 90 12'],
  ['Mustafa Şahin', 'Teknik Servis', '0544 831 45 67'],
  ['Elif Yıldız', 'İdari İşler', '0536 942 23 10'],
  ['Emre Öztürk', 'Grafik Tasarım', '0505 315 68 91'],
  ['Fatma Aydın', 'Müşteri İlişkileri', '0538 227 54 39'],
  ['Burak Arslan', 'Sevkiyat Görevlisi', '0541 609 82 14'],
  ['Selin Koç', 'Ön Büro & Sekreterya', '0530 781 19 45']
];

async function seedDemoData(now = new Date()) {
  const config = await getConfig();
  const tz = config.timezone || 'Europe/Istanbul';
  const dayStartHour = Number(config.dayStartHour ?? 4);
  const todayWd = getWorkDate(now, tz, dayStartHour);
  const nowParts = getZonedParts(now, tz);

  const createdEmps = [];
  const baseCreated = zonedToUtc(shiftDateStr(todayWd, -10), 8, 30, tz);

  for (const [name, title, phone] of DEMO_STAFF) {
    const code = makeEmpCode();
    const pairCode = await generateUniquePairCode();
    const r = await query(
      `INSERT INTO employees(name, title, phone, code, pair_code, active, is_demo, created_at)
       VALUES ($1, $2, $3, $4, $5, true, true, $6) RETURNING *`,
      [name, title, phone, code, pairCode, baseCreated.toISOString()]
    );
    createdEmps.push(r.rows[0]);
  }

  const pastWorkdays = [];
  let cursor = shiftDateStr(todayWd, -1);
  while (pastWorkdays.length < 5) {
    const dow = dayOfWeek(cursor);
    if (dow >= 1 && dow <= 5) pastWorkdays.unshift(cursor);
    cursor = shiftDateStr(cursor, -1);
  }

  const punchRows = [];

  for (let dIdx = 0; dIdx < pastWorkdays.length; dIdx++) {
    const wd = pastWorkdays[dIdx];
    for (let eIdx = 0; eIdx < createdEmps.length; eIdx++) {
      const emp = createdEmps[eIdx];
      if (dIdx === 2 && eIdx === 8) continue;

      const inOffset = ((eIdx * 7 + dIdx * 5) % 26) - 10;
      const inTotalMin = 9 * 60 + inOffset;
      const inTs = zonedToUtc(wd, Math.floor(inTotalMin / 60), inTotalMin % 60, tz);
      const src = eIdx % 3 === 0 ? 'phone' : 'kiosk';
      punchRows.push([emp.id, inTs.toISOString(), 'in', src, '']);

      if (dIdx === pastWorkdays.length - 1 && eIdx === 6) continue;

      const outOffset = ((eIdx * 11 + dIdx * 3) % 30) - 8;
      const outTotalMin = 18 * 60 + outOffset;
      const outTs = zonedToUtc(wd, Math.floor(outTotalMin / 60), outTotalMin % 60, tz);
      punchRows.push([emp.id, outTs.toISOString(), 'out', src, '']);
    }
  }

  const curMin = nowParts.minutesOfDay >= dayStartHour * 60 ? nowParts.minutesOfDay : nowParts.minutesOfDay + 1440;
  const baseInBase = Math.min(9 * 60, Math.max(dayStartHour * 60 + 15, curMin - 90));

  const todayProfiles = [
    { idx: 0, inDelta: -8, outAfter: null, src: 'kiosk' },
    { idx: 1, inDelta: -4, outAfter: null, src: 'phone' },
    { idx: 2, inDelta: 2, outAfter: null, src: 'kiosk' },
    { idx: 3, inDelta: 19, outAfter: null, src: 'phone' },
    { idx: 4, inDelta: -6, outAfter: 185, src: 'kiosk' },
    { idx: 5, inDelta: 5, outAfter: null, src: 'kiosk' },
    { idx: 6, inDelta: 24, outAfter: null, src: 'phone' },
    { idx: 7, inDelta: -2, outAfter: null, src: 'kiosk' }
  ];

  for (const tp of todayProfiles) {
    const emp = createdEmps[tp.idx];
    const inM = Math.min(curMin - 5, baseInBase + tp.inDelta);
    if (inM <= dayStartHour * 60) continue;
    const inTs = zonedToUtc(todayWd, Math.floor(inM / 60) % 24, inM % 60, tz);
    if (inTs.getTime() > now.getTime() - 60000) continue;
    punchRows.push([emp.id, inTs.toISOString(), 'in', tp.src, '']);

    if (tp.outAfter && inM + tp.outAfter < curMin - 2) {
      const outM = inM + tp.outAfter;
      const outTs = zonedToUtc(todayWd, Math.floor(outM / 60) % 24, outM % 60, tz);
      if (outTs.getTime() < now.getTime() - 30000) {
        punchRows.push([emp.id, outTs.toISOString(), 'out', tp.src, 'Müşteri ziyareti']);
      }
    }
  }

  if (punchRows.length > 0) {
    const valuesSql = [];
    const params = [];
    punchRows.forEach((r, i) => {
      const b = i * 5;
      valuesSql.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, true)`);
      params.push(r[0], r[1], r[2], r[3], r[4]);
    });
    await query(
      `INSERT INTO punches(employee_id, ts, type, source, note, is_demo) VALUES ${valuesSql.join(',')}`,
      params
    );
  }

  return createdEmps.length;
}

const SAMPLE_MEETINGS = [
  {
    day_of_week: 1, // Pazartesi
    start_time: '10:00',
    end_time: '11:00',
    title: 'Haftalık Koordinasyon & Planlama',
    participants: 'Tüm Personel',
    room: 'Toplantı Odası A',
    description: 'Haftalık hedefler, iş dağılımı ve haftalık görev planlaması.',
    color: 'blue'
  },
  {
    day_of_week: 1, // Pazartesi
    start_time: '14:30',
    end_time: '15:30',
    title: 'İçerik & Sosyal Medya Toplantısı',
    participants: 'Pazarlama & Tasarım Ekibi',
    room: 'Ofis / Stüdyo 2',
    description: 'Haftalık içerik takvimi ve paylaşımlar.',
    color: 'purple'
  },
  {
    day_of_week: 2, // Salı
    start_time: '11:00',
    end_time: '12:30',
    title: 'Stüdyo Kayıt & Prodüksiyon Planlama',
    participants: 'Müzik & Ses Ekibi',
    room: 'Ana Stüdyo',
    description: 'Sanatçı kayıt saatleri ve stüdyo rezervasyonları.',
    color: 'emerald'
  },
  {
    day_of_week: 3, // Çarşamba
    start_time: '14:00',
    end_time: '15:00',
    title: 'Finans & Muhasebe Ara Değerlendirme',
    participants: 'Muhasebe & Yönetim',
    room: 'Toplantı Odası B',
    description: 'Aylık giderler, fatura ve hak ediş takibi.',
    color: 'amber'
  },
  {
    day_of_week: 4, // Perşembe
    start_time: '15:30',
    end_time: '16:30',
    title: 'Etkinlik & Sahne Organizasyonu',
    participants: 'Organizasyon Ekibi',
    room: 'Toplantı Odası A',
    description: 'Hafta sonu konser ve etkinlik detayları.',
    color: 'rose'
  },
  {
    day_of_week: 5, // Cuma
    start_time: '16:30',
    end_time: '17:30',
    title: 'Haftalık Kapanış & Retrospektif',
    participants: 'Tüm Personel',
    room: 'Lobi / Ortak Alan',
    description: 'Haftanın tamamlanan işleri ve önümüzdeki haftanın hazırlığı.',
    color: 'indigo'
  }
];

async function seedSampleMeetings() {
  const existing = await query(`SELECT COUNT(*)::int AS c FROM meetings`);
  if (Number(existing.rows[0]?.c || 0) > 0) return 0;
  for (const m of SAMPLE_MEETINGS) {
    await query(
      `INSERT INTO meetings(title, description, day_of_week, meeting_date, start_time, end_time, participants, room, color)
       VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8)`,
      [m.title, m.description, m.day_of_week, m.start_time, m.end_time, m.participants, m.room, m.color]
    );
  }
  return SAMPLE_MEETINGS.length;
}

module.exports = {
  hashPassword,
  verifyPassword,
  makeToken,
  sha256,
  makeEmpCode,
  generateUniquePairCode,
  getZonedParts,
  shiftDateStr,
  dayOfWeek,
  zonedToUtc,
  getWorkDate,
  workDateBoundsUtc,
  parseHm,
  formatDurationTr,
  haversineMeters,
  calcDayStats,
  recordPunch,
  buildReport,
  seedDemoData,
  SAMPLE_MEETINGS,
  seedSampleMeetings
};
