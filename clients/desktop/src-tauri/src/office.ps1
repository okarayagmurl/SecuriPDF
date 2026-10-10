# Converts one document with the Microsoft Office installed on this PC.
# Called by office.rs; the last output line is a status code the app maps to a message.
# Macros are force-disabled: the document comes from the user and must not run code.
param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Target,
    [Parameter(Mandatory)][string]$PidFile,
    [ValidateSet("pdf", "pdfa", "docx")][string]$Format = "pdf"
)
$ErrorActionPreference = "Stop"

$forceDisableMacros = 3
$extension = [System.IO.Path]::GetExtension($Source).TrimStart(".").ToLowerInvariant()
$wordTypes = "doc", "docx", "docm", "dot", "dotx", "rtf", "odt", "txt", "pdf"
$excelTypes = "xls", "xlsx", "xlsm", "xlsb", "ods", "csv"
$powerPointTypes = "ppt", "pptx", "pptm", "pps", "ppsx", "odp"
$pdfa = $Format -eq "pdfa"

class OfficeFailure : System.Exception {
    OfficeFailure([string]$code) : base($code) {}
}

function Fail($code) { throw [OfficeFailure]::new($code) }

function Release($object) {
    if ($null -ne $object) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
}

# Office starts through COM, outside this process tree; the app kills the
# recorded process if the conversion does not finish in time.
function Open-App($progId, $processName) {
    $before = @(Get-Process $processName -ErrorAction SilentlyContinue | ForEach-Object Id)
    try { $app = New-Object -ComObject $progId } catch { Fail "OFFICE_MISSING" }
    $started = Get-Process $processName -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id }
    Set-Content -LiteralPath $PidFile -Value (@($started | ForEach-Object Id) -join " ")
    return $app
}

function Restore-PdfWarning($options, $previous) {
    if (-not $options) { return }
    if ($null -eq $previous) { Remove-ItemProperty -Path $options -Name DisableConvertPdfWarning -ErrorAction SilentlyContinue }
    else { Set-ItemProperty -Path $options -Name DisableConvertPdfWarning -Value $previous -Type DWord }
}

function Convert-Word {
    $app = Open-App "Word.Application" "WINWORD"
    $doc = $null
    $options = $null
    $previousWarning = $null
    try {
        $app.Visible = $false
        $app.DisplayAlerts = 0
        $app.AutomationSecurity = $forceDisableMacros
        if ($extension -eq "pdf") {
            # Word asks before reflowing a PDF even with alerts off; the prompt is
            # switched off for the open only and restored right after.
            $options = "HKCU:\Software\Microsoft\Office\$($app.Version)\Word\Options"
            if (-not (Test-Path $options)) { New-Item -Path $options -Force | Out-Null }
            $previousWarning = (Get-ItemProperty -Path $options -Name DisableConvertPdfWarning -ErrorAction SilentlyContinue).DisableConvertPdfWarning
            Set-ItemProperty -Path $options -Name DisableConvertPdfWarning -Value 1 -Type DWord
        }
        try { $doc = $app.Documents.Open($Source, $false, $true, $false) } catch { Fail "OFFICE_OPEN_FAILED" }
        finally { Restore-PdfWarning $options $previousWarning; $options = $null }
        try {
            if ($Format -eq "docx") {
                $doc.SaveAs2($Target, 16)
            } else {
                $doc.ExportAsFixedFormat($Target, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $pdfa)
            }
        } catch { Fail "OFFICE_EXPORT_FAILED" }
    } finally {
        if ($doc) { try { $doc.Close([ref]0) } catch {}; Release $doc }
        try { $app.Quit() } catch {}
        Release $app
    }
}

function Convert-Excel {
    if ($pdfa) { Fail "OFFICE_PDFA_WORD_ONLY" }
    $app = Open-App "Excel.Application" "EXCEL"
    $book = $null
    try {
        $app.Visible = $false
        $app.DisplayAlerts = $false
        $app.AutomationSecurity = $forceDisableMacros
        try { $book = $app.Workbooks.Open($Source, 0, $true) } catch { Fail "OFFICE_OPEN_FAILED" }
        try { $book.ExportAsFixedFormat(0, $Target) } catch { Fail "OFFICE_EXPORT_FAILED" }
    } finally {
        if ($book) { try { $book.Close($false) } catch {}; Release $book }
        try { $app.Quit() } catch {}
        Release $app
    }
}

function Convert-PowerPoint {
    # PowerPoint runs as a single instance; leave it open if the user already had it.
    $wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
    $app = Open-App "PowerPoint.Application" "POWERPNT"
    $show = $null
    try {
        $app.AutomationSecurity = $forceDisableMacros
        try { $show = $app.Presentations.Open($Source, -1, 0, 0) } catch { Fail "OFFICE_OPEN_FAILED" }
        try {
            if ($pdfa) {
                # COM rejects Missing for PrintRange; a range over every slide stands in for "all".
                $range = $show.PrintOptions.Ranges.Add(1, [Math]::Max(1, $show.Slides.Count))
                $show.ExportAsFixedFormat($Target, 2, 1, 0, 1, 1, 0, $range, 1, "", $true, $true, $true, $true, $true)
            } else {
                $show.SaveAs($Target, 32)
            }
        } catch { Fail "OFFICE_EXPORT_FAILED" }
    } finally {
        if ($show) { try { $show.Close() } catch {}; Release $show }
        if (-not $wasRunning) { try { $app.Quit() } catch {} }
        Release $app
    }
}

try {
    if ($Format -eq "docx" -and $extension -ne "pdf") { Fail "OFFICE_BAD_INPUT" }
    if ($wordTypes -contains $extension) { Convert-Word }
    elseif ($excelTypes -contains $extension) { Convert-Excel }
    elseif ($powerPointTypes -contains $extension) { Convert-PowerPoint }
    else { Fail "OFFICE_BAD_INPUT" }
    if (-not (Test-Path -LiteralPath $Target)) { Fail "OFFICE_EXPORT_FAILED" }
    Write-Output "OK"
    exit 0
} catch [OfficeFailure] {
    Write-Output $_.Exception.Message
    exit 1
} catch {
    Write-Output "OFFICE_EXPORT_FAILED"
    exit 1
}
