# SecuriPDF — Keycloak realm export + postgres dump
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

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
$outDir = if ($args[0]) { $args[0] } else { Join-Path $PSScriptRoot "..\backups\keycloak-export" }

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$realmFile = Join-Path $outDir "realm-$realm-$stamp.json"

Write-Host "Keycloak realm export: $realmFile"

docker exec securipdf-keycloak /opt/keycloak/bin/kcadm.sh config credentials `
  --server http://localhost:8080 --realm master --user $admin --password $adminPass 2>$null | Out-Null

docker exec securipdf-keycloak /opt/keycloak/bin/kcadm.sh get "realms/$realm" > $realmFile 2>$null
if (-not (Test-Path $realmFile) -or (Get-Item $realmFile).Length -lt 100) {
  throw "Realm export basarisiz"
}
Write-Host "[OK] Realm export: $realmFile"

$pgDump = Join-Path $outDir "keycloak-db-$stamp.sql"
$dbPass = if ($env:KEYCLOAK_DB_PASSWORD) { $env:KEYCLOAK_DB_PASSWORD } else { "ChangeMe-KcDb-2026" }
docker exec securipdf-postgres pg_dump -U keycloak keycloak > $pgDump 2>$null
if (Test-Path $pgDump) {
  Write-Host "[OK] Postgres dump: $pgDump"
}

Write-Host "Tamam."
