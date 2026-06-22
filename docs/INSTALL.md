# Kurulum

SecuriPDF, [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) Community sürümünü temel alan, Docker üzerinde çalışan kurumsal PDF platformudur.

| Ortam | Kılavuz |
|-------|---------|
| **Ubuntu sunucu (sıfırdan, Docker)** | **[INSTALL-UBUNTU.md](INSTALL-UBUNTU.md)** |
| Windows / genel | Bu dosya |



## Gereksinimler



- Docker 24+ ve Docker Compose v2

- Minimum 4 GB RAM (OCR ve LibreOffice için)

- 10 GB disk alanı

- Auth stack için ek ~2 GB RAM (Keycloak + PostgreSQL + Platform)



## Kurulum modları



| Mod | Komut | Giriş |

|-----|--------|-------|

| **Auth (önerilen)** | `.\up-auth.ps1` | Keycloak + AD zorunlu |

| Geliştirme (auth yok) | `docker compose -f docker-compose.yml -f docker-compose.direct.yml up -d` | Doğrudan Stirling |



---



## Auth stack kurulumu (prod hedef)



```powershell

# 1. Repoyu klonlayın

git clone <repo-url> SecuriPDF

cd SecuriPDF



# 2. Ortam dosyası

copy docker\.env.example docker\.env

# .env düzenleyin: LDAP_BIND_PASSWORD, OAUTH2_CLIENT_SECRET



# 3. Araç yapılandırması (Git Bash veya WSL)

./scripts/sync-tools-config.sh



# 4. Tam stack başlat + Keycloak bootstrap

cd docker

.\up-auth.ps1



# 5. Doğrulama

.\test-stack.ps1

```



**Tarayıcı:** http://localhost:8080



| URL | Açıklama |

|-----|----------|

| http://localhost:8080 | Ana giriş (oauth2-proxy) |

| http://localhost:8080/admin | Admin paneli (`pdf-admin` rolü) |

| http://localhost:8090 | Keycloak yönetim konsolu |



### Giriş bilgileri



| Kullanıcı | Parola | Not |

|-----------|--------|-----|

| `Administrator` | AD parolası | sAMAccountName — e-posta değil |

| `securipdf-local-admin` | `SecuriPDF-Local-Admin-2026` | Break-glass (AD dışı) |



### Bootstrap / LDAP ayrı çalıştırma



```powershell

cd docker

.\bootstrap-keycloak-realm.ps1   # Realm, roller, OAuth client, tema

.\fix-keycloak-ldap.ps1          # AD LDAP + grup→rol mapper

.\map-ad-group-roles.ps1         # (opsiyonel) KC grup → rol

.\apply-prod-hardening.ps1       # Prod: IP + TLS + oauth2
.\deploy-prod.ps1 -Force         # Prod stack (TLS edge nginx:443)

```

Detay: [PHASES.md](PHASES.md)



---



## Geliştirme kurulumu (auth kapalı)



```bash

cp docker/.env.example docker/.env

chmod +x scripts/*.sh

./scripts/sync-tools-config.sh

cd docker

docker compose -f docker-compose.yml -f docker-compose.direct.yml up -d --build

../scripts/healthcheck.sh

```



Tarayıcı: **http://localhost:8080** (direct mod)



---



## Ortam değişkenleri



`docker/.env` dosyasında düzenleyin:



| Değişken | Açıklama |

|----------|----------|

| `UI_APPNAME` | Ürün adı |

| `STIRLING_VERSION` | Upstream Stirling sürümü |

| `HTTP_PORT` | Dış giriş portu (auth: 8080) |

| `LDAP_BIND_PASSWORD` | AD servis hesabı parolası |

| `OAUTH2_CLIENT_SECRET` | Keycloak OAuth client secret |

| `VAULT_MASTER_KEY` | Vault şifreleme anahtarı (prod'da değiştirin) |



Tam liste: `docker/.env.example`



### Araç yönetimi



`config/tools.yml` düzenleyin, ardından:



```bash

./scripts/sync-tools-config.sh

cd docker && docker compose restart entera-pdf

```



### Branding



- Logo: `branding/static/classic-logo/StirlingPDFLogoBlackText.svg`

- CSS: `branding/static/css/entera-branding.css`

- Keycloak login teması: `docker/keycloak/themes/securipdf/`



---



## TLS / HTTPS (Faz 1)



```powershell

cd docker

.\generate-tls.ps1

```



Ardından `docker-compose.yml` içinde TLS volume satırlarının yorumunu kaldırın. Prod intranet için:



```powershell

copy nginx\ip-whitelist.prod.conf nginx\ip-whitelist.conf

docker compose restart nginx

```



---



## Prod sertleştirme



`.env` içinde:



```env

OAUTH2_INSECURE_ISSUER=false

OAUTH2_SKIP_DISCOVERY=false

OAUTH2_ALLOW_UNVERIFIED_EMAIL=false

OAUTH2_INSECURE_TLS=false

OAUTH2_COOKIE_SECURE=true

```



Detay: [PHASES.md](PHASES.md) · [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md)



## Sorun giderme



Bkz. [TROUBLESHOOTING.md](TROUBLESHOOTING.md)


