# Temiz offline kurulum — test checklist (1.2.1)

Kod: `main` @ `1f025f2` · Sürüm: `1.2.1-stirling-2.14.3`

## A) Build makinesi (internet VAR)

```bash
cd ~/SecuriPDF   # veya clone
git pull origin main
cat VERSION   # 1.2.1-stirling-2.14.3

# Deb'ler yoksa (ilk kez)
sudo bash scripts/ubuntu/download-offline-debs.sh

# Full paket (delta otomatik üretilir — PREV_VERSION varsa)
chmod +x scripts/build-offline-bundle.sh scripts/build-offline-delta.sh scripts/verify-offline-bundle.sh
bash scripts/build-offline-bundle.sh
# Delta atlamak icin: SKIP_DELTA=1 bash scripts/build-offline-bundle.sh

# Dogrulama
bash scripts/verify-offline-bundle.sh
```

## B) Test sunucusu — temiz kurulum (192.168.6.175)

**Uyarı:** Aşağıdakiler mevcut stack’i siler (`down -v`).

```bash
# 1) Durdur + volume sil
cd ~/securipdf-*-offline/docker 2>/dev/null && \
  docker compose -f docker-compose.yml -f docker-compose.auth.yml down -v || true
docker rm -f securipdf-platform securipdf-oauth2-proxy securipdf-keycloak \
  securipdf-nginx entera-pdf securipdf-postgres 2>/dev/null || true

# 2) Paketi aç
cd ~
tar xzf /path/to/securipdf-1.2.1-stirling-2.14.3-offline.tar.gz
cd securipdf-1.2.1-stirling-2.14.3-offline

# 3) Önkoşul + kurulum
sudo bash scripts/ubuntu/install-prerequisites-offline.sh
cd installer && ./install.sh
# IP: 192.168.6.175  (localhost yazmayın)

# 4) Updater + teşhis
cd ..
sudo SECURIPDF_OFFLINE_DIR="$(pwd)" bash scripts/securipdf-updater/install-updater.sh
# Ekrandaki SECURIPDF_DIAG_PASSWORD not edin
```

## C) Doğrulama

| Kontrol | Komut / URL |
|---------|-------------|
| Nginx | `curl -sf http://192.168.6.175:8080/nginx-health` |
| Platform | `curl -sf http://192.168.6.175:8080/health` |
| Setup | http://192.168.6.175:8080/setup |
| **Teşhis** | http://192.168.6.175:8765/diag (yerel parola) |
| Stack test | `bash docker/test-stack.sh` |

Setup: depolama + admin kullanıcı → bitir → giriş.

## D) Delta upgrade smoke (opsiyonel, ikinci tur)

1.2.0 full kuruluysa delta `.tar.gz` yükle / aç → `upgrade-offline-stack.sh` → IMAGE_TAG 1.2.1.
