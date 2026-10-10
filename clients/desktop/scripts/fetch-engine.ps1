param(
    [string]$StirlingVersion = "2.14.3",
    [int]$JavaMajor = 25,
    [string]$SevenZip = "C:\Program Files\7-Zip\7z.exe"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$engine = Join-Path $PSScriptRoot "..\src-tauri\engine" | Resolve-Path
$headers = @{ "User-Agent" = "securipdf-desktop" }
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("securipdf-engine-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

$tesseractVersion = "5.4.0.20240606"
$tesseractSetup = @{
    Url = "https://github.com/UB-Mannheim/tesseract/releases/download/v$tesseractVersion/tesseract-ocr-w64-setup-$tesseractVersion.exe"
    Sha256 = "c885fff6998e0608ba4bb8ab51436e1c6775c2bafc2559a19b423e18678b60c9"
}
# tesseract.exe and the DLLs it loads; the installer also ships training tools we do not need.
$tesseractFiles = @(
    "tesseract.exe", "libtesseract-5.dll", "libleptonica-6.dll", "libarchive-13.dll", "libb2-1.dll",
    "libbz2-1.dll", "libcrypto-3-x64.dll", "libdeflate.dll", "libexpat-1.dll", "libgcc_s_seh-1.dll",
    "libgif-7.dll", "libiconv-2.dll", "libjbig-0.dll", "libjpeg-8.dll", "libLerc.dll", "liblz4.dll",
    "liblzma-5.dll", "libopenjp2-7.dll", "libpng16-16.dll", "libsharpyuv-0.dll", "libstdc++-6.dll",
    "libtiff-6.dll", "libwebp-7.dll", "libwebpmux-3.dll", "libwinpthread-1.dll", "libzstd.dll", "zlib1.dll"
)
$languages = @{
    tur = "e0c3338dc17503dc7d335a507c9ae01b2b46cfd07561171e1e1ac55d85e8e438"
    eng = "8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba"
}

# The AOT cache is only used when the JVM runs with the same options and
# settings it was trained with, so the app reads both from jvm.args and
# engine.env instead of keeping its own copy.
$jvmOptions = @(
    "-Xmx1g",
    "-Djava.awt.headless=true",
    "-Dspring.main.lazy-initialization=true",
    "-XX:TieredStopAtLevel=1"
)
$engineEnv = @{
    SECURITY_ENABLELOGIN = "false"
    DOCKER_ENABLE_SECURITY = "false"
    DISABLE_ADDITIONAL_FEATURES = "true"
    SYSTEM_ENABLEANALYTICS = "false"
    SYSTEM_GOOGLEVISIBILITY = "false"
    SYSTEM_DEFAULTLOCALE = "tr-TR"
    SYSTEM_MAXFILESIZE = "500"
    METRICS_ENABLED = "false"
    SHOW_SURVEY = "false"
    ENDPOINTS_GROUPSTOREMOVE = "OCRmyPDF"
}

function Get-Verified([string]$Url, [string]$Sha256, [string]$OutFile) {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers $headers
    $actual = (Get-FileHash -Algorithm SHA256 $OutFile).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256.ToLowerInvariant()) {
        throw "SHA256 eşleşmedi: $Url"
    }
}

try {
    if (-not (Test-Path $SevenZip)) {
        throw "7-Zip bulunamadı: $SevenZip (Tesseract kurulum paketini açmak için gerekir)"
    }

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
    $jreRoot = Get-ChildItem $unpacked -Directory | Select-Object -First 1

    $setup = Join-Path $tmp "tesseract-setup.exe"
    Get-Verified $tesseractSetup.Url $tesseractSetup.Sha256 $setup
    $tessUnpacked = Join-Path $tmp "tesseract"
    & $SevenZip x $setup "-o$tessUnpacked" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Tesseract paketi açılamadı" }
    foreach ($lang in $languages.Keys) {
        Get-Verified "https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/$lang.traineddata" `
            $languages[$lang] (Join-Path $tmp "$lang.traineddata")
    }

    Get-ChildItem $engine -Force | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Recurse -Force
    Move-Item $jreRoot.FullName (Join-Path $engine "jre")
    $java = Join-Path $engine "jre\bin\java.exe"

    $app = Join-Path $engine "app"
    & $java -Djarmode=tools -jar $jar extract --destination $app | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Stirling JAR açılamadı" }
    # The JVM rejects the AOT cache when a class path file's time changes, and
    # the NSIS installer stores file times with only 2-second precision.
    $fixedTime = [datetime]::new(2000, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    Get-ChildItem $app -Recurse -File | ForEach-Object { $_.LastWriteTimeUtc = $fixedTime }

    $tessDir = New-Item -ItemType Directory -Path (Join-Path $engine "tesseract")
    foreach ($file in $tesseractFiles) {
        Copy-Item (Join-Path $tessUnpacked $file) $tessDir
    }
    $tessdata = New-Item -ItemType Directory -Path (Join-Path $engine "tessdata")
    Copy-Item (Join-Path $tessUnpacked "tessdata\configs") $tessdata -Recurse
    # Stirling renders pages for OCR at system.maxDPI (500) into PNGs without a
    # resolution; Tesseract would assume 70 DPI and make the pages 7x too big.
    Add-Content -Encoding ASCII (Join-Path $tessdata "configs\pdf") "user_defined_dpi 500"
    Copy-Item (Join-Path $tessUnpacked "tessdata\pdf.ttf"), (Join-Path $tessUnpacked "tessdata\osd.traineddata") $tessdata
    foreach ($lang in $languages.Keys) {
        Move-Item (Join-Path $tmp "$lang.traineddata") $tessdata
    }

    $jvmOptions | Set-Content -Encoding ASCII (Join-Path $engine "jvm.args")
    $engineEnv.Keys | Sort-Object | ForEach-Object { "$_=$($engineEnv[$_])" } |
        Set-Content -Encoding ASCII (Join-Path $engine "engine.env")

    Write-Host "AOT önbelleği hazırlanıyor (birkaç dakika sürebilir)..."
    $train = New-Item -ItemType Directory -Path (Join-Path $tmp "train")
    $aot = Join-Path $engine "engine.aot"
    $saved = @{}
    foreach ($key in $engineEnv.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key)
        [Environment]::SetEnvironmentVariable($key, $engineEnv[$key])
    }
    $trainLog = Join-Path ([System.IO.Path]::GetTempPath()) "securipdf-aot-train.log"
    Push-Location $train
    # Java reports normal progress on stderr, which Windows PowerShell turns into errors under "Stop".
    $ErrorActionPreference = "Continue"
    try {
        & $java @jvmOptions "-XX:AOTCacheOutput=$aot" "-Dspring.context.exit=onRefresh" `
            -jar (Join-Path $app "stirling-pdf-server.jar") "--server.address=127.0.0.1" "--server.port=0" 2>&1 |
            Out-File -Encoding UTF8 $trainLog
        $trainExit = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = "Stop"
        Pop-Location
        foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
    }
    if ($trainExit -ne 0 -or -not (Test-Path $aot)) { throw "AOT önbelleği oluşmadı; günlük: $trainLog" }

    @{
        stirlingVersion = $StirlingVersion
        jarSha256 = ($asset.digest -replace "^sha256:", "")
        java = $jre[0].release_name
        tesseract = $tesseractVersion
        tessdata = "tessdata_best 4.1.0: " + (($languages.Keys | Sort-Object) -join ", ")
    } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $engine "engine.json")
    Write-Host "Yerel motor hazır: $engine"
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
