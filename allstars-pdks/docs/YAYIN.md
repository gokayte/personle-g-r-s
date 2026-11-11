# Yayın Kontrol Listesi

1. **Ortam Değişkenleri**: Vercel panelinde `DATABASE_URL`, `PUBLIC_URL`, `SETUP_KEY` ve `ADMIN_RECOVERY_KEY` değişkenlerinin tanımlı olduğundan emin olun.
2. **İlk Kurulum**: Dağıtım sonrası `/admin` sayfasından yönetici şifrenizi oluşturun.
3. **Salt-Okunur Doğrulama**: Canlı ortamda veri değiştirmeden sağlık kontrolü yapmak için:
   ```bash
   ADMIN_PASSWORD="YoneticiSifreniz" node scripts/smoke.js https://allstars-pdks.vercel.app
   ```
   *(Not: `--mutate` bayrağı verilmediği sürece `smoke.js` canlı veritabanına örnek kayıt veya arşiv yazmaz.)*
