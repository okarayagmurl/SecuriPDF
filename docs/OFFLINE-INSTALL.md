# SecuriPDF — Kapalı Ağ (Offline) Kurulum

Müşteri ortamında **internet yoksa** kurulum iki aşamada yapılır:

1. **Entera build makinesi** (internet var) — `.deb` + Docker image paketi üretimi  
2. **Müşteri sunucusu** (kapalı ağ) — yerel kurulum  

Genel Ubuntu kılavuzu: [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md)  
Sorun giderme: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## Mimari özet

```
[Entera — internet VAR]
  1) download-offline-debs.sh     → offline/debs/ + offline/debs-pwsh/
  2) build-offline-bundle.sh      → dist/securipdf-*-offline.tar.gz

[USB / SFTP / fiziksel medya]

[Müşteri — internet YOK]
  1) install-prerequisites-offline.sh   → Docker + pwsh (.deb)
  2) installer/install.sh               → sihirbaz + docker load + stack
     veya install-offline.sh --load-images --deploy
```

**Müşteri sunucusunda dış bağımlılık:**

| Bağlantı | Zorunlu |
|----------|---------|
| Active Directory (LDAP) | Evet (giriş için) |
| İnternet | **Hayır** |
| SMTP | Hayır (opsiyonel) |

---

## Bölüm A — Entera: `.deb` paketlerini hazırlama

Bu adım **internet olan** bir Ubuntu makinede yapılır. Müşteri sunucusu ile **aynı Ubuntu major sürümü** kullanın (ör. build 24.04 → müşteri 24.04).

### A.1 Build makinesi gereksinimleri

- Ubuntu 22.04 veya 24.04 LTS (müşteri ile eşleşmeli)
- `sudo` yetkisi
- ~500 MB disk (`.deb` dosyaları)
- İnternet

### A.2 Kaynak kodu

```bash
git clone https://github.com/okarayagmurl/SecuriPDF.git
cd SecuriPDF
git checkout main
git log -1 --oneline
```

> Güncel kod `main` dalındadır. `git clone` varsayılan dalı `main` olmalıdır.

### A.3 Docker ve PowerShell `.deb` indirme

```bash
cd SecuriPDF
sudo bash scripts/ubuntu/download-offline-debs.sh
```

> **Not:** Microsoft repo URL'si `ubuntu/24.04` formatinda olmalidir (`noble` degil). Script bunu otomatik kullanir. APT basarisiz olursa GitHub universal `.deb` yedegi denenir.

**Ne yapar?**

| Klasör | İçerik |
|--------|--------|
| `offline/debs/` | Docker Engine, containerd, compose plugin + bağımlılıklar |
| `offline/debs-pwsh/` | PowerShell (`pwsh`) — Keycloak bootstrap için **şiddetle önerilir** |

**Doğrulama:**

```bash
ls offline/debs/*.deb | wc -l          # örn. 15–40 dosya
ls offline/debs-pwsh/*.deb | wc -l   # en az 1 (powershell)
```

`debs-pwsh` boşsa müşteride `pwsh` kurulamaz ve Keycloak realm bootstrap çalışmaz.

**Manuel alternatif (script basarisiz olursa — Ubuntu 24.04):**

```bash
cd SecuriPDF
sudo mkdir -p offline/debs-pwsh
cd /tmp
sudo rm -f packages-microsoft-prod.deb packages-microsoft-prod.deb.*

# DOGRU URL: 24.04 (noble degil)
wget -O packages-microsoft-prod.deb https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb
file packages-microsoft-prod.deb   # "Debian binary package" olmali
sudo dpkg -i packages-microsoft-prod.deb
sudo apt-get update
sudo apt-get install --download-only -y powershell
sudo cp /var/cache/apt/archives/*.deb /home/securipdfadmin/SecuriPDF/offline/debs-pwsh/
```

**GitHub yedegi (repo calismazsa):**

```bash
cd SecuriPDF/offline/debs-pwsh
wget https://github.com/PowerShell/PowerShell/releases/download/v7.5.2/powershell_7.5.2-1.deb_amd64.deb
sudo apt-get install -y --download-only ./powershell_7.5.2-1.deb_amd64.deb
sudo cp /var/cache/apt/archives/*.deb .
```

`.deb` dosyalarını USB ile müşteriye taşıyın; `offline/debs/` yapısını koruyun.

---

## Bölüm B — Entera: offline kurulum paketi (image arşivi)

### B.1 Gereksinimler

- Docker çalışır durumda (build makinesinde)
- Disk: ~8–12 GB (image arşivi)
- `offline/debs/` hazır (önerilir; pakete gömülür)

### B.2 Paketi oluşturma

```bash
cd SecuriPDF
chmod +x scripts/build-offline-bundle.sh scripts/install-offline.sh
./scripts/build-offline-bundle.sh
```

Süre: ilk build 15–30 dk (Stirling fat image).

**Çıktı:**

```
dist/securipdf-1.1.0-stirling-2.13.1-offline.tar.gz
dist/securipdf-1.1.0-stirling-2.13.1-offline.tar.gz.sha256
dist/securipdf-1.1.0-stirling-2.13.1-offline/
  install-offline.sh
  images/securipdf-images.tar      (~4–8 GB)
  offline/debs/                     (varsa)
  offline/debs-pwsh/                (varsa)
  docker/                           (compose, fix-access-url.sh, nginx)
  installer/
  config/ branding/ scripts/ docs/
  MANIFEST.json
  CHECKSUMS.sha256
```

### B.3 Paketteki image listesi

| Image | Açıklama |
|-------|----------|
| `entera-pdf:<IMAGE_TAG>` | Stirling + branding |
| `securipdf-platform:<IMAGE_TAG>` | Vault / Admin API |
| `nginx:1.27-alpine` | Reverse proxy |
| `postgres:16-alpine` | Keycloak DB |
| `quay.io/keycloak/keycloak:26.0` | Kimlik sağlayıcı |
| `quay.io/oauth2-proxy/oauth2-proxy:v7.7.1` | SSO kapısı |

### B.4 Entera test VM (önerilir)

Kapalı ağa göndermeden önce aynı paketi test VM'de kurun:

```bash
tar xzf dist/securipdf-*-offline.tar.gz
cd securipdf-*-offline
sudo bash scripts/ubuntu/install-prerequisites-offline.sh
cd installer
./install.sh
```

Kontrol listesi:

- [ ] `OAUTH2_CLIENT_SECRET` `.env` içinde **dolu**
- [ ] `fix-access-url.sh SUNUCU_IP` ile localhost yönlendirmesi yok
- [ ] `pwsh --version` çalışıyor
- [ ] `securipdf-local-admin` ile giriş OK
- [ ] `docker compose ps` tüm servisler healthy

### B.5 Müşteriye teslim

- [ ] `securipdf-*-offline.tar.gz` + `.sha256`
- [ ] `MANIFEST.json`
- [ ] `docs/AD-KEYCLOAK-SETUP.md`
- [ ] Müşteriye özel bilgi sayfası: sunucu IP/FQDN, portlar
- [ ] **Break-glass parolası ayrı güvenli kanaldan** (CREDENTIALS dosyası veya installer çıktısı)

---

## Bölüm C — Müşteri: kapalı ağ kurulumu

### C.1 Ön koşullar (müşteri IT)

- [ ] Ubuntu 22.04/24.04 LTS (build ile aynı major sürüm)
- [ ] 8+ GB RAM, 100+ GB disk
- [ ] AD: `svc-securipdf`, `SecuriPDF-Users`, `SecuriPDF-Admins`
- [ ] Sunucu → AD LDAP (389/636)
- [ ] Kullanıcılar → sunucu `8080` veya `443`

### C.2 Paketi açma

```bash
sudo mkdir -p /opt/securipdf
cd /opt/securipdf
sudo tar xzf /media/usb/securipdf-*-offline.tar.gz
cd securipdf-*-offline
sha256sum -c ../securipdf-*-offline.tar.gz.sha256
```

### C.3 Docker + PowerShell (ilk sefer)

```bash
sudo bash scripts/ubuntu/install-prerequisites-offline.sh
pwsh --version
docker compose version
```

`pwsh` yoksa: pakette `offline/debs-pwsh/` eksik — Entera'dan yeniden paket isteyin.

Docker grubu:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### C.4 Kurulum — yöntem 1: installer sihirbazı (önerilen)

```bash
cd installer
bash install.sh
```

Sihirbaz sorar:

- Sunucu IP veya FQDN (ör. `192.168.6.175`) — **localhost yazmayın**
- HTTP port (varsayılan `8080`)
- Offline image arşivi otomatik bulunur

Sihirbaz otomatik üretir:

- `docker/.env` (secret'lar dahil — `OAUTH2_CLIENT_SECRET` boş kalmaz)
- `installer/CREDENTIALS-*.txt`

### C.5 Kurulum — yöntem 2: manuel CLI

```bash
cp docker/.env.example docker/.env
nano docker/.env
```

**Mutlaka doldurun:**

```env
KEYCLOAK_HOSTNAME=192.168.6.175
PUBLIC_FQDN=192.168.6.175
OAUTH2_CLIENT_SECRET=guclu-bir-secret-buraya
BREAK_GLASS_PASSWORD=guclu-parola
KEYCLOAK_ADMIN_PASSWORD=...
KEYCLOAK_DB_PASSWORD=...
OAUTH2_COOKIE_SECRET=32-karakter-hex
VAULT_MASTER_KEY=...
```

URL senkronizasyonu:

```bash
cd docker
bash fix-access-url.sh 192.168.6.175
```

Deploy:

```bash
cd /opt/securipdf/securipdf-*-offline
bash install-offline.sh --load-images --deploy --verify
```

### C.6 İlk giriş

| Alan | Değer |
|------|--------|
| URL | `http://SUNUCU_IP:8080` |
| Kullanıcı | `securipdf-local-admin` |
| Parola | `installer/CREDENTIALS-*.txt` veya `.env` → `BREAK_GLASS_PASSWORD` |

LDAP / SMTP: kurulum sonrası **Admin panel** → Yapılandırma.

---

## Bölüm D — Bilinen kurulum tuzakları (2026 güncellemesi)

| Belirti | Neden | Çözüm |
|---------|--------|--------|
| `localhost:8090` yönlendirme | `.env` IP ile uyumsuz | `docker/fix-access-url.sh SUNUCU_IP` |
| OAuth callback **500** / `unauthorized_client` | `OAUTH2_CLIENT_SECRET` boş | `.env` doldur + `bootstrap-keycloak-realm.ps1` |
| `pwsh: command not found` | `debs-pwsh` pakette yok | Entera'da `download-offline-debs.sh` tekrar |
| Bootstrap `TEMP is null` | Eski script | Güncel `main` + `ps1-common.ps1` |
| `entera-nginx unhealthy` (HTTPS) | TLS yok | `generate-tls.sh` veya HTTP modu |
| Script `command not found` | Çalıştırma izni yok | `bash script.sh` kullanın |

Doğrulama komutları:

```bash
cd docker
grep OAUTH2_CLIENT_SECRET .env
docker exec securipdf-oauth2-proxy printenv OAUTH2_PROXY_LOGIN_URL
docker exec securipdf-oauth2-proxy printenv OAUTH2_PROXY_CLIENT_SECRET
docker compose -f docker-compose.yml -f docker-compose.auth.yml -f docker-compose.offline.yml ps
```

---

## Bölüm E — Prod HTTPS (kapalı ağ)

1. Kurumsal sertifikayı `docker/nginx/ssl/securipdf.crt` + `.key` olarak koyun  
   (veya `docker/generate-tls.sh` — internet gerekmez)
2. `fix-access-url.sh SUNUCU_FQDN --https`
3. Prod overlay:

```bash
cd docker
docker compose \
  -f docker-compose.yml \
  -f docker-compose.auth.yml \
  -f docker-compose.offline.yml \
  -f docker-compose.prod.yml \
  up -d --no-build
```

---

## Bölüm F — Güncelleme

1. Entera yeni `build-offline-bundle.sh` çalıştırır
2. Müşteriye yeni `.tar.gz` iletilir
3. Müşteri:

```bash
./scripts/backup.sh
bash install-offline.sh --load-images
cd docker
docker compose -f docker-compose.yml -f docker-compose.auth.yml -f docker-compose.offline.yml up -d --no-build
pwsh -File bootstrap-keycloak-realm.ps1
```

---

## Hızlı komut özeti

```bash
# === ENTERA (internet var, Ubuntu 24.04 örnek) ===
git clone https://github.com/okarayagmurl/SecuriPDF.git && cd SecuriPDF
sudo bash scripts/ubuntu/download-offline-debs.sh
./scripts/build-offline-bundle.sh

# === MÜŞTERİ (kapalı ağ) ===
tar xzf securipdf-*-offline.tar.gz && cd securipdf-*-offline
sudo bash scripts/ubuntu/install-prerequisites-offline.sh
cd installer && bash install.sh
# veya:
# cp docker/.env.example docker/.env && nano docker/.env
# cd docker && bash fix-access-url.sh 192.168.6.175
# cd .. && bash install-offline.sh --load-images --deploy --verify
```
