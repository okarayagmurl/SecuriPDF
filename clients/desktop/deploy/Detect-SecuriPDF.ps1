# SCCM detection method. Exit 0 and print a line when the app is installed.
$ErrorActionPreference = 'SilentlyContinue'
$candidates = @(
    Join-Path $env:ProgramFiles 'SecuriPDF\securipdf-desktop.exe',
    Join-Path ${env:ProgramFiles(x86)} 'SecuriPDF\securipdf-desktop.exe',
    Join-Path $env:LOCALAPPDATA 'SecuriPDF\securipdf-desktop.exe'
)
$exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $exe) {
    exit 1
}
$version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
Write-Output "SecuriPDF $version"
exit 0
