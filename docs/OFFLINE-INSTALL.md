# SecuriPDF — Kapalı Ağ (Offline) Kurulum

Müşteri ortamında **internet erişimi yoksa** kurulum iki aşamada yapılır:

1. **Entera build makinesi** (internet var) — paket üretimi  
2. **Müşteri sunucusu** (kapalı ağ) — paket kurulumu  

Genel Ubuntu kılavuzu: [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md)

---

## Mimari özet

```
[Entera LAN — build]                    [USB / SFTP / fiziksel medya]
     build-offline-bundle.sh      →      securipdf-x.y.z-offline.tar.gz
     download-offline-debs.sh            + Docker .deb paketleri (opsiyonel)

[Müşteri kapalı ağ]
     install.sh --prereqs     → Docker kurulumu (offline deb)
     install.sh --load-images → docker load
     install.sh --deploy      → compose up + Keycloak bootstrap
     install.sh --verify      → test-stack
```

**Dış bağımlılık (müşteri sunucusunda gerekli):**

| Bağlantı | Hedef | Zorunlu |
|----------|-------|---------|
| LDAP | Active Directory | Evet |
| (Opsiyonel) SMTP | Kurumsal posta sunucusu | Hayır |
| İnternet | — | **Hayır** |

---

## Bölüm A — Entera tarafı (paket hazırlığı)

### A.1 Gereksinimler

- Ubuntu 22.04/24.04 veya WSL2 (build için)
- Docker + internet
- Git + SecuriPDF kaynak kodu
- Disk: ~8–12 GB (image arşivi için)

### A.2 Docker .deb paketlerini indirin (müşteri sunucusu için)

Müşteri sunucusunda Docker yoksa, önce `.deb` paketlerini hazırlayın:

```bash
cd SecuriPDF
sudo chmod +x scripts/ubuntu/download-offline-debs.sh
sudo ./scripts/ubuntu/download-offline-debs.sh
```

Çıktı: `offline/debs/` (Docker Engine + Compose plugin)

> **Alternatif:** Müşteriye Docker önceden kurulu **altın imaj (golden VM)** verin; bu adım atlanır.

### A.3 Offline kurulum paketini oluşturun

```bash
chmod +x scripts/build-offline-bundle.sh scripts/install-offline.sh
./scripts/build-offline-bundle.sh
```

Çıktı:

```
dist/securipdf-1.0.0-stirling-0.46.2-offline.tar.gz   (~4–8 GB)
dist/securipdf-1.0.0-stirling-0.46.2-offline/
  install.sh
  MANIFEST.json
  CHECKSUMS.sha256
  images/securipdf-images.tar
  docker/          # compose, nginx, keycloak tema
  config/
  branding/
  scripts/
  offline/debs/    # varsa
  docs/
```

### A.4 Pakete dahil image listesi

| Image | Açıklama |
|-------|----------|
| `entera-pdf:<IMAGE_TAG>` | Stirling + branding (sizin build) |
| `securipdf-platform:<IMAGE_TAG>` | Vault / Admin API |
| `nginx:1.27-alpine` | Reverse proxy |
| `postgres:16-alpine` | Keycloak DB |
| `quay.io/keycloak/keycloak:26.0` | Kimlik sağlayıcı |
| `quay.io/oauth2-proxy/oauth2-proxy:v7.7.1` | SSO kapısı |

### A.5 Müşteriye teslim

Teslim paketi:

- [ ] `securipdf-*-offline.tar.gz` + `.sha256`
- [ ] `MANIFEST.json` (sürüm bilgisi)
- [ ] `docs/AD-KEYCLOAK-SETUP.md` (AD ön hazırlık)
- [ ] Müşteriye özel doldurulmuş `.env` şablonu (LDAP DN, hostname)
- [ ] Kurulum özeti (1 sayfa): FQDN, portlar, break-glass parolası

**Güvenli aktarım:** Şifreli arşiv, kurumsal SFTP, fiziksel medya. `.env` içindeki parolalar ayrı kanaldan iletilmeli.

---

## Bölüm B — Müşteri tarafı (kapalı ağ kurulumu)

### B.1 Ön koşullar (kurulum öncesi)

Müşteri IT ekibi tamamlamalı:

- [ ] Ubuntu 22.04/24.04 LTS, 8+ GB RAM, 100+ GB disk
- [ ] AD: `svc-securipdf` hesabı, `SecuriPDF-Users` / `SecuriPDF-Admins` grupları
- [ ] DNS: `pdf.musteri.local` → sunucu IP
- [ ] Firewall: kullanıcılar → 443 (veya 8080 test)
- [ ] Sunucu → AD LDAP (389/636) erişimi

### B.2 Paketi sunucuya kopyalayın

```bash
# Örnek: /opt altına
sudo mkdir -p /opt/securipdf
sudo tar xzf securipdf-1.0.0-stirling-0.46.2-offline.tar.gz -C /opt/securipdf
cd /opt/securipdf/securipdf-1.0.0-stirling-0.46.2-offline
sha256sum -c ../securipdf-1.0.0-stirling-0.46.2-offline.tar.gz.sha256
```

### B.3 Docker kurulumu (ilk sefer)

**Seçenek 1 — Offline .deb (pakette varsa):**

```bash
sudo ./install.sh --prereqs
newgrp docker
```

**Seçenek 2 — Docker önceden kurulu VM:** bu adımı atlayın.

### B.4 Ortam dosyası

```bash
cp docker/.env.example docker/.env
nano docker/.env
```

Mutlaka müşteri ortamına göre ayarlayın:

- `LDAP_*`, `LDAP_BIND_PASSWORD`
- `PUBLIC_FQDN`, `OAUTH2_*_URL`, `OAUTH2_REDIRECT_URL`
- `KEYCLOAK_*`, `OAUTH2_CLIENT_SECRET`, `VAULT_MASTER_KEY`
- `PUID` / `PGID` → `id -u` / `id -g`

Kapalı ağda issuer URL’leri **iç hostname** kullanmalı; dış DNS çözümlemesi gerekmez.

### B.5 Kurulum (önerilen — installer sihirbazı)

```bash
cd installer
chmod +x install.sh lib/*.sh
./install.sh
```

Sihirbaz birkaç soru sorar, `.env` üretir, stack’i başlatır. LDAP ve SMTP **Admin panelden** yapılır.

Alternatif (manuel):

```bash
./install.sh --load-images --deploy
./install.sh --verify
```

`--load-images`: `images/securipdf-images.tar` → `docker load`  
`--deploy`: stack başlatma + Keycloak realm + LDAP federation  
`--verify`: `test-stack.sh` + healthcheck

### B.6 Tarayıcı testi

| URL | Beklenen |
|-----|----------|
| `http://SUNUCU:8080` | AD girişi → ana sayfa |
| `http://SUNUCU:8080/admin` | Admin paneli |
| `http://SUNUCU:8090` | Keycloak (yalnızca yönetim ağı) |

---

## Bölüm C — Prod (HTTPS) kapalı ağda

1. Kurumsal TLS sertifikasını `docker/nginx/ssl/` altına kopyalayın  
   (self-signed için: `docker/generate-tls.sh` — openssl sunucuda çalışır, internet gerekmez)
2. `docker/.env` içinde HTTPS URL’lerini güncelleyin
3. Prod overlay ile başlatın:

```bash
cd docker
docker compose \
  -f docker-compose.yml \
  -f docker-compose.auth.yml \
  -f docker-compose.offline.yml \
  -f docker-compose.prod.yml \
  up -d --no-build
```

4. Keycloak client redirect URI’lerini HTTPS ile eşleştirin

---

## Bölüm D — Güncelleme (kapalı ağ)

1. Entera yeni `securipdf-*-offline.tar.gz` üretir
2. Müşteriye medya ile iletilir
3. Müşteri:

```bash
./scripts/backup.sh                    # yedek al
./install.sh --load-images               # yeni image'lar
cd docker
docker compose -f docker-compose.yml -f docker-compose.auth.yml \
  -f docker-compose.offline.yml up -d --no-build
./test-stack.sh
```

Rollback: önceki image arşivi saklanmalı (`docker load` + eski tag).

---

## Bölüm E — Sık sorunlar

| Sorun | Çözüm |
|-------|--------|
| `docker load` çok yavaş | Normal; 4–8 GB arşiv 10–30 dk sürebilir |
| `pull` hatası | `docker-compose.offline.yml` kullanıldığından emin olun; `--no-build` |
| Keycloak bootstrap hatası | `pwsh` kurulu mu? Offline `debs-pwsh` veya golden VM |
| LDAP erişim yok | Sunucu → AD firewall; `LDAP_HOST` doğru mu |
| Giriş 500 | AD kullanıcısında `mail` veya `UPN` dolu mu; `fix-keycloak-email.ps1` |

---

## Bölüm F — Kontrol listesi

**Entera (paket öncesi)**

- [ ] `download-offline-debs.sh` (veya golden VM planı)
- [ ] `build-offline-bundle.sh` başarılı
- [ ] CHECKSUMS doğrulandı
- [ ] Test VM’de offline kurulum denendi
- [ ] Müşteri `.env` şablonu hazır

**Müşteri (kurulum günü)**

- [ ] AD hazır
- [ ] Paket kopyalandı, checksum OK
- [ ] Docker kurulu
- [ ] `.env` dolduruldu
- [ ] `install.sh --load-images --deploy` OK
- [ ] `install.sh --verify` OK
- [ ] AD kullanıcı girişi test edildi
- [ ] İlk Vault yedeği alındı

---

## Hızlı komut özeti

```bash
# === ENTERA (internet var) ===
sudo ./scripts/ubuntu/download-offline-debs.sh
./scripts/build-offline-bundle.sh

# === MÜŞTERİ (kapalı ağ) ===
tar xzf securipdf-*-offline.tar.gz && cd securipdf-*-offline
cp docker/.env.example docker/.env && nano docker/.env
sudo ./install.sh --prereqs
./install.sh --load-images --deploy --verify
```
