# SecuriPDF Windows uygulaması

Sunucu gerektirmeyen masaüstü uygulaması. Dosyalar bilgisayarda işlenir, hiçbir yere gönderilmez; sunucu adresi, oturum veya ağ bağlantısı gerekmez.

Uygulama yanında küçük bir PDF motoru çalıştırır (Stirling-PDF server JAR, Java 25, Tesseract OCR). Araçlar:

- Düzenle: birleştir, böl (sayfa, sayı/boyut, bölüm), bindir, düzleştir
- Metin tanıma: OCR ile aranabilir PDF (Türkçe, İngilizce)
- Sayfalar: döndür, sil, çıkar, sırala, ölçekle, kırp, çok sayfa düzeni, tek sayfa, sayfa numarası
- Güvenlik: damga, parola ekle, parola kaldır
- Dönüştür: PDF'ten görsele, görselden PDF'e, UYAP UDF'ten PDF'e, PDF'ten UDF'e (yalnızca metin), e-Fatura / e-Arşiv / e-İrsaliye XML'inden PDF'e

UDF ve e-Fatura dönüşümleri motoru kullanmaz: belge arayüzde HTML olarak dizilir ve WebView2'nin yazdırma motoruyla PDF'e çevrilir (`src/print.rs`), böylece metin seçilebilir kalır. Bu sayfalarda betik çalıştırılmaz. e-Fatura'da belgeye gömülü XSLT şablonu varsa o, yoksa SecuriPDF standart şablonu kullanılır.

Seçilen belge ve sonuç sağ tarafta önizlenir (PDF.js). Sayfa silme, çıkarma ve bölmede sayfalar küçük resimlere tıklanarak seçilir; çift tıklama sayfayı tam ekranda açar. Sonuç kaydetmeden önce görülür ve "Sonuçla devam et" ile başka bir araca aktarılabilir. Uygulamayla açılan PDF (çift tıklama veya "Birlikte aç") doğrudan yüklenir.

Motor yalnızca `127.0.0.1` üzerinde dinler. Uygulama kapanınca, zorla kapatılsa da, motor da kapanır. Açılış, derleme sırasında üretilen Java AOT önbelleği sayesinde yaklaşık 15-20 saniyedir; bu sırada dosya seçilip önizlenebilir. Motor kaydı `%LOCALAPPDATA%\net.entera.securipdf.desktop\engine\engine.log` dosyasındadır.

## Derleme

Rust, MSVC derleyicisi, Windows SDK, WebView2 ve 7-Zip gerekir. `clients/desktop` içinde:

```text
powershell -ExecutionPolicy Bypass -File scripts\fetch-engine.ps1
cd src-tauri
cargo install tauri-cli --version "~2" --locked
cargo tauri build
```

`fetch-engine.ps1` şunları SHA256 özetini doğrulayarak `src-tauri\engine` altına koyar; bu dosyalar repoya girmez:

- Stirling-PDF 2.14.3 server JAR (açılmış hali `app\`)
- Temurin 25 JRE (`jre\`)
- UB Mannheim Tesseract 5.4 (`tesseract\`, yalnızca `tesseract.exe` ve yüklediği DLL'ler)
- `tessdata_best` 4.1.0 Türkçe ve İngilizce dil verisi (`tessdata\`)

Betik ardından motoru bir kez açıp kapatarak AOT önbelleğini (`engine.aot`) eğitir. JVM seçenekleri (`jvm.args`) ve motor ayarları (`engine.env`) da buraya yazılır; uygulama motoru bu dosyalarla başlatır. Önbellek yalnızca aynı seçeneklerle kullanılabildiği için bu iki dosya elle değiştirilmemeli, betik yeniden çalıştırılmalıdır.

Kurulum dosyası `src-tauri\target\release\bundle\nsis` altındadır. PDF.js 6.4.299 `ui\vendor\pdfjs` altında repoda durur.
