# All Stars Music — Personel QR Giriş-Çıkış & Mesai Takip (PDKS)

Karekod (QR) okutma tabanlı, gerçek zamanlı bulut veritabanlı personel devam kontrol ve puantaj sistemi.

## Özellikler
- **Ana Portal (`/`)**: All Stars Music markalı karşılama ekranı ve canlı İstanbul saati.
- **Yönetici Paneli (`/admin`)**:
  - Canlı içerideki personel listesi ve anlık okutma akışı
  - Giriş-çıkış hareketlerini filtreleme, manuel ekleme/düzenleme/silme
  - Günlük ve dönemsel mesai, geç kalma, erken çıkış, eksik çıkış ve devamsızlık raporu
  - 3 sayfalı yerel **Excel (`.xlsx`)** dışa aktarma
  - Personel yönetimi ve tek cihaz kilitli 6 haneli telefon eşleştirme kodu / linki
  - A4 boyutunda yazdırılabilir **Kapı QR Afişi** ve **Personel QR Yaka Kartları**
  - Mesai saatleri, tolerans süreleri ve isteğe bağlı iş yeri GPS konum doğrulaması
- **Kapı Kiosk Terminali (`/kiosk`)**: Sabit tablet/telefon/bilgisayar kamerasıyla personel kartı okutma (veya USB barkod okuyucu desteği).
- **Personel Telefon Ekranı (`/p`)**: Personelin kendi telefonuyla kapıdaki QR afişi okutarak giriş-çıkış yapması.

## Bilgisayarda Çalıştırma
1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   npm run build
   ```
2. `.env.example` dosyasını `.env` adıyla kopyalayıp `DATABASE_URL` alanına PostgreSQL bağlantınızı yazın.
3. Sunucuyu başlatın:
   ```bash
   npm start
   ```
   Tarayıcıdan `http://localhost:3000` adresini açın.

## Vercel Üzerinde Yayınlama
- Build Command: `npm run build`
- Install Command: `npm install`
- Output Directory: `public`
- Environment Variables: `DATABASE_URL` ve `PUBLIC_URL`
