# SecuriPDF — stack dogrulama (Faz 1-5)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$fail = 0

function Test-Step {
  param([string]$Name, [scriptblock]$Action)
  try {
    & $Action
    Write-Host "[OK] $Name" -ForegroundColor Green
  } catch {
    Write-Host "[FAIL] $Name — $($_.Exception.Message)" -ForegroundColor Red
    $script:fail++
  }
}

Test-Step "Platform health" {
  $r = docker exec securipdf-platform curl -sf http://127.0.0.1:8000/health | ConvertFrom-Json
  if ($r.status -ne "ok") { throw "unexpected" }
}

Test-Step "License API (public status)" {
  $r = docker exec securipdf-platform curl -sf http://127.0.0.1:8000/api/license/v1/status | ConvertFrom-Json
  if (-not $r.valid) { throw "license invalid" }
}

Test-Step "Vault quota (simulated auth header)" {
  $json = docker exec entera-nginx wget -qO- `
    --header="X-Auth-Request-User: test-user" `
    --header="X-Auth-Request-Groups: pdf-user" `
    http://127.0.0.1:8080/api/vault/v1/quota 2>$null
  if ($json -notmatch "maxBytes") { throw "quota response invalid: $json" }
}

Test-Step "Admin /admin JWT auth (access token)" {
  $body = @{
    client_id     = "securipdf"
    client_secret = "SecuriPDF-OAuth2-Dev-Secret-2026"
    grant_type    = "password"
    username      = "securipdf-local-admin"
    password      = "SecuriPDF-Local-Admin-2026"
    scope         = "openid profile email"
  }
  if ($env:OAUTH2_CLIENT_SECRET) { $body.client_secret = $env:OAUTH2_CLIENT_SECRET }
  $token = Invoke-RestMethod -Method Post -Uri "http://localhost:8090/realms/securipdf/protocol/openid-connect/token" `
    -ContentType "application/x-www-form-urlencoded" -Body $body
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = docker exec entera-nginx wget -qS -O /dev/null `
    --header="X-Forwarded-User: securipdf-local-admin" `
    --header="X-Forwarded-Access-Token: $($token.access_token)" `
    http://127.0.0.1:8080/admin 2>&1 | Out-String
  $ErrorActionPreference = $prev
  if ($out -notmatch "200 OK") { throw "admin JWT auth failed: $out" }
}

Test-Step "Admin users list API" {
  $json = docker exec entera-nginx wget -qO- `
    --header="X-Auth-Request-User: admin-test" `
    --header="X-Auth-Request-Groups: pdf-admin" `
    "http://127.0.0.1:8080/api/vault/v1/admin/users?size=5" 2>$null
  if ($json -notmatch '"items"') { throw "users list invalid: $json" }
}

Test-Step "Admin settings API" {
  $json = docker exec entera-nginx wget -qO- `
    --header="X-Auth-Request-User: admin-test" `
    --header="X-Auth-Request-Groups: pdf-admin" `
    http://127.0.0.1:8080/api/vault/v1/admin/settings 2>$null
  if ($json -notmatch '"ldap"') { throw "settings response invalid: $json" }
}

Test-Step "Admin API (simulated pdf-admin)" {
  $json = docker exec entera-nginx wget -qO- `
    --header="X-Auth-Request-User: admin-test" `
    --header="X-Auth-Request-Groups: pdf-admin" `
    http://127.0.0.1:8080/api/vault/v1/admin/ldap/test 2>$null
  if ($json -notmatch '"ok"') { throw "admin ldap test invalid: $json" }
}

Test-Step "Orchestration signatures list" {
  $json = docker exec entera-nginx wget -qO- `
    --header="X-Auth-Request-User: test-user" `
    --header="X-Auth-Request-Groups: pdf-user" `
    http://127.0.0.1:8080/api/orchestration/signatures 2>$null
  if ($json -notmatch "items") { throw "signatures list invalid: $json" }
}

Test-Step "Nginx health" {
  docker exec entera-nginx wget -qO- http://127.0.0.1:8080/nginx-health | Out-Null
}

Test-Step "Keycloak" {
  docker exec securipdf-keycloak sh -c "timeout 2 sh -c 'cat < /dev/null > /dev/tcp/127.0.0.1/8080'" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "keycloak down" }
}

Test-Step "Postgres" {
  docker exec securipdf-postgres pg_isready -U keycloak -d keycloak | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "postgres down" }
}

if ($fail -gt 0) {
  Write-Host "`n$fail test basarisiz" -ForegroundColor Red
  exit 1
}
Write-Host "`nTum testler gecti ($((11)) kontrol)." -ForegroundColor Green
