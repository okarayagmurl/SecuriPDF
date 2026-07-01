# Güncelleme

## Versiyon Formatı

```
entera-pdf:<ENTERA_VERSION>-stirling-<STIRLING_VERSION>
```

Örnek: `entera-pdf:1.1.0-stirling-2.13.1`

## Admin — Sürüm ve staging (Faz 1)

**Admin → Operasyon → Sistem sürümü ve güncelleme**

| API | Açıklama |
|-----|----------|
| `GET /api/vault/v1/admin/ops/version` | Kurulu sürüm, image tag, FQDN |
| `GET /api/vault/v1/admin/ops/upgrade/available` | Staging paket vs kurulu |
| `PUT /api/vault/v1/admin/ops/upgrade/staging` | Staging `MANIFEST.json` kaydet |

Staging manifest yolu (vault volume): `/vault-data/upgrades/staging/manifest.json`

```bash
# Yeni paket MANIFEST'ini staging'e kopyala
docker cp MANIFEST.json securipdf-platform:/vault-data/upgrades/staging/manifest.json

# Güncelleme uygula (CLI — Faz 2'de Admin'den tetiklenecek)
cd ~/securipdf-*-offline && sudo bash scripts/upgrade-offline-stack.sh
```

Offline paket `MANIFEST.json` alanları: `version`, `min_upgrade_from`, `upgrade_from`, `changelog`, `platform_ui`, `oauth2_proxy`.

## Stirling 0.46 → 2.x (V1 → V2)

Büyük sürüm atlaması. Önce yedek alın, staging'de deneyin.

| Alan | V1 (0.46.x) | V2 (2.13.x) |
|------|-------------|-------------|
| Image tag | `0.46.2-fat` | `2.13.1-fat` |
| Ana sayfa şablonu | `branding/templates/` | React (şablon override yok) |
| Logo / CSS | `branding/static/` | Aynı |
| `ui.appName` | settings.yml | Kaldırıldı → `appNameNavbar` |
| Metin düzenleyici | Yok | `text-editor-pdf` |

**V1 config volume:** Eski `entera_config` (H2 veritabanı) ile V2 bazen `InitialSecuritySetup` hatası verir. Yükseltmeden önce yedek alın; gerekirse volume sıfırlayın:

```bash
cd docker
docker compose stop entera-pdf
docker volume rm entera-pdf_entera_config   # veya yedekten geri yükleme
docker compose up -d entera-pdf
```

Resmi rehber: https://docs.stirlingpdf.com/Migration/Breaking-Changes/

## Otomatik Güncelleme

```bash
# 1. Yeni Stirling sürümünü .env'de güncelleyin
#    STIRLING_VERSION=2.14.0
#    IMAGE_TAG=1.2.0-stirling-2.14.0

# 2. VERSION dosyasını güncelleyin
echo "1.1.0-stirling-0.47.0" > VERSION

# 3. Güncelleme scriptini çalıştırın
./scripts/update.sh
```

`update.sh` şunları yapar:

1. Mevcut image'a rollback etiketi ekler
2. `tools.yml` → `settings.yml` senkronizasyonu
3. Yeni image derleme
4. `docker compose up -d`
5. Healthcheck doğrulaması

## Upstream Merge (Fork Modeli)

Stirling-PDF kaynak kodunu fork'ladıysanız:

```bash
./upstream-sync.sh
```

Bu script:

```bash
git remote add upstream https://github.com/Stirling-Tools/Stirling-PDF.git
git fetch upstream
git checkout entera-custom
git merge upstream/main
```

Conflict azaltma stratejisi:

- `branding/` — sadece Entera dosyaları
- `config/` — sadece Entera yapılandırması
- `docker/` — sadece Entera Docker katmanı
- Stirling core dosyalarında upstream değişikliklerini kabul edin

## Custom-Only Repo (Önerilen)

Bu repoda Stirling kaynak kodu yoktur. Güncelleme = yeni upstream Docker image sürümüne geçiş.

1. Stirling release notlarını kontrol edin
2. `STIRLING_VERSION` güncelleyin
3. `./scripts/update.sh` çalıştırın
4. Endpoint ID değişikliklerini `scripts/sync-tools-config.sh` içinde güncelleyin

## Rollback

Güncelleme başarısız olursa:

```bash
./scripts/rollback.sh
```

Bkz. [BACKUP.md](BACKUP.md)
