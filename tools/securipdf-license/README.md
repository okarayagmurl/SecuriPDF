# SecuriPDF License Manager

Tek araç: **lisans üretimi (generator)** + **doğrulama / inceleme (manager)**.

## Kurulum (geliştirme)

```bash
pip install cryptography pyyaml
cd tools/securipdf-license
python cli.py packages
```

Vendor private key: `keys/vendor.ed25519.priv` (gitignore — Entera ops’ta saklanır).
Public key platformda gömülü: `services/platform/app/license_file.py`.

## Komutlar

```bash
# Katalog
python cli.py packages

# Lisans üret
python cli.py generate -p professional -c "Musteri A.S." -e 2027-12-31 -o musteri.lic

# Dogrula
python cli.py verify musteri.lic

# Ozet
python cli.py info musteri.lic
```

## Windows exe

```powershell
cd tools\securipdf-license
pip install pyinstaller cryptography pyyaml
pyinstaller --onefile --name SecuriPDF-LicenseManager cli.py
# dist\SecuriPDF-LicenseManager.exe
```

Exe ile aynı klasöre `keys\vendor.ed25519.priv` koyun veya `--key` verin.

## Müşteri tarafı

Üretilen `.lic` dosyası Admin → Lisans → **Lisans dosyası yükle** ile uygulanır.
Platform imzayı public key ile doğrular; süresi dolmuşsa reddeder.
