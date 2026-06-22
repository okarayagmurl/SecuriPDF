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
2. Tessdata volume mount kontrolü: `entera_data` → `/usr/share/tessdata`
3. Dil paketi ekleyin:

```bash
docker run --rm -v entera-pdf_entera_data:/data alpine ls /data
```

Türkçe için `tur.traineddata` dosyasını volume'a ekleyin.

## Word ↔ PDF Dönüşümü Çalışmıyor

- `file-to-pdf` ve `pdf-to-word` endpoint'lerinin `tools.yml`'de aktif olduğunu doğrulayın
- Fat image gerekli (LibreOffice)
- `./scripts/sync-tools-config.sh` çalıştırıp container'ı restart edin

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

### Bootstrap hatasi (kcadm yardim metni)

PowerShell'de `$Args` ayrilmis degiskendir — guncel `bootstrap-keycloak-realm.ps1` kullanin.

```powershell
cd docker
.\bootstrap-keycloak-realm.ps1
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

Nginx ve Stirling limitlerini kontrol edin:

- `CLIENT_MAX_BODY_SIZE=500M` (nginx)
- `SYSTEM_MAXFILESIZE=500` (Stirling, MB)

## Loglar

```bash
docker compose -f docker/docker-compose.yml logs -f entera-pdf
docker compose -f docker/docker-compose.yml logs -f nginx
```

Volume: `entera-pdf_entera_logs`

## Destek

1. `./scripts/backup.sh` ile yedek alın
2. `docker compose logs` çıktısını kaydedin
3. `VERSION` ve `docker/.env` (şifreler hariç) bilgisini paylaşın
