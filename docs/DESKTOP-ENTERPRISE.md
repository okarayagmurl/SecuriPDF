# SecuriPDF masaüstü: GPO, SCCM, Intune

Windows uygulaması internete bağlanmadan çalışır. Kurumsal dağıtım sessiz kurulum, kayıt defteri ilkesi ve paylaşılan lisans / güncelleme dosyasıyladır.

Kayıt yolu (bilgisayar ilkesi makineyi, kullanıcı ilkesi kullanıcıyı ezer):

`SOFTWARE\Policies\Entera\SecuriPDF\Desktop`

| Değer | Tür | Anlamı |
|---|---|---|
| `LicenseFile` | REG_SZ | İmzalı `.lic` (UNC veya yerel). Yolda `{installation_id}` kullanılabilir. |
| `LicenseDirectory` | REG_SZ | Klasör: önce `{kurulum}.lic`, yoksa `license.lic`. |
| `DisableDemo` | REG_DWORD | `1`: 15 günlük deneme geçersiz. |
| `EnableShellMenu` | REG_DWORD | Varsa menüyü zorlar (`1` açık, `0` kapalı). Yoksa kullanıcı seçer. |
| `AllowTimestamp` | REG_DWORD | `0`: RFC 3161 zaman damgası çalışmaz. |
| `EnableUpdates` | REG_DWORD | `1`: kurum içi `update.json` okunur. |
| `UpdateManifestUrl` | REG_SZ | `update.json` UNC veya yerel yolu. HTTPS yok. |
| `BlockedTools` | REG_SZ | Kapatılacak araç kimlikleri (`timestamp-pdf; compress-pdf`). |
| `AllowedADGroups` | REG_SZ | Yalnızca bu AD gruplarındaki kullanıcılar araç çalıştırır. |

Uygulama ayrıca şunları dener: `%PROGRAMDATA%\Entera\SecuriPDF\license.lic`, aynı klasörde `{kurulum}.lic`, `%LOCALAPPDATA%\net.entera.securipdf.desktop\license\deployed.lic`, ortam değişkeni `SECURIPDF_LICENSE`.

Kurum lisansı (`scope=organization`) tek `.lic` ile tüm bilgisayarlarda geçerlidir. License Manager’da “Kurum lisansı (GPO / SCCM)” veya `cli.py issue --scope organization`.

## GPO

1. `clients/desktop/policy/EnteraSecuriPDF.admx` dosyasını `%windir%\PolicyDefinitions` altına kopyalayın.
2. `tr-TR` ve `en-US` ADML dosyalarını ilgili dil klasörlerine koyun.
3. `gpmc.msc` → Bilgisayar Yapılandırması → İlkeler → Yönetim Şablonları → Entera → SecuriPDF → Masaüstü.
4. `gpupdate /force` sonrası `securipdf-desktop.exe --policy-status --json`.

## SCCM / Intune

Kurulum paketi: `SecuriPDF_*_x64-setup.exe` (NSIS) veya `SecuriPDF_*_x64_en-US.msi`. NSIS sessiz: `/S`. Tüm kullanıcılar: `/S /ALLUSERS`. MSI: `msiexec /i paket.msi /qn ALLUSERS=1`. `Install-SecuriPDF.ps1` her iki türü de kurar.

```powershell
powershell -ExecutionPolicy Bypass -File clients\desktop\deploy\Install-SecuriPDF.ps1 `
  -Installer \\fileserver\SecuriPDF\SecuriPDF_1.2.8_x64-setup.exe `
  -LicenseFile \\fileserver\SecuriPDF\site.lic `
  -PerMachine -DisableDemo -ShellMenu On `
  -EnableUpdates -UpdateManifestUrl \\fileserver\SecuriPDF\update.json
```

- Tespit: `Detect-SecuriPDF.ps1` (çıkış 0 = kurulu).
- Kaldırma: `Uninstall-SecuriPDF.ps1`.
- Yalnız ilke: `Set-SecuriPDFPolicy.ps1`.
- `SECURIPDF_LICENSE` kurulum sırasında `.lic` dosyasını ProgramData ve LocalAppData’ya kopyalar.

Intune Win32 uygulamasında aynı betikler kullanılır. Algılama kuralı olarak tespit betiğini verin.

## Kurum içi güncelleme

`clients/desktop/deploy/update.example.json` örneğini bir paylaşıma koyun, `EnableUpdates=1` ve `UpdateManifestUrl` yazın. Uygulama sürüm büyükse üst çubukta Güncelle gösterir; `securipdf-desktop.exe --update-status --json` aynı bilgiyi verir.

## Komut satırı

```text
securipdf-desktop.exe --license-status --json
securipdf-desktop.exe --license-activate C:\lisans\site.lic
securipdf-desktop.exe --policy-status --json
securipdf-desktop.exe --update-status --json
```
