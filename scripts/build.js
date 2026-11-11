const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'public', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

const files = [
  ['node_modules/qr-scanner/qr-scanner.umd.min.js', 'qr-scanner.min.js'],
  ['node_modules/qr-scanner/qr-scanner-worker.min.js', 'qr-scanner-worker.min.js'],
  ['node_modules/qrcode-generator/qrcode.js', 'qrcode.js']
];

for (const [srcRel, destName] of files) {
  const src = path.join(root, srcRel);
  const dest = path.join(vendorDir, destName);
  if (!fs.existsSync(src)) {
    if (fs.existsSync(dest)) {
      console.log(`Skip ${srcRel} (not installed); using existing public/vendor/${destName}`);
      continue;
    }
    console.error(`Missing ${srcRel} and no existing public/vendor/${destName}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`Copied ${srcRel} -> public/vendor/${destName}`);
}
