# Mimari

## Genel Bakış

# SecuriPDF, **minimum fork maliyeti** ile Stirling-PDF MIT core üzerine inşa edilmiş kurumsal bir PDF platformudur.

```
┌─────────────────────────────────────────────────────────────┐
│  Nginx — TLS · IP whitelist · Upload limits · Timeouts      │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  oauth2-proxy + Keycloak ← Active Directory (LDAP)          │
└─────────────┬─────────────────────────────┬─────────────────┘
              │                             │
┌─────────────▼─────────────┐   ┌───────────▼─────────────────┐
│  Stirling-PDF (MIT core)  │   │  SecuriPDF Vault (planlı)   │
│  login KAPALI             │   │  belge · imza · sertifika   │
└───────────────────────────┘   └─────────────────────────────┘
              │
        ┌─────┴─────┬─────────────┐
   Branding     Config        Docker
```

Detay: [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md)

## Katmanlar

### Upstream (Değiştirilmez)

- **Stirling-PDF** — PDF engine, UI, API
- Resmi Docker image: `stirling-pdf:*-fat`
- Güncellemeler upstream image tag değişikliği ile alınır

### Custom Katman (Entera)

| Klasör | Sorumluluk |
|--------|------------|
| `branding/` | Logo, favicon, CSS override |
| `config/` | settings.yml, tools.yml, security.yml |
| `docker/` | Compose, Dockerfile, Nginx |
| `scripts/` | Operasyon scriptleri |
| `docs/` | Kurumsal dokümantasyon |

## Fork Modeli

```
Upstream:  Stirling-Tools/Stirling-PDF (main)
Fork:      Entera-PDF (entera-custom branch)
Custom:    branding/ + config/ + docker/ (conflict-free)
```

İki deployment modeli desteklenir:

1. **Custom-only (önerilen):** Bu repo — Stirling kaynak kodu yok, sadece Docker image
2. **Full fork:** Stirling fork + `entera-custom` branch merge

## Kimlik Doğrulama

**MVP:** Authentication disabled (geliştirme).

**Prod hedef (Seçenek B):** Kimlik Stirling dışında — Keycloak + AD + oauth2-proxy. Stirling login **açılmaz** (proprietary lisans). Kişisel belge/imza **SecuriPDF Vault**.

| Bileşen | Sorumluluk |
|---------|------------|
| Active Directory | Kullanıcı, grup (User / Admin) |
| Keycloak | LDAP federation, roller, ileride MFA |
| oauth2-proxy | Intranet SSO kapısı |
| SecuriPDF Vault | Arşiv, imza, sertifika, kota, şifreleme |
| Stirling-PDF | PDF motoru (MIT, login kapalı) |

Tam dokümantasyon: [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) · AD kurulum: [AD-KEYCLOAK-SETUP.md](AD-KEYCLOAK-SETUP.md)

`config/security.yml`, `config/vault.yml` — yapılandırma şablonları.

## Volume Yapısı

| Volume | Mount | Amaç |
|--------|-------|------|
| `entera_data` | `/usr/share/tesseract-ocr/5/tessdata` | OCR dil paketleri |
| `entera_config` | `/configs` | Runtime ayarlar |
| `entera_logs` | `/logs` | Loglar |
| `entera_pipeline` | `/pipeline` | Otomasyon |
| `entera_uploads` | `/uploads` | Kalıcı yüklemeler |
| `entera_backups` | — | Yedek depolama (gelecek) |

## Araç Yönetimi

`config/tools.yml` → whitelist yaklaşımı

`scripts/sync-tools-config.sh` → `config/settings.yml` endpoints.toRemove üretir

Stirling endpoint referansı: [docs.stirlingpdf.com](https://docs.stirlingpdf.com/Configuration/Endpoint%20or%20Feature%20Customisation)

## Versiyonlama

```
entera-pdf:1.1.0-stirling-2.13.1
           │       │         └── Upstream Stirling sürümü
           │       └── Entera sürümü
           └── Image adı
```

## Gelecek Servisler

`docker-compose.auth.yml` — Keycloak + oauth2-proxy PoC şablonu.

Planlanan:

- Keycloak + PostgreSQL (AD federation)
- oauth2-proxy
- SecuriPDF Vault (Faz 3)
- License service (Faz 6)
