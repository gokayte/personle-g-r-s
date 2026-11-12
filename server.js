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
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

// --- ÖNBELLEK POLİTİKASI ---
// Sayfalar (HTML) her zaman taze kalır; stiller/betikler ve görseller önbelleğe alınır.
// s-maxage Vercel kenar (CDN) önbelleği içindir ve her yeni dağıtımda sıfırlanır,
// dolayısıyla yayına alınan güncelleme personel telefonlarına anında yansır.
// Amaç: kapıda okutma sırasında sayfanın mümkün olan en hızlı açılması.
const EDGE_DAY = 's-maxage=86400, stale-while-revalidate=86400';

function cacheControlFor(ext) {
  if (ext === '.html') return 'no-cache';
  if (ext === '.css' || ext === '.js' || ext === '.mjs') return `public, max-age=60, ${EDGE_DAY}`;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2'].includes(ext)) {
    return `public, max-age=3600, ${EDGE_DAY}`;
  }
  if (ext === '.json' || ext === '.webmanifest') return `public, max-age=300, ${EDGE_DAY}`;
  return 'no-cache';
}

// Yanlış/eksik adrese düşen kişi (özellikle kapıda telefonla okutma yapan personel)
// çıkmaza girmesin diye yönlendirmeli, markalı 404 sayfası.
const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sayfa bulunamadı — Personel Giriş-Çıkış</title>
<link rel="icon" href="/allstar-logo.png" type="image/png">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main style="max-width:480px;margin:0 auto;padding:40px 18px;text-align:center;">
  <img src="/allstar-logo.png" alt="All Stars Music" style="width:min(100%,200px);height:auto;display:block;margin:0 auto 16px;">
  <div style="font-weight:800;font-size:20px;margin-bottom:6px;">Sayfa bulunamadı</div>
  <p style="color:var(--muted);font-size:14px;line-height:1.6;margin:0 0 22px;">
    Aradığınız adres taşınmış veya yazımda bir hata olabilir.
    Giriş-çıkış okutması için personel ekranını kullanın.
  </p>
  <a href="/p" class="btn btn-primary" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px;font-size:15px;margin-bottom:10px;">
    Personel Ekranına Git
  </a>
  <a href="/" class="btn" style="display:block;padding:12px;margin-bottom:10px;">Ana Sayfa</a>
  <a href="/admin" class="btn" style="display:block;padding:12px;">Yönetici Paneli</a>
</main>
</body>
</html>`;

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
      // Markalı 404: yanlış adrese düşen personel tek dokunuşla kendi ekranına dönebilsin
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer'
      });
      return res.end(NOT_FOUND_HTML);
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControlFor(ext)
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Personel PDKS sunucusu çalışıyor: http://0.0.0.0:${PORT}`);
});
