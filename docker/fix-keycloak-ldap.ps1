# Keycloak LDAP federation kurulum / onarim (Entera AD)
# Kullanim: docker/.env icinde LDAP_BIND_PASSWORD dolu olmali
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

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

function Sync-LdapGroups {
  param(
    [string]$Realm,
    [string]$LdapId,
    [string]$GroupMapperId,
    [string]$Admin,
    [string]$AdminPass
  )
  $kcPort = if ($env:KEYCLOAK_HTTP_PORT) { $env:KEYCLOAK_HTTP_PORT } else { "8090" }
  $token = Invoke-RestMethod -Method Post -Uri "http://localhost:$kcPort/realms/master/protocol/openid-connect/token" `
    -ContentType "application/x-www-form-urlencoded" `
    -Body @{ client_id = "admin-cli"; username = $Admin; password = $AdminPass; grant_type = "password" }
  Invoke-RestMethod -Method Post `
    -Uri "http://localhost:$kcPort/admin/realms/$Realm/user-storage/$LdapId/mappers/$GroupMapperId/sync?direction=fedToKeycloak" `
    -Headers @{ Authorization = "Bearer $($token.access_token)" } | Out-Null
}

function Test-AdGroupsExist {
  param([string]$LdapHost, [string]$BindDn, [string]$BindPassword, [string]$BaseDn, [string[]]$GroupNames)
  $missing = @()
  $passEsc = $BindPassword -replace "'", "'\\''"
  foreach ($g in $GroupNames) {
    $cmd = "apk add --no-cache openldap-clients >/dev/null 2>&1; ldapsearch -x -H ldap://${LdapHost}:389 -D '$BindDn' -w '$passEsc' -b '$BaseDn' '(cn=$g)' cn | grep -E '^cn: '"
    $out = docker run --rm --network entera-pdf_entera-net alpine sh -c $cmd 2>&1 | Out-String
    if ($out -notmatch "(?m)^cn:\s*$g\s*$") { $missing += $g }
  }
  return $missing
}

function Ensure-RoleLdapMapper {
  param(
    [string]$Realm,
    [string]$LdapId,
    [string]$Name,
    [string]$AdGroup,
    [string]$RealmRole,
    [string]$RolesDn
  )
  $mapperJson = @"
{
  "name": "$Name",
  "providerId": "role-ldap-mapper",
  "providerType": "org.keycloak.storage.ldap.mappers.LDAPStorageMapper",
  "parentId": "$LdapId",
  "config": {
    "roles.dn": ["$RolesDn"],
    "role.name.ldap.attribute": ["cn"],
    "role.object.classes": ["group"],
    "membership.ldap.attribute": ["member"],
    "membership.attribute.type": ["DN"],
    "roles.ldap.filter": ["(cn=$AdGroup)"],
    "mode": ["READ_ONLY"],
    "use.realm.roles.mapping": ["true"],
    "roles.realm.role.mapping": ["${AdGroup}=${RealmRole}"]
  }
}
"@
  $file = Join-Path $env:TEMP "securipdf-$Name.json"
  [System.IO.File]::WriteAllText($file, $mapperJson)

  $existing = ""
  try { $existing = Invoke-Kcadm @("get", "components", "-r", $Realm, "-q", "name=$Name", "-q", "parentId=$LdapId") | Out-String } catch { }
  docker cp $file "securipdf-keycloak:/tmp/role-ldap-mapper.json" | Out-Null
  if ($existing -match '"id"\s*:\s*"([^"]+)"') {
    Invoke-Kcadm @("update", "components/$($Matches[1])", "-r", $Realm, "-f", "/tmp/role-ldap-mapper.json") | Out-Null
    Write-Host "AD rol mapper guncellendi: $AdGroup -> $RealmRole (DN: $RolesDn)"
  } else {
    Invoke-Kcadm @("create", "components", "-r", $Realm, "-f", "/tmp/role-ldap-mapper.json") | Out-Null
    Write-Host "AD rol mapper: $AdGroup -> $RealmRole (DN: $RolesDn)"
  }
  Remove-Item $file -Force -ErrorAction SilentlyContinue
}

function Remove-LegacyHardcodedMappers {
  param([string]$Realm, [string]$LdapId)
  foreach ($name in @("hardcoded-pdf-admin", "hardcoded-pdf-user")) {
    $existing = ""
    try { $existing = Invoke-Kcadm @("get", "components", "-r", $Realm, "-q", "name=$name", "-q", "parentId=$LdapId") | Out-String } catch { }
    if ($existing -match '"id"\s*:\s*"([^"]+)"') {
      Invoke-Kcadm @("delete", "components/$($Matches[1])", "-r", $Realm) | Out-Null
      Write-Host "Kaldirildi (hatali mapper): $name"
    }
  }
}

function Sync-LdapUsers {
  param(
    [string]$Realm,
    [string]$LdapId,
    [string]$Admin,
    [string]$AdminPass
  )

  $methods = @(
    { Invoke-Kcadm @("create", "user-storage/$LdapId/sync?action=triggerFullSync", "-r", $Realm) | Out-Null },
    { Invoke-Kcadm @("create", "user-storage/$LdapId/sync", "-r", $Realm, "-s", "action=triggerFullSync") | Out-Null }
  )

  foreach ($method in $methods) {
    try {
      & $method
      Write-Host "LDAP kullanici senkronu tetiklendi (kcadm)"
      return
    } catch { }
  }

  $kcPort = if ($env:KEYCLOAK_HTTP_PORT) { $env:KEYCLOAK_HTTP_PORT } else { "8090" }
  $kcBase = "http://localhost:$kcPort"

  try {
    $tokenBody = @{
      client_id  = "admin-cli"
      username   = $Admin
      password   = $AdminPass
      grant_type = "password"
    }
    $token = Invoke-RestMethod -Method Post -Uri "$kcBase/realms/master/protocol/openid-connect/token" `
      -ContentType "application/x-www-form-urlencoded" -Body $tokenBody
    if (-not $token.access_token) { throw "token alinamadi" }

    $headers = @{ Authorization = "Bearer $($token.access_token)" }
    Invoke-RestMethod -Method Post -Uri "$kcBase/admin/realms/$Realm/user-storage/$LdapId/sync?action=triggerFullSync" `
      -Headers $headers | Out-Null
    Write-Host "LDAP kullanici senkronu tetiklendi (Admin REST)"
  } catch {
    $detail = $_.ErrorDetails.Message
    if ($detail -match "UnknownError") {
      throw "LDAP sync UnknownError — AD baglantisi/bind parolasi veya Users DN kontrol edin"
    }
    throw "LDAP sync basarisiz: $($_.Exception.Message) $detail"
  }
}

$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) { throw ".env bulunamadi: $envFile" }

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    Set-Item -Path "env:$($Matches[1].Trim())" -Value $Matches[2].Trim()
  }
}

$admin = if ($env:KEYCLOAK_ADMIN) { $env:KEYCLOAK_ADMIN } else { "admin" }
$adminPass = if ($env:KEYCLOAK_ADMIN_PASSWORD) { $env:KEYCLOAK_ADMIN_PASSWORD } else { "ChangeMe-KcAdmin-2026" }

$bindPassword = $env:LDAP_BIND_PASSWORD
if ([string]::IsNullOrWhiteSpace($bindPassword)) { throw "LDAP_BIND_PASSWORD .env icinde bos" }

$realm = "securipdf"
$ldapHost = if ($env:LDAP_HOST) { $env:LDAP_HOST } else { "192.168.6.10" }
$ldapBase = if ($env:LDAP_BASE_DN) { $env:LDAP_BASE_DN } else { "dc=entera,dc=test" }
$ldapUsersDn = if ($env:LDAP_USERS_DN) { $env:LDAP_USERS_DN } else { "CN=Users,$ldapBase" }
$ldapGroupsDn = if ($env:LDAP_GROUPS_DN) { $env:LDAP_GROUPS_DN } else { $ldapBase }
$ldapBindDn = if ($env:LDAP_BIND_DN) { $env:LDAP_BIND_DN } else { "CN=svc-securipdf,$ldapUsersDn" }

Invoke-Kcadm @("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", $admin, "--password", $adminPass) | Out-Null

$realmJson = Invoke-Kcadm @("get", "realms/$realm", "--fields", "id") | Out-String
if ($realmJson -notmatch '"id"\s*:\s*"([^"]+)"') {
  throw "Realm $realm bulunamadi — once bootstrap-keycloak-realm.ps1 calistirin"
}
$realmId = $Matches[1]

$ldapJson = @"
{
  "name": "entera-ad",
  "providerId": "ldap",
  "providerType": "org.keycloak.storage.UserStorageProvider",
  "parentId": "$realmId",
  "config": {
    "enabled": ["true"],
    "priority": ["0"],
    "editMode": ["READ_ONLY"],
    "syncRegistrations": ["false"],
    "vendor": ["ad"],
    "usernameLDAPAttribute": ["sAMAccountName"],
    "rdnLDAPAttribute": ["cn"],
    "uuidLDAPAttribute": ["objectGUID"],
    "userObjectClasses": ["person, organizationalPerson, user"],
    "connectionUrl": ["ldap://${ldapHost}:389"],
    "usersDn": ["$ldapUsersDn"],
    "bindDn": ["$ldapBindDn"],
    "bindCredential": ["$($bindPassword -replace '\\','\\\\' -replace '"','\"')"],
    "searchScope": ["2"],
    "referral": ["ignore"],
    "pagination": ["false"],
    "importEnabled": ["true"],
    "connectionPooling": ["true"],
    "useTruststoreSpi": ["ldapsOnly"]
  }
}
"@

$tmp = Join-Path $env:TEMP "securipdf-ldap-create.json"
[System.IO.File]::WriteAllText($tmp, $ldapJson)

$existing = ""
try { $existing = Invoke-Kcadm @("get", "components", "-r", $realm, "-q", "name=entera-ad") | Out-String } catch { }

if ($existing -match '"id"\s*:\s*"([^"]+)"') {
  $ldapId = $Matches[1]
  docker cp $tmp securipdf-keycloak:/tmp/ldap-update.json | Out-Null
  Invoke-Kcadm @("update", "components/$ldapId", "-r", $realm, "-f", "/tmp/ldap-update.json") | Out-Null
  Write-Host "LDAP federation guncellendi (entera-ad / $ldapId)"
} else {
  docker cp $tmp securipdf-keycloak:/tmp/ldap-create.json | Out-Null
  $createOut = Invoke-Kcadm @("create", "components", "-r", $realm, "-f", "/tmp/ldap-create.json") | Out-String
  if ($createOut -match "Created new component with id '([^']+)'") {
    $ldapId = $Matches[1]
    Write-Host "LDAP federation olusturuldu (entera-ad / $ldapId)"
  } else {
    throw "LDAP olusturulamadi: $createOut"
  }
}

Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# connectionUrl dogrulama
$check = Invoke-Kcadm @("get", "components", "-r", $realm, "-q", "name=entera-ad") | Out-String
if ($check -notmatch "ldap://${ldapHost}:389") {
  throw "LDAP connectionUrl hatali — beklenen ldap://${ldapHost}:389"
}
Write-Host "LDAP connectionUrl: ldap://${ldapHost}:389"

# AD test connection (Keycloak LDAP test endpoint)
$groupUser = if ($env:LDAP_GROUP_USER) { $env:LDAP_GROUP_USER } else { "SecuriPDF-Users" }
$groupFilter = if ($env:LDAP_GROUP_FILTER) { $env:LDAP_GROUP_FILTER } else { "(cn=SecuriPDF-*)" }

$existingGroupMapper = ""
try {
  $existingGroupMapper = Invoke-Kcadm @("get", "components", "-r", $realm, "-q", "name=ad-groups", "-q", "parentId=$ldapId") | Out-String
} catch { }

$groupMapperJson = @"
{
  "name": "ad-groups",
  "providerId": "group-ldap-mapper",
  "providerType": "org.keycloak.storage.ldap.mappers.LDAPStorageMapper",
  "parentId": "$ldapId",
  "config": {
    "groups.dn": ["$ldapGroupsDn"],
    "group.name.ldap.attribute": ["cn"],
    "group.object.classes": ["group"],
    "membership.ldap.attribute": ["member"],
    "membership.attribute.type": ["DN"],
    "groups.ldap.filter": ["$groupFilter"],
    "mode": ["READ_ONLY"],
    "preserve.group.inheritance": ["false"],
    "ignore.missing.groups": ["true"],
    "user.roles.retrieve.strategy": ["LOAD_GROUPS_BY_MEMBER_ATTRIBUTE"]
  }
}
"@
$gmFile = Join-Path $env:TEMP "securipdf-group-mapper.json"
[System.IO.File]::WriteAllText($gmFile, $groupMapperJson)
docker cp $gmFile "securipdf-keycloak:/tmp/group-mapper.json" | Out-Null

if ($existingGroupMapper -match '"id"\s*:\s*"([^"]+)"') {
  Invoke-Kcadm @("update", "components/$($Matches[1])", "-r", $realm, "-f", "/tmp/group-mapper.json") | Out-Null
  Write-Host "AD grup mapper guncellendi (groups.dn: $ldapGroupsDn)"
} else {
  Invoke-Kcadm @("create", "components", "-r", $realm, "-f", "/tmp/group-mapper.json") | Out-Null
  Write-Host "AD grup mapper olusturuldu (groups.dn: $ldapGroupsDn)"
}
Remove-Item $gmFile -Force -ErrorAction SilentlyContinue

# AD e-posta: mail -> email; UPN -> ldap_upn + OIDC fallback (ikisi ayni alana yazilamaz)
function Ensure-LdapEmailMappers {
  param([string]$Realm, [string]$LdapId)

  foreach ($name in @("ad-email-mail")) {
    $existing = ""
    try { $existing = Invoke-Kcadm @("get", "components", "-r", $Realm, "-q", "name=$name", "-q", "parentId=$LdapId") | Out-String } catch { }
    if ($existing -match '"id"\s*:\s*"([^"]+)"') {
      Invoke-Kcadm @("delete", "components/$($Matches[1])", "-r", $Realm) | Out-Null
      Write-Host "Kaldirildi (gereksiz mapper): $name"
    }
  }

  function Set-LdapAttributeMapper {
    param(
      [string]$Realm,
      [string]$LdapId,
      [string]$Name,
      [string]$MapperId,
      [string]$LdapAttribute,
      [string]$UserAttribute
    )
    $body = if ($MapperId) {
      @{ id = $MapperId; name = $Name; providerId = "user-attribute-ldap-mapper"; providerType = "org.keycloak.storage.ldap.mappers.LDAPStorageMapper"; parentId = $LdapId; config = @{ "ldap.attribute" = @($LdapAttribute); "user.model.attribute" = @($UserAttribute); "read.only" = @("true"); "always.read.value.from.ldap" = @("true"); "is.mandatory.in.ldap" = @("false") } }
    } else {
      @{ name = $Name; providerId = "user-attribute-ldap-mapper"; providerType = "org.keycloak.storage.ldap.mappers.LDAPStorageMapper"; parentId = $LdapId; config = @{ "ldap.attribute" = @($LdapAttribute); "user.model.attribute" = @($UserAttribute); "read.only" = @("true"); "always.read.value.from.ldap" = @("true"); "is.mandatory.in.ldap" = @("false") } }
    }
    $file = Join-Path $env:TEMP "securipdf-ldap-$Name.json"
    ($body | ConvertTo-Json -Depth 6) | Set-Content -Path $file -Encoding UTF8
    docker cp $file "securipdf-keycloak:/tmp/ldap-email-mapper.json" | Out-Null
    if ($MapperId) {
      Invoke-Kcadm @("update", "components/$MapperId", "-r", $Realm, "-f", "/tmp/ldap-email-mapper.json") | Out-Null
    } else {
      Invoke-Kcadm @("create", "components", "-r", $Realm, "-f", "/tmp/ldap-email-mapper.json") | Out-Null
    }
    Remove-Item $file -Force -ErrorAction SilentlyContinue
    Write-Host "LDAP mapper: $LdapAttribute -> $UserAttribute ($Name)"
  }

  $builtIn = ""
  try { $builtIn = Invoke-Kcadm @("get", "components", "-r", $Realm, "-q", "name=email", "-q", "parentId=$LdapId") | Out-String } catch { }
  if ($builtIn -notmatch '"id"\s*:\s*"([^"]+)"') {
    throw "LDAP 'email' mapper bulunamadi — Keycloak LDAP federation bilesenini kontrol edin"
  }
  Set-LdapAttributeMapper -Realm $Realm -LdapId $LdapId -Name "email" -MapperId $Matches[1] -LdapAttribute "mail" -UserAttribute "email"

  $upnExisting = ""
  try { $upnExisting = Invoke-Kcadm @("get", "components", "-r", $Realm, "-q", "name=ad-email-upn", "-q", "parentId=$LdapId") | Out-String } catch { }
  $upnId = if ($upnExisting -match '"id"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
  Set-LdapAttributeMapper -Realm $Realm -LdapId $LdapId -Name "ad-email-upn" -MapperId $upnId -LdapAttribute "userPrincipalName" -UserAttribute "ldap_upn"

  $emailScope = ""
  try { $emailScope = Invoke-Kcadm @("get", "client-scopes", "-r", $Realm, "-q", "name=email") | Out-String } catch { }
  if ($emailScope -notmatch '"id"\s*:\s*"([^"]+)"') {
    throw "email client scope bulunamadi"
  }
  $scopeId = $Matches[1]
  $existingProto = ""
  try { $existingProto = Invoke-Kcadm @("get", "client-scopes/$scopeId/protocol-mappers/models", "-r", $Realm) | Out-String } catch { }
  if ($existingProto -notmatch "ldap-upn-email-fallback") {
    $protoJson = '{"name":"ldap-upn-email-fallback","protocol":"openid-connect","protocolMapper":"oidc-usermodel-attribute-mapper","config":{"user.attribute":"ldap_upn","claim.name":"email","jsonType.label":"String","id.token.claim":"true","access.token.claim":"true","userinfo.token.claim":"true","introspection.token.claim":"true"}}'
    $protoFile = Join-Path $env:TEMP "securipdf-ldap-upn-proto.json"
    [System.IO.File]::WriteAllText($protoFile, $protoJson)
    docker cp $protoFile "securipdf-keycloak:/tmp/ldap-upn-proto.json" | Out-Null
    Invoke-Kcadm @("create", "client-scopes/$scopeId/protocol-mappers/models", "-r", $Realm, "-f", "/tmp/ldap-upn-proto.json") | Out-Null
    Remove-Item $protoFile -Force -ErrorAction SilentlyContinue
    Write-Host "OIDC mapper: ldap_upn -> email claim (UPN yedek)"
  }
}
Ensure-LdapEmailMappers -Realm $realm -LdapId $ldapId

# LDAP senkron (Keycloak 26: kcadm veya Admin REST)
try {
  Sync-LdapUsers -Realm $realm -LdapId $ldapId -Admin $admin -AdminPass $adminPass
} catch {
  Write-Warning "LDAP sync API basarisiz — Keycloak UI: User federation -> Sync all users"
  Write-Warning $_.Exception.Message
}

# AD grup -> realm rolu (role-ldap-mapper — AD uyeligine gore)
Remove-LegacyHardcodedMappers -Realm $realm -LdapId $ldapId

$groupAdmin = if ($env:LDAP_GROUP_ADMIN) { $env:LDAP_GROUP_ADMIN } else { "SecuriPDF-Admins" }
$groupUser = if ($env:LDAP_GROUP_USER) { $env:LDAP_GROUP_USER } else { "SecuriPDF-Users" }

$missingGroups = @(Test-AdGroupsExist -LdapHost $ldapHost -BindDn $ldapBindDn -BindPassword $bindPassword `
  -BaseDn $ldapGroupsDn -GroupNames @($groupUser, $groupAdmin))

$foundGroups = @(@($groupUser, $groupAdmin) | Where-Object { $_ -notin $missingGroups })
if ($foundGroups.Count -gt 0) {
  Write-Host "AD gruplari bulundu: $($foundGroups -join ', ') (arama: $ldapGroupsDn)"
}
if ($missingGroups.Count -gt 0) {
  Write-Warning "AD'de bulunamayan gruplar: $($missingGroups -join ', ')"
}

Ensure-RoleLdapMapper -Realm $realm -LdapId $ldapId -Name "ad-role-pdf-user" -AdGroup $groupUser -RealmRole "pdf-user" -RolesDn $ldapGroupsDn
if ($groupAdmin -notin $missingGroups) {
  Ensure-RoleLdapMapper -Realm $realm -LdapId $ldapId -Name "ad-role-pdf-admin" -AdGroup $groupAdmin -RealmRole "pdf-admin" -RolesDn $ldapGroupsDn
}

# Keycloak grup senkronu (map-ad-group-roles icin)
$groupMapperId = ""
try {
  $gm = Invoke-Kcadm @("get", "components", "-r", $realm, "-q", "name=ad-groups", "-q", "parentId=$ldapId") | Out-String
  if ($gm -match '"id"\s*:\s*"([^"]+)"') { $groupMapperId = $Matches[1] }
} catch { }

if ($groupMapperId -and $foundGroups.Count -gt 0) {
  try {
    Sync-LdapGroups -Realm $realm -LdapId $ldapId -GroupMapperId $groupMapperId -Admin $admin -AdminPass $adminPass
    Write-Host "AD gruplari Keycloak'a senkron edildi"
  } catch {
    Write-Warning "Grup senkronu atlandi: $($_.Exception.Message)"
  }
}

# Gruplar yokken gecici: Administrator'a admin rolu (dev/test)
if ($missingGroups -contains $groupAdmin) {
  try {
    Invoke-Kcadm @("add-roles", "-r", $realm, "--uusername", "administrator", "--rolename", "pdf-admin") | Out-Null
    Invoke-Kcadm @("add-roles", "-r", $realm, "--uusername", "administrator", "--rolename", "pdf-user") | Out-Null
    Write-Host "Gecici rol: administrator -> pdf-admin, pdf-user (AD gruplari olusturulunca kaldirilabilir)"
  } catch {
    if ($_.Exception.Message -notmatch "already exists|Conflict") {
      Write-Warning "Administrator rol atamasi atlandi: $($_.Exception.Message)"
    }
  }
}

Write-Host "AD giris: sAMAccountName (ornek: pdf, Administrator) + AD parolasi"
Write-Host "Grup DN: $ldapGroupsDn | Kullanici DN: $ldapUsersDn"
if ($ldapUsersDn -notmatch [regex]::Escape($ldapBase) -or $ldapUsersDn -eq "CN=Users,$ldapBase") {
  Write-Host "Not: CN=Users disindaki kullanicilar (or. CN=pdf,DC=entera,DC=test) icin .env: LDAP_USERS_DN=$ldapBase"
}

# Keycloak grup -> realm rolu (gruplar sync olduktan sonra)
try {
  & "$PSScriptRoot\map-ad-group-roles.ps1"
} catch {
  Write-Warning "Grup-rol eslemesi atlandi: $($_.Exception.Message)"
}

Write-Host "Tamam."
