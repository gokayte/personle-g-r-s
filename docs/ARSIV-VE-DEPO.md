# Arşiv & Depo Mimarisi — "Geçmiş veriler nerede tutuluyor?"

Kısa cevap: **hepsi buluttaki PostgreSQL veritabanında** (Neon / Supabase / Railway — `DATABASE_URL`).
Vercel'de kalıcı disk yoktur; bu yüzden uygulamadaki her şey veritabanına yazılır ve **sunucu yeniden
başlasa, yeni sürüm yayınlansa, tarayıcı kapansa bile veriler kaybolmaz.**

---

## 1) Katmanlar

| Katman | İçerik | Nerede | Saklama |
|---|---|---|---|
| **Canlı veri** | Personel, giriş-çıkış kayıtları (her okutma), toplantılar, ayarlar, oturumlar | PostgreSQL tabloları: `employees`, `punches`, `meetings`, `settings`, `sessions` | Süresiz (silinene kadar) |
| **Dönem arşivi** | Her ayın puantaj özeti (dondurulmuş kopya: kişi bazlı gün/mesai/geç kalma/devamsızlık + günlük döküm) | `archive_snapshots` tablosu (`payload` = JSONB) | Süresiz, ay başına 1 kayıt |
| **Belge deposu** | Sözleşme, izin formu, onaylı puantaj PDF'i, yedek dosyası, QR/baskı materyali | `archive_files` tablosu (`data` = BYTEA, dosya başına ≤ 4 MB) | Süresiz |
| **Dışa aktarım** | Excel (`.xlsx`) raporları ve arşiv dönemleri | İndirilen dosya (kullanıcının bilgisayarı) | Kullanıcıya bağlı |

## 2) "Geçmiş" nasıl garanti altına alınıyor?

1. **Her okutma anında yazılır.** Giriş/çıkış kaydı istek anında veritabanına commit edilir; tarayıcı
   kapansa da kayıt durur.
2. **Aylık dondurma (snapshot).** Yönetici paneli → *Arşiv & Depo* ekranı, **geçen ayın** arşivini
   otomatik oluşturur (ay başına bir kez). İsterseniz geçmiş herhangi bir ayı "Arşive Al" ile
   elle de dondurursunuz. Dondurulan kayıt, sonradan personel silinse/düzenlense bile değişmez.
3. **Dönem Excel'i.** Her arşiv kaydı tek tıkla 2 sayfalı `.xlsx` olarak indirilir (Dönem Özeti + Günlük Puantaj).
4. **Yedek dosyası.** Matbaa çıktıları, imzalı puantaj listeleri, sözleşmeler depoya yüklenir; kategori
   ve dönem etiketiyle aranır, tek tıkla indirilir, yetkisiz erişim kapalıdır (yalnızca yönetici oturumu).
5. **Sağlama (checksum).** Yüklenen her dosya ve her arşiv kaydı için SHA-256 parmak izi tutulur;
   bütünlük doğrulaması yapılabilir.

## 3) Ne kadar veri saklanabilir?

- Kayıt satırları (okutma) çok küçüktür: 100 personel × günde 4 okutma ≈ **yılda ~150 bin satır ≈ 30 MB**.
  Neon'un ücretsiz katmanı (0,5 GB) bu yükün çok üstünde.
- Belge deposu: dosya başına **4 MB** sınırı var (Vercel'in 4,5 MB istek limiti nedeniyle).
  Toplam alan veritabanı kotasına bağlıdır; panelde **"Kullanılan Alan"** göstergesinden izlenir.
- Çok büyük dosyalar (ör. yıllık imaj yedekleri, video) için ileri aşamada **Vercel Blob / Cloudflare R2**
  gibi nesne depolama eklenebilir; mevcut yapı buna hazır (indirme uçları tek yerden geçiyor).

## 4) Saklama süresi ve temizlik

- Varsayılan: **süresiz saklama.**
- İsteğe bağlı: bir dönem arşive alındıktan sonra çok eski ham okutma satırları silinebilir
  (`POST /api/admin/archive/purge` · `{"before":"2024-01-01"}`). Arşiv özeti silinmez, sadece ham
  satırlar temizlenir → kota düşer, geçmiş puantaj korunur.

## 5) Yasal not (Türkiye)

İşçi özlük ve puantaj kayıtları için saklama yükümlülüğü uygulamada **süresiz** varsayılmıştır.
İK pratiği açısından puantaj/özlük belgelerinin **10 yıl** saklanması önerilir; sistem bunu otomatik
sağlar (silme işlemi yalnızca yönetici onayıyla yapılabilir).

---

## 6) Yönetici panelinde nerede?

**Yönetici Paneli → Arşiv & Depo** sekmesi:

- Depo durumu (toplam dosya, arşiv sayısı, kullanılan alan, saklama politikası)
- **Geçmiş Dönem Arşivi**: ay seç → *Arşive Al* → listede kalıcı kayıt → *Excel indir* / *Detay*
- **Belge / Dosya Yükle**: dosya + başlık + kategori + dönem → *Depoya Yükle*
- **Depodaki Dosyalar**: arama, kategori filtresi, indirme, silme

## 7) Teknik uçlar (API)

| Uç | Yöntem | Açıklama |
|---|---|---|
| `/api/admin/archive/summary` | GET | Depo özeti + geçen ay otomatik arşivi tetikler |
| `/api/admin/archive/snapshots` | GET / POST | Dönem arşivlerini listele / yeni dönem dondur |
| `/api/admin/archive/snapshots/:id` | GET | Arşiv detayı (JSON özet) |
| `/api/admin/archive/snapshots/:id/excel` | GET | Dönemin Excel çıktısı |
| `/api/admin/archive/files` | GET / POST | Belge listesi / yükleme (base64, ≤ 4 MB) |
| `/api/admin/archive/files/:id` | GET / DELETE | İndirme / silme |
| `/api/admin/archive/purge` | POST | Belirtilen tarihten eski ham okutmaları temizle |

Tüm uçlar **yalnızca yönetici oturumu** (`Bearer` token) ile çalışır.
