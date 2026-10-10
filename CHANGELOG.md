# Changelog

## Unreleased

- Windows uygulaması sunucusuz çalışır; 19 araç dosyayı bilgisayardan çıkarmadan işler
- Windows uygulamasında Türkçe ve İngilizce OCR ile aranabilir PDF bilgisayarda üretilir
- Windows uygulaması belgeyi ve sonucu önizler; sayfa silme, çıkarma ve bölmede sayfalar küçük resimlerden seçilir
- Windows uygulamasının PDF motoru yaklaşık 15-20 saniyede hazır olur
- Windows uygulaması açılışta logoyu, sürümü ve motorun gerçek açılış ilerlemesini gösterir; beklerken dosya seçilebilir
- Windows uygulaması UYAP UDF belgelerini PDF'e, PDF'teki metni UDF'e dönüştürür
- Windows uygulaması e-Fatura, e-Arşiv ve e-İrsaliye XML dosyalarını belgedeki şablonla veya standart şablonla PDF'e dönüştürür
- Windows uygulaması komut satırından çalışır (`--tool`, `--set`, `--out`, `--json`, `--silent`, çıkış kodları) ve isteğe bağlı Gezgin sağ tık menüsü ekler
- Windows uygulamasının görüntüleyicisinde metin arama, sayfaya gitme, sığdırma, döndürme ile vurgulama, çizim ve metin notu ekleyip PDF'e kaydetme
- Windows uygulaması kurulu Microsoft Office ile Word, Excel ve PowerPoint belgelerini PDF veya PDF/A'ya, PDF'i Word'e dönüştürür
- Windows uygulaması metinleri, düzenli ifadeleri ve kişisel verileri (TC kimlik no, IBAN, e-posta, telefon, kart numarası) kalıcı olarak karartır
- Windows uygulamasında taranmış belgelerin OCR sonrası sayfa boyutu 7 kat büyüyordu; düzeltildi (`fetch-engine.ps1` yeniden çalıştırılmalı)
- Windows uygulaması PDF'i Windows sertifika deposundaki sertifikayla (e-imza kartları dahil), PKCS#11 token, PFX/P12 veya PEM ile imzalar; zaman damgası ekler, imzaları doğrulayıp rapor üretir ve imzaları kaldırır
- Windows uygulaması bir aracı birden çok dosyaya uygular; sonuçları ZIP olarak veya bir klasöre kaydeder ve CSV işlem raporu üretir
- Windows uygulamasına filigran, sıkıştırma, PDF→Excel/CSV/metin, PDF/A, üstveri, boş sayfa silme, onarma, temizleme, görsel çıkarma ve kitapçık eklendi; görsel dönüşümüne BMP eklendi
- Windows uygulamasının PDF motoruna onarma ve kayıpsız sıkıştırma için qpdf 12.4.2 eklendi (`fetch-engine.ps1` yeniden çalıştırılmalı)

## 1.2.8-stirling-2.14.3 (2026-10-02)

- Erişim portu yönetim ekranından yazılır; HTTPS etkinleştirilince bu kapı dinlenir, 443 açık kalır
- HTTPS kurulu sunucuda paket güncellemesi uygulama ve Keycloak adreslerini olduğu gibi bırakır

## 1.2.7-stirling-2.14.3 (2026-10-02)

- Hazır sertifika ve özel anahtar birlikte yüklenir; kayıtlı adres IP ise sertifikanın alan adı kullanılır
- Girişteki büyük oturum çerezi Nginx’te 502 üretmez
- Uygulama varsayılan HTTPS kapısı 8444’tür; Keycloak 8443’te kalır, 443 de dinlenir

## 1.2.6-stirling-2.14.3 (2026-10-01)

- Yönetim panelinden CA talep dosyası indirilir; dönen sertifika uygulama (8444, 443 de açık) ve Keycloak (8443) için etkinleştirilir
- Özel anahtar sunucuda kalır

## 1.2.5-stirling-2.14.3 (2026-09-30)

- Kullanıcı ve yönetici kullanım kılavuzları uygulama içinden açılır
- Gözlem hesabı yönetim ekranını gezer; yerel kullanıcı formundan seçilir
- HTTP laboratuvarında prod kontrol listesi HTTPS maddelerini bekletir

## 1.2.4-stirling-2.14.3 (2026-09-29)

- OCR Türkçe dil paketi imaja gömülür; CBR/RAR5 platformda unrar ile açılır
- e-Kitap dönüşümü headless Qt ile çalışır (Vulkan/QRHiGles2 hatası)
- Görsel ekleme tıklanan noktaya, karartma işaretlenen metnin üzerine uygulanır
- PDF temizleme, imza kaldırma, meta veri, otomatik adlandırma ve ek/görsel çıkarma platformda sonuç üretir

## 1.2.3-stirling-2.14.3 (2026-09-28)

- Kurulum, updater servisi ayakta değilse bitmez; giriş kapısı kapanmadan sihirbaz tamamlanmış sayılmaz
- Offline Docker kurulumunda eski GnuPG/keyboxd paketleri atlanır

## 1.2.2-stirling-2.14.3 (2026-09-28)

- Lisans yalnızca imzalı .lic veya 30 günlük demo ile açılır; paket kartı ve araç listesi lisansı değiştirmez
- Admin lisans ekranı yalnızca paketteki araçları ve lisans bilgilerini gösterir
- PDF→HTML ve PDF→CSV sonuçları zip ise .zip olarak iner
- Araçlar sayfasına ad ve açıklamaya göre arama eklendi
- License Manager müşteri adı günceller ve verilen lisansları tek ekranda listeler

## 1.2.0-stirling-2.14.3 (2026-09-25)

- Upstream Stirling-PDF **2.14.3** (2.13.1 → 2.14.3; bug fix / güvenlik / imza iyileştirmeleri)
- Offline paket ve web güncelleme bu sürüme hizalandı

## 1.1.1-stirling-2.13.1 (2026-09-25)

- Web üzerinden offline paket yükleme ve host updater ile güncelleme
- MANIFEST: `upgrade_from` / `min_upgrade_from` doğru önceki sürüme bağlandı
- Build: `VERSION` dosyasından image tag okuma

## 1.1.0-stirling-2.13.1 (2026-07-01)

- Logout: Keycloak SSO icin oauth2 `BACKEND_LOGOUT_URL` + oauth2-proxy v7.8.2
- SPA: oturum dusunce login yonlendirme (CORS duzeltmesi)
- Admin Operasyon: kurulu surum ve staging guncelleme bilgisi (Faz 1)
- Offline: `upgrade-offline-stack.sh`, `patch-logout-deploy.sh`
