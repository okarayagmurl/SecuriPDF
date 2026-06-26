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

function Get-KeycloakHttpPort {
  if (-not [string]::IsNullOrWhiteSpace($env:KEYCLOAK_HTTP_PORT)) { return $env:KEYCLOAK_HTTP_PORT.Trim() }
  return '8090'
}

function Test-KeycloakReady {
  $kcPort = Get-KeycloakHttpPort
  $probeUrls = @(
    "http://127.0.0.1:${kcPort}/health/ready",
    "http://127.0.0.1:${kcPort}/realms/master"
  )

  foreach ($url in $probeUrls) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
      if (Get-Command curl -ErrorAction SilentlyContinue) {
        & curl -sf --max-time 3 $url 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { return $true }
      } else {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -SkipHttpErrorCheck
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { return $true }
      }
    } catch { }
    finally { $ErrorActionPreference = $prev }
  }

  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  docker exec securipdf-keycloak bash -c "timeout 2 bash -c 'echo > /dev/tcp/127.0.0.1/8080'" 2>$null | Out-Null
  $tcpOk = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $prev
  return $tcpOk
}

function Wait-KeycloakReady {
  param(
    [int]$MaxAttempts = 60,
    [int]$SleepSeconds = 5
  )
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if (Test-KeycloakReady) { return $true }
    if ($i -eq 0) { Write-Host "Keycloak baslatiliyor, bekleniyor..." }
    elseif (($i % 6) -eq 0) { Write-Host "  ... hala bekleniyor ($($i * $SleepSeconds) sn)" }
    Start-Sleep -Seconds $SleepSeconds
  }
  return $false
}

function Show-KeycloakStartupHelp {
  Write-Host ""
  Write-Host "Keycloak hazir degil. Kontrol:" -ForegroundColor Yellow
  Write-Host "  docker ps -a --filter name=securipdf-keycloak"
  Write-Host "  docker logs securipdf-keycloak --tail 60"
  Write-Host "  curl -sf http://127.0.0.1:$(Get-KeycloakHttpPort)/health/ready"
  Write-Host ""
  Write-Host "Ilk acilista 3-5 dk surebilir. Postgres sifre uyumsuzlugu veya bellek yetersizligi de bu hataya yol acar."
}
