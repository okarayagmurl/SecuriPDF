@echo off
REM SecuriPDF-LicenseManager.exe (GUI varsayilan)
cd /d "%~dp0"
python -m pip install -q pyinstaller cryptography pyyaml
pyinstaller --noconfirm --onefile --name SecuriPDF-LicenseManager --hidden-import=customer_store --hidden-import=license_core --hidden-import=gui cli.py
echo.
echo Cikti: dist\SecuriPDF-LicenseManager.exe
echo Private key: keys\vendor.ed25519.priv dosyasini exe ile ayni klasore (keys altina) koyun.
echo Musteri kayitlari: data\customers.json
