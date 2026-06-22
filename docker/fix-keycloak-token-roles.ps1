# Keycloak token — realm rollerini ust seviye 'roles' claim'ine yazar
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Invoke-Kcadm {
  param([string[]]$KcadmArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = docker exec securipdf-keycloak /opt/keycloak/bin/kcadm.sh @KcadmArgs 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0) { throw ($out | Out-String) }
  return ($out | Out-String)
}

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
$scopeId = "a3af842d-f268-42c1-b5f7-5d4b925cf5f9"
$mapperId = "d6c5848e-bac3-4957-a354-ca09f4d54996"
$mapperFile = Join-Path $PSScriptRoot "keycloak-realm-roles-mapper.json"

if (-not (Test-Path $mapperFile)) { throw "Mapper sablonu bulunamadi: $mapperFile" }

Invoke-Kcadm @("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", $admin, "--password", $adminPass) | Out-Null
docker cp $mapperFile "securipdf-keycloak:/tmp/realm-roles-mapper.json" | Out-Null
Invoke-Kcadm @("update", "client-scopes/$scopeId/protocol-mappers/models/$mapperId", "-r", $realm, "-f", "/tmp/realm-roles-mapper.json") | Out-Null

$verify = Invoke-Kcadm @("get", "client-scopes/$scopeId/protocol-mappers/models/$mapperId", "-r", $realm)
if ($verify -notmatch '"claim.name"\s*:\s*"roles"') {
  throw "Mapper guncellenemedi"
}

Write-Host "Keycloak: realm roles -> claim 'roles' OK"
Write-Host "Provider: oauth2-proxy keycloak-oidc (role: prefix desteklenir)"
Write-Host "Cikis yapip tekrar giris yapin: http://localhost:8080/oauth2/sign_out"
