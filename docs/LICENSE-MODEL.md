# SecuriPDF lisans modeli

## Roller

| Rol | Araç | Ne yapar |
|-----|------|----------|
| Entera (satış/ops) | `SecuriPDF-LicenseManager.exe` | Paket seçer, müşteri + bitiş tarihi ile imzalı `.lic` üretir; doğrular |
| Müşteri admin | Admin → Lisans | `.lic` yükler / anahtar girer; paket ve araçları görür |
| Platform | `LicenseService` | Araç erişimi + oturum limitlerini uygular |

## Paketler (`config/license-packages.yml`)

- **starter** — temel birleştirme/bölme/dönüşüm
- **professional** — geniş dönüşüm + güvenlik
- **enterprise** — tüm whitelist araçları

## Dosya formatı (`.lic`)

Ed25519 imzalı JSON:

```json
{
  "v": 1,
  "payload": {
    "product": "SecuriPDF",
    "package": "professional",
    "customer": "Musteri A.S.",
    "license_key": "SPDF-...",
    "issued_at": "2026-09-26T10:00:00Z",
    "expires_at": "2027-12-31T23:59:59Z",
    "limits": { "max_users": 150, "max_concurrent_sessions": 30 },
    "apply_package_limits": true
  },
  "sig": "<base64>"
}
```

Private key yalnızca Entera’da; public key platform image içinde.

## Akış

1. Ops: `SecuriPDF-LicenseManager generate -p professional -c "..." -e 2027-12-31 -o musteri.lic`
2. Müşteri: Admin → Lisans dosyası yapıştır/yükle → etkinleştir
3. Platform imzayı doğrular, `admin-settings` override’a yazar

## Broşür

İçerik taslağı: [BROCHURE-OUTLINE.md](BROCHURE-OUTLINE.md)
