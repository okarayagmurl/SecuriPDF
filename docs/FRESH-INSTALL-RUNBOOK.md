# SecuriPDF — Sıfır Makine Kurulum Runbook

Bu belge **Entera build** → **offline paket** → **sıfır Ubuntu sunucu** akışını tek sayfada toplar.  
Ayrıntılı kapalı ağ: [OFFLINE-INSTALL.md](OFFLINE-INSTALL.md) · Ubuntu: [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md)

---

## Özet akış

```mermaid
flowchart LR
  A[GitHub main] --> B[Build makinesi internet VAR]
  B --> C[offline debs + image bundle]
  C --> D[USB / SFTP]
  D --> E[Sifir Ubuntu sunucu]
  E --> F[install-prerequisites-offline]
  F --> G[installer / install-offline]
  G --> H[fix-access-url + bootstrap]
```

---

## Aşama 1 — Kod (GitHub)

```bash
git clone https://github.com/okarayagmurl/SecuriPDF.git
cd SecuriPDF
git checkout main
git log -1 --oneline
cat VERSION   # örn. 1.1.0-stirling-2.13.1
```

---

## Aşama 2 — Build makinesi (internet gerekli)

**Gereksinim:** Ubuntu 22.04 veya 24.04 LTS, Docker, ~15 GB boş disk, `sudo`.

### 2.1 Docker + PowerShell `.deb` paketleri

```bash
cd SecuriPDF
sudo bash scripts/ubuntu/download-offline-debs.sh
ls offline/debs/*.deb | wc -l          # 15+ beklenir
ls offline/debs-pwsh/*.deb | wc -l   # 1+ (pwsh zorunlu)
```

### 2.2 Docker ve pwsh kurulumu (build makinesinde)

`.deb` indirmek **kurulum yapmaz**. Image build için Docker daemon gerekir:

```bash
sudo bash scripts/ubuntu/install-prerequisites-offline.sh
docker --version
docker compose version
```

> `spadm` kullanıcısıyla build alacaksanız: kurulumdan sonra `newgrp docker` veya oturumu kapatıp açın.

### 2.3 Docker image offline arşivi

```bash
chmod +x scripts/build-offline-bundle.sh scripts/install-offline.sh
./scripts/build-offline-bundle.sh
# İsteğe bağlı: ./scripts/build-offline-bundle.sh --output /tmp/releases
```

**Çıktı:**

| Dosya | Açıklama |
|-------|----------|
| `dist/securipdf-<VERSION>-offline.tar.gz` | Tüm kurulum paketi (~4–10 GB) |
| `dist/securipdf-<VERSION>-offline.tar.gz.sha256` | Bütünlük kontrolü |

**Paketteki image'lar** (`docker save`):

- `entera-pdf:<VERSION>`
- `securipdf-platform:<VERSION>`
- `nginx:1.27-alpine`
- `postgres:16-alpine`
- `quay.io/keycloak/keycloak:26.0`
- `quay.io/oauth2-proxy/oauth2-proxy:v7.7.1`

### 2.3 Build makinesinde duman testi (önerilir)

```bash
tar xzf dist/securipdf-*-offline.tar.gz -C /tmp
cd /tmp/securipdf-*-offline
sudo bash scripts/ubuntu/install-prerequisites-offline.sh
cd installer && sudo ./install.sh
```

---

## Aşama 3 — Sıfır sunucu (müşteri / test VM)

### 3.1 Ön koşullar

- [ ] Ubuntu **aynı major** sürüm (build 24.04 → hedef 24.04)
- [ ] 8+ GB RAM, 100+ GB disk
- [ ] AD: `svc-securipdf`, `SecuriPDF-Users`, `SecuriPDF-Admins`
- [ ] Sunucu → AD LDAP (389 veya 636)
- [ ] Kullanıcılar → sunucu `:8080` (veya prod `:443`)

### 3.2 Paketi kopyala ve aç

```bash
sudo mkdir -p /opt/securipdf && cd /opt/securipdf
sudo tar xzf /path/to/securipdf-*-offline.tar.gz
cd securipdf-*-offline
sha256sum -c ../securipdf-*-offline.tar.gz.sha256
```

### 3.3 Docker + pwsh (ilk kurulum)

```bash
sudo bash scripts/ubuntu/install-prerequisites-offline.sh
docker --version
pwsh --version
```

### 3.4 Kurulum sihirbazı

```bash
cd installer
sudo ./install.sh
# veya: cd .. && sudo ./install-offline.sh --load-images --deploy
```

### 3.5 Erişim adreslerini ayarla

Sunucu IP veya FQDN ile (localhost kullanmayın):

```bash
cd docker
sudo bash fix-access-url.sh SUNUCU_IP
# veya: sudo bash fix-access-url.sh pdf.sirket.local
sudo bash bootstrap-keycloak-realm.ps1   # pwsh gerekir
sudo bash fix-keycloak-logout.ps1
```

### 3.6 Doğrulama

```bash
cd docker
docker compose -f docker-compose.yml -f docker-compose.auth.yml ps
curl -sf http://127.0.0.1:8080/nginx-health
curl -sf http://127.0.0.1:8080/api/license/v1/status
```

Tarayıcı: `http://SUNUCU_IP:8080` · Admin: `/admin` · Keycloak: `:8090`

### 3.7 İlk admin checklist

1. **Yapılandırma** → LDAP kaydet → Keycloak'a uygula
2. **Lisans & Araçlar** → paket + erişim profilleri
3. **Kullanıcılar** → profil ata, AD sync
4. **Operasyon** → FQDN, ilk yedek
5. **Genel bakış** → kurulum / prod hazırlık yeşil

---

## Sık karşılaşılan aksilikler

| Belirti | Olası neden | Çözüm |
|---------|-------------|--------|
| `pwsh: command not found` | `offline/debs-pwsh` boş | Build'de `download-offline-debs.sh` tekrar |
| OAuth 500 / unauthorized_client | `OAUTH2_CLIENT_SECRET` boş | `docker/.env` doldur, oauth2-proxy recreate |
| Login döngüsü / logout çalışmıyor | post-logout URI yok | `fix-keycloak-logout.ps1` |
| `localhost` ile giriş hatası | Yanlış redirect URL | `fix-access-url.sh` gerçek IP/FQDN |
| Image pull hatası (offline) | Bundle yüklenmedi | `install-offline.sh --load-images` |
| Platform unhealthy | Vault key / mount | `.env` `VAULT_MASTER_KEY`, loglar |

Detay: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## Teslim listesi (müşteriye)

- [ ] `securipdf-*-offline.tar.gz` + `.sha256`
- [ ] `docs/AD-KEYCLOAK-SETUP.md` (paket içinde)
- [ ] Sunucu IP, portlar, FQDN sayfası
- [ ] Break-glass parolası (ayrı güvenli kanal)
