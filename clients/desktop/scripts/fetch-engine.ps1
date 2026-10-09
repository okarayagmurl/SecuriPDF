param(
    [string]$StirlingVersion = "2.14.3",
    [int]$JavaMajor = 25
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$engine = Join-Path $PSScriptRoot "..\src-tauri\engine" | Resolve-Path
$headers = @{ "User-Agent" = "securipdf-desktop" }
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("securipdf-engine-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

function Get-Verified([string]$Url, [string]$Sha256, [string]$OutFile) {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers $headers
    $actual = (Get-FileHash -Algorithm SHA256 $OutFile).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256.ToLowerInvariant()) {
        throw "SHA256 eşleşmedi: $Url"
    }
}

try {
    $release = Invoke-RestMethod -Headers $headers `
        -Uri "https://api.github.com/repos/Stirling-Tools/Stirling-PDF/releases/tags/v$StirlingVersion"
    $asset = $release.assets | Where-Object { $_.name -eq "Stirling-PDF-server.jar" } | Select-Object -First 1
    if (-not $asset -or -not $asset.digest) {
        throw "Stirling-PDF-server.jar $StirlingVersion bulunamadı veya özet yok"
    }
    $jar = Join-Path $tmp "stirling-pdf-server.jar"
    Get-Verified $asset.browser_download_url ($asset.digest -replace "^sha256:", "") $jar

    $jre = Invoke-RestMethod -Headers $headers `
        -Uri "https://api.adoptium.net/v3/assets/latest/$JavaMajor/hotspot?os=windows&architecture=x64&image_type=jre&vendor=eclipse"
    $pkg = $jre[0].binary.package
    $zip = Join-Path $tmp $pkg.name
    Get-Verified $pkg.link $pkg.checksum $zip
    $unpacked = Join-Path $tmp "jre"
    Expand-Archive -Path $zip -DestinationPath $unpacked
    $root = Get-ChildItem $unpacked -Directory | Select-Object -First 1

    Get-ChildItem $engine -Force | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Recurse -Force
    Move-Item $root.FullName (Join-Path $engine "jre")
    Move-Item $jar (Join-Path $engine "stirling-pdf-server.jar")
    @{
        stirlingVersion = $StirlingVersion
        jarSha256 = ($asset.digest -replace "^sha256:", "")
        java = $jre[0].release_name
    } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $engine "engine.json")
    Write-Host "Yerel motor hazır: $engine"
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
