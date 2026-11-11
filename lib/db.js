const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let pool = null;
let sqliteDb = null;
let schemaPromise = null;

function hasPostgresUrl() {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

function normalizeConnString(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const mode = u.searchParams.get('sslmode');
    if (mode === 'require' || mode === 'prefer' || mode === 'verify-ca') {
      u.searchParams.set('sslmode', 'verify-full');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function getPool() {
  if (pool) return pool;
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!raw) {
    const err = new Error('DATABASE_URL tanımlı değil.');
    err.code = 'NO_DB_URL';
    throw err;
  }
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: normalizeConnString(raw),
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    keepAlive: true
  });
  pool.on('error', () => {});

  // Vercel Fluid compute: havuzu örnek yaşam döngüsüne bağla (Neon agent skill önerisi).
  // @vercel/functions yoksa sessizce atlanır (yerel çalışma etkilenmez).
  try {
    const { attachDatabasePool } = require('@vercel/functions');
    if (typeof attachDatabasePool === 'function') {
      attachDatabasePool(pool);
    }
  } catch {}

  return pool;
}

function getSqlite() {
  if (sqliteDb) return sqliteDb;
  const { DatabaseSync } = require('node:sqlite');
  const dbDir = path.resolve(__dirname, '..');
  const dbPath = path.join(dbDir, 'pdks.db');
  sqliteDb = new DatabaseSync(dbPath);
  try {
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
  } catch {}
  sqliteDb.function('now', () => new Date().toISOString());
  return sqliteDb;
}

async function querySqlite(text, params = []) {
  const db = getSqlite();
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  if (upper === 'BEGIN') {
    db.exec('BEGIN');
    return { rows: [], rowCount: 0 };
  }
  if (upper === 'COMMIT') {
    db.exec('COMMIT');
    return { rows: [], rowCount: 0 };
  }
  if (upper === 'ROLLBACK') {
    try { db.exec('ROLLBACK'); } catch {}
    return { rows: [], rowCount: 0 };
  }
  if (/^SELECT\s+pg_advisory_xact_lock/i.test(trimmed)) {
    return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
  }

  let cleanSql = text
    .replace(/::[a-zA-Z0-9_]+/g, '')
    .replace(/now\(\)\s*\+\s*interval\s*'([0-9]+)\s*days'/gi, "datetime('now', '+$1 days')")
    .replace(/now\(\)\s*\+\s*interval\s*'([0-9]+)\s*minutes'/gi, "datetime('now', '+$1 minutes')")
    .replace(/now\(\)\s*\+\s*interval\s*'365\s*days'/gi, "datetime('now', '+365 days')")
    .replace(/now\(\)\s*\+\s*interval\s*'30\s*days'/gi, "datetime('now', '+30 days')")
    .replace(/now\(\)\s*\+\s*interval\s*'10\s*minutes'/gi, "datetime('now', '+10 minutes')")
  const mappedParams = params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p && typeof p === 'object' && !(p instanceof Date)) return JSON.stringify(p);
    return p;
  });
  const cleanParams = [];
  cleanSql = cleanSql.replace(/\$([0-9]+)/g, (_, idx) => {
    cleanParams.push(mappedParams[Number(idx) - 1]);
    return '?';
  });

  const isSelect = /^SELECT\b/i.test(cleanSql);
  const hasReturning = /\bRETURNING\b/i.test(cleanSql);

  const stmt = db.prepare(cleanSql);
  if (isSelect || hasReturning) {
    const rawRows = stmt.all(...cleanParams);
    const rows = rawRows.map((r) => {
      const copy = { ...r };
      for (const k of Object.keys(copy)) {
        if (typeof copy[k] === 'string' && (copy[k].startsWith('{') || copy[k].startsWith('['))) {
          try {
            copy[k] = JSON.parse(copy[k]);
          } catch {}
        }
        if (k === 'active' || k === 'device_bound' || k === 'is_demo') {
          copy[k] = Boolean(copy[k]);
        }
      }
      return copy;
    });
    return { rows, rowCount: rows.length };
  } else {
    const info = stmt.run(...cleanParams);
    return { rows: [], rowCount: Number(info.changes) };
  }
}

async function query(text, params = []) {
  if (!hasPostgresUrl()) {
    return querySqlite(text, params);
  }

  const p = getPool();
  try {
    return await p.query(text, params);
  } catch (err) {
    const retryable =
      err &&
      (err.code === 'ECONNRESET' ||
        err.code === '57P01' ||
        err.code === '08006' ||
        err.code === '08003' ||
        /Connection terminated|ECONNRESET|timeout/i.test(String(err.message)));
    if (retryable) {
      return await p.query(text, params);
    }
    throw err;
  }
}

const DEFAULT_SETTINGS = {
  companyName: 'All Stars Music',
  timezone: 'Europe/Istanbul',
  workStart: '09:00',
  workEnd: '18:00',
  lateToleranceMin: 10,
  earlyToleranceMin: 10,
  dayStartHour: 4,
  cooldownSec: 60,
  workDays: [1, 2, 3, 4, 5],
  geoEnabled: false,
  geoLat: null,
  geoLng: null,
  geoRadiusMeters: 150
};

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    if (!hasPostgresUrl()) {
      const db = getSqlite();
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (now())
        );
        CREATE TABLE IF NOT EXISTS employees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          code TEXT NOT NULL UNIQUE,
          pair_code TEXT UNIQUE,
          device_bound INT NOT NULL DEFAULT 0,
          active INT NOT NULL DEFAULT 1,
          is_demo INT NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (now())
        );
        CREATE TABLE IF NOT EXISTS punches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          ts TEXT NOT NULL DEFAULT (now()),
          type TEXT NOT NULL CHECK (type IN ('in', 'out')),
          source TEXT NOT NULL DEFAULT 'kiosk',
          note TEXT NOT NULL DEFAULT '',
          is_demo INT NOT NULL DEFAULT 0,
          meta TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_punches_emp_ts ON punches(employee_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_punches_ts ON punches(ts DESC);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          role TEXT NOT NULL CHECK (role IN ('admin', 'kiosk', 'employee')),
          employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
          label TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (now()),
          last_seen TEXT NOT NULL DEFAULT (now()),
          expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_throttle (
          ip TEXT PRIMARY KEY,
          fails INT NOT NULL DEFAULT 0,
          reset_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meetings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          day_of_week INT NOT NULL DEFAULT 1,
          meeting_date TEXT NOT NULL DEFAULT '',
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          participants TEXT NOT NULL DEFAULT '',
          room TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT 'blue',
          created_at TEXT NOT NULL DEFAULT (now())
        );
        CREATE TABLE IF NOT EXISTS archive_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'diger',
          tag TEXT NOT NULL DEFAULT '',
          period TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          filename TEXT NOT NULL,
          mime TEXT NOT NULL DEFAULT 'application/octet-stream',
          size_bytes INT NOT NULL DEFAULT 0,
          data TEXT NOT NULL,
          checksum TEXT NOT NULL DEFAULT '',
          uploaded_by TEXT NOT NULL DEFAULT 'admin',
          is_demo INT NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (now())
        );
        CREATE INDEX IF NOT EXISTS idx_archive_cat ON archive_files(category, created_at DESC);
        CREATE TABLE IF NOT EXISTS archive_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          period TEXT NOT NULL,
          from_date TEXT NOT NULL,
          to_date TEXT NOT NULL,
          row_count INT NOT NULL DEFAULT 0,
          payload TEXT NOT NULL,
          checksum TEXT NOT NULL DEFAULT '',
          is_demo INT NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (now())
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_snap_period ON archive_snapshots(period);
      `);

      const cfgRes = await querySqlite(`SELECT value FROM settings WHERE key = 'config'`);
      if (cfgRes.rowCount === 0) {
        await querySqlite(`INSERT INTO settings(key, value) VALUES ('config', $1)`, [
          JSON.stringify(DEFAULT_SETTINGS)
        ]);
      }
      const siteRes = await querySqlite(`SELECT value FROM settings WHERE key = 'site_key'`);
      if (siteRes.rowCount === 0) {
        const sk = crypto.randomBytes(12).toString('base64url');
        await querySqlite(`INSERT INTO settings(key, value) VALUES ('site_key', $1)`, [
          JSON.stringify({ key: sk, rotatedAt: new Date().toISOString() })
        ]);
      }
      return;
    }

    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(74829105)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS employees (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          code TEXT NOT NULL UNIQUE,
          pair_code TEXT UNIQUE,
          device_bound BOOLEAN NOT NULL DEFAULT false,
          active BOOLEAN NOT NULL DEFAULT true,
          is_demo BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS punches (
          id SERIAL PRIMARY KEY,
          employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          ts TIMESTAMPTZ NOT NULL DEFAULT now(),
          type TEXT NOT NULL CHECK (type IN ('in', 'out')),
          source TEXT NOT NULL DEFAULT 'kiosk',
          note TEXT NOT NULL DEFAULT '',
          is_demo BOOLEAN NOT NULL DEFAULT false,
          meta JSONB NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE INDEX IF NOT EXISTS idx_punches_emp_ts ON punches(employee_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_punches_ts ON punches(ts DESC);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          role TEXT NOT NULL CHECK (role IN ('admin', 'kiosk', 'employee')),
          employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
          label TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_throttle (
          ip TEXT PRIMARY KEY,
          fails INT NOT NULL DEFAULT 0,
          reset_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meetings (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          day_of_week INT NOT NULL DEFAULT 1,
          meeting_date TEXT NOT NULL DEFAULT '',
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          participants TEXT NOT NULL DEFAULT '',
          room TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT 'blue',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS archive_files (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'diger',
          tag TEXT NOT NULL DEFAULT '',
          period TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          filename TEXT NOT NULL,
          mime TEXT NOT NULL DEFAULT 'application/octet-stream',
          size_bytes INT NOT NULL DEFAULT 0,
          data BYTEA NOT NULL,
          checksum TEXT NOT NULL DEFAULT '',
          uploaded_by TEXT NOT NULL DEFAULT 'admin',
          is_demo BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_archive_cat ON archive_files(category, created_at DESC);
        CREATE TABLE IF NOT EXISTS archive_snapshots (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          period TEXT NOT NULL,
          from_date TEXT NOT NULL,
          to_date TEXT NOT NULL,
          row_count INT NOT NULL DEFAULT 0,
          payload JSONB NOT NULL,
          checksum TEXT NOT NULL DEFAULT '',
          is_demo BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_snap_period ON archive_snapshots(period);
      `);

      const cfgRes = await client.query(`SELECT value FROM settings WHERE key = 'config'`);
      if (cfgRes.rowCount === 0) {
        await client.query(`INSERT INTO settings(key, value) VALUES ('config', $1::jsonb)`, [
          JSON.stringify(DEFAULT_SETTINGS)
        ]);
      }
      const siteRes = await client.query(`SELECT value FROM settings WHERE key = 'site_key'`);
      if (siteRes.rowCount === 0) {
        const sk = crypto.randomBytes(12).toString('base64url');
        await client.query(`INSERT INTO settings(key, value) VALUES ('site_key', $1::jsonb)`, [
          JSON.stringify({ key: sk, rotatedAt: new Date().toISOString() })
        ]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      schemaPromise = null;
      throw e;
    } finally {
      client.release();
    }
  })();
  return schemaPromise;
}

async function getConfig() {
  await ensureSchema();
  const r = await query(`SELECT value FROM settings WHERE key = 'config'`);
  const rawVal = r.rows[0]?.value;
  const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal || {};
  return { ...DEFAULT_SETTINGS, ...parsed };
}

async function updateConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur, ...patch };
  await query(
    `INSERT INTO settings(key, value, updated_at) VALUES ('config', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)]
  );
  return next;
}

async function getSiteKey() {
  await ensureSchema();
  const r = await query(`SELECT value FROM settings WHERE key = 'site_key'`);
  const raw = r.rows[0]?.value;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  return parsed.key || '';
}

async function rotateSiteKey() {
  const sk = crypto.randomBytes(12).toString('base64url');
  await query(
    `INSERT INTO settings(key, value, updated_at) VALUES ('site_key', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ key: sk, rotatedAt: new Date().toISOString() })]
  );
  return sk;
}

module.exports = {
  DEFAULT_SETTINGS,
  hasPostgresUrl,
  getPool,
  query,
  ensureSchema,
  getConfig,
  updateConfig,
  getSiteKey,
  rotateSiteKey
};
