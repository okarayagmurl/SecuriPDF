# SecuriPDF — Keycloak + oauth2-proxy + Platform ile başlat
param(
  [switch]$SkipTest,
  [switch]$Dev
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$composeFiles = @(
  "-f", "docker-compose.yml",
  "-f", "docker-compose.auth.yml"
)
if ($Dev) {
  $composeFiles += @("-f", "docker-compose.dev.yml")
  Write-Host "Dev modu: platform kodu host'tan mount ediliyor (offline/prod'da -Dev kullanmayin)."
}

Write-Host "SecuriPDF tam stack baslatiliyor..."
docker compose @composeFiles up -d --build @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Servisler hazirlaniyor..."
Start-Sleep -Seconds 15

& "$PSScriptRoot\bootstrap-keycloak-realm.ps1"

if (-not $SkipTest) {
  & "$PSScriptRoot\test-stack.ps1"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$httpPort = if ($env:HTTP_PORT) { $env:HTTP_PORT } else { "8080" }
Write-Host ""
Write-Host "SecuriPDF (auth):     http://localhost:$httpPort"
Write-Host "Admin UI:             http://localhost:$httpPort/admin"
Write-Host "Vault API:            http://localhost:$httpPort/api/vault/v1"
Write-Host "Keycloak admin:       http://localhost:8090"
Write-Host "Cikis:                http://localhost:$httpPort/oauth2/sign_out"
