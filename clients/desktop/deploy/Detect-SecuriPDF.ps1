# SCCM detection method. Exit 0 and print a line when the app is installed.
$ErrorActionPreference = 'SilentlyContinue'
$candidates = @(
    Join-Path $env:ProgramFiles 'SecuriPDF\securipdf-desktop.exe',
    Join-Path ${env:ProgramFiles(x86)} 'SecuriPDF\securipdf-desktop.exe',
    Join-Path $env:LOCALAPPDATA 'SecuriPDF\securipdf-desktop.exe'
)
$exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $exe) {
    $roots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $hit = Get-ChildItem $root | ForEach-Object { Get-ItemProperty $_.PSPath } |
            Where-Object { $_.DisplayName -eq 'SecuriPDF' -or $_.DisplayName -like 'SecuriPDF *' } |
            Select-Object -First 1
        if ($hit) {
            Write-Output ("SecuriPDF " + ($hit.DisplayVersion))
            exit 0
        }
    }
    exit 1
}
$version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
Write-Output "SecuriPDF $version"
exit 0
