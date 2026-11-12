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


const apiHandler = require('./api/index');

const PORT = Number(process.env.PORT || 3000);
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

// --- PERSONEL OKUTMA AKIŞI YÖNLENDİRMESİ ---
// Kapı QR afişi "…/p?k=ANAHTAR" biçimindedir. Eski/yanlış basılmış bir afiş veya
// elle açılan bir bağlantı çalışanı yönetici (/admin), kiosk (/kiosk) ya da ana
// sayfaya düşürürse, sunucu tarafında anında personel ekranına (/p) gönderilir.
// Böylece okutma bittiğinde çalışan daima kendi personel sayfasında kalır.
const EMPLOYEE_ENTRY_PARAMS = ['k', 'pair', 'code'];
const EMPLOYEE_ENTRY_PATHS = new Set([
  '/',
  '/index.html',
  '/admin',
  '/admin.html',
  '/kiosk',
  '/kiosk.html',
  '/kurulum',
  '/kurulum.html',
  '/marka',
  '/marka/index.html',
  '/marka/kapi-afisi.html'
]);

function normalizePathname(pathname) {
  const cleaned = String(pathname || '/').replace(/\/+$/, '');
  return cleaned === '' ? '/' : cleaned;
}

function isEmployeeEntryRequest(u, pathname) {
  if (!EMPLOYEE_ENTRY_PATHS.has(pathname)) return false;
  return EMPLOYEE_ENTRY_PARAMS.some((key) => String(u.searchParams.get(key) || '').trim() !== '');
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  if (u.pathname === '/api' || u.pathname.startsWith('/api/')) {
    return apiHandler(req, res);
  }

  const pathname = normalizePathname(u.pathname);

  // Personel okutma/eşleştirme linki yanlış sayfaya açıldıysa personel ekranına yönlendir
  if (isEmployeeEntryRequest(u, pathname)) {
    res.writeHead(302, {
      Location: '/p' + (u.search || ''),
      'Cache-Control': 'no-store'
    });
    return res.end();
  }

  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  let filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const htmlCandidate = filePath + '.html';
    const indexCandidate = path.join(filePath, 'index.html');
    if (fs.existsSync(htmlCandidate) && !fs.statSync(htmlCandidate).isDirectory()) {
      filePath = htmlCandidate;
    } else if (fs.existsSync(indexCandidate)) {
      filePath = indexCandidate;
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
