# Güncelleme

## Versiyon Formatı

```
entera-pdf:<ENTERA_VERSION>-stirling-<STIRLING_VERSION>
```

Örnek: `entera-pdf:1.0.0-stirling-0.46.2`

## Otomatik Güncelleme

```bash
# 1. Yeni Stirling sürümünü .env'de güncelleyin
#    STIRLING_VERSION=0.47.0
#    IMAGE_TAG=1.1.0-stirling-0.47.0

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
