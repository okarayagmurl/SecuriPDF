# Prod Operasyonları ve Yedekleme

## Admin UI — Operasyon sekmesi

**URL:** http://localhost:8080/admin → **Operasyon**

| Bölüm | Ne yapar |
|-------|----------|
| Sistem durumu | Belge sayısı, disk, yedek özeti |
| Prod hazırlık | Kritik/uyarı maddeleri (anahtar, OAuth2, LDAP, yedek yaşı) |
| Prod / yedek ayarları | Ortam (dev/staging/prod), yedek saklama süresi |
| Vault yedekleme | Tek tıkla yedek al, listele, indir, sil |
| Geri yükleme | Vault metadata + `.enc` dosyalarını geri yükle |
| Bakım | Soft-delete temizliği |

Vault yedekleri `/vault-data/backups/` altında saklanır (Docker volume: `securipdf_vault_data`).

## Vault yedek içeriği

```
backups/YYYYMMDD_HHMMSS/
├── manifest.json
├── metadata.db
├── config/              # admin-settings.yml, tools.override.yml
├── documents.tar.gz     # *.enc belgeler
├── signatures.tar.gz
└── certificates.tar.gz
```

İndirilebilir arşiv: `backups/YYYYMMDD_HHMMSS.tar.gz`

## Tam stack yedek (sunucu)

Admin UI yalnızca **Vault** verisini yönetir. Keycloak, Stirling volume ve `.env` için:

```bash
./scripts/backup.sh
```

```powershell
cd docker
.\backup-keycloak.ps1 ..\backups\manual-export
.\apply-prod-hardening.ps1 -Force
.\deploy-prod.ps1 -Force
```

Bkz. [BACKUP.md](BACKUP.md)

## Prod geçiş checklist

1. Admin → Operasyon → **Prod hazırlık** — tüm kritik maddeler yeşil
2. `.env`: `VAULT_MASTER_KEY`, `OAUTH2_*`, `KEYCLOAK_*` güçlü değerler
3. `apply-prod-hardening.ps1` — IP whitelist prod, OAuth2 sertleştirme
4. TLS: `generate-tls.ps1` veya kurumsal sertifika
5. Admin → Operasyon → **Yedek al** (Vault)
6. `./scripts/backup.sh` (tam stack)
7. Ortamı **prod** olarak işaretle (Admin → Operasyon)
8. `deploy-prod.ps1 -Force`

## Geri yükleme sonrası

Vault geri yüklemeden sonra platform servisini yeniden başlatın:

```powershell
docker compose restart securipdf-platform
```

Tam stack geri yükleme: `./scripts/restore.sh backups/YYYYMMDD_HHMMSS`
