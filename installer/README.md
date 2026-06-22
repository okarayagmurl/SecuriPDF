# SecuriPDF Installer

Müşteri kurulumu için **minimal sihirbaz**: birkaç soru → sistem ayağa kalkar → geri kalan ayarlar **Admin panel** (`/admin`) üzerinden yapılır.

## Mantık

| Kurulumda (installer) | Kurulum sonrası (Admin panel) |
|------------------------|-------------------------------|
| Sunucu adresi / port | LDAP / AD detayları |
| HTTPS evet/hayır | SMTP |
| Gizli anahtarlar (otomatik) | Vault kota, lisans, marka |
| Break-glass admin parolası | Operasyon, yedek, prod hazırlık |
| Docker stack başlatma | Keycloak'a LDAP uygula |

**İlk giriş:** `securipdf-local-admin` + kurulum parolası (varsayılan: `SecuriPDF-Install-2026!`)

LDAP kurulumda **bilerek boş** bırakılır; `bootstrap-keycloak-realm.ps1` LDAP'ı atlar. Admin panelden yapılandırıp **Keycloak'a uygula** ile federation eklenir.

## Kullanım

```bash
cd SecuriPDF/installer
chmod +x install.sh lib/*.sh
./install.sh
```

Hızlı (soru sormadan, localhost:8080):

```bash
./install.sh --yes
```

## Offline

Image arşivini şuraya koyun:

```
installer/images/securipdf-images.tar
```

veya `build-offline-bundle.sh` çıktısındaki `images/` klasörünü kopyalayın. Sihirbaz arşivi bulunca offline modu önerir.

## Çıktılar

| Dosya | Açıklama |
|-------|----------|
| `docker/.env` | Otomatik üretilen ortam |
| `installer/CREDENTIALS-*.txt` | İlk giriş ve Keycloak admin parolaları |

`CREDENTIALS-*.txt` dosyasını güvenli saklayın; LDAP yapılandırmasından sonra silin.

## Admin panel sonrası akış

1. `http://SUNUCU:8080/admin` → giriş (`securipdf-local-admin`)
2. **Active Directory / LDAP** → host, DN, bind parolası → Kaydet
3. **Bağlantı testi** → **Keycloak'a uygula**
4. **Operasyon** → ortam bilgisi, ilk yedek

Detay: [docs/INSTALL-UBUNTU.md](../docs/INSTALL-UBUNTU.md) · Kapalı ağ: [docs/OFFLINE-INSTALL.md](../docs/OFFLINE-INSTALL.md)
