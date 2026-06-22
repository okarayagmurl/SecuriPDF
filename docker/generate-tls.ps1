# SecuriPDF — self-signed TLS (dev / intranet PoC)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$sslDir = Join-Path $PSScriptRoot "nginx/ssl"
New-Item -ItemType Directory -Force -Path $sslDir | Out-Null

$key = Join-Path $sslDir "securipdf.key"
$crt = Join-Path $sslDir "securipdf.crt"

if (Test-Path $crt) {
  Write-Host "TLS sertifikasi zaten var: $crt"
  exit 0
}

Write-Host "Self-signed TLS olusturuluyor..."
docker run --rm -v "${sslDir}:/ssl" alpine/openssl req -x509 -nodes -days 825 `
  -newkey rsa:2048 `
  -keyout /ssl/securipdf.key `
  -out /ssl/securipdf.crt `
  -subj "/CN=securipdf.local/O=Entera"

Write-Host "Tamam: $crt"
