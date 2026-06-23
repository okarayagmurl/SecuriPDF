# SecuriPDF — AD grubu → Keycloak realm rolu eslemesi
# SecuriPDF-Users -> pdf-user, SecuriPDF-Admins -> pdf-admin
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

$groupUser = if ($env:LDAP_GROUP_USER) { $env:LDAP_GROUP_USER } else { "SecuriPDF-Users" }
$groupAdmin = if ($env:LDAP_GROUP_ADMIN) { $env:LDAP_GROUP_ADMIN } else { "SecuriPDF-Admins" }
$roleUser = "pdf-user"
$roleAdmin = "pdf-admin"

Invoke-Kcadm @("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", $admin, "--password", $adminPass) | Out-Null

function Get-RoleId($roleName) {
  $role = Invoke-Kcadm @("get", "roles/$roleName", "-r", $realm) | Out-String
  if ($role -match '"id"\s*:\s*"([^"]+)"') {
    return $Matches[1]
  }
  throw "Rol bulunamadi: $roleName"
}

function Map-GroupToRole($groupName, $roleName) {
  $groups = Invoke-Kcadm @("get", "groups", "-r", $realm, "-q", "search=$groupName") | Out-String
  if ($groups -notmatch '"id"\s*:\s*"([^"]+)"') {
    Write-Warning "Keycloak grubu bulunamadi: $groupName"
    Write-Warning "  -> AD'de grup olusturun veya fix-keycloak-ldap.ps1 calistirin (role-ldap-mapper aktif)"
    return
  }
  $groupId = $Matches[1]
  $roleId = Get-RoleId $roleName
  $payload = "[{ `"id`": `"$roleId`", `"name`": `"$roleName`" }]"
  $payloadFile = Join-Path $SecuriPdfTemp "securipdf-role-map-$groupName.json"
  [System.IO.File]::WriteAllText($payloadFile, $payload)
  docker cp $payloadFile "securipdf-keycloak:/tmp/role-map.json" | Out-Null
  try {
    Invoke-Kcadm @("create", "groups/$groupId/role-mappings/realm", "-r", $realm, "-f", "/tmp/role-map.json") | Out-Null
    Write-Host "Esleme: $groupName -> $roleName"
  } catch {
    if ($_.Exception.Message -match "already exists|Conflict") {
      Write-Host "Esleme zaten var: $groupName -> $roleName"
    } else {
      throw
    }
  }
  Remove-Item $payloadFile -Force -ErrorAction SilentlyContinue
}

Write-Host "AD grup -> rol eslemesi: $realm"
Map-GroupToRole $groupUser $roleUser
Map-GroupToRole $groupAdmin $roleAdmin
Write-Host "Tamam."
