# Branding Klasörü

Stirling-PDF core dosyalarına dokunmadan markalama yapılır.

## Dizin Yapısı

```
branding/
├── custom.css              # Kaynak CSS (düzenleme için)
├── custom-theme.css        # Tema değişkenleri
├── logo.png                # Opsiyonel: PNG logo kaynağı
├── favicon.ico             # Opsiyonel: ICO favicon kaynağı
└── static/                 # /customFiles mount noktası
    ├── favicon.svg
    ├── classic-logo/
    │   ├── StirlingPDFLogoBlackText.svg
    │   └── StirlingPDFLogoWhiteText.svg
    └── css/
        ├── entera-custom.css
        └── entera-theme.css
```

## Branding (Stirling referanslarını gizleme)

Fork modelinde upstream markalama `branding/` katmanından kaldırılır:

- `templates/fragments/` — footer, navbar, home override
- `static/css/entera-branding.css` — kalan UI öğeleri
- `config/custom_settings.yml` — legal, analytics, premium kapalı

Upstream güncellemesinde template dosyalarını diff ile kontrol edin.


## Logo ve favicon (önemli)

Stirling yalnızca **belirli dosya adlarını** okur. Yeni dosyaları `securipdf-*` adıyla koymak yetmez; aşağıdaki hedefe kopyalanmalıdır:

| Görünen yer | Hedef dosya (zorunlu ad) | Kaynak (örnek) |
|-------------|--------------------------|----------------|
| Navbar ikon | `static/classic-logo/securipdf-icon.svg` | `securipdf-brand-assets/securipdf-icon.svg` |
| Tam logo (classic) | `static/classic-logo/StirlingPDFLogoBlackText.svg` | `securipdf-logo.svg` |
| Tam logo koyu tema | `static/classic-logo/StirlingPDFLogoWhiteText.svg` | `securipdf-logo-white.svg` |
| **Keycloak login** | `docker/keycloak/themes/.../img/logo.svg` | `apply-keycloak-theme.ps1` ile senkron |
| Sekme favicon | `static/favicon.svg` | `securipdf-favicon.svg` |
| Sekme PNG | `static/favicon-32x32.png`, `static/favicon-16x16.png` | `securipdf-favicon-*.png` |
| Sekme ICO | `static/favicon.ico` | `securipdf-favicon.ico` |

Logo güncelledikten sonra:

1. Dosyaları yukarıdaki **hedef adlarla** kopyalayın
2. `docker compose restart entera-pdf` (navbar şablonu için)
3. Tarayıcıda **Ctrl+F5** (favicon önbelleği)

`UI_LOGOSTYLE=classic` olduğundan emin olun (`docker/.env`).

## Logo (eski not)

1. `UI_LOGOSTYLE=classic` olduğundan emin olun (`docker/.env`)
2. Logoları `static/classic-logo/` altına aynı dosya adlarıyla koyun
3. Container'ı restart edin

## Favicon

`static/favicon.svg` dosyasını değiştirin.

## CSS Override

`custom.css` dosyasını düzenleyin. Logo ve ürün adı env değişkenleri MVP'de doğrudan çalışır.

## Ürün Adı

`docker/.env` içinde `UI_APPNAME`, `UI_APPNAMENAVBAR`, `UI_HOMEDESCRIPTION`.
