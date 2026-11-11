#!/usr/bin/env bash
# All Stars PDKS — tek komutla yayın
#
# Kullanım:
#   VERCEL_TOKEN=xxxxx DATABASE_URL="postgresql://..." ./scripts/deploy.sh
#
# Yaptıkları:
#   1. Vercel CLI ile projeye bağlanır (yoksa oluşturur)
#   2. DATABASE_URL ve PUBLIC_URL ortam değişkenlerini production/preview/development'a yazar
#   3. Kodu production'a dağıtır
#   4. Dağıtım sonrası /api/health kontrolü yapar
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN gerekli (https://vercel.com/account/tokens)}"
: "${DATABASE_URL:?DATABASE_URL gerekli (Neon/Supabase/Railway postgresql://...)}"

PROJECT_NAME="${PROJECT_NAME:-allstars-pdks}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "→ Bağımlılıklar kuruluyor ve vendor dosyaları hazırlanıyor…"
npm install --no-audit --no-fund
npm run build

echo "→ Vercel projesine bağlanılıyor: $PROJECT_NAME"
npx --yes vercel@latest link --yes --project "$PROJECT_NAME" --token "$VERCEL_TOKEN" >/dev/null

echo "→ Ortam değişkenleri yazılıyor…"
for target in production preview development; do
  # Aynı isimde değişken varsa önce kaldır (idempotent)
  npx --yes vercel@latest env rm DATABASE_URL "$target" --yes --token "$VERCEL_TOKEN" >/dev/null 2>&1 || true
  printf '%s' "$DATABASE_URL" | npx --yes vercel@latest env add DATABASE_URL "$target" --token "$VERCEL_TOKEN" >/dev/null
  npx --yes vercel@latest env rm PUBLIC_URL "$target" --yes --token "$VERCEL_TOKEN" >/dev/null 2>&1 || true
  printf '%s' "https://${PROJECT_NAME}.vercel.app" | npx --yes vercel@latest env add PUBLIC_URL "$target" --token "$VERCEL_TOKEN" >/dev/null
done

echo "→ Production dağıtımı başlatılıyor…"
DEPLOY_URL=$(npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN" 2>&1 | tee /dev/stderr | grep -Eo 'https://[a-z0-9-]+\.vercel\.app' | tail -1)

if [ -z "${DEPLOY_URL:-}" ]; then
  echo "✖ Dağıtım adresi alınamadı. Yukarıdaki çıktıyı kontrol edin." >&2
  exit 1
fi

echo "→ Yayın adresi: $DEPLOY_URL"
echo "→ Sağlık kontrolü…"
sleep 5
curl -fsS "$DEPLOY_URL/api/health" || { echo "✖ API yanıt vermiyor." >&2; exit 1; }

echo ""
echo "✔ Yayında: https://${PROJECT_NAME}.vercel.app"
echo ""
echo "Sıradaki adım — ilk kurulum (yönetici şifresi):"
echo "  node scripts/smoke.js https://${PROJECT_NAME}.vercel.app '<YONETICI_SIFRESI>'"
