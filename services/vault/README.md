# SecuriPDF Vault

Kullanıcı bazlı belge arşivi, görsel imza ve sertifika deposu.

**Durum:** Uygulandı — `services/platform` (Vault API modülü)

## Çalıştırma

Auth stack ile birlikte:

```powershell
cd docker
.\up-auth.ps1
```

API tabanı: `http://localhost:8080/api/vault/v1`

## Dokümantasyon

- [VAULT-API.md](../docs/VAULT-API.md)
- [AUTH-ARCHITECTURE.md](../docs/AUTH-ARCHITECTURE.md)
- [config/vault.yml](../config/vault.yml)

## Sorumluluklar

- Kalıcı PDF arşivi (varsayılan 1 GB/kullanıcı)
- Görsel imza ve sertifika (AES-256-GCM encrypted at rest)
- Admin kota yönetimi (`/admin`)
- Audit log

Stirling-PDF login veya `storage.enabled` **kullanılmaz**.
