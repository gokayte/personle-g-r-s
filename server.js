const http = require('http');
const fs = require('fs');
const path = require('path');

const dotEnvPath = path.join(__dirname, '.env');
if (fs.existsSync(dotEnvPath)) {
  for (const line of fs.readFileSync(dotEnvPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const localEnvFile = '/home/user/.secrets/deploy_env.json';
if (!process.env.DATABASE_URL && fs.existsSync(localEnvFile)) {
  try {
    const m = JSON.parse(fs.readFileSync(localEnvFile, 'utf8'));
    if (m.database_url) process.env.DATABASE_URL = m.database_url;
    if (m.neon_project_id) process.env.NEON_PROJECT_ID = m.neon_project_id;
    if (m.neon_expires_at) process.env.NEON_EXPIRES_AT = m.neon_expires_at;
    if (m.neon_identity_assertion) process.env.NEON_IDENTITY_ASSERTION = m.neon_identity_assertion;
    if (!process.env.PUBLIC_URL) process.env.PUBLIC_URL = 'https://personel-pdks.vercel.app';
  } catch {}
}

const apiHandler = require('./api/index');

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  if (u.pathname === '/api' || u.pathname.startsWith('/api/')) {
    return apiHandler(req, res);
  }

  let rel = decodeURIComponent(u.pathname);
  if (rel === '/') rel = '/index.html';
  let filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const htmlCandidate = filePath + '.html';
    if (fs.existsSync(htmlCandidate)) {
      filePath = htmlCandidate;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Sayfa bulunamadı');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Personel PDKS sunucusu çalışıyor: http://0.0.0.0:${PORT}`);
});
