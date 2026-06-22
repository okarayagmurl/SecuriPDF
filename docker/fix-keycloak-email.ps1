# Keycloak LDAP — e-posta alanini AD userPrincipalName'den senkronize eder (oauth2-proxy icin zorunlu)
# Kullanim: cd docker; .\fix-keycloak-email.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

& "$PSScriptRoot\fix-keycloak-ldap.ps1"
