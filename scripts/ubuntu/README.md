# Ubuntu sunucu scriptleri

| Script | Nerede çalışır | Açıklama |
|--------|----------------|----------|
| [download-offline-debs.sh](download-offline-debs.sh) | **Entera (internet var)** | Docker + pwsh `.deb` → `offline/debs/` |
| [install-prerequisites-offline.sh](install-prerequisites-offline.sh) | **Müşteri (kapalı ağ)** | Yerel `.deb` ile Docker + pwsh kurulumu |
| [install-prerequisites.sh](install-prerequisites.sh) | Online Ubuntu | Docker apt repo ile kurulum |

## `.deb` hazırlama (kısa)

```bash
cd SecuriPDF
sudo bash scripts/ubuntu/download-offline-debs.sh
ls offline/debs/*.deb offline/debs-pwsh/*.deb
```

Sonra: `./scripts/build-offline-bundle.sh`

Kılavuz: [docs/OFFLINE-INSTALL.md](../docs/OFFLINE-INSTALL.md)
