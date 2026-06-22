# SecuriPDF Platform Service

Faz 3–6 birleşik backend: **Vault**, **Admin**, **License**, **Orchestration**.

## Modüller

| Modül | Prefix | Açıklama |
|-------|--------|----------|
| Vault | `/api/vault/v1` | Belgeler, imzalar, sertifikalar, kota |
| Admin | `/api/vault/v1/admin` | Kota, LDAP bilgisi, audit, lisans (pdf-admin) |
| Orchestration | `/api/orchestration` | Stirling sign entegrasyonu |
| License | `/api/license/v1` | Paket, araç listesi, oturum limiti |
| Admin UI | `/admin` | Statik yönetim paneli |

## Geliştirme

```bash
cd services/platform
pip install -r requirements.txt
export PLATFORM_DEV_AUTH=true
export VAULT_MASTER_KEY=dev-master-key-change-in-production!!
uvicorn app.main:app --reload --port 8000
```

## Docker

`docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d --build securipdf-platform`
