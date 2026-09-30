# Changelog

## 1.2.6-stirling-2.14.3 (2026-10-01)

- Yönetim panelinden CA talep dosyası indirilir; dönen sertifika uygulama (443) ve Keycloak (8443) için etkinleştirilir
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
