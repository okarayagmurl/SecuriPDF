# SecuriPDF — Prod sertlestirme profili uygular
# Dev ortaminda CALISTIRMAYIN — IP kisiti localhost disini engeller
param([switch]$Force)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "SecuriPDF prod sertlestirme profili"
if (-not $Force) {
  Write-Host "UYARI: ip-whitelist.prod.conf localhost disindaki erisimi engeller."
  $confirm = Read-Host "Devam? (evet/hayir)"
  if ($confirm -notmatch '^(evet|e|yes|y)$') { exit 0 }
}

# 1. IP whitelist
Copy-Item -Path (Join-Path $PSScriptRoot "nginx\ip-whitelist.prod.conf") `
  -Destination (Join-Path $PSScriptRoot "nginx\ip-whitelist.conf") -Force
Write-Host "[OK] ip-whitelist.prod.conf uygulandi"

# 2. TLS sertifikasi
& "$PSScriptRoot\generate-tls.ps1"

# 3. .env prod degiskenleri
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $PSScriptRoot ".env.prod.example") $envFile
  Write-Warning ".env olusturuldu — sifreleri doldurun"
}

function Set-EnvVar($name, $value) {
  $content = Get-Content $envFile -Raw
  if ($content -match "(?m)^$name=.*$") {
    $content = $content -replace "(?m)^$name=.*$", "$name=$value"
  } else {
    $content += "`n$name=$value"
  }
  Set-Content -Path $envFile -Value $content.TrimEnd() -NoNewline
  Add-Content -Path $envFile -Value ""
}

Set-EnvVar "OAUTH2_INSECURE_ISSUER" "false"
Set-EnvVar "OAUTH2_SKIP_DISCOVERY" "false"
Set-EnvVar "OAUTH2_ALLOW_UNVERIFIED_EMAIL" "false"
Set-EnvVar "OAUTH2_INSECURE_TLS" "false"
Set-EnvVar "OAUTH2_COOKIE_SECURE" "true"
Write-Host "[OK] .env oauth2 sertlestirme bayraklari guncellendi"

Write-Host ""
Write-Host "Sonraki adimlar:"
Write-Host "  1. .env: VAULT_MASTER_KEY, KEYCLOAK_* parolalarini guncelleyin"
Write-Host "  2. .env: OAUTH2_REDIRECT_URL=https://<hostname>/oauth2/callback"
Write-Host "  3. .\deploy-prod.ps1 -Force"
Write-Host "  veya: docker compose -f docker-compose.yml -f docker-compose.auth.yml -f docker-compose.prod.yml up -d"
