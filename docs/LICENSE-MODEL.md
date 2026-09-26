# SecuriPDF lisans modeli

## Akış (müşteri bazlı)

```
Musteri Admin                     Entera License Manager (exe)
     |                                      |
     | 1) Kurulum ID olusur                 |
     | 2) .req talep indir  --------------->| 3) Musteri kaydet
     |                                      | 4) issue(.req) → .lic
     | 5) .lic yukle <----------------------|
     |    (installation_id kilitli)         |
```

**Demo:** Admin → «30 günlük demo başlat» — imza yok, `license_type=demo`, süre dolunca araçlar kapanır; ticari `.lic` gerekir.

## Roller

| Rol | Araç | Ne yapar |
|-----|------|----------|
| Entera | `SecuriPDF-LicenseManager.exe` | Müşteri kaydı, `.req` → `.lic`, doğrulama |
| Müşteri admin | Admin → Lisans | Talep (.req), demo, `.lic` yükleme |
| Platform | `LicenseService` | Araç + oturum limitleri; imza + kurulum kimliği |

## Dosyalar

- **`.req`** — imzasız talep: `installation_id`, şirket, istenen paket, iletişim
- **`.lic`** — Ed25519 imzalı: paket, limitler, `installation_id`, `customer_id`, `request_id`

## Paketler

`demo` · `starter` · `professional` · `enterprise` — `config/license-packages.yml`

## Broşür

[BROCHURE-OUTLINE.md](BROCHURE-OUTLINE.md)
