# SecuriPDF — Prod ortam deploy (TLS edge + sertlestirme)
param(
  [switch]$Force,
  [switch]$SkipHardening,
  [switch]$SkipBootstrap
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $SkipHardening) {
  & "$PSScriptRoot\apply-prod-hardening.ps1" -Force:$Force
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Prod stack baslatiliyor (TLS edge nginx:443)..."
docker compose -f docker-compose.yml -f docker-compose.auth.yml -f docker-compose.prod.yml up -d --build @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Servisler hazirlaniyor..."
Start-Sleep -Seconds 20

if (-not $SkipBootstrap) {
  & "$PSScriptRoot\bootstrap-keycloak-realm.ps1"
}

& "$PSScriptRoot\test-stack.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "SecuriPDF (prod):     https://localhost (veya .env PUBLIC_HOSTNAME)"
Write-Host "Admin UI:             https://localhost/admin"
Write-Host "Keycloak admin:       https://localhost:8090 (veya ayri hostname)"
Write-Host ""
Write-Host "Not: OAUTH2_REDIRECT_URL ve Keycloak redirect URI'leri https olmalidir."
