# SecuriPDF License Manager

Entera tarafı: **müşteri kaydı** + müşteri web’den gelen **`.req` talebinden imzalı `.lic` üretimi**.

## Akış

1. Müşteri Admin → Lisans → **Talep oluştur ve indir** (`.req`)
2. Entera: müşteri kaydet (GUI veya CLI) → `.req` ile lisans üret
3. Müşteri Admin → **Lisans dosyası** ile `.lic` yükle (kurulum kimliği eşleşmeli)
4. Demo: müşteri Admin’de **30 günlük demo başlat** (imza yok, süre bitince ticari `.lic`)

## GUI (önerilen)

```powershell
cd tools\securipdf-license
python gui.py
# veya exe: SecuriPDF-LicenseManager.exe  (args yoksa gui acilir)
```

## CLI

```bash
python cli.py customer-add -n "ACME A.S." --email satis@acme.com
python cli.py customer-list
python cli.py issue -r musteri.req --auto-create -e 2027-12-31 -o acme.lic
python cli.py verify acme.lic
```

Müşteri deposu: `data/customers.json` (gitignore).

Private key: `keys/vendor.ed25519.priv` (gitignore). Public key platformda gömülü.

## Windows exe

```bat
build-exe.bat
```

`dist\SecuriPDF-LicenseManager.exe` — yanına `keys\vendor.ed25519.priv` koyun.
