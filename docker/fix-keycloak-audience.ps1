# Keycloak securipdf client — access token aud claim'ine client id ekler (oauth2-proxy uyumu)
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
$clientId = if ($env:OAUTH2_CLIENT_ID) { $env:OAUTH2_CLIENT_ID } else { "securipdf" }
$mapperName = "audience-$clientId"
$mapperFile = Join-Path $PSScriptRoot "keycloak-audience-mapper.json"
if (-not (Test-Path $mapperFile)) { throw "Mapper sablonu bulunamadi: $mapperFile" }

Invoke-Kcadm @("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", $admin, "--password", $adminPass) | Out-Null

$clients = Invoke-Kcadm @("get", "clients", "-r", $realm, "-q", "clientId=$clientId")
if ($clients -notmatch '"id"\s*:\s*"([^"]+)"') {
  throw "OAuth client bulunamadi: $clientId"
}
$clientUuid = $Matches[1]

$existing = ""
try {
  $existing = Invoke-Kcadm @("get", "clients/$clientUuid/protocol-mappers/models", "-r", $realm)
} catch { }

if ($existing -match [regex]::Escape($mapperName)) {
  Write-Host "Audience mapper zaten mevcut: $mapperName"
} else {
  docker cp $mapperFile "securipdf-keycloak:/tmp/audience-mapper.json" | Out-Null
  Invoke-Kcadm @("create", "clients/$clientUuid/protocol-mappers/models", "-r", $realm, "-f", "/tmp/audience-mapper.json") | Out-Null
  Write-Host "Audience mapper olusturuldu: $mapperName -> $clientId"
}

Write-Host "Tamam. oauth2-proxy yeniden baslatilip tekrar giris yapin."
