# Writes HKLM policy for workgroup PCs or an SCCM configuration baseline.
[CmdletBinding()]
param(
    [string]$LicenseFile,
    [string]$LicenseDirectory,
    [switch]$DisableDemo,
    [ValidateSet('User', 'On', 'Off')]
    [string]$ShellMenu = 'User',
    [switch]$BlockTimestamp,
    [switch]$EnableUpdates,
    [string]$UpdateManifestUrl,
    [string]$BlockedTools,
    [string]$AllowedADGroups,
    [switch]$Clear
)

$ErrorActionPreference = 'Stop'
$key = 'HKLM:\SOFTWARE\Policies\Entera\SecuriPDF\Desktop'
if ($Clear) {
    if (Test-Path $key) {
        Remove-Item -Path $key -Recurse -Force
    }
    return
}
New-Item -Path $key -Force | Out-Null
if ($LicenseFile) {
    Set-ItemProperty -Path $key -Name LicenseFile -Value $LicenseFile
}
if ($LicenseDirectory) {
    Set-ItemProperty -Path $key -Name LicenseDirectory -Value $LicenseDirectory
}
if ($DisableDemo) {
    New-ItemProperty -Path $key -Name DisableDemo -PropertyType DWord -Value 1 -Force | Out-Null
}
if ($ShellMenu -eq 'On') {
    New-ItemProperty -Path $key -Name EnableShellMenu -PropertyType DWord -Value 1 -Force | Out-Null
}
elseif ($ShellMenu -eq 'Off') {
    New-ItemProperty -Path $key -Name EnableShellMenu -PropertyType DWord -Value 0 -Force | Out-Null
}
if ($BlockTimestamp) {
    New-ItemProperty -Path $key -Name AllowTimestamp -PropertyType DWord -Value 0 -Force | Out-Null
}
if ($EnableUpdates) {
    New-ItemProperty -Path $key -Name EnableUpdates -PropertyType DWord -Value 1 -Force | Out-Null
}
if ($UpdateManifestUrl) {
    Set-ItemProperty -Path $key -Name UpdateManifestUrl -Value $UpdateManifestUrl
}
if ($BlockedTools) {
    Set-ItemProperty -Path $key -Name BlockedTools -Value $BlockedTools
}
if ($AllowedADGroups) {
    Set-ItemProperty -Path $key -Name AllowedADGroups -Value $AllowedADGroups
}
