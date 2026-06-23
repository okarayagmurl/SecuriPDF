# SecuriPDF — PowerShell ortak yardimcilar (Windows + Linux pwsh)
function Get-SecuriPdfTempDir {
  if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { return $env:TEMP }
  if (-not [string]::IsNullOrWhiteSpace($env:TMPDIR)) { return $env:TMPDIR }
  return '/tmp'
}

function Get-SecuriPdfAppUrl {
  $appHost = if (-not [string]::IsNullOrWhiteSpace($env:PUBLIC_FQDN)) { $env:PUBLIC_FQDN.Trim() }
    elseif (-not [string]::IsNullOrWhiteSpace($env:KEYCLOAK_HOSTNAME)) { $env:KEYCLOAK_HOSTNAME.Trim() }
    else { 'localhost' }
  $httpPort = if ($env:HTTP_PORT) { $env:HTTP_PORT.Trim() } else { '8080' }
  if ($env:PUBLIC_USE_HTTPS -eq 'true') { return "https://$appHost" }
  return "http://${appHost}:$httpPort"
}
