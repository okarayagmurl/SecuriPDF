# Yedekleme ve Geri Yükleme

## İki katman

| Katman | Kapsam | Nasıl |
|--------|--------|-------|
| **Admin UI (Vault)** | Belgeler, imzalar, sertifikalar, metadata.db, admin ayarları | http://localhost:8080/admin → Operasyon |
| **Sunucu scripti** | Keycloak Postgres, Stirling volume, config, .env | `./scripts/backup.sh` |

Detaylı prod rehberi: [PROD-OPS.md](PROD-OPS.md)

## Admin UI ile Vault yedekleme

1. `/admin` → **Operasyon** sekmesi
2. **Yedek al** — anlık Vault yedeği oluşturur
3. **Indir** — `.tar.gz` indirir
4. **Geri yukle** — kimliği onaylayarak geri yükler (platform restart önerilir)

Yedekler: Docker volume `securipdf_vault_data` → `/vault-data/backups/`

## Yedeklenen Bileşenler (tam stack script)

| Bileşen | İçerik |
|---------|--------|
| `config.tar.gz` | config/, branding/, VERSION |
| `volume_config.tar.gz` | Stirling settings ve runtime config |
| `volume_data.tar.gz` | OCR tessdata |
| `volume_logs.tar.gz` | Uygulama logları |
| `volume_uploads.tar.gz` | Yüklenen dosyalar |
| `volume_pipeline.tar.gz` | Otomasyon pipeline'ları |
| `volume_keycloak_postgres.tar.gz` | Keycloak realm/DB (auth stack) |
| `volume_vault_data.tar.gz` | Vault belge/imza/sertifika + metadata |
| `keycloak-realm-export/` | Realm JSON export (auth stack aktifse) |
| `.env` | Ortam değişkenleri |
| `images.txt` | Aktif image bilgisi |

## Yedekleme

```bash
./scripts/backup.sh
```

Windows (Keycloak export dahil):

```powershell
cd docker
.\backup-keycloak.ps1 ..\backups\manual-export
```

Yedekler `backups/YYYYMMDD_HHMMSS/` altına kaydedilir.

Varsayılan saklama süresi: 30 gün (`BACKUP_RETENTION_DAYS`)

## Geri Yükleme

```bash
# Auth stack dahil ( .env yedeğinde OAUTH2 varsa otomatik algilanir )
RESTORE_SKIP_CONFIRM=1 AUTH_STACK=1 ./scripts/restore.sh backups/20250619_020000
```

Script:

1. Config dosyalarını geri yükler
2. Stirling + auth volume'larını geri yükler
3. Auth stack veya direct modda servisleri başlatır
4. Healthcheck çalıştırır
5. (Auth) Keycloak bootstrap dener

## Rollback

Image rollback için bkz. [UPDATE.md](UPDATE.md) — `./scripts/rollback.sh`
