# SCCM / Intune / GPO startup: silent NSIS install + optional license and policy.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Installer,
    [string]$LicenseFile,
    [switch]$PerMachine,
    [switch]$DisableDemo,
    [ValidateSet('User', 'On', 'Off')]
    [string]$ShellMenu = 'User',
    [switch]$EnableUpdates,
    [string]$UpdateManifestUrl,
    [string]$LicenseDirectory
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Installer)) {
    throw "Kurulum dosyasi yok: $Installer"
}
if ($LicenseFile) {
    if (-not (Test-Path -LiteralPath $LicenseFile)) {
        throw "Lisans dosyasi yok: $LicenseFile"
    }
    $env:SECURIPDF_LICENSE = (Resolve-Path -LiteralPath $LicenseFile).Path
}

$isMsi = [System.IO.Path]::GetExtension($Installer) -eq '.msi'
if ($isMsi) {
    $arguments = @('/i', (Resolve-Path -LiteralPath $Installer).Path, '/qn')
    if ($PerMachine) {
        $arguments += 'ALLUSERS=1'
    }
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru
} else {
    $arguments = @('/S')
    if ($PerMachine) {
        $arguments += '/ALLUSERS'
    }
    $process = Start-Process -FilePath $Installer -ArgumentList $arguments -Wait -PassThru
}
if ($process.ExitCode -ne 0) {
    throw "Kurulum cikti kodu $($process.ExitCode)"
}

$writePolicy = $LicenseFile -or $LicenseDirectory -or $DisableDemo -or $EnableUpdates -or $UpdateManifestUrl -or ($ShellMenu -ne 'User')
if (-not $writePolicy) {
    return
}

$key = 'HKLM:\SOFTWARE\Policies\Entera\SecuriPDF\Desktop'
New-Item -Path $key -Force | Out-Null
if ($LicenseFile) {
    Set-ItemProperty -Path $key -Name LicenseFile -Value $env:SECURIPDF_LICENSE
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
if ($EnableUpdates) {
    New-ItemProperty -Path $key -Name EnableUpdates -PropertyType DWord -Value 1 -Force | Out-Null
}
if ($UpdateManifestUrl) {
    Set-ItemProperty -Path $key -Name UpdateManifestUrl -Value $UpdateManifestUrl
}
