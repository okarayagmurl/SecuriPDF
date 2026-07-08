# SecuriPDF — PowerShell ortak yardimcilar (Windows + Linux pwsh)

function Import-SecuriPdfDotEnv {
  param([string]$EnvFile = (Join-Path $PSScriptRoot '.env'))
  if (-not (Test-Path $EnvFile)) { return }
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $key = $Matches[1].Trim()
      $val = $Matches[2].Trim()
      # fix-access-url.sh KEY="value" yazar; JSON uraelmak icin tirnaklari kaldir
      if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
        $val = $val.Substring(1, $val.Length - 2)
      }
      Set-Item -Path "env:$key" -Value $val
    }
  }
}

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

function Wait-KeycloakReady {
  param(
    [int]$MaxAttempts = 60,
    [int]$SleepSeconds = 5
  )
  $waitScript = Join-Path $PSScriptRoot 'wait-keycloak.sh'
  if (-not (Test-Path $waitScript)) {
    throw "wait-keycloak.sh bulunamadi: $waitScript"
  }
  $env:KEYCLOAK_WAIT_ATTEMPTS = "$MaxAttempts"
  $env:KEYCLOAK_WAIT_SLEEP = "$SleepSeconds"
  & bash $waitScript
  return $LASTEXITCODE -eq 0
}

function Show-KeycloakStartupHelp {
  Write-Host ""
  Write-Host "Keycloak hazir degil. Kontrol:" -ForegroundColor Yellow
  Write-Host "  bash docker/wait-keycloak.sh"
  Write-Host "  docker logs securipdf-keycloak --tail 60"
}
