# SecuriPDF Windows uygulaması

Kurum sunucusundaki SecuriPDF arayüzünü Windows penceresinde açar. Giriş, sunucudaki Active Directory akışıdır.

Uygulama yanında küçük bir PDF motoru çalıştırır (Stirling-PDF server JAR ve Java 25). Sunucu bir aracın bilgisayarda çalışmasına izin verirse dosya bilgisayarda işlenir ve sunucuya gönderilmez. İzin listesi `services/platform/app/routes/desktop.py` içindedir: birleştirme, bölme, döndürme, sayfa işlemleri, sayfa numarası, damga, düzleştirme, şifre ekleme/kaldırma, PDF↔görsel. OCR, ofis dönüşümleri, filigran, karartma, imza ve diğer araçlar sunucuda çalışır.

Yerel iş de sunucudan geçer: lisans ve kullanıcı aracı yetkisi kontrol edilir, form alanları normalleştirilir, başlangıç ve sonuç denetim kaydına yazılır. "Belgelere kaydet" seçiliyse yalnızca sonuç dosyası belgelere yüklenir. Motor hazır değilse iş bugünkü gibi sunucu kuyruğuna gider. Motor bir işi reddederse dosya sessizce sunucuya gönderilmez, hata gösterilir.

Motor açılışta yaklaşık bir dakikada hazır olur ve yalnızca `127.0.0.1` üzerinde dinler. Uygulama kapanınca, zorla kapatılsa da, motor da kapanır. Motor kaydı `%LOCALAPPDATA%\net.entera.securipdf.desktop\engine\engine.log` dosyasındadır.

## Sunucu adresi

İlk açılışta sunucu adresi sorulur. Örnek: `https://pdf.sirket.local:8444`. Adres `%APPDATA%\SecuriPDF\securipdf-provisioning.json` dosyasına yazılır. Aynı ada sahip Keycloak kapısı (8443) ayrıca izin istemez.

Yönetici adresi kilitlemek için `C:\ProgramData\SecuriPDF\securipdf-provisioning.json` bırakır:

```json
{
  "serverUrl": "https://pdf.sirket.local:8444",
  "lockConnection": true,
  "allowedHosts": []
}
```

`allowedHosts` yalnızca giriş ekranı farklı bir alan adındaysa doldurulur. Sunucudan açılan sayfa yalnızca motor durumunu sorabilir ve motora iş verebilir; sunucu adresini değiştiremez.

## Derleme

Rust, MSVC derleyicisi, Windows SDK ve WebView2 gerekir. `clients/desktop` içinde:

```text
powershell -ExecutionPolicy Bypass -File scripts\fetch-engine.ps1
cd src-tauri
cargo install tauri-cli --version "~2" --locked
cargo tauri build
```

`fetch-engine.ps1`, Stirling-PDF 2.14.3 server JAR'ını ve Temurin 25 JRE'yi SHA256 özetini doğrulayarak `src-tauri\engine` altına indirir; bu dosyalar repoya girmez. Kurulum dosyası `src-tauri\target\release\bundle\nsis` altındadır.
