# SecuriPDF — Keycloak login temasini realm'e uygular
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'ps1-common.ps1')
$SecuriPdfTemp = Get-SecuriPdfTempDir

$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      Set-Item -Path "env:$($Matches[1].Trim())" -Value $Matches[2].Trim()
    }
  }
}

$admin = if ($env:KEYCLOAK_ADMIN) { $env:KEYCLOAK_ADMIN } else { "admin" }
$adminPass = if ($env:KEYCLOAK_ADMIN_PASSWORD) { $env:KEYCLOAK_ADMIN_PASSWORD } else { "ChangeMe-KcAdmin-2026" }
$realm = "securipdf"
$theme = "securipdf"

$logoSrc = Join-Path $PSScriptRoot "..\branding\static\classic-logo\StirlingPDFLogoBlackText.svg"
$logoDst = Join-Path $PSScriptRoot "keycloak\themes\securipdf\login\resources\img\logo.svg"
if (Test-Path $logoSrc) {
  Copy-Item $logoSrc $logoDst -Force
  (Get-Content $logoDst -Raw) -replace 'viewBox="0 0 760 180"', 'viewBox="0 0 700 180"' | Set-Content $logoDst -NoNewline
}

Write-Host "Keycloak login temasi uygulaniyor: $theme"

$ready = $false
for ($i = 0; $i -lt 12; $i++) {
  docker exec securipdf-keycloak sh -c "timeout 2 sh -c 'cat < /dev/null > /dev/tcp/127.0.0.1/8080'" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 5
}
if (-not $ready) {
  Write-Warning "Keycloak hazir degil; temayi sonra calistirin: .\apply-keycloak-theme.ps1"
  exit 1
}

docker exec securipdf-keycloak /opt/keycloak/bin/kcadm.sh config credentials `
  --server http://localhost:8080 --realm master --user $admin --password $adminPass | Out-Null

docker exec securipdf-keycloak /opt/keycloak/bin/kcadm.sh update "realms/$realm" `
  -s "loginTheme=$theme" -s "accountTheme=$theme" | Out-Null

$i18nFile = Join-Path $SecuriPdfTemp "securipdf-realm-i18n.json"
$i18nJson = @'
{
  "internationalizationEnabled": true,
  "supportedLocales": ["tr", "en"],
  "defaultLocale": "tr"
}
'@
[System.IO.File]::WriteAllText($i18nFile, $i18nJson)

docker cp $i18nFile "securipdf-keycloak:/tmp/realm-i18n.json" | Out-Null
docker exec securipdf-keycloak /opt/keycloak/bin/kcadm.sh update "realms/$realm" -f /tmp/realm-i18n.json | Out-Null
Remove-Item $i18nFile -Force -ErrorAction SilentlyContinue

Write-Host "Tamam. Login: http://localhost:$(if ($env:KEYCLOAK_HTTP_PORT) { $env:KEYCLOAK_HTTP_PORT } else { '8090' })/realms/$realm/account"
Write-Host "Diller: Turkce (varsayilan), English"
