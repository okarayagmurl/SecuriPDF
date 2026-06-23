# Offline paket dosyalari (git'e eklenmez)

Build makinesinde `download-offline-debs.sh` ile doldurulur:

| Klasör | İçerik |
|--------|--------|
| `debs/` | Docker Engine + Compose plugin (.deb) |
| `debs-pwsh/` | PowerShell `pwsh` (.deb) — Keycloak bootstrap |

`build-offline-bundle.sh` bu klasörleri offline kurulum paketine dahil eder.

**Önemli:** `.deb` dosyalarını müşteri Ubuntu sürümü ile **aynı major** sürümde indirin (22.04 → 22.04, 24.04 → 24.04).

Detaylı adımlar: [docs/OFFLINE-INSTALL.md](../docs/OFFLINE-INSTALL.md) — Bölüm A
