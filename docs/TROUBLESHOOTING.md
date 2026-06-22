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
2. Redirect URI: `http://localhost:8080/oauth2/callback`
3. oauth2-proxy log: `docker logs securipdf-oauth2-proxy --tail 50`

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
