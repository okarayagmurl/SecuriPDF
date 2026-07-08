# Sorun Giderme

## Container Başlamıyor

```bash
cd docker
docker compose logs entera-pdf --tail 100
docker compose ps
```

Yaygın nedenler:

- Yetersiz RAM (minimum 4 GB)
- Port çakışması (`HTTP_PORT` değiştirin)
- Bozuk `settings.yml` (YAML syntax kontrolü)

## Healthcheck Başarısız

```bash
./scripts/healthcheck.sh
curl -v http://localhost/api/v1/info/status
```

Stirling container'ı 90 saniyeye kadar başlangıç süresi gerektirebilir (`start_period`).

### `entera-nginx is unhealthy`

oauth2-proxy bu yüzden başlamaz (`dependency failed to start`).

**Teşhis:**

```bash
cd docker
docker logs entera-nginx --tail 80
docker inspect entera-nginx --format='{{json .State.Health}}' | jq .
```

**Yaygın nedenler:**

| Log / belirti | Çözüm |
|---------------|--------|
| `resolver directive is duplicate` | Prod (HTTPS) modda eski nginx şablonları — güncel kodu çekin; `00-http-snippet.conf` olmalı |
| `cannot load certificate ... securipdf.crt` | HTTPS modu seçildi ama TLS yok — `cd docker && ./generate-tls.sh` |
| `invalid number of arguments in client_max_body_size` | `.env` içinde `CLIENT_MAX_BODY_SIZE=500M` olmalı |
| Nginx log temiz, healthcheck fail | `docker exec entera-nginx wget -qO- http://127.0.0.1:8080/nginx-health` |

**Hızlı onarım (HTTP / lab):**

```bash
cd docker
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d --force-recreate nginx
```

**HTTPS kurulumu:**

```bash
cd docker
./generate-tls.sh
docker compose -f docker-compose.yml -f docker-compose.auth.yml -f docker-compose.prod.yml up -d --force-recreate nginx oauth2-proxy
```

## OCR Çalışmıyor

1. Fat image kullanıldığından emin olun (`*-fat` tag)
2. Tessdata volume mount kontrolü: `entera_data` → `/usr/share/tesseract-ocr/5/tessdata` (eski `/usr/share/tessdata` yolu **geçersiz**)
3. Dil paketi ekleyin:

```bash
bash scripts/setup-tessdata.sh tur
cd docker && docker compose restart entera-pdf
```

Türkçe için `tur.traineddata` dosyasını volume'a ekleyin.

## OCR %40'ta 502 Bad Gateway

İlerleme çubuğu **%40** civarında durup `502 Bad Gateway (nginx)` görürseniz:

1. **Türkçe dil paketi** — varsayılan OCR `tur+eng` seçer; `tur.traineddata` yoksa motor çökebilir:
   ```bash
   bash scripts/setup-tessdata.sh tur
   docker compose -f docker-compose.yml restart entera-pdf
   ```
2. **Bellek** — OCR çok RAM kullanır; Stirling limiti (`STIRLING_MEMORY_LIMIT`, varsayılan 4G) ve Docker Desktop RAM ayarını kontrol edin.
3. **oauth2-proxy zaman aşımı** — `docker-compose.auth.yml` içinde `OAUTH2_PROXY_UPSTREAM_TIMEOUT=3600s` olmalı; değiştirdiyseniz oauth2-proxy'yi yeniden başlatın.
4. **Loglar** — `docker logs entera-pdf --tail 100` ve `docker logs securipdf-platform --tail 50`

## `securipdf-platform is unhealthy` — `Could not import module "app.main"`

**Offline kurulumda** veya repoda `services/platform/app` yokken gorulur.

**Neden:** Eski `docker-compose.auth.yml` dosyalari platform kodunu host'tan mount eder (`../services/platform/app:/app/app`). Offline pakette bu klasor yok; Docker bos dizin olusturur ve image icindeki Python kodunun ustune yazar.

**Dogrulama:**

```bash
docker logs securipdf-platform --tail 20
ls -la ../services/platform/app   # bos dizin (sadece . ..)
```

**Duzeltme (musteri sunucusu):**

```bash
cd docker
# docker-compose.auth.yml icinde su satiri kaldirin veya yorumlayin:
#   - ../services/platform/app:/app/app:ro
docker compose -f docker-compose.yml -f docker-compose.auth.yml -f docker-compose.offline.yml up -d --no-build securipdf-platform
```

Guncel repoda bu mount yalnizca `docker-compose.dev.yml` icindedir (yerel gelistirme). Offline/prod stack'te kullanilmaz.

## Word ↔ PDF Dönüşümü Çalışmıyor

- `file-to-pdf` ve `pdf-to-word` endpoint'lerinin `tools.yml`'de aktif olduğunu doğrulayın
- Fat image gerekli (LibreOffice)
- `./scripts/sync-tools-config.sh` çalıştırıp container'ı restart edin

## Stirling V2 (2.x) yükseltmesi

SecuriPDF **1.1.0+** Stirling-PDF **2.13.1** (V2) kullanır. 0.46.x (V1) kurulumundan geçişte:

1. **Yedek:** `./scripts/backup.sh` — özellikle `entera_config` volume (`settings.yml`, veritabanı)
2. **`.env` güncelle:** `STIRLING_VERSION=2.13.1`, `IMAGE_TAG=1.1.0-stirling-2.13.1`
3. **`./scripts/sync-tools-config.sh`** — araç whitelist senkronu
4. **`./scripts/update.sh`** — image build + compose up
5. **V2 farkları:**
   - `branding/templates/` (Thymeleaf) artık kullanılmaz; UI React tabanlıdır
   - `UI_APPNAME` / `UI_HOMEDESCRIPTION` env değişkenleri yok; `UI_APPNAMENAVBAR` + `branding/static/` geçerli
   - `config/settings.yml` içinde `ui.appName` / `homeDescription` kaldırıldı (navbar adı `appNameNavbar`)

Detay: [Stirling V2 breaking changes](https://docs.stirlingpdf.com/Migration/Breaking-Changes/)

## `/text-editor-pdf` çalışmıyor

Stirling **2.1+** gerekir. `tools.yml` içinde `text-editor-pdf` aktif olmalı ve image `1.1.0-stirling-2.13.1` (veya üzeri) olmalıdır:

```bash
./scripts/sync-tools-config.sh
cd docker && docker compose build entera-pdf && docker compose up -d entera-pdf
```

OCR sonrası alternatif akış: `/ocr-pdf` → `/pdf-to-word` → düzenle → `/file-to-pdf`

## Araçlar Hâlâ Görünüyor

1. `config/settings.yml` mount edildiğinden emin olun
2. `ui.defaultHideUnavailableTools: true` olmalı
3. Container restart gerekli (runtime reload yok)

```bash
cd docker && docker compose restart entera-pdf
```

## Branding Değişmiyor

- Logo: `UI_LOGOSTYLE=classic` ve `branding/static/classic-logo/` path uyumu
- Tarayıcı cache temizleyin
- Volume mount: `../branding:/customFiles:ro`

## Auth / Keycloak

### `Keycloak hazir degil` (bootstrap)

Bootstrap scripti Keycloak'in HTTP portunu dinlemesini bekler (eski surum ~2 dk; guncel ~5 dk).

**1. Container durumu**

```bash
docker ps -a --filter name=securipdf-keycloak
docker logs securipdf-keycloak --tail 60
docker logs securipdf-postgres --tail 20
```

**2. Hazirlik testi (host'tan)**

```bash
curl -sf http://127.0.0.1:8090/health/ready && echo OK
curl -sf http://127.0.0.1:8090/realms/master && echo OK
```

`curl` basarili olunca:

```bash
cd docker
sudo bash bootstrap-stack-auth.sh
```

**Sik nedenler**

| Log / belirti | Cozum |
|---------------|--------|
| `password authentication failed for user "keycloak"` | Postgres volume eski sifre ile kaldi — `.env` `KEYCLOAK_DB_PASSWORD` uyumsuz |
| `OutOfMemoryError` / surekli restart | RAM artirin (onerilen 8 GB) |
| Ilk kurulum, henuz `started` yok | 3-5 dk bekleyin |
| Container `Exited` | `docker logs securipdf-keycloak` tam ciktiyi inceleyin |

### Admin Operasyon: "Not Found" (sürüm API)

**Neden:** Platform container eski image ile calisiyor; `/api/vault/v1/admin/ops/version` endpoint'i yok (404).

**Dogrulama:**

```bash
docker exec securipdf-platform curl -sf http://127.0.0.1:8000/openapi.json | grep ops/version
# Cikti yoksa image guncel degil
```

**Duzeltme:**

```bash
cd ~/SecuriPDF && git pull
sudo bash scripts/patch-logout-deploy.sh
```

Tarayicida Ctrl+Shift+R ile onbellegi temizleyin.

### `.env: line N: PDF: command not found`

**Neden:** `.env` icinde bosluklu degerler (`UI_HOMEDESCRIPTION=Kurumsal PDF ...`) bash `source` ile okununca `PDF` komut sanilir.

**Duzeltme:** Degerleri tirnak icine alin veya guncel `docker/load-env.sh` kullanin:

```bash
sed -i 's/^UI_HOMEDESCRIPTION=.*/UI_HOMEDESCRIPTION="Kurumsal PDF islem platformu"/' docker/.env
sed -i 's/^LDAP_GROUP_FILTER=.*/LDAP_GROUP_FILTER="(cn=SecuriPDF-*)"/' docker/.env
cd docker && bash bootstrap-stack-auth.sh
```

### Bootstrap hatasi (kcadm yardim metni)

PowerShell'de `$Args` ayrilmis degiskendir — guncel `bootstrap-keycloak-realm.ps1` kullanin.

```powershell
cd docker
.\bootstrap-keycloak-realm.ps1
```

### Internal Server Error (500) — giris veya callback sonrasi

**En sik neden:** `.env` icinde `OAUTH2_CLIENT_SECRET=` bos — oauth2-proxy ile Keycloak client secret uyusmuyor.

```bash
cd docker
grep OAUTH2_CLIENT_SECRET .env
docker logs securipdf-oauth2-proxy --tail 40
```

`invalid_client`, `unauthorized_client` veya `token exchange` gorurseniz:

```bash
# .env'e secret ekleyin (ornek; bootstrap ayni degeri Keycloak'a yazar)
sed -i 's|^OAUTH2_CLIENT_SECRET=.*|OAUTH2_CLIENT_SECRET=SecuriPDF-OAuth2-Dev-Secret-2026|' .env
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d --force-recreate oauth2-proxy
pwsh -File bootstrap-keycloak-realm.ps1
```

Diger loglar:

```bash
docker logs entera-nginx --tail 30
docker logs entera-pdf --tail 30
docker logs securipdf-keycloak --tail 30
docker compose -f docker-compose.yml -f docker-compose.auth.yml ps
```

### Login loop veya 502

1. `OAUTH2_CLIENT_SECRET` Keycloak client secret ile eslesmeli
2. Redirect URI: `http://SUNUCU_IP:8080/oauth2/callback` (localhost degil)
3. oauth2-proxy log: `docker logs securipdf-oauth2-proxy --tail 50`

### `192.168.x.x:8080` acinca `localhost:8090` yonleniyor

**Neden:** `.env` icinde yalnizca `OAUTH2_REDIRECT_URL` IP iken `KEYCLOAK_HOSTNAME` hala `localhost` (veya oauth2-proxy yeniden baslatilmadi).

**Tek komutla duzeltme:**

```bash
cd docker
chmod +x fix-access-url.sh
./fix-access-url.sh 192.168.6.175
```

Manuel `.env` (tum satirlar ayni IP olmali):

```bash
KEYCLOAK_HOSTNAME=192.168.6.175
PUBLIC_FQDN=192.168.6.175
OAUTH2_ISSUER_URL=http://192.168.6.175:8090/realms/securipdf
OAUTH2_REDIRECT_URL=http://192.168.6.175:8080/oauth2/callback
OAUTH2_LOGIN_URL=http://192.168.6.175:8090/realms/securipdf/protocol/openid-connect/auth?ui_locales=tr
```

Sonra:

```bash
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d --force-recreate oauth2-proxy keycloak
pwsh -File bootstrap-keycloak-realm.ps1
docker exec securipdf-oauth2-proxy printenv OAUTH2_PROXY_LOGIN_URL
# Beklenen: http://192.168.6.175:8090/realms/...
```

### AD kullanicisi giremiyor

- Kullanici adi: `Administrator` (sAMAccountName) — e-posta degil
- LDAP connectionUrl bozuksa: PowerShell `$ldapHost:389` hatasi — `.\fix-keycloak-ldap.ps1` calistirin
- Keycloak UI: User federation → connection URL `ldap://192.168.6.10:389` olmali (bos `ldap://` degil)
- LDAP: `.\fix-keycloak-ldap.ps1`
- AD erisimi: `docker exec securipdf-keycloak sh -c "timeout 3 bash -c '</dev/tcp/192.168.6.10/389' && echo OK"`
- Break-glass: `securipdf-local-admin` / `SecuriPDF-Local-Admin-2026`

### "Kimlik saglayiciya ... beklenmeyen bir hata"

Keycloak LDAP URL bos (`ldap://`) ise fix script calistirin. Gecici cozum: break-glass kullanici ile giris.

### LDAP sync UnknownError

Keycloak Admin REST veya UI ile sync basarisiz olursa:

1. `.\fix-keycloak-ldap.ps1` — bind parolasi ayri guncellenir
2. Keycloak UI: User federation → **Test connection** → **Sync all users**
3. AD erisimi: port 389, `LDAP_BIND_PASSWORD`, `CN=svc-securipdf,...` bind DN

Hardcoded rol mapper (`SecuriPDF-Admins` → `pdf-admin`) grup sync olmasa da calisir.

### Admin paneli acilmiyor

`/admin` icin Keycloak'ta `pdf-admin` rolu gerekir. Break-glass: `securipdf-local-admin`

**403 "Admin yetkisi gerekli"** — oturum var ama token'da rol yok:

1. Keycloak'ta kullaniciya `pdf-admin` atanmis mi kontrol edin
2. Token mapper (opsiyonel): `cd docker; .\fix-keycloak-token-roles.ps1` — roller ust seviye `roles` claim'ine tasinir
3. oauth2-proxy provider: `keycloak-oidc` (Keycloak realm rollerini okur)
4. Platform access token'dan `realm_access.roles` okur (yedek)
5. **Tam cikis yapip tekrar giris** — http://localhost:8080/oauth2/sign_out

### Platform / Vault API 401

API oturum gerektirir — tarayicidan `8080` uzerinden giris yapin; dogrudan curl icin oauth2-proxy header'lari gerekir.

---

## Büyük Dosya Yükleme Hatası

### Türkçe karakterli dosya adı — Internal Server Error (önizleme / indirme)

**Belirti:** `UnicodeEncodeError: 'latin-1' codec can't encode character` — log'da `preview_document` veya `Content-Disposition`.

**Neden:** Dosya adında `ı`, `ş`, `ğ` gibi karakterler varken HTTP başlığı latin-1 ile kodlanamıyor.

**Çözüm:** Güncel platform image (RFC 5987 `filename*=UTF-8` desteği). Geçici: dosyayı ASCII adla yeniden yükleyin.

Nginx ve Stirling limitlerini kontrol edin:

- `CLIENT_MAX_BODY_SIZE=500M` (nginx)
- `SYSTEM_MAXFILESIZE=500` (Stirling, MB)

## Loglar

```bash
docker compose -f docker/docker-compose.yml logs -f entera-pdf
docker compose -f docker/docker-compose.yml logs -f nginx
```

Volume: `entera-pdf_entera_logs`

## PDF → CBR / CBR → PDF (403)

403 genelde **premium** değil; Stirling bağımlılık grubu:

| Yön | Gereksinim | Not |
|-----|------------|-----|
| PDF → CBR | Host/container PATH'te `rar` | Resmi image lisans nedeniyle `rar` içermez; `docker/Dockerfile` RARLAB binary ekler |
| CBR → PDF | Junrar (Java, fat image) | Ayrı `unrar` gerekmez |

`pdf-to-cbr` / `cbr-to-pdf` `endpoints.toRemove` listesinde olmamalı. `premium.enabled` Pro özellikleri içindir; CBR `rar` grubuna bağlıdır.

Stirling logunda şunu görürseniz `rar` eksiktir:

```text
Missing dependency: rar - Disabling group: rar (Affected features: PDF To Cbr)
```

**Düzeltme:** `entera-pdf` image'ını yeniden build edin (`docker/Dockerfile` rar kurulumu). Alternatif: host'taki `/usr/local/bin/rar` dosyasını volume ile bağlayın.

```bash
cd docker
docker compose build entera-pdf
docker compose up -d entera-pdf
docker compose logs entera-pdf | findstr /i "rar"
```

Ticari kullanımda [RARLAB lisans](https://www.rarlab.com/license.htm) şartlarını kontrol edin. Mümkünse CBZ tercih edin.

## URL → PDF (403, 415 veya 500)

1. **403 — endpoint disabled:** `SYSTEM_ENABLEURLTOPDF=true` (compose) ve `config/custom_settings.yml` içinde `system.enableUrlToPDF: true`. Env `false` iken YAML `true` olsa bile Stirling endpoint'i kapatır.
2. **415 — Desteklenmeyen dosya türü:** Yalnızca `urlInput` gönderilmeli; platform istekleri her zaman `multipart/form-data` olmalı (dosyasız urlencoded yasak).
3. **500 — WeasyPrint / ağ:** Fat image (`*-fat`) WeasyPrint içermeli. Container hedef URL'ye çıkabilmeli. JS gerektiren SPA'lar boş/hatalı PDF üretebilir — basit statik sayfa deneyin (`https://example.com`). Stirling log: `docker logs entera-pdf --tail 80`.

```bash
cd docker && docker compose up -d --force-recreate entera-pdf
```

## CBR → PDF (400)

Stirling Junrar yalnızca **`.cbr` / `.rar`** uzantısını kabul eder; RAR5 ve şifreli arşivler sıkça reddedilir. Dosya adında uzantı olduğundan emin olun. Mümkünse CBZ kullanın.

## Otomatik Ayır (auto-split-pdf)

1. **QR (Stirling):** Resmi ayraç QR (`https://github.com/Stirling-Tools/Stirling-PDF` vb.). Ayraçları yazdırıp belgeler arasına koyun.
2. **Boş sayfa (platform yedek):** QR yoksa PyMuPDF boş/beyaz sayfaları ayraç kabul eder; çıktı ZIP. Çizgi/ayraç işareti algılanmaz.
3. `duplexMode=true` ayraçtan sonraki sayfayı da atar.

## UI değişiklikleri görünmüyor (önbellek)

Statik dosyalar tarayıcıda agresif önbelleklenebilir.

1. `index.html` içindeki `?v=` sürüm numaralarını kontrol edin (`app.css`, `app.js`, `tool-panels.js`, `ui-tooltips.js`, `pdf-preview-nav.js`).
2. Tarayıcıda **Ctrl+Shift+R** (hard refresh) veya gizli pencere deneyin.
3. Platform container'ı statik dosyaları image içinden sunar; host mount kullanıyorsanız dosyaların güncel olduğundan emin olun.

**Platform image yeniden derleme (statik dosya güncellemesi):**

```bash
cd docker
docker compose -f docker-compose.yml -f docker-compose.auth.yml build securipdf-platform
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d securipdf-platform
```

Dev ortamında `services/platform/app/static/app/` doğrudan mount ediliyorsa yalnızca container restart yeterli olabilir:

```bash
docker compose -f docker-compose.yml -f docker-compose.auth.yml restart securipdf-platform
```

## Audit logda kullanıcı adı görünmüyor

Audit kayıtları `userId` (teknik kimlik) ile yazılır. Admin panel **Denetim** sekmesinde artık `userLabel` (görünen ad / e-posta) gösterilir. Kullanıcı dizini, oturum açan kullanıcıların `/api/app/v1/me` çağrısında güncellenir — mevcut kullanıcıların bir kez uygulamaya girmesi gerekir.

## Hatalı işler ve destek raporu (Kayıt No)

Her işe `RPT-YYYYMMDD-XXXXXX` formatında **Kayıt No** atanır.

| Rol | Ne yapılır |
|-----|------------|
| Kullanıcı | `#/isler` → hatalı satırda **Raporu kopyala** veya **Yalnızca hatalı** filtresi |
| Admin | **Merkezi iş kuyruğu** → Kayıt No ile filtre veya `GET /api/admin/v1/support-reports/{reportId}` |

**Debug modu** (Admin → Sistem / Uyumluluk): Açıkken hata raporlarına Stirling HTTP yanıt özeti ve form alan adları eklenir (dosya içeriği veya şifre yok). Test sürecinde geçici olarak açın; üretimde kapalı tutun.

```bash
# Örnek: sunucuda rapor dosyası
ls /vault-data/debug-reports/
```

## Destek

1. `./scripts/backup.sh` ile yedek alın
2. `docker compose logs` çıktısını kaydedin
3. `VERSION` ve `docker/.env` (şifreler hariç) bilgisini paylaşın
