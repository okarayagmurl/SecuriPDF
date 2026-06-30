# Keycloak securipdf client — post-logout redirect URI (cikis sonrasi login ekrani)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'ps1-common.ps1')
$SecuriPdfTemp = Get-SecuriPdfTempDir

function Get-DotEnvValue($Key) {
  $envFile = Join-Path $PSScriptRoot ".env"
  if (-not (Test-Path $envFile)) { return $null }
  foreach ($line in Get-Content $envFile) {
    if ($line -match "^\s*$([regex]::Escape($Key))=(.*)$") { return $Matches[1].Trim().Trim('"') }
  }
  return $null
}

function Invoke-Kcadm {
  param([string[]]$KcadmArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = docker exec securipdf-keycloak /opt/keycloak/bin/kcadm.sh @KcadmArgs 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0) { throw ($out | Out-String) }
  return $out
}

$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      Set-Item -Path "env:$($Matches[1].Trim())" -Value $Matches[2].Trim().Trim('"')
    }
  }
}

$redirectUrl = if ($env:OAUTH2_REDIRECT_URL) { $env:OAUTH2_REDIRECT_URL } else { Get-DotEnvValue "OAUTH2_REDIRECT_URL" }
if (-not $redirectUrl) { $redirectUrl = "http://localhost:8080/oauth2/callback" }
$appBase = ($redirectUrl -replace '/oauth2/callback.*$', '')
if (-not $appBase) { throw "OAUTH2_REDIRECT_URL gecersiz: $redirectUrl" }

$postLogout = "$appBase/*"
$realm = if ($env:KEYCLOAK_REALM) { $env:KEYCLOAK_REALM } else { "securipdf" }
$clientId = if ($env:OAUTH2_CLIENT_ID) { $env:OAUTH2_CLIENT_ID } else { "securipdf" }

$kcAdmin = if ($env:KEYCLOAK_ADMIN) { $env:KEYCLOAK_ADMIN } else { "admin" }
$kcPass = if ($env:KEYCLOAK_ADMIN_PASSWORD) { $env:KEYCLOAK_ADMIN_PASSWORD } else { "ChangeMe-KcAdmin-2026" }

if (-not (Wait-KeycloakReady -MaxAttempts 24)) {
  Show-KeycloakStartupHelp
  throw "Keycloak hazir degil"
}

Invoke-Kcadm @("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", $kcAdmin, "--password", $kcPass) | Out-Null

$clients = Invoke-Kcadm @("get", "clients", "-r", $realm, "-q", "clientId=$clientId") | Out-String
if ($clients -notmatch '"id"\s*:\s*"([^"]+)"') {
  throw "Keycloak client bulunamadi: $clientId"
}
$cid = $Matches[1]

$escapedLogout = $postLogout -replace '\\', '\\\\' -replace '"', '\"'
$patchFile = Join-Path $SecuriPdfTemp "securipdf-logout-patch.json"
@"
{
  "attributes": {
    "post.logout.redirect.uris": "$escapedLogout"
  },
  "frontchannelLogout": true,
  "redirectUris": ["$redirectUrl"],
  "webOrigins": ["$appBase"]
}
"@ | Set-Content -Path $patchFile -Encoding UTF8
docker cp $patchFile "securipdf-keycloak:/tmp/logout-patch.json" | Out-Null
Invoke-Kcadm @("update", "clients/$cid", "-r", $realm, "-f", "/tmp/logout-patch.json") | Out-Null
Remove-Item $patchFile -Force -ErrorAction SilentlyContinue

Write-Host "Keycloak post-logout URI guncellendi: $postLogout"
Write-Host "Redirect URI: $redirectUrl"
Write-Host "Cikis testi: $appBase/oauth2/sign_out"
