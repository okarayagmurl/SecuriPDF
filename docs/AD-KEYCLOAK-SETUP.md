# Active Directory + Keycloak Kurulumu (Entera test)

**AD sunucusu:** `192.168.6.10`  
**Base DN:** `dc=entera,dc=test`

Yapılandırma referansı: `config/ad.yml`, `config/security.yml`

---

## 1. AD tarafında hazırlık

### Servis hesabı

LDAP okuma için (IT):

```
CN=svc-securipdf,CN=Users,dc=entera,dc=test
```

- Domain join okuma / grup okuma yetkisi
- Parola `docker/.env` → `LDAP_BIND_PASSWORD`

### Güvenlik grupları

| Grup | Amaç |
|------|------|
| `SecuriPDF-Users` | Standart kullanıcı |
| `SecuriPDF-Admins` | Admin |

Test kullanıcılarını bu gruplara ekleyin.

---

## 2. Docker ağından AD erişimi

Keycloak container'ının `192.168.6.10:389` adresine erişebildiğini doğrulayın:

```bash
docker exec securipdf-keycloak sh -c "timeout 3 bash -c '</dev/tcp/192.168.6.10/389' && echo OK || echo FAIL"
```

Windows Docker Desktop'ta AD aynı LAN'daysa genelde çalışır. Erişim yoksa firewall veya routing kontrol edin.

---

## 3. Otomatik kurulum (önerilen)

```powershell
cd docker
cp .env.example .env   # LDAP_BIND_PASSWORD doldurun
.\up-auth.ps1          # Stack + bootstrap + LDAP + test
```

Bu komut sırasıyla:

1. Tüm servisleri başlatır (Stirling, nginx, Keycloak, oauth2-proxy, Platform)
2. `bootstrap-keycloak-realm.ps1` — realm, roller, OAuth client, break-glass admin, tema
3. `fix-keycloak-ldap.ps1` — LDAP federation, AD grup mapper, hardcoded rol mapper, sync
4. `test-stack.ps1` — 5/5 sağlık kontrolü

**Giriş:** `Administrator` + AD parolası (sAMAccountName, e-posta değil)

| URL | Açıklama |
|-----|----------|
| http://localhost:8080 | Ana giriş |
| http://localhost:8080/admin | Admin (`pdf-admin` rolü) |
| http://localhost:8090 | Keycloak yönetim |

LDAP ayrı çalıştırma:

```powershell
.\fix-keycloak-ldap.ps1
.\map-ad-group-roles.ps1   # opsiyonel; hardcoded mapper genelde yeterli
```

---

## 4. Manuel Keycloak yapılandırması (referans)

Otomasyon başarısız olursa aşağıdaki adımları Keycloak Admin UI üzerinden uygulayın.

### Realm

1. Realm oluştur: **securipdf**
2. Roller: `pdf-user`, `pdf-admin`

### User federation (LDAP)

| Alan | Değer |
|------|--------|
| UI display name | Entera AD |
| Vendor | Active Directory |
| Connection URL | `ldap://192.168.6.10:389` |
| Bind DN | `CN=svc-securipdf,CN=Users,dc=entera,dc=test` |
| Bind credentials | `.env` içindeki parola |
| Users DN | `CN=Users,dc=entera,dc=test` |
| Username LDAP attribute | `sAMAccountName` |
| RDN LDAP attribute | `cn` |
| UUID LDAP attribute | `objectGUID` |
| User Object Classes | `person, organizationalPerson, user` |
| Edit Mode | `READ_ONLY` |

**Synchronize all users** çalıştırın.

### Mappers

- **Group LDAP mapper** — `SecuriPDF-*` grupları
- **Hardcoded LDAP role mapper** — `SecuriPDF-Admins` → `pdf-admin`, `SecuriPDF-Users` → `pdf-user`

---

## 5. OAuth2 client (SecuriPDF)

Realm → Clients → `securipdf`:

- Client authentication: ON
- Valid redirect URIs: `http://localhost:8080/oauth2/callback` (dev)
- Web origins: `http://localhost:8080`
- Secret → `docker/.env` → `OAUTH2_CLIENT_SECRET`

Prod için redirect URI: `https://<hostname>/oauth2/callback`

---

## 6. oauth2-proxy

`.env` değerlerini doldurduktan sonra:

```powershell
docker compose -f docker-compose.yml -f docker-compose.auth.yml restart oauth2-proxy
```

Akış: **Kullanıcı → oauth2-proxy → nginx:8080 → Stirling / Platform API**

---

## 7. Stirling

```env
DOCKER_ENABLE_SECURITY=false
SECURITY_ENABLELOGIN=false
```

Değiştirmeyin — bkz. [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md)

---

## 8. Yerel break-glass admin (AD dışı)

Bootstrap otomatik oluşturur:

| Kullanıcı | Parola | Rol |
|-----------|--------|-----|
| `securipdf-local-admin` | `SecuriPDF-Local-Admin-2026` | `pdf-admin` |

**Güvenlik:** Güçlü parola, mümkünse yalnızca yönetim IP'sinden erişim, audit log.

---

## Sorun giderme

| Sorun | Kontrol |
|-------|---------|
| LDAP connection failed | AD erişim, bind DN/parola, port 389 firewall |
| Kullanıcı sync yok | `.\fix-keycloak-ldap.ps1` veya UI: Sync all users |
| Rol yok | Hardcoded mapper / `SecuriPDF-Admins` grup üyeliği |
| Login loop | oauth2 redirect URI, client secret |
| Container AD görmüyor | Docker network, `192.168.6.10` routing |

Detay: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
