# SCCM / Intune uninstall. Runs the NSIS uninstaller silently.
$ErrorActionPreference = 'Stop'
$roots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)
$apps = foreach ($root in $roots) {
    if (Test-Path $root) {
        Get-ChildItem $root | ForEach-Object {
            Get-ItemProperty $_.PSPath
        }
    }
}
$app = $apps | Where-Object {
    $_.DisplayName -eq 'SecuriPDF' -or $_.DisplayName -like 'SecuriPDF *'
} | Select-Object -First 1
if (-not $app) {
    Write-Output 'SecuriPDF kurulu degil.'
    exit 0
}
$cmd = $app.QuietUninstallString
if (-not $cmd) {
    $cmd = $app.UninstallString
}
if (-not $cmd) {
    throw 'Kaldirma komutu bulunamadi.'
}
if ($cmd -notmatch '/S') {
    $cmd = "$cmd /S"
}
cmd.exe /c $cmd
exit $LASTEXITCODE
