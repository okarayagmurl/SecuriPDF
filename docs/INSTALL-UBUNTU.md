# SecuriPDF — Ubuntu Sıfırdan Kurulum Kılavuzu

Bu doküman, **temiz bir Ubuntu 22.04 veya 24.04 LTS** sunucusuna SecuriPDF’i Docker ile kurmak için adım adım yol haritasıdır.

**Tahmini süre:** İlk kurulum (AD hazırsa) ~45–90 dakika · Prod sertleştirme + TLS ~30 dakika

İlgili dokümanlar:

| Konu | Dosya |
|------|--------|
| Active Directory hazırlığı | [AD-KEYCLOAK-SETUP.md](AD-KEYCLOAK-SETUP.md) |
| Kimlik mimarisi | [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) |
| Prod operasyonları | [PROD-OPS.md](PROD-OPS.md) |
| Yedekleme | [BACKUP.md](BACKUP.md) |
| Sorun giderme | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| Windows geliştirme | [INSTALL.md](INSTALL.md) |
| **Kapalı ağ (offline)** | [OFFLINE-INSTALL.md](OFFLINE-INSTALL.md) |

---

## Hızlı kurulum (temiz Ubuntu + installer)

Aşağıdaki komutlar **internet olan build/kurulum sunucusu** veya **offline paket** ile temiz Ubuntu 22.04/24.04 üzerinde çalışır.

### A) İnternetli kurulum (geliştirme / test)

```bash
# 1. Repo
git clone <repo-url> SecuriPDF
cd SecuriPDF

# 2. Docker + PowerShell
sudo chmod +x scripts/ubuntu/install-prerequisites.sh
sudo INSTALL_PWSH=1 ./scripts/ubuntu/install-prerequisites.sh
newgrp docker

# 3. Kurulum sihirbazı (LDAP sorulmaz — Admin panelden yapılır)
chmod +x installer/install.sh installer/lib/*.sh
cd installer
./install.sh
```

İlk giriş: `http://SUNUCU:8080` → `securipdf-local-admin` / `installer/CREDENTIALS-*.txt` içindeki parola  
Admin: `http://SUNUCU:8080/admin` → **Kurulum tamamlama** checklist

### B) Kapalı ağ (offline paket)

**Entera tarafı (internet var):**

```bash
git clone <repo-url> SecuriPDF && cd SecuriPDF
sudo ./scripts/ubuntu/download-offline-debs.sh    # opsiyonel: Docker .deb
./scripts/build-offline-bundle.sh
# → dist/securipdf-*-offline.tar.gz müşteriye verilir
```

**Müşteri sunucusu (internet yok):**

```bash
tar xzf securipdf-*-offline.tar.gz
cd securipdf-*-offline

# Docker yoksa (pakette offline/debs varsa):
sudo ./installer/install.sh --prereqs

# Kurulum
cd installer
chmod +x install.sh lib/*.sh
./install.sh
```

Detay: [OFFLINE-INSTALL.md](OFFLINE-INSTALL.md)

---

## Kurulacak yapı (özet)

```
Kullanıcı → oauth2-proxy (:8080 veya :443)
              → nginx → Stirling-PDF (PDF araçları)
                      → Platform API (Vault, Admin)
              → Keycloak (:8090, LDAP/AD)
              → PostgreSQL (Keycloak DB)
```

Giriş **Active Directory** üzerinden yapılır; Stirling’in kendi login ekranı kapalıdır.

---

## Bölüm 0 — Kurulum öncesi kontrol listesi

Kuruluma başlamadan önce aşağıdakilerin hazır olduğundan emin olun:

- [ ] Ubuntu 22.04 / 24.04 LTS (64-bit), root veya sudo erişimi
- [ ] Statik IP veya DNS kaydı (ör. `pdf.sirket.local`)
- [ ] Sunucu → AD LDAP erişimi (389 veya 636)
- [ ] Kullanıcılar → sunucu erişimi (8080 test / 443 prod)
- [ ] AD’de servis hesabı ve gruplar hazır (Bölüm 1)
- [ ] Git deposuna erişim (clone URL veya arşiv)

### Donanım önerisi

| Kaynak | Minimum | Önerilen (prod) |
|--------|---------|-----------------|
| CPU | 2 vCPU | 4+ vCPU |
| RAM | 6 GB | 8–16 GB |
| Disk | 40 GB | 100 GB+ SSD |

> Stirling container’ı OCR ve LibreOffice nedeniyle tek başına ~4 GB RAM kullanabilir (`STIRLING_MEMORY_LIMIT`).

---

## Bölüm 1 — Active Directory hazırlığı

AD tarafını **SecuriPDF sunucusuna kurmadan önce** tamamlayın. Ayrıntılar: [AD-KEYCLOAK-SETUP.md](AD-KEYCLOAK-SETUP.md)

### 1.1 Servis hesabı

LDAP okuma için örnek hesap:

```
CN=svc-securipdf,CN=Users,dc=sirket,dc=local
```

- Domain’de kullanıcı/ grup okuma yetkisi
- Parola kurulumda `docker/.env` → `LDAP_BIND_PASSWORD` olacak

### 1.2 Güvenlik grupları

| AD grubu | Keycloak rolü | Yetki |
|----------|---------------|-------|
| `SecuriPDF-Users` | `pdf-user` | PDF araçları + kişisel Vault |
| `SecuriPDF-Admins` | `pdf-admin` | Admin paneli (`/admin`) |

Test kullanıcılarını ilgili gruplara ekleyin.

### 1.3 E-posta / UPN (giriş için zorunlu)

oauth2-proxy oturum açmak için JWT içinde `email` claim’i bekler. AD’de kullanıcıların en az birinde dolu olmalı:

- `mail` attribute (ör. `admin@sirket.local`), **veya**
- `userPrincipalName` (ör. `kullanici@sirket.local`)

Kurulum scriptleri her iki kaynağı da destekler (`fix-keycloak-ldap.ps1`).

### 1.4 Kullanıcı DN notu

Kullanıcılar `CN=Users` altında değilse (ör. `CN=pdf,DC=sirket,DC=local`), `.env` içinde:

```env
LDAP_USERS_DN=dc=sirket,dc=local
```

---

## Bölüm 2 — Ubuntu sunucu hazırlığı

### 2.1 Sistemi güncelleyin

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### 2.1 Hostname ve DNS (prod için)

```bash
# Örnek
sudo hostnamectl set-hostname pdf.sirket.local
```

İstemcilerin sunucuya bu isimle erişebildiğini doğrulayın (`ping pdf.sirket.local`).

### 2.2 Güvenlik duvarı

**Test ortamı (8080):**

```bash
sudo ufw allow 22/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 8090/tcp   # yalnızca yönetim ağından; prod’da kapatılabilir
sudo ufw enable
```

**Prod (HTTPS):**

```bash
sudo ufw allow 22/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## Bölüm 3 — Docker ve yardımcı araçlar

### 3.1 Otomatik kurulum (önerilen)

```bash
git clone <repo-url> SecuriPDF
cd SecuriPDF

sudo chmod +x scripts/ubuntu/install-prerequisites.sh
sudo INSTALL_PWSH=1 ./scripts/ubuntu/install-prerequisites.sh
```

`INSTALL_PWSH=1` — Keycloak bootstrap scriptleri için PowerShell kurar (**zorunlu değil ama şiddetle önerilir**).

### 3.2 Oturumu yenileyin

Docker grubunun etkinleşmesi için:

```bash
newgrp docker
# veya SSH oturumunu kapatıp tekrar açın
```

### 3.3 Doğrulama

```bash
docker --version
docker compose version
python3 --version
pwsh --version    # kurulduysa
```

---

## Bölüm 4 — Ortam dosyası (.env)

### 4.1 Şablonu kopyalayın

**İki senaryo:**

| Senaryo | Şablon | Erişim |
|---------|--------|--------|
| İlk test / laboratuvar | `docker/.env.example` | `http://SUNUCU:8080` |
| Doğrudan prod | `docker/.env.ubuntu.example` | `https://SUNUCU` |

```bash
cd SecuriPDF

# Laboratuvar (8080) — önerilen ilk kurulum
cp docker/.env.example docker/.env

# veya doğrudan prod şablonu
# cp docker/.env.ubuntu.example docker/.env

nano docker/.env
```

### 4.2 Mutlaka düzenlenecek değişkenler

| Değişken | Açıklama |
|----------|----------|
| `LDAP_HOST`, `LDAP_BASE_DN`, `LDAP_*` | AD sunucu ve DN’ler |
| `LDAP_BIND_PASSWORD` | Servis hesabı parolası |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak yönetici |
| `KEYCLOAK_DB_PASSWORD` | Keycloak Postgres |
| `OAUTH2_CLIENT_SECRET` | OAuth client gizli anahtarı |
| `OAUTH2_COOKIE_SECRET` | En az 32 karakter rastgele hex |
| `VAULT_MASTER_KEY` | En az 32 karakter; belge şifreleme |
| `BREAK_GLASS_PASSWORD` | Yerel acil giriş (`securipdf-local-admin`) |
| `PUID` / `PGID` | `id -u` / `id -g` çıktısı |

### 4.3 Güçlü rastgele değer üretme

```bash
openssl rand -hex 16    # OAUTH2_COOKIE_SECRET (32 hex)
openssl rand -base64 32 # VAULT_MASTER_KEY önerisi
```

### 4.4 Linux dosya sahibi

```bash
echo "PUID=$(id -u)" >> docker/.env   # elle düzenleyin
echo "PGID=$(id -g)"
```

`.env` içinde `PUID` ve `PGID` bu değerlere ayarlanmalı.

### 4.5 Hostname / OAuth URL’leri

**Laboratuvar (8080):**

```env
HTTP_PORT=8080
PUBLIC_FQDN=pdf.sirket.local
PUBLIC_SERVER_IP=192.168.1.50
OAUTH2_REDIRECT_URL=http://pdf.sirket.local:8080/oauth2/callback
OAUTH2_ISSUER_URL=http://pdf.sirket.local:8090/realms/securipdf
OAUTH2_INSECURE_ISSUER=true
OAUTH2_COOKIE_SECURE=false
```

**Prod (443):**

```env
HTTP_PORT=80
HTTPS_PORT=443
KEYCLOAK_HOSTNAME=pdf.sirket.local
OAUTH2_REDIRECT_URL=https://pdf.sirket.local/oauth2/callback
OAUTH2_ISSUER_URL=https://pdf.sirket.local/realms/securipdf
OAUTH2_INSECURE_ISSUER=false
OAUTH2_COOKIE_SECURE=true
```

---

## Bölüm 5 — Araç listesi ve stack başlatma

### 5.1 Araç yapılandırmasını senkronize edin

```bash
chmod +x scripts/*.sh docker/*.sh
./scripts/sync-tools-config.sh
```

Bu komut `config/tools.yml` listesini Stirling `settings.yml` ve ilgili dosyalarla eşitler.

### 5.2 Stack’i başlatın

```bash
cd docker
./up-auth.sh
```

`up-auth.sh` sırasıyla:

1. Tüm container’ları build eder ve başlatır
2. `bootstrap-keycloak-realm.ps1` — realm, roller, OAuth client, break-glass admin
3. `test-stack.sh` — sağlık testleri

Bootstrap’ı atlamak:

```bash
./up-auth.sh --skip-test
```

İlk build 10–20 dakika sürebilir (Stirling fat image).

### 5.3 Container durumu

```bash
docker compose -f docker-compose.yml -f docker-compose.auth.yml ps
```

Beklenen servisler: `entera-pdf`, `entera-nginx`, `securipdf-oauth2-proxy`, `securipdf-keycloak`, `securipdf-postgres`, `securipdf-platform`.

---

## Bölüm 6 — LDAP / Active Directory bağlantısı

Stack ayakta olduktan sonra AD federation’ı yapılandırın:

```bash
cd docker
pwsh -File fix-keycloak-ldap.ps1
```

Bu script:

- LDAP federation (`entera-ad`) oluşturur/günceller
- `mail` → `email` ve `userPrincipalName` → `ldap_upn` mapper’larını ayarlar
- AD gruplarını Keycloak rollerine bağlar
- Kullanıcı senkronunu tetikler

Grup–rol eşlemesi gerekirse:

```bash
pwsh -File map-ad-group-roles.ps1
```

E-posta sorunlarında:

```bash
pwsh -File fix-keycloak-email.ps1
```

### 6.1 AD erişim testi

```bash
# LDAP_HOST değerinizi kullanın
docker exec securipdf-keycloak sh -c "timeout 3 bash -c '</dev/tcp/LDAP_HOST/389' && echo OK || echo FAIL"
```

Admin panelinden: **http://SUNUCU:8080/admin** → LDAP test (Operasyon veya LDAP sekmesi).

---

## Bölüm 7 — Doğrulama ve ilk giriş

### 7.1 Otomatik testler

```bash
cd docker
./test-stack.sh
../scripts/healthcheck.sh
```

Tüm testler `[OK]` olmalı.

### 7.2 Tarayıcı testleri

| URL | Beklenen |
|-----|----------|
| `http://SUNUCU:8080` | Keycloak giriş → PDF ana sayfa |
| `http://SUNUCU:8080/admin` | Admin paneli (`pdf-admin` rolü) |
| `http://SUNUCU:8090` | Keycloak yönetim konsolu |

### 7.3 Giriş bilgileri

| Kullanıcı | Nasıl |
|-----------|-------|
| AD kullanıcısı | sAMAccountName + AD parolası |
| Break-glass | `securipdf-local-admin` + `BREAK_GLASS_PASSWORD` |

**Test sırası:**

1. Standart kullanıcı (`SecuriPDF-Users` grubunda) ile giriş
2. Admin kullanıcı (`SecuriPDF-Admins` grubunda) ile giriş
3. Admin paneli → Operasyon → ilk Vault yedeği

### 7.4 Keycloak redirect URI kontrolü

Keycloak Admin → Realm `securipdf` → Clients → `securipdf` → **Valid redirect URIs**:

```
http://pdf.sirket.local:8080/oauth2/callback
```

(prod’da `https://...` olmalı)

---

## Bölüm 8 — Prod geçişi (HTTPS)

Laboratuvar kurulumu başarılıysa prod’a geçin.

### 8.1 Sertleştirme

```bash
cd docker
./apply-prod-hardening.sh --force
```

- Prod IP whitelist (`nginx/ip-whitelist.prod.conf`)
- Self-signed TLS (`nginx/ssl/`) veya kendi sertifikanızı kopyalayın
- OAuth2 güvenli cookie bayrakları

Kurumsal sertifika:

```bash
# Kendi dosyalarınızı yerleştirin
cp sirket.crt docker/nginx/ssl/securipdf.crt
cp sirket.key docker/nginx/ssl/securipdf.key
```

Self-signed üretmek:

```bash
./generate-tls.sh
```

### 8.2 Prod stack

`.env` içinde HTTPS URL’lerini güncelledikten sonra:

```bash
./deploy-prod.sh --force
```

Erişim: **https://pdf.sirket.local**

### 8.3 Prod sonrası kontrol

- [ ] HTTP → HTTPS yönlendirmesi çalışıyor
- [ ] AD kullanıcı girişi çalışıyor
- [ ] Keycloak redirect URI `https://` ile eşleşiyor
- [ ] Admin → Operasyon → Prod hazırlık maddeleri yeşil
- [ ] `./scripts/backup.sh` ile tam yedek alındı

Detay: [PROD-OPS.md](PROD-OPS.md)

---

## Bölüm 9 — Bakım ve güncelleme

### 9.1 Sunucu yeniden başlatma sonrası

Docker `restart: unless-stopped` tanımlıdır. Gerekirse:

```bash
sudo systemctl enable docker
cd SecuriPDF/docker
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d
# prod: -f docker-compose.prod.yml ekleyin
```

### 9.2 Güncelleme

```bash
cd SecuriPDF
git pull
./scripts/sync-tools-config.sh
cd docker
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d --build
../scripts/healthcheck.sh
```

Sürüm değişikliği: `docker/.env` içinde `STIRLING_VERSION` ve `IMAGE_TAG` güncelleyin → [UPDATE.md](UPDATE.md)

### 9.3 Yedekleme

```bash
# Tam stack
./scripts/backup.sh

# Keycloak realm export
cd docker && pwsh -File backup-keycloak.ps1 ../backups/manual-export

# Vault (Admin UI)
# /admin → Operasyon → Yedek al
```

---

## Bölüm 10 — Sorun giderme (hızlı)

| Belirti | Olası neden | Çözüm |
|---------|-------------|-------|
| 500 giriş hatası | JWT’de `email` yok | `pwsh fix-keycloak-email.ps1`, AD’de mail/UPN kontrol |
| Admin giriş yok, standart OK | E-posta mapper çakışması | `fix-keycloak-ldap.ps1` tekrar çalıştır |
| LDAP hatası | Firewall / bind parolası | Admin LDAP test, `LDAP_BIND_*` kontrol |
| 502 Bad Gateway | Stirling çökmüş | `docker compose logs entera-pdf` |
| Admin paneli 403 | `pdf-admin` rolü yok | AD `SecuriPDF-Admins` üyeliği |
| pwsh bulunamadı | PowerShell kurulmamış | `sudo INSTALL_PWSH=1 ./scripts/ubuntu/install-prerequisites.sh` |

Genel: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## Bölüm 11 — Kurulum kontrol listesi (özet)

```
[ ] Ubuntu güncel, Docker çalışıyor
[ ] AD servis hesabı + gruplar hazır
[ ] docker/.env dolduruldu (LDAP, parolalar, VAULT_MASTER_KEY)
[ ] PUID/PGID ayarlandı
[ ] ./scripts/sync-tools-config.sh
[ ] cd docker && ./up-auth.sh
[ ] pwsh -File fix-keycloak-ldap.ps1
[ ] ./test-stack.sh geçti
[ ] AD standart + admin kullanıcı girişi test edildi
[ ] /admin açıldı, Operasyon’dan yedek alındı
[ ] (Prod) TLS + deploy-prod.sh + HTTPS redirect URI
```

---

## Hızlı komut özeti (kopyala-yapıştır)

```bash
# === 1. Ön gereksinimler ===
git clone <repo-url> SecuriPDF && cd SecuriPDF
sudo chmod +x scripts/ubuntu/install-prerequisites.sh
sudo INSTALL_PWSH=1 ./scripts/ubuntu/install-prerequisites.sh
newgrp docker

# === 2. Yapılandırma ===
cp docker/.env.example docker/.env
nano docker/.env    # LDAP, parolalar, PUID/PGID
chmod +x scripts/*.sh docker/*.sh
./scripts/sync-tools-config.sh

# === 3. Kurulum ===
cd docker
./up-auth.sh
pwsh -File fix-keycloak-ldap.ps1
./test-stack.sh

# === 4. Prod (hazır olunca) ===
./apply-prod-hardening.sh --force
./deploy-prod.sh --force

# === 5. Yedek ===
cd .. && ./scripts/backup.sh
```

---

## Destek ve ek kaynaklar

- Mimari: [ARCHITECTURE.md](ARCHITECTURE.md)
- Vault API: [VAULT-API.md](VAULT-API.md)
- Ubuntu scriptleri: [scripts/ubuntu/README.md](../scripts/ubuntu/README.md)
