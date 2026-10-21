$ErrorActionPreference = 'Stop'
$reviewDirectory = Split-Path -Parent $PSScriptRoot
$inputDocument = Join-Path $reviewDirectory 'Dragon_Market_Reviewer_Guide_and_Signoff_Form_COMPLETED_CODEX.docx'
$outputPdf = Join-Path $reviewDirectory 'Dragon_Market_Reviewer_Guide_and_Signoff_Form_COMPLETED_CODEX.pdf'
$wordApplication = $null
$reviewDocument = $null
try {
    $wordApplication = New-Object -ComObject Word.Application
    $wordApplication.Visible = $false
    $wordApplication.DisplayAlerts = 0
    $wordApplication.AutomationSecurity = 3
    $reviewDocument = $wordApplication.Documents.Open($inputDocument, $false, $true)
    $reviewDocument.ExportAsFixedFormat($outputPdf, 17)
    Write-Output $outputPdf
} finally {
    if ($null -ne $reviewDocument) {
        $reviewDocument.Close(0)
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($reviewDocument)
    }
    if ($null -ne $wordApplication) {
        $wordApplication.Quit(0)
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApplication)
    }
}
