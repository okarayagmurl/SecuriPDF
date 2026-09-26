# SecuriPDF ürün broşürü — içerik taslağı

Hedef: 2 sayfa (A4) veya tek katlanır broşür. Marka: Entera / SecuriPDF. Offline-first, kurumsal PDF.

## Sayfa 1 — Kapak / değer önerisi

- **Ürün adı:** SecuriPDF (hero düzeyinde)
- **Tek cümle:** Kurum içi, offline çalışabilen PDF işlem ve arşiv platformu
- **3 madde (kısa):**
  - 70+ PDF aracı (birleştir, böl, OCR, imza, redaksiyon…)
  - Active Directory / Keycloak ile kurumsal giriş
  - Yerel disk, SMB paylaşım veya S3 — veriniz sizin ağınızda
- **Görsel fikri:** Admin + kullanıcı arayüzü ekran görüntüsü (veya PDF → güvenli arşiv diyagramı)

## Sayfa 2 — Paketler ve kurulum

| | Demo | Başlangıç | Profesyonel | Kurumsal |
|---|------|-----------|-------------|---------|
| Süre | 30 gün | Sözleşme | Sözleşme | Sözleşme |
| Kullanıcı | 5 | 25 | 150 | 500 |
| Lisans | Admin’den demo | Entera `.lic` | Entera `.lic` | Entera `.lic` |

- **Lisans:** Müşteri web’den talep (`.req`) → Entera License Manager → `.lic` yükleme
- **Kurulum:** tek sunucu, Docker, kurulum sihirbazı
- **Güncelleme:** offline `.tar.gz`
- **CTA:** demo / teklif iletişimi

## Vurgulanacak farklılaştırıcılar

1. İnternet zorunlu değil (air-gap uyumlu güncelleme)
2. SMB’ye uygulama bağlanır — host’ta ayrı mount zorunluluğu yok
3. Araç erişim profilleri (ör. muhasebe vs tarama)
4. Vault kota + soft-delete + denetim izi

## Üretim notu

Bu dosya içerik iskeleti; grafik tasarım / baskı ayrı iş. Metin onaylandıktan sonra Canva/InDesign veya ajansa verilir.
