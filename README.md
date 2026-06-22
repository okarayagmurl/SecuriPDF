# SecuriPDF

Kurumsal müşterilere sunulabilecek, **SecuriPDF** markalı, Docker tabanlı PDF işlem platformu.

[Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) Community sürümünü temel alır; upstream güncellemelerini minimum maliyetle almak için **fork değil, ince sarmalayıcı katman** mimarisi kullanır.

**Mevcut sürüm:** `1.0.0-stirling-0.46.2`

## Özellikler (MVP)

| Kategori | Araçlar |
|----------|---------|
| Birleştirme / Bölme | Merge, Split |
| Optimizasyon | Compress, OCR |
| Dönüşüm | PDF↔Word, Image→PDF |
| Düzenleme | Rotate, Watermark |
| Güvenlik | Password Protect, Remove Password, Sign |

Araçlar `config/tools.yml` üzerinden yönetilir; gereksiz veya riskli araçlar kolayca kapatılabilir.

## Mimari

```
SecuriPDF/
├── branding/          # Logo, CSS, Stirling template override
├── config/            # settings, tools, security, vault, license
├── services/platform/ # Vault, Admin, License, Orchestration API
├── docker/            # Compose, Keycloak tema, bootstrap scriptleri
├── scripts/           # backup, restore, update, healthcheck
└── docs/              # Kurulum ve mimari
```

Detaylı mimari: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Hızlı Başlangıç (Auth stack — önerilen)

```powershell
copy docker\.env.example docker\.env
# .env: LDAP_BIND_PASSWORD, OAUTH2_CLIENT_SECRET doldurun
./scripts/sync-tools-config.sh
cd docker
.\up-auth.ps1
.\test-stack.ps1
```

Tarayıcı: **http://localhost:8080** · Admin: **http://localhost:8080/admin**

Geliştirme (auth kapalı): `docker compose -f docker-compose.yml -f docker-compose.direct.yml up -d`

## Kurulum

| Ortam | Dokümantasyon |
|-------|----------------|
| **Ubuntu (sıfırdan, Docker)** | [docs/INSTALL-UBUNTU.md](docs/INSTALL-UBUNTU.md) |
| **Kapalı ağ (offline)** | [docs/OFFLINE-INSTALL.md](docs/OFFLINE-INSTALL.md) |
| **Kurulum sihirbazı** | [installer/README.md](installer/README.md) |
| Windows / genel | [docs/INSTALL.md](docs/INSTALL.md) |

- Docker 24+ ve Compose v2
- Minimum 4 GB RAM
- Fat image (OCR + LibreOffice dahil)

## Güncelleme

```bash
# docker/.env içinde STIRLING_VERSION ve IMAGE_TAG güncelleyin
./scripts/update.sh
```

Fork modeli için:

```bash
./upstream-sync.sh
```

Bkz. [docs/UPDATE.md](docs/UPDATE.md)

## Yedekleme

```bash
./scripts/backup.sh
./scripts/restore.sh backups/YYYYMMDD_HHMMSS
```

Bkz. [docs/BACKUP.md](docs/BACKUP.md) · Prod operasyonları: [docs/PROD-OPS.md](docs/PROD-OPS.md)

## Geri Dönüş (Rollback)

```bash
./scripts/rollback.sh
```

`update.sh` her güncellemede otomatik rollback etiketi oluşturur.

## Versiyonlama

Format: `entera-pdf:<ENTERA>-stirling-<STIRLING>`

```
entera-pdf:1.0.0-stirling-0.46.2
```

- `ENTERA_VERSION` — Entera ürün sürümü
- `STIRLING_VERSION` — Upstream Stirling-PDF sürümü

## Branding

Core frontend dosyaları değiştirilmez:

| Öğe | Yöntem |
|-----|--------|
| Ürün adı | `UI_APPNAME`, `UI_APPNAMENAVBAR` env |
| Logo | `branding/static/classic-logo/` override |
| Favicon | `branding/static/favicon.svg` |
| Renkler | `branding/custom.css` |
| Footer | CSS override veya template (opsiyonel) |

## Kimlik Doğrulama

**Prod (varsayılan):** Keycloak + Active Directory + oauth2-proxy. Stirling login **kapalı** kalır.

| Bileşen | Rol |
|---------|-----|
| Keycloak | LDAP federation, roller (`pdf-user`, `pdf-admin`) |
| oauth2-proxy | SSO kapısı (`8080`) |
| Platform servisi | Vault, Admin UI, License |

Başlatma: `docker/up-auth.ps1` · Detay: [docs/AUTH-ARCHITECTURE.md](docs/AUTH-ARCHITECTURE.md) · [docs/PHASES.md](docs/PHASES.md)

## Docker Servisleri (auth stack)

| Container | Rol |
|-----------|-----|
| `entera-pdf` | Stirling-PDF fat image |
| `entera-nginx` | Reverse proxy (Stirling + Platform API) |
| `securipdf-oauth2-proxy` | SSO giriş kapısı |
| `securipdf-keycloak` | Kimlik sağlayıcı |
| `securipdf-postgres` | Keycloak veritabanı |
| `securipdf-platform` | Vault / Admin / License API |

Kalıcı volume'lar: `entera_*`, `securipdf_postgres`, `securipdf_vault_data`

## Araç Yapılandırması

1. `config/tools.yml` — aktif araç listesi (whitelist)
2. `./scripts/sync-tools-config.sh` — `settings.yml` güncelle
3. `docker compose restart entera-pdf`

## Upstream Stratejisi

```bash
git remote add upstream https://github.com/Stirling-Tools/Stirling-PDF.git
git fetch upstream
git checkout entera-custom
git merge upstream/main
```

Conflict azaltma: branding, config ve docker klasörleri ayrı tutulur.

**Önerilen model:** Bu repo yalnızca custom katmanı içerir; Stirling kaynak kodu fork'lanmaz. Güncelleme = yeni upstream Docker image tag'i.

## Sorun Giderme

Bkz. [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Lisans

- Entera custom katman: Kurumsal lisans (belirlenmeli)
- Stirling-PDF: [Upstream lisansı](https://github.com/Stirling-Tools/Stirling-PDF/blob/main/LICENSE)
