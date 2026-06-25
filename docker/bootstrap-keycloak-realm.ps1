# SecuriPDF — Keycloak realm bootstrap (Faz 2 kapanis)
# Realm, roller, client, LDAP, grup mapper, token groups claim
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'ps1-common.ps1')
$SecuriPdfTemp = Get-SecuriPdfTempDir

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
      Set-Item -Path "env:$($Matches[1].Trim())" -Value $Matches[2].Trim()
    }
  }
}

$admin = if ($env:KEYCLOAK_ADMIN) { $env:KEYCLOAK_ADMIN } else { "admin" }
$adminPass = if ($env:KEYCLOAK_ADMIN_PASSWORD) { $env:KEYCLOAK_ADMIN_PASSWORD } else { "ChangeMe-KcAdmin-2026" }
$realm = "securipdf"
$clientId = if ($env:OAUTH2_CLIENT_ID) { $env:OAUTH2_CLIENT_ID } else { "securipdf" }
$clientSecret = if (-not [string]::IsNullOrWhiteSpace($env:OAUTH2_CLIENT_SECRET)) { $env:OAUTH2_CLIENT_SECRET } else { "SecuriPDF-OAuth2-Dev-Secret-2026" }
$redirectUrl = if ($env:OAUTH2_REDIRECT_URL) { $env:OAUTH2_REDIRECT_URL } else { "http://localhost:8080/oauth2/callback" }
$appBase = ($redirectUrl -replace '/oauth2/callback.*','')
$postLogoutUris = "$appBase/*"
$ldapHost = if ($env:LDAP_HOST) { $env:LDAP_HOST } else { "192.168.6.10" }
$ldapBase = if ($env:LDAP_BASE_DN) { $env:LDAP_BASE_DN } else { "dc=entera,dc=test" }
$ldapUsersDn = if ($env:LDAP_USERS_DN) { $env:LDAP_USERS_DN } else { "CN=Users,$ldapBase" }
$ldapBindDn = if ($env:LDAP_BIND_DN) { $env:LDAP_BIND_DN } else { "CN=svc-securipdf,$ldapUsersDn" }
$ldapBindPassword = $env:LDAP_BIND_PASSWORD
$breakGlassUser = "securipdf-local-admin"

Write-Host "Keycloak realm bootstrap: $realm"

$ready = $false
for ($i = 0; $i -lt 24; $i++) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  docker exec securipdf-keycloak sh -c "timeout 2 sh -c 'cat < /dev/null > /dev/tcp/127.0.0.1/8080'" 2>$null | Out-Null
  $probeOk = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $prev
  if ($probeOk) { $ready = $true; break }
  if ($i -eq 0) { Write-Host "Keycloak baslatiliyor, bekleniyor..." }
  Start-Sleep -Seconds 5
}
if (-not $ready) { throw "Keycloak hazir degil" }

Invoke-Kcadm @("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", $admin, "--password", $adminPass) | Out-Null

try {
  Invoke-Kcadm @("get", "realms/$realm") | Out-Null
  $realmMissing = $false
} catch {
  $realmMissing = $true
}

if ($realmMissing) {
  Invoke-Kcadm @("create", "realms", "-s", "realm=$realm", "-s", "enabled=true", "-s", "loginTheme=securipdf") | Out-Null
  Write-Host "Realm olusturuldu: $realm"
} else {
  Write-Host "Realm mevcut: $realm"
}

try {
  Invoke-Kcadm @(
    "update", "realms/$realm",
    "-s", "eventsEnabled=true",
    "-s", "eventsExpiration=604800",
    "-s", "enabledEventTypes=LOGIN",
    "-s", "enabledEventTypes=LOGIN_ERROR",
    "-s", "enabledEventTypes=LOGOUT"
  ) | Out-Null
  Write-Host "Realm event log etkin: LOGIN / LOGIN_ERROR / LOGOUT"
} catch {
  Write-Warning "Realm event log ayari atlandi: $($_.Exception.Message)"
}

foreach ($role in @("pdf-user", "pdf-admin")) {
  $roleMissing = $true
  try {
    Invoke-Kcadm @("get", "realms/$realm/roles/$role") | Out-Null
    $roleMissing = $false
  } catch { }
  if ($roleMissing) {
    Invoke-Kcadm @("create", "realms/$realm/roles", "-s", "name=$role") | Out-Null
    Write-Host "Rol olusturuldu: $role"
  }
}

$clients = ""
try {
  $clients = Invoke-Kcadm @("get", "clients", "-r", $realm, "-q", "clientId=$clientId") | Out-String
} catch { }

if ($clients -notmatch '"id"\s*:\s*"([^"]+)"') {
  $clientJson = @"
{
  "clientId": "$clientId",
  "enabled": true,
  "clientAuthenticatorType": "client-secret",
  "secret": "$clientSecret",
  "redirectUris": ["$redirectUrl"],
  "webOrigins": ["$appBase"],
  "attributes": {
    "post.logout.redirect.uris": "$postLogoutUris"
  },
  "frontchannelLogout": true,
  "publicClient": false,
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": true,
  "protocol": "openid-connect"
}
"@
  $clientFile = Join-Path $SecuriPdfTemp "securipdf-oauth-client.json"
  [System.IO.File]::WriteAllText($clientFile, $clientJson)
  docker cp $clientFile "securipdf-keycloak:/tmp/oauth-client.json" | Out-Null
  try {
    Invoke-Kcadm @("create", "clients", "-r", $realm, "-f", "/tmp/oauth-client.json") | Out-Null
    Write-Host "OAuth client olusturuldu: $clientId"
  } catch {
    if ($_.Exception.Message -notmatch "already exists") { throw }
    Write-Host "OAuth client zaten mevcut: $clientId"
  }
  Remove-Item $clientFile -Force -ErrorAction SilentlyContinue
  $clients = Invoke-Kcadm @("get", "clients", "-r", $realm, "-q", "clientId=$clientId") | Out-String
}

if ($clients -match '"id"\s*:\s*"([^"]+)"') {
  $cid = $Matches[1]
  Invoke-Kcadm @("update", "clients/$cid", "-r", $realm, "-s", "secret=$clientSecret") | Out-Null
  Invoke-Kcadm @(
    "update", "clients/$cid", "-r", $realm,
    "-s", "attributes.post.logout.redirect.uris=$postLogoutUris",
    "-s", "frontchannelLogout=true"
  ) | Out-Null
  Write-Host "OAuth client guncellendi: $clientId (post-logout: $postLogoutUris)"

  $audMapper = "audience-$clientId"
  $audMapperFile = Join-Path $PSScriptRoot "keycloak-audience-mapper.json"
  $existingMappers = ""
  try { $existingMappers = Invoke-Kcadm @("get", "clients/$cid/protocol-mappers/models", "-r", $realm) | Out-String } catch { }
  if ($existingMappers -notmatch [regex]::Escape($audMapper) -and (Test-Path $audMapperFile)) {
    try {
      docker cp $audMapperFile "securipdf-keycloak:/tmp/audience-mapper.json" | Out-Null
      Invoke-Kcadm @("create", "clients/$cid/protocol-mappers/models", "-r", $realm, "-f", "/tmp/audience-mapper.json") | Out-Null
      Write-Host "Audience mapper olusturuldu: $audMapper"
    } catch {
      Write-Warning "Audience mapper atlandi: $($_.Exception.Message)"
    }
  }
}

# Groups claim mapper (client scope) — istege bagli
try {
  $scopeName = "groups"
  $scopes = Invoke-Kcadm @("get", "client-scopes", "-r", $realm, "-q", "name=$scopeName") | Out-String
  if ($scopes -notmatch '"id"\s*:\s*"([^"]+)"') {
    Invoke-Kcadm @("create", "client-scopes", "-r", $realm, "-s", "name=$scopeName", "-s", "protocol=openid-connect") | Out-Null
    $scopes = Invoke-Kcadm @("get", "client-scopes", "-r", $realm, "-q", "name=$scopeName") | Out-String
  }
  if ($scopes -match '"id"\s*:\s*"([^"]+)"') {
    $scopeId = $Matches[1]
    $existingMapper = Invoke-Kcadm @("get", "client-scopes/$scopeId/protocol-mappers/models", "-r", $realm) | Out-String
    if ($existingMapper -notmatch "groups-mapper") {
      $mapperJson = '{"name":"groups-mapper","protocol":"openid-connect","protocolMapper":"oidc-group-membership-mapper","config":{"claim.name":"groups","full.path":"false","id.token.claim":"true","access.token.claim":"true","userinfo.token.claim":"true"}}'
      $mapperFile = Join-Path $SecuriPdfTemp "securipdf-groups-mapper.json"
      [System.IO.File]::WriteAllText($mapperFile, $mapperJson)
      docker cp $mapperFile "securipdf-keycloak:/tmp/groups-mapper.json" | Out-Null
      Invoke-Kcadm @("create", "client-scopes/$scopeId/protocol-mappers/models", "-r", $realm, "-f", "/tmp/groups-mapper.json") | Out-Null
      Remove-Item $mapperFile -Force -ErrorAction SilentlyContinue
    }
    if ($clients -match '"id"\s*:\s*"([^"]+)"') {
      $clientUuid = $Matches[1]
      try {
        Invoke-Kcadm @("update", "clients/$clientUuid/default-client-scopes/$scopeId", "-r", $realm) | Out-Null
      } catch {
        try { Invoke-Kcadm @("create", "clients/$clientUuid/default-client-scopes/$scopeId", "-r", $realm) | Out-Null } catch { }
      }
    }
  }
} catch {
  Write-Warning "Groups mapper atlandi: $($_.Exception.Message)"
}

# Realm roles claim — oauth2-proxy OAUTH2_GROUPS_CLAIM=roles ile uyumlu
try {
  & "$PSScriptRoot\fix-keycloak-token-roles.ps1"
} catch {
  Write-Warning "Token roles mapper atlandi: $($_.Exception.Message)"
}

# LDAP federation (parola varsa)
if (-not [string]::IsNullOrWhiteSpace($ldapBindPassword)) {
  try {
    & "$PSScriptRoot\fix-keycloak-ldap.ps1"
    Write-Host "LDAP federation uygulandi"
  } catch {
    Write-Warning "LDAP federation basarisiz: $($_.Exception.Message)"
  }
} else {
  Write-Warning "LDAP_BIND_PASSWORD bos — LDAP atlandi"
}

# Break-glass admin
$bg = ""
try { $bg = Invoke-Kcadm @("get", "users", "-r", $realm, "-q", "username=$breakGlassUser") | Out-String } catch { }
if ($bg -notmatch '"id"\s*:\s*"([^"]+)"') {
  try {
    Invoke-Kcadm @("create", "users", "-r", $realm, "-s", "username=$breakGlassUser", "-s", "enabled=true", "-s", "emailVerified=true") | Out-Null
    Write-Host "Break-glass admin olusturuldu: $breakGlassUser"
  } catch {
    if ($_.Exception.Message -notmatch "User exists") { throw }
    Write-Host "Break-glass admin zaten mevcut: $breakGlassUser"
  }
  $bg = Invoke-Kcadm @("get", "users", "-r", $realm, "-q", "username=$breakGlassUser") | Out-String
}
if ($bg -match '"id"\s*:\s*"([^"]+)"') {
  $bgId = $Matches[1]
  $bgPass = if ($env:BREAK_GLASS_PASSWORD) { $env:BREAK_GLASS_PASSWORD } else { "SecuriPDF-Local-Admin-2026" }
  try { Invoke-Kcadm @("set-password", "-r", $realm, "--userid", $bgId, "--new-password", $bgPass) | Out-Null } catch { }
  try { Invoke-Kcadm @("add-roles", "-r", $realm, "--uusername", $breakGlassUser, "--rolename", "pdf-admin") | Out-Null } catch { }
}

& "$PSScriptRoot\apply-keycloak-theme.ps1"

Write-Host ""
Write-Host "Bootstrap tamam. Giris: $(Get-SecuriPdfAppUrl)"
