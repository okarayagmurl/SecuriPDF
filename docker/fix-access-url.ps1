# SecuriPDF — erisim adreslerini (IP/FQDN) .env icinde senkronize eder
# Kullanim: .\fix-access-url.ps1 -Host 192.168.6.175
param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [switch]$Https
)

$ErrorActionPreference = "Stop"
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) { throw ".env bulunamadi" }

function Set-EnvLine($Key, $Value) {
  $content = Get-Content $envFile -Raw
  $line = "${Key}=${Value}"
  if ($content -match "(?m)^${Key}=") {
    $content = $content -replace "(?m)^${Key}=.*", $line
  } else {
    $content = $content.TrimEnd() + "`n$line`n"
  }
  Set-Content -Path $envFile -Value $content -NoNewline
}

$httpPort = if ($env:HTTP_PORT) { $env:HTTP_PORT } else { "8080" }
$kcPort = if ($env:KEYCLOAK_HTTP_PORT) { $env:KEYCLOAK_HTTP_PORT } else { "8090" }

if ($Https) {
  $appUrl = "https://$HostName"
  $kcPublic = $appUrl
  $cookieSecure = "true"
  $insecureIssuer = "false"
} else {
  $appUrl = "http://${HostName}:$httpPort"
  $kcPublic = "http://${HostName}:$kcPort"
  $cookieSecure = "false"
  $insecureIssuer = "true"
}

Set-EnvLine "PUBLIC_SERVER_IP" $HostName
Set-EnvLine "PUBLIC_FQDN" $HostName
Set-EnvLine "KEYCLOAK_PUBLIC_FQDN" $HostName
Set-EnvLine "KEYCLOAK_HOSTNAME" $HostName
Set-EnvLine "OAUTH2_ISSUER_URL" "$kcPublic/realms/securipdf"
Set-EnvLine "OAUTH2_REDIRECT_URL" "$appUrl/oauth2/callback"
Set-EnvLine "OAUTH2_LOGIN_URL" "$kcPublic/realms/securipdf/protocol/openid-connect/auth?ui_locales=tr"
Set-EnvLine "OAUTH2_SIGN_OUT_REDIRECT_URL" "$kcPublic/realms/securipdf/protocol/openid-connect/logout?client_id=securipdf&post_logout_redirect_uri=$appUrl/"
Set-EnvLine "OAUTH2_COOKIE_SECURE" $cookieSecure
Set-EnvLine "OAUTH2_INSECURE_ISSUER" $insecureIssuer
Set-EnvLine "PUBLIC_USE_HTTPS" ($(if ($Https) { "true" } else { "false" }))

Write-Host "=== Erisim adresleri guncellendi ==="
Write-Host "  Uygulama: $appUrl"
Write-Host "  Keycloak: $kcPublic"

Push-Location $PSScriptRoot
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d --force-recreate oauth2-proxy keycloak
& "$PSScriptRoot\bootstrap-keycloak-realm.ps1"
Pop-Location

Write-Host "Tarayici: $appUrl"
