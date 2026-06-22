# Kimlik Doğrulama ve Kullanıcı Yönetimi

SecuriPDF ticari mimarisi: **kimlik ve kişisel veri Stirling dışında**, PDF işleme Stirling MIT core üzerinde.

## Temel ilke

| Karar | Gerekçe |
|-------|---------|
| Stirling login **kapalı kalır** | Login/security `app/proprietary/` altında; prod/ticari kullanım Stirling User License gerektirir |
| Kimlik **Keycloak + Active Directory** | LDAP doğrudan Stirling’de yok; AD kurumsal standart |
| Kişisel belge/imza **SecuriPDF Vault** | 1 GB kota, şifreleme, kullanıcı izolasyonu — bizim lisans modelimiz |
| Erişim **intranet** | TLS (iç CA) + IP whitelist |

```
Kullanıcı
   │
   ▼
Nginx (TLS, IP, upload limit)
   │
   ▼
oauth2-proxy (oturum)
   │
   ├──► Keycloak ◄── LDAP/Active Directory
   │
   ├──► SecuriPDF Vault (belge, imza, sertifika)
   │
   └──► Stirling-PDF (login KAPALI — PDF motoru, MIT core)
```

## Roller

| Rol | AD grubu (örnek) | Keycloak rol | Yetkiler |
|-----|------------------|--------------|----------|
| **User** | `SecuriPDF-Users` | `pdf-user` | PDF araçları, kendi vault verisi |
| **Admin** | `SecuriPDF-Admins` | `pdf-admin` | User + kota yönetimi, audit, sistem config |

## Yerel admin hesabı (break-glass)

**Evet, yapılabilir** — ama **Stirling local admin değil** (proprietary lisans).

| Katman | Yerel admin | Amaç |
|--------|-------------|------|
| **Keycloak** | Realm içi kullanıcı (AD dışı) | AD kapalıyken giriş; ilk kurulum |
| **SecuriPDF Admin** (Faz 5) | Bootstrap + arayüz | Kota, LDAP ayarları, araç listesi |
| **Stirling** | ❌ Kullanılmaz | `SECURITY_ENABLELOGIN=false` kalır |

### Önerilen model

1. **Break-glass admin (Keycloak)**
   - Realm `securipdf` içinde AD’den gelmeyen kullanıcı: örn. `securipdf-local-admin`
   - Rol: `pdf-admin`
   - AD federation `READ_ONLY`; bu kullanıcı yalnızca Keycloak’ta tanımlı
   - AD erişilemezken acil giriş için; prod’da güçlü parola + erişim kısıtı (IP)

2. **Keycloak master admin**
   - Container kurulumu: `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` (`.env`)
   - Sadece Keycloak yönetimi; SecuriPDF uygulamasına doğrudan admin yetkisi vermez

3. **SecuriPDF Admin UI** (`/admin`, Faz 5 — uygulandi)
   - `pdf-admin` rolü zorunlu (oauth2-proxy header → Platform)
   - Kota yönetimi, LDAP TCP testi, araç override (`tools.override.yml`), audit log
   - LDAP tam sync: `docker/fix-keycloak-ldap.ps1` veya Keycloak UI
   - Lisans durumu okuma Faz 6 kapsaminda (henuz genisletilmedi)

```
Normal akış:     AD kullanıcısı → Keycloak → pdf-admin → Admin UI
Break-glass:     securipdf-local-admin (Keycloak) → pdf-admin → Admin UI
Stirling admin:  KULLANILMAZ
```

Detay: `docs/AD-KEYCLOAK-SETUP.md` — "Yerel break-glass admin" bölümü


```yaml
# docker/.env — ticari dağıtımda ASLA true yapmayın
DOCKER_ENABLE_SECURITY=false
SECURITY_ENABLELOGIN=false
```

Stirling `/customFiles/signatures/{user}/` prod planda **kullanılmaz**; imza ve sertifikalar Vault’ta tutulur.

## SecuriPDF Vault

Kalıcı kullanıcı verisi:

| Tür | Yol (mantıksal) | Varsayılan kota |
|-----|-----------------|-----------------|
| Belgeler | `documents/{userId}/` | 1 GB/kullanıcı |
| Görsel imza | `signatures/{userId}/` | Vault kotası içinde |
| Sertifika | `certificates/{userId}/` | Vault kotası içinde |

- **Encrypted at rest:** volume encryption + uygulama katmanı (sertifikalar zorunlu)
- **Admin kota:** `config/vault.yml` ve Vault admin API (ileride UI)

API taslağı: [VAULT-API.md](VAULT-API.md)

## Lisans (ileride)

SecuriPDF License Service — Stirling dışında:

- Paket → hangi araçlar açık
- Kullanıcı sayısı veya eşzamanlı oturum limiti
- Keycloak custom claim veya sidecar kontrolü

## MFA (ileride)

Keycloak veya AD Conditional Access üzerinde açılır; Stirling tarafında değişiklik gerekmez.

## Uygulama fazları

| Faz | İçerik | Durum |
|-----|--------|-------|
| 0 | Mimari karar (bu doküman) | Tamamlandı |
| 1 | Intranet TLS + IP kısıtı | Tamamlandı (dev whitelist acik; prod: `ip-whitelist.prod.conf`, `generate-tls.ps1`) |
| 2 | Keycloak + AD + oauth2-proxy | Tamamlandı (`bootstrap-keycloak-realm.ps1`, `up-auth.ps1`) |
| 3 | Vault v1 (API, kota, şifreleme) | Tamamlandı (`services/platform`, `/api/vault/v1`) |
| 4 | Stirling ↔ Vault orchestration | Tamamlandı (`vault-archive.js`, `vault-signatures.js`, `/api/orchestration`) |
| 5 | Admin + audit | Tamamlandı (`/admin`, `/api/vault/v1/admin/audit`) |
| 6 | License service | Tamamlandı (`config/license.yml`, `/api/license/v1`) |

Detay: [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) · AD: [AD-KEYCLOAK-SETUP.md](AD-KEYCLOAK-SETUP.md) · `config/ad.yml`

## Yedekleme

Auth/vault devreye alındığında yedek kapsamına eklenir:

- Keycloak realm export / Postgres dump
- Vault metadata (Postgres) + şifreli dosya volume
- `config/security.yml`, `config/vault.yml`

## Referanslar

- [ARCHITECTURE.md](ARCHITECTURE.md) — genel mimari
- [VAULT-API.md](VAULT-API.md) — Vault REST API taslağı
- `config/security.yml` — güvenlik modu ve AD/Keycloak şablonu
- `config/vault.yml` — kota ve depolama varsayılanları
