# SecuriPDF — Faz 1–6 + Prod Operasyonları

## Başlatma (dev / test)

```powershell
cd docker
.\up-auth.ps1
.\test-stack.ps1
```

## Faz durumu

| Faz | Bileşen | Durum |
|-----|---------|-------|
| 1 | TLS + IP whitelist | Dev: oauth2:8080; prod: nginx:443 → oauth2 → nginx:8080 |
| 2 | Auth stack | `bootstrap-keycloak-realm.ps1`, AD grup→rol |
| 3 | Vault API | `services/platform` |
| 4 | Orchestration | `vault-archive.js`, `vault-signatures.js` |
| 5 | Admin UI | `/admin` — kota, LDAP test, araç override, audit, **operasyon/yedek**, **genel bakış**, **lisans/profil** |
| 6 | License | `config/license.yml` + paketler — **tamamlandı** (profil tabanlı araç erişimi) |
| 7 | **Kullanıcı UI** | `/` — SecuriPDF arayüzü; Stirling yalnızca `/api/pdf` proxy |
| 8 | **Admin Faz 8** | Genel bakış, audit tablosu/CSV, kota listesi — **devam ediyor** |
| 9 | **Upgrade Faz 1** | Admin Operasyon: kurulu sürüm, staging MANIFEST, CLI upgrade yolu — **tamamlandı** |
| 10 | **Upgrade Faz 2** | Host updater agent + Admin tek tık güncelleme — **planlandı** |

**Ubuntu sıfırdan kurulum:** [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md)

## Post-faz: Prod operasyonları

| Görev | Script |
|-------|--------|
| AD LDAP + grup mapper | `.\fix-keycloak-ldap.ps1` |
| AD grup → rol (`pdf-user` / `pdf-admin`) | `.\map-ad-group-roles.ps1` |
| Prod deploy (TLS edge) | `.\deploy-prod.ps1 -Force` |
| Keycloak yedek | `.\backup-keycloak.ps1` |
| Tam yedek | `..\scripts\backup.sh` |

### Prod stack

```powershell
.\deploy-prod.ps1 -Force
# veya adim adim:
.\apply-prod-hardening.ps1 -Force
docker compose -f docker-compose.yml -f docker-compose.auth.yml -f docker-compose.prod.yml up -d
```

Prod akisi: **HTTPS (443) → nginx → oauth2-proxy → nginx:8080 (ic) → Stirling/Platform**

## URL'ler

| URL | Açıklama |
|-----|----------|
| http://localhost:8080 | Ana giriş |
| http://localhost:8080/admin | Admin (`pdf-admin`) |
| http://localhost:8090 | Keycloak admin |

## Roller

| AD grubu | Keycloak rolü | Yetki |
|----------|---------------|-------|
| SecuriPDF-Users | pdf-user | PDF + Vault |
| SecuriPDF-Admins | pdf-admin | + Admin UI |
