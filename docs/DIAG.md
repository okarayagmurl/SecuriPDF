# SecuriPDF teşhis sayfası (SSO bağımsız)

Uygulama / Keycloak / oauth2-proxy çalışmasa bile host üzerindeki **updater** servisi teşhis UI sunar.

## Erişim

```
http://<sunucu-ip>:8765/diag
```

- Yerel parola: `SECURIPDF_DIAG_PASSWORD` (`/etc/securipdf/updater.env`)
- Kurulumda `install-updater.sh` otomatik üretir ve ekrana yazar
- Bearer token gerekmez (oturum çerezi, 24 saat)

## Ne kontrol eder?

- Docker daemon
- Beklenen container’lar (platform, oauth2-proxy, keycloak, nginx, entera-pdf, postgres)
- `MANIFEST.json` / offline dizin / image arşivi (full veya delta)
- `curl` probe: nginx-health, /health, updater /health
- Disk kullanımı
- Son 40 satır container logları

JSON: `GET /diag/api` (aynı oturum)

## Parola değiştirme

```bash
sudo nano /etc/securipdf/updater.env   # SECURIPDF_DIAG_PASSWORD=...
sudo systemctl restart securipdf-updater
```

## Not

Bu sayfa **platform container içinde değildir**; host agent’tır. Firewall’da 8765 yalnızca yönetim ağından açılmalıdır.
