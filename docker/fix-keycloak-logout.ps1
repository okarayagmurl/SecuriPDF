# Keycloak securipdf client — post-logout redirect URI (cikis sonrasi login ekrani)
$ErrorActionPreference = "Stop"
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-DotEnvValue($Key) {
  $envFile = Join-Path $PSScriptRoot ".env"
  if (-not (Test-Path $envFile)) { return $null }
  foreach ($line in Get-Content $envFile) {
    if ($line -match "^${Key}=(.*)$") { return $Matches[1].Trim() }
  }
  return $null
}

$redirectUrl = Get-DotEnvValue "OAUTH2_REDIRECT_URL"
if (-not $redirectUrl) { $redirectUrl = "http://localhost:8080/oauth2/callback" }
$appBase = ($redirectUrl -replace '/oauth2/callback.*$', '')
if (-not $appBase) { throw "OAUTH2_REDIRECT_URL gecersiz: $redirectUrl" }

$postLogout = "$appBase/*"
$realm = if ($env:KEYCLOAK_REALM) { $env:KEYCLOAK_REALM } else { "securipdf" }
$clientId = if ($env:OAUTH2_CLIENT_ID) { $env:OAUTH2_CLIENT_ID } else { "securipdf" }

function Invoke-Kcadm {
  param([string[]]$Args)
  docker exec securipdf-keycloak /opt/keycloak/bin/kcadm.sh @Args 2>&1
}

$kcAdmin = if ($env:KEYCLOAK_ADMIN) { $env:KEYCLOAK_ADMIN } else { "admin" }
$kcPass = if ($env:KEYCLOAK_ADMIN_PASSWORD) { $env:KEYCLOAK_ADMIN_PASSWORD } else { "ChangeMe-KcAdmin-2026" }
Invoke-Kcadm @("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", $kcAdmin, "--password", $kcPass) | Out-Null

$clients = Invoke-Kcadm @("get", "clients", "-r", $realm, "-q", "clientId=$clientId") | Out-String
if ($clients -notmatch '"id"\s*:\s*"([^"]+)"') {
  throw "Keycloak client bulunamadi: $clientId"
}
$cid = $Matches[1]

Invoke-Kcadm @(
  "update", "clients/$cid", "-r", $realm,
  "-s", "attributes.post.logout.redirect.uris=$postLogout",
  "-s", "frontchannelLogout=true"
) | Out-Null

Write-Host "Keycloak post-logout URI guncellendi: $postLogout"
Write-Host "Cikis testi: $appBase/oauth2/sign_out"
