# All Stars Music PDKS — Yayına Alma ve Kurulum Rehberi

Bu rehber, sistemi güvenli biçimde yayına almak ve ilk kurulumu tamamlamak için gereken adımları içerir.

## 1) Kalıcı PostgreSQL Veritabanı (Neon / Supabase / Railway)

1. Veritabanı sağlayıcınızda yeni bir PostgreSQL projesi oluşturun (`allstars-pdks`).
2. Size verilen `postgresql://...` bağlantı adresini (`DATABASE_URL`) kopyalayın.
   - **Güvenlik Uyarısı:** Bağlantı adresini hiçbir sohbet ekranında veya üçüncü kişilerle paylaşmayın; doğrudan kendi Vercel panelinize girin.

## 2) Vercel Ortam Değişkenleri (Environment Variables)

Vercel → Proje (`allstars-pdks`) → **Settings → Environment Variables** bölümüne aşağıdaki değişkenleri ekleyin:

- `DATABASE_URL`: PostgreSQL bağlantı adresiniz (`?sslmode=require` ile)
- `PUBLIC_URL`: Sitenizin tam yayın adresi (ör. `https://allstars-pdks.vercel.app`)
- `SETUP_KEY` *(Önerilen)*: İlk kurulum ekranını yetkisiz kişilerden korumak için belirleyeceğiniz gizli kurulum anahtarı
- `ADMIN_RECOVERY_KEY` *(Önerilen)*: Yönetici şifresi unutulduğunda sıfırlamak için en az 12 karakterlik kurtarma anahtarı

Değişkenleri kaydettikten sonra **Deployments → Redeploy** ile projeyi yeniden dağıtın.

## 3) İlk Yönetici Kurulumu

1. Yayın tamamlandıktan sonra hemen `https://<yayın-adresiniz>/admin` sayfasını açın.
2. En az 8 karakterli, güçlü ve benzersiz bir yönetici şifresi belirleyin (`SETUP_KEY` tanımladıysanız kurulum anahtarını girin).
3. İlk kurulum tamamlandığında `/api/setup` ucu otomatik olarak kilitlenir.

## 4) Personel Eşleştirme ve Kullanım

1. Yönetici panelinden **Personeller** sekmesine girip her personel için üretilen 6 haneli eşleştirme kodunu ilgili personele iletin.
2. Personel telefonundan `/p` ekranını açıp kodu bir kez girer; cihaz tek cihaz kilidiyle eşleşir.
3. Personel iş yeri kapısındaki QR afişini okutarak giriş-çıkış yapar.

## 5) Okutma Sonrası Ekran (Personel Sayfası Garantisi)

Kapı QR afişi `https://<yayın-adresiniz>/p?k=<kapı anahtarı>` içeriğini taşır. Çalışan okutmayı
yaptığında telefon **doğrudan personel ekranına** gider, kayıt işlenir ve çalışan okutma sonunda
**kendi personel sayfasında kalır** (giriş saati, mesai, bugünkü hareketler).

Yönetici paneli (`/admin`) veya kiosk (`/kiosk`) adresleri `?k=`, `?pair=`, `?code=` parametreleriyle
açılırsa otomatik olarak `/p` adresine yönlendirilir (Vercel `redirects` + `server.js` + sayfa içi
koruyucu script). Böylece eski/yanlış basılmış bir afiş bile çalışanı yönetici sayfasına düşürmez.

Kendi alan adınızı bağlarsanız (`ör. pdks.firmaniz.com`) afişteki karekod da otomatik olarak bu
adresi kullanır; ayrıca `PUBLIC_URL` tanımlamanıza gerek yoktur. Sabit kalmasını isterseniz
`PUBLIC_URL` ortam değişkenine tam adresi yazabilirsiniz.
