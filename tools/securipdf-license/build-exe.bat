@echo off
REM SecuriPDF-LicenseManager.exe uret (PyInstaller)
cd /d "%~dp0"
python -m pip install -q pyinstaller cryptography pyyaml
pyinstaller --noconfirm --onefile --name SecuriPDF-LicenseManager cli.py
echo.
echo Cikti: dist\SecuriPDF-LicenseManager.exe
echo Private key'i keys\vendor.ed25519.priv olarak exe yanina koyun.
