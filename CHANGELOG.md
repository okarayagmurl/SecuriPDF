# Changelog

## Unreleased

- Düzenlenen yazı beyaz kutuya alınmaz; sayfadaki zemin ve yazı rengiyle yerinde çizilir
- Hücreden çıkınca yazılan metin yerinde kalır; yan hücreye geçmek önceki taslağı silmez
- Açık yazı hücresinden başka bir hücreye tıklanınca geçilir; boş sayfaya tıklanınca hücre kapanır
- Metin alanları arasında geçiş yazı kutusunu kapatmadan olur. Kaydet tıklaması bu kapanışa bağlı değildir
- Metin düzenlerken başka bir yazı alanına geçilir. Kaydet ve Farklı kaydet tıklaması yazı alanı kapanırken kaybolmaz
- Metin taslağı menü değişince yerinde kalır. Kaydet ve Farklı kaydet bu taslağı dosyaya yazar
- Metin değişince güncel yazı yerinde kalır. Motora yazma ve ilerleme yalnızca Kaydet’te başlar
- Metin, ayrı bir kutu yerine seçilen yazının üzerinde değişir
- Kırpmada panoya kopyalama bitince kopyalandı uyarısı çıkar
- Kes paneli ve Düzen menüsü açıkken düğmeleri seçili görünür
- Şeritte Ekle, Sayfa, Dönüştür veya İmzala seçilince Metin, Şekil, Form ve İşaret seçimi kalkar
- Görüntüleme ve düzenlemede yorumlar sağ panelde listelenir. Belgedeki notlar açılınca görünür; yeni yorum ve işlemler de oraya düşer ve silinebilir
- Sayfa düzeni menüsü sürekli veya tek sayfa geçişi, saat yönü ve tersi döndürme, tek sayfa, çift sayfa, kapak ve tam ekran sunar. Kesme aracı seçilen alanı panoya kopyalar, indirir veya sayfayı o alana kırpar
- Farklı kaydet, belgeyi seçilen adla yazar. Sayfa, Dönüştür ve İmzala açılınca ve işlem sürerken seçili renkte kalır
- Şerit komutları ve açılan listeler ikonlu. Kaydet yanındaki Word kalktı. Dönüştürme sonucu kendi uzantısıyla gösterilir ve o adla kaydedilir
- Yorum ekranı: sayfaya tıklanınca not yazılır, listeden açılır ve Kaydet ile PDF notu olur
- Sayfa seçimi küçük resme tıklayınca da kutuya yazılır. Damga ve numara konumu sayfaya tıklayınca değişir. Kırpma alanı sayfada sürüklenir; sayılar durur
- Dönüştür, imzala, karart, OCR, damga, ek dosya ve sayfa işlemleri belgeyi kapatmaz. Seçenekler sayfanın yanında açılır; sonuç PDF ise aynı sekme yenilenir. Word ve Excel kayıt penceresine gider, PDF yerinde kalır
- Açık belgede komutlar şeritte durur: Metin, Ekle, Şekil, Form, İşaret, Dönüştür ve İmzala. Araç ara herhangi bir aracı belgenin üstünden açar. Dönüştürme, karartma veya imza belgeyi kapatmaz; Belgeye dön aynı sayfaya getirir
- Şekillerde Seç aracı var. Seçilen şeklin rengi ve biçimi şeritten değiştirilir
- Görüntüleyicide Şekiller sekmesi: dikdörtgen, elips, eğri, beşgen, bulut, çizgi, zikzak ve ok. Renk, geri al, yinele ve silgi var. Kaydet şekli PDF'e yazar
- Düzenlemede aynı satır iki kutu ve iki yazı olarak üst üste görünmez. Kutu, sayfadaki yazının üzerine oturur
- Sağ tık menüsünde vurgula, metin ekle, görsel ekle, kopyala ve yakınlaştırma var. Vurgula seçili yazıyı boyar; görsel dosya seçince sayfaya iner. Metin eklemede Uygula yazıyı sayfaya işler. Dönüştür araçları şeritte durur. Ctrl+tekerlek ve Ctrl+artı/eksi yakınlaştırır
- Açılan PDF’ler üstte yatay sekme olur. Yeni belge eskisini kapatmaz; sekmedeki artı başka belge açar
- Sayfa yakınlaştırma, sığdırma ve döndürme Görünüm dışında Düzenleme, Açıklama ve Formlar sekmelerinde de durur
- Düzenleme, yazısı olan sayfada OCR çalıştırmaz ve “düzenlenebilir metin yok” demez. Kesik alan tıklanınca yazının kendisi olur; başka yere tıklayınca yazılır
- Görüntüleyicide Görünüm, Düzenleme, Açıklama ve Formlar sekmeleri var. Düzenlemede sağda Metin Stilleri paneli, formlarda alan listesi durur
- Düzenleme, kesik çizgili alanları motoru bekletmeden gösterir. Belge bir kez hazırlanır; sonraki yazı değişimi aynı hazırlığı kullanır
- Görüntüleyicide Düzenleme menüsü, seçilince değiştirilebilir alanları kesik çizgiyle gösterir
- Düzenlemeden önce taranmış sayfa tanınır; yazı alanları kesik çizgiyle işaretlenir ve tıklanınca değiştirilir
- Metin ekleme kutusu sayfanın içinde kalır; Uygula tıklanınca yazı belgeye işlenir ve kutu kapanır
- PDF birleştirme ve sayfa keserek bölme qpdf ile yapılır; eksik jpdfium yüzünden işlem tamamlanamadı hatası kalkar
- Görsel ekleme, belgenin üstünü beyaz sayfayla kapatmaz; görsel seçilen noktaya biner ve yazı durur
- Web arayüzünde görsel ekleme önizlemesi tıklanacak sayfanın üstünde boş kutu bırakmaz
- Ayarlar sayfasında uygulama dili, Gezgin sağ tık menüsü ve ana sayfada üstte duran sık kullanılan araçlar seçilir
- Sağ tık menüsü uygulamanın dilinde yazılır. Ana sayfadaki belge yükleme alanı da seçilen dile uyar
- Metin değiştirme ve metin eklemede kalın, italik ve ikisi birlikte seçilir; seçim belgenin yazısına işlenir
- Metin değiştirme yalnızca seçilen satırı yazar; alttaki satır silinmez. Sığmayan satır, altta başka yazı varsa onun üzerine binmez
- Kurulum Office veya LibreOffice uyarısı göstermez. Araç ekranındaki açıklama durur
- Metin değiştirme ve metin ekleme, seçilen rengi belgenin yazısına işler. Uzun metin seçilen bloğun genişliğine göre satır kırar; alttaki paragraflar yerinde kalır
- PDF → Excel ve PDF → CSV, hizalı tabloda birleşik hücreyi ve aynı hücredeki alt satırı korur. Izgara yoksa motorun çıktısı kullanılır
- Office yokken kurulum ve Office, Word, PowerPoint araçları bunu açıkça söyler. Office belgesinden PDF, LibreOffice ile sürdürülebilir; PDF → Word için Word gerekir
- Üst çubuktan uygulama dili Türkçe veya English seçilir; seçim bu bilgisayarda hatırlanır
- Portföy, PDF sayfalarını Türkçe veya İngilizce bir kapağın ardına ekler. PDF olmayan dosyalar belgenin ekine konur
- Boş sayfa ve sayfa ekleme, eksik jpdfium bileşenine takılmadan qpdf ile birleştirilir
- Belge aç ekranında önerilen sürecin altında diğer araçlar kategorilere göre listelenir; açık PDF bir sonraki araca taşınır
- Metin değiştirmede ve metin eklemede yazı tipi (Helvetica, Times, Courier ve kalınları) ile punto seçilir; seçim belgenin yazısına işlenir
- Masaüstü menüsündeki her aracın yanında ikon var
- Metin değiştirme sırasında ilerleme çubuğu görünür; işlem bitince sayfa yeniden çizilir. Seçim kutusu yazıyla tam örtüşmezse aynı satırdaki yazı yine bulunur
- Damga konumu artık seçilen köşeye basılır (üst sol gerçekten üst soldur)
- Arka plan rengi yazıcı çıktısı yerine sade bir PDF ile yerleştirilir; görsel önce onarılıp bindirilir
- Kurulum paketi uygulama yoksa kurar, kuruluysa aynı klasörün üzerine yükseltir
- Masaüstüne Stirling'de olup bizde olmayan araçlar eklendi: içindekiler, ek ekleme ve çıkarma, portföy, otomatik adlandırma, renk değiştirme
- Metin değiştirme tabloda bütün sütunu tek parça sanıyordu; artık yalnızca seçilen satır veya hücre yazılıyor
- Metin değiştirme artık beyaz damga basmıyor; seçilen yazıyı Stirling metin düzenleyicisiyle belgenin metnine işliyor. Yorum kutusundaki yazı da aynı yolla değişiyor
- Masaüstü PDF motoru Stirling-PDF **3.1.0** (2.14.3 → 3.1.0; JPDFium karartma, otomatik sayfa döndürme, OCR yön düzeltme)
- Masaüstünde belge süreci: Döndür → OCR → Karart → İmzala; görüntüleyicide İşle şeridi
- Taranmış belgede yan/ters sayfalar otomatik düzeltilir (`auto-rotate-pdf`, OCR `rotatePages`)
- Stirling Sign, Office Convert beta, Processor/S3 ve PDF/UA alınmadı (çevrimdışı lisans ve mevcut kapsam)
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
- Windows uygulamasının OCR dillerine Arapça, Almanca, Fransızca, İspanyolca ve İtalyanca eklendi (`fetch-engine.ps1` yeniden çalıştırılmalı)
- Windows uygulaması dosyayı Windows Defender ile tarar; dosya karantinaya alınmaz, sonuç PDF rapor olur
- Windows uygulamasının virüs taraması `*/*` kabulünü yanlış uyguladığı için PDF'i reddediyordu; düzeltildi
- Windows uygulamasının açılışında "motor" yerine "ön gereksinimler hazırlanıyor" yazılır; pencere splash boyanıncaya kadar gizli kalır, WebView2 beyaz ekranı görünmez
- Windows uygulamasında kırpma önizlemede sürüklenerek seçilir; damga ve sayfa numarası konumu 3×3 ızgaradan, saydamlık ve açı kaydırıcıdan ayarlanır
- Windows uygulamasının filigran aracına QR kod eklendi; kod belgede tekrarlanır, internet gerekmez
- Windows uygulamasında karartma kutuları kelime kenarında boşluk bırakmayacak şekilde birleştirilir; görüntüleyicide vurgu rengi ve metin seçimi açılır
- Windows kurucusunun kaldırma kancası Gezgin menüsünün tüm uzantılarını siler; Tauri 2'nin dört NSIS kancası tanımlıdır
- Windows uygulaması ilk açılışta 15 günlük deneme lisansı başlatır; süre bitince araçlar kilitlenir, imzalı .lic ile açılır
- Windows uygulaması açılışta Belge aç ekranıyla PDF görüntüleyici olarak çalışır; birlikte aç, sürükle-bırak ve üst çubuk belgeyi görüntüleyiciye alır
- Görüntüleyicide seçilen metin üzerine yazılarak değiştirilir; PDF satırları kaymaz, uzun düzenleme Word'e dönüştürülür
- Görüntüleyicide metin değiştirme seçili satırı yerinde kapatır; yeni metin eski yazının üzerine binmez, damga olarak onun yerine yazılır
- Windows uygulaması GPO/SCCM ilkelerini okur (lisans dosyası, deneme kapatma, Gezgin menüsü, zaman damgası, kurum içi güncelleme)
- Windows kurucusu `/S /ALLUSERS` ve `SECURIPDF_LICENSE` ile sessiz kurulur; ADMX ve SCCM betikleri `clients/desktop/policy` ile `deploy` altındadır
- License Manager kurum lisansı üretir (`scope=organization`); tek `.lic` GPO ile tüm masaüstlerine dağıtılır
- Windows kurucusu MSI de üretir; GPO ile araç kapatılır (`BlockedTools`) ve AD grubu dışındaki kullanıcılar kilitlenir (`AllowedADGroups`)
- Windows görüntüleyicisinde yazdırma (Ctrl+P), form doldurma, görsel ekleyip taşıma ve metin değiştirmede yazı rengi / boyutu
- Windows uygulamasına sayfa ekleme, üst/alt bilgi, tam sayfa arka plan, görsel ekleme/kaldırma, PDF karşılaştırma, PDF→PowerPoint, PDF/X, PDF bilgisi ve erişilebilirlik raporu eklendi
- Birlikte açılan UNC dosyası görüntülenirken yazmaya kilitlenir; korumalı aç JavaScript ve ekleri kaldırır
- Dijital imza PAdES iddia etmez; erişilebilirlik raporu PDF/UA üretmez
- PDF görüntüleyici açık temalı düzenleme ekranı: üstte belge ve arama, Word tarzı şerit (sayfa, görünüm, işaretle, düzenle), solda sayfa listesi ve altta durum çubuğu; Ctrl+S kaydeder
- Office→PDF, Microsoft Office yoksa LibreOffice dener; zaman damgasına kurum TSA adresi yazılır; yerinde metin değiştirmede yazı tipi seçilir
- Görüntüleyicide seçilen paragraf yerinde kapatılıp blok içinde satır kaydırılarak yazılır; alttaki paragraflar ve sayfa düzeni kaymaz
- Görüntüleyicide Form ile sayfada sürükleyerek metin, onay kutusu veya liste (AcroForm) alanı eklenir; hesaplama ve JavaScript yazılmaz
- Masaüstü açılış, araç listesi ve lisans penceresi görüntüleyiciyle aynı açık temaya çekildi; Belge aç ekranı büyük bırakma alanı ve sık kullanılan kısayollar gösterir
- PDF/A ve PDF/X dönüşümü Ghostscript ile çalışır; her işleme sırasında altta ilerleme çubuğu görünür
- Windows kurucusu WebView2 Evergreen çevrimdışı paketini gömer; kurulum internet gerektirmez
- Başka bilgisayarda Java AOT önbelleği eski işlemcide çöküyordu; motor AOT olmadan yeniden açılır
- Lisans penceresinden .lic dosyası veya yapıştırılan metinle lisans güncellenir; kurulum kimliği kopyalanır
- PDF/UA, etiketli PDF ve erişilebilirlik denetimi kapsam dışıdır; erişilebilirlik raporu aracı kaldırıldı
- Masaüstü karartmaya web ile aynı desenler eklendi (VKN, pasaport, sabit telefon, posta kodu, adres)
- Ön gereksinim açılış ekranında Entera logosu gösterilir
- Damga, filigran, üst/alt bilgide yazı tipi (alfabe) seçilir; görüntüleyicide sistem yazı tipleri listelenir
- Ön gereksinim ekranında Entera logosu alta alındı; kurulum dosyası SecuriPDF simgesini taşır

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
