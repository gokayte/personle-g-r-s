#!/usr/bin/env node
/**
 * All Stars PDKS — Vercel API ile doğrudan dağıtım (CLI gerekmez)
 *
 * Kullanım:
 *   VERCEL_TOKEN=... TEAM_ID=... PROJECT=allstars-pdks node scripts/deploy_api.js
 *
 * Akış:
 *   1. Proje dosyalarını toplar (gizli/çöp dosyalar hariç)
 *   2. Her dosya için SHA-1 hesaplar ve /v2/files uçuna yükler (ikili dosyalar dahil)
 *   3. /v13/deployments ile production dağıtımı oluşturur
 *   4. Dağıtım READY olana kadar bekler; hata olursa derleme kayıtlarını yazdırır
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const TOKEN = process.env.VERCEL_TOKEN || '';
const TEAM_ID = process.env.TEAM_ID || '';
const PROJECT = process.env.PROJECT || 'allstars-pdks';
const ROOT = process.env.ROOT || path.resolve(__dirname, '..');
const API = 'https://api.vercel.com';

if (!TOKEN) {
  console.error('VERCEL_TOKEN gerekli.');
  process.exit(1);
}

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.vercel', 'pdks.db', '.next', 'dist', 'build']);
const EXCLUDE_FILES = ['.env', 'pdks.db', 'pdks.db-wal', 'pdks.db-shm', '.DS_Store'];

function collect(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...collect(path.join(dir, entry.name), rel));
    } else {
      if (EXCLUDE_FILES.includes(entry.name)) continue;
      if (entry.name.startsWith('pdks.db')) continue;
      out.push(rel);
    }
  }
  return out;
}

async function api(pathname, opts = {}) {
  const url = `${API}${pathname}${pathname.includes('?') ? '&' : '?'}teamId=${TEAM_ID}`;
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) }
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, text, json };
}

(async () => {
  const files = collect(ROOT);
  console.log(`→ ${files.length} dosya toplandı.`);

  const uploaded = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const buf = fs.readFileSync(abs);
    const sha = crypto.createHash('sha1').update(buf).digest('hex');
    const up = await api('/v2/files', {
      method: 'POST',
      headers: { 'x-vercel-digest': sha, 'Content-Length': String(buf.length) },
      body: buf
    });
    if (!up.res.ok) {
      // 409 = dosya zaten yüklü (aynı sha) → sorun değil
      if (up.res.status !== 409) {
        console.error(`✖ ${rel} yüklenemedi: ${up.res.status} ${up.text.slice(0, 200)}`);
        process.exit(1);
      }
    }
    uploaded.push({ file: rel, sha, size: buf.length });
  }
  console.log(`→ ${uploaded.length} dosya yüklendi (sha-1 tabanlı).`);

  const deploy = await api('/v13/deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: PROJECT,
      project: PROJECT,
      target: 'production',
      files: uploaded,
      projectSettings: {
        framework: null,
        buildCommand: 'npm run build',
        installCommand: 'npm install',
        outputDirectory: 'public',
        rootDirectory: null,
        nodeVersion: '22.x'
      }
    })
  });

  if (!deploy.res.ok) {
    console.error('✖ Dağıtım oluşturulamadı:', deploy.res.status, deploy.text.slice(0, 500));
    process.exit(1);
  }

  const id = deploy.json.id;
  const host = deploy.json.url;
  console.log(`→ Dağıtım oluşturuldu: ${id} (${host})`);
  console.log('→ Derleme bekleniyor…');

  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await api(`/v13/deployments/${id}`);
    const state = st.json?.readyState || st.json?.status;
    process.stdout.write(`   ${state}\n`);
    if (state === 'READY') {
      console.log(`\n✔ Yayında: https://${PROJECT}.vercel.app`);
      console.log(`  Dağıtım adresi: https://${host}`);
      process.exit(0);
    }
    if (state === 'ERROR' || state === 'CANCELED') {
      const logs = await api(`/v3/deployments/${id}/events?limit=60`);
      console.error('\n✖ Derleme başarısız. Son kayıtlar:');
      const lines = (logs.text || '').split('\n').slice(0, 60).join('\n');
      console.error(lines.slice(0, 4000));
      process.exit(1);
    }
  }
  console.error('✖ Zaman aşımı.');
  process.exit(1);
})().catch((e) => {
  console.error('Beklenmeyen hata:', e);
  process.exit(1);
});
