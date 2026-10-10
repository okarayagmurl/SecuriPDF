# SecuriPDF Windows uygulaması

Sunucu gerektirmeyen masaüstü uygulaması. Dosyalar bilgisayarda işlenir, hiçbir yere gönderilmez; sunucu adresi, oturum veya ağ bağlantısı gerekmez.

Uygulama yanında küçük bir PDF motoru çalıştırır (Stirling-PDF server JAR, Java 25, Tesseract OCR). Araçlar:

- Düzenle: birleştir, böl (sayfa, sayı/boyut, bölüm), bindir, düzleştir
- Metin tanıma: OCR ile aranabilir PDF (Türkçe, İngilizce, Almanca, Fransızca, İspanyolca, İtalyanca, Arapça)
- Sayfalar: döndür, sil, çıkar, sırala, ölçekle, kırp, çok sayfa düzeni, tek sayfa, sayfa numarası, kitapçık
- Güvenlik: damga, filigran (metin veya görsel), parola ekle (AES-256), parola kaldır, karartma (metin, düzenli ifade, TC kimlik no, IBAN, e-posta, telefon, kart numarası), Windows Defender ile virüs tarama
- E-imza: dijital imza (Windows sertifika deposu, PKCS#11 akıllı kart/token, PFX/P12, PEM), RFC 3161 zaman damgası, imza doğrulama raporu, imzaları kaldırma
- Dönüştür: PDF'ten görsele (PNG, JPEG, WebP, GIF, BMP), görselden PDF'e, PDF'ten Excel / CSV / metne, PDF'ten PDF/A'ya, UYAP UDF'ten PDF'e, PDF'ten UDF'e (yalnızca metin), e-Fatura / e-Arşiv / e-İrsaliye XML'inden PDF'e, Word / Excel / PowerPoint'ten PDF veya PDF/A'ya, PDF'ten Word'e
- Optimize: sıkıştır, üstveri düzenle, boş sayfa sil, onar, temizle, görselleri çıkar

UDF ve e-Fatura dönüşümleri motoru kullanmaz: belge arayüzde HTML olarak dizilir ve WebView2'nin yazdırma motoruyla PDF'e çevrilir (`src/print.rs`), böylece metin seçilebilir kalır. Bu sayfalarda betik çalıştırılmaz. e-Fatura'da belgeye gömülü XSLT şablonu varsa o, yoksa SecuriPDF standart şablonu kullanılır.

Office dönüşümleri bilgisayarda kurulu Microsoft Office ile yapılır (`src/office.rs`, `src/office.ps1`); Office yoksa araç bunu bildirir. Makrolar zorla kapatılır, belge salt okunur açılır. Office görünmeyen bir uyarıda takılırsa 3 dakika sonra süreç kapatılır ve kullanıcıya bildirilir. PDF/A çıktısını Word ve PowerPoint verir; Excel için PDF'e çevirip "PDF/A'ya dönüştür" aracı kullanılır.

E-imza araçları motorun masaüstü modunu kullanır (`-DSTIRLING_PDF_TAURI_MODE=true`); donanımla imzalama yalnızca bu modda ve `127.0.0.1` üzerinden açılır. Windows sertifika deposundaki özel anahtarlı sertifikalar listelenir; e-imza kartının sürücüsü Windows'a kuruluysa kart sertifikası da burada görünür ve PIN'i Windows sorar. PKCS#11'de Stirling'in tanıdığı sürücülere (OpenSC, YubiKey, SafeNet, Gemalto IDPrime, SoftHSM) ek olarak AKİS, SafeSign, DataKey ve ePass2003 sürücülerine izin verilir (`STIRLING_PKCS11_LIBRARIES`, `src/engine.rs`). Seçilen sertifika depoda yoksa motor başka bir sertifikayla imzalamaya çalıştığından uygulama imzalamadan önce sertifikanın depoda olduğunu denetler. Zaman damgası internet ister; sunucuya yalnızca belgenin SHA-256 özeti gider. İmza doğrulama sonucu PDF rapor olarak hazırlanır; Kamu SM gibi Java'nın tanımadığı kökler için kök sertifika isteğe bağlı olarak eklenebilir. Parola ve PIN saklanmaz.

Karartmada eşleşmeler PDF.js'in metin konumlarından bulunur (`textBoxes`, `ui/preview.js`); motorun kendi metin araması kutuları kaydırıyor ve metni altında bırakıyordu. Motor (`/api/v1/security/redact`) yalnızca kutuları çizer ve sayfaları görsele çevirir, böylece karartılan metin belgede kalmaz. İstenirse ardından OCR ile belge yeniden aranabilir yapılır.

Seçilen belge ve sonuç sağ tarafta önizlenir (PDF.js). Sayfa silme, çıkarma ve bölmede sayfalar küçük resimlere tıklanarak seçilir; çift tıklama sayfayı tam ekranda açar. Tam ekran görüntüleyicide (PDF.js görüntüleyici bileşeni) metin arama (Ctrl+F), sayfaya gitme, genişliğe/sayfaya sığdırma, yakınlaştırma ve döndürme vardır; vurgulama, serbest çizim ve metin notu eklenip "Kaydet" ile işaretlemeler PDF'e yazılarak `_isaretli.pdf` olarak kaydedilir. Sonuç kaydetmeden önce görülür ve "Sonuçla devam et" ile başka bir araca aktarılabilir. Uygulamayla açılan PDF (çift tıklama veya "Birlikte aç") doğrudan yüklenir.

Tek dosyayla çalışan araçlarda "Birden çok dosyaya uygula" seçilirse her dosya aynı ayarlarla ayrı ayrı işlenir. Sonuçlar tek ZIP olarak veya seçilen klasöre kaydedilir; klasördeki dosyaların üzerine yazılmaz. Her iki durumda da hangi dosyanın başarılı olduğunu, çıktı adını, boyutu, süreyi ve hata nedenini gösteren `islem-raporu.csv` eklenir (Excel'de Türkçe karakterlerle açılır). Hatalı bir dosya diğerlerinin işlenmesini durdurmaz.

## Komut satırı ve Gezgin menüsü

Betikler ve RPA robotları araçları pencere açmadan çalıştırabilir (`src/cli.rs`). Araç, arayüzdeki kodla gizli bir pencerede çalışır; sonuç aynıdır.

```text
securipdf-desktop.exe --list-tools [--json]
securipdf-desktop.exe --tool ocr-pdf --set languages=tur,eng --out C:\cikti\ tarama.pdf
securipdf-desktop.exe --tool office-to-pdf --set format=pdfa --json --silent rapor.docx
```

`--out` verilmezse sonuç girdinin yanına yazılır ve var olan dosyanın üzerine yazılmaz (`ad (2).pdf`). `--set ad=değer` araç ayarlarını verir; ayar adları ve geçerli değerler `--list-tools --json` çıktısındadır. `--json` sonucu tek satır JSON yazar, `--silent` hata penceresini kapatır. Çıkış kodları: 0 başarılı, 1 araç hatası, 2 kullanım hatası, 3 PDF motoru açılamadı, 4 girdi okunamadı, 5 çıktı yazılamadı, 6 zaman aşımı (30 dk). Motor yalnızca gereken araçlarda, ayrı bir çalışma klasöründe açılır ve işten sonra kapanır. Aynı anda başlatılan komutlar sırayla çalışır. Uygulama bir Windows (GUI) programı olduğundan komut isteminde `start "" /wait securipdf-desktop.exe ...`, PowerShell'de `Start-Process ... -Wait -PassThru` ile beklenir; çıktı yönlendirildiğinde (robotlar, `| Out-String`) doğrudan okunur.

Üst çubuktaki "Gezgin sağ tık menüsü" kutusu PDF, Office ve UDF dosyalarına bir "SecuriPDF" alt menüsü ekler (OCR, Word'e, UDF'e, PDF'e, PDF/A'ya dönüştür, sıkıştır). Kayıtlar yönetici izni gerektirmeyen `HKCU\Software\Classes\SystemFileAssociations` altındadır; kutu kapatılınca ve uygulama kaldırılınca (`windows/hooks.nsh`) silinir.

Onarma ve kayıpsız sıkıştırma için qpdf 12.4.2 paketlenir (`fetch-engine.ps1`). Onarma motora bırakılmaz; uygulama qpdf'i doğrudan çalıştırır (`src/qpdf.rs`). Ghostscript gerektiren sıkıştırma düzeyleri (6–9) paketlenmez.

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
- `tessdata_best` 4.1.0 Türkçe ve İngilizce dil verisi (`tessdata\`); `configs\pdf` dosyasına `user_defined_dpi 500` eklenir, yoksa taranmış belgelerde OCR sonrası sayfalar 7 kat büyük çıkar

Betik ardından motoru bir kez açıp kapatarak AOT önbelleğini (`engine.aot`) eğitir. JVM seçenekleri (`jvm.args`) ve motor ayarları (`engine.env`) da buraya yazılır; uygulama motoru bu dosyalarla başlatır. Önbellek yalnızca aynı seçeneklerle kullanılabildiği için bu iki dosya elle değiştirilmemeli, betik yeniden çalıştırılmalıdır.

Kurulum dosyası `src-tauri\target\release\bundle\nsis` altındadır. PDF.js 6.4.299 `ui\vendor\pdfjs` altında repoda durur.
