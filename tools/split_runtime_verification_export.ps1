# Split a browser-generated refactor_runtime_verification_20260604_runtime.txt
# (from refactor_runtime_oneshot_verify_download.js) into the 7 required export files.

param(
    [string]$InputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'exports\for_chatgpt\refactor_runtime_verification_20260604_runtime.txt'),
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'exports\for_chatgpt')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $InputPath)) {
    Write-Error "Input not found: $InputPath"
}
$raw = Get-Content -Path $InputPath -Raw -Encoding UTF8
if ($raw -match 'PENDING_USER_RUN|"status"\s*:\s*"PENDING') {
    Write-Error 'Input is still a PENDING template — run oneshot script in Chrome first'
}

function Extract-JsonBlock([string]$text) {
    $start = $text.IndexOf('{')
    if ($start -lt 0) { return $null }
    $depth = 0
    for ($i = $start; $i -lt $text.Length; $i++) {
        $c = $text[$i]
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) {
                return $text.Substring($start, $i - $start + 1)
            }
        }
    }
    return $null
}

function Section-Lines([string]$text, [string]$header) {
    if ($text -notmatch "(?s)$header\s*\r?\n(.*?)(?=\r?\n# ---|\z)") {
        return @()
    }
    return ($Matches[1] -split '\r?\n' | Where-Object { $_ -and $_ -notmatch '^\s*#\s*\(none' })
}

$payload = $null
$json = Extract-JsonBlock $raw
if ($json) {
    try { $payload = $json | ConvertFrom-Json } catch { Write-Warning "JSON parse failed: $_" }
}

$harvest = $null
if ($payload -and $payload.report -and $payload.report.sections -and $payload.report.sections.manualHarvest) {
    $harvest = $payload.report.sections.manualHarvest
}

$maps = @{
    'send_message_button_log_20260604.txt' = {
        if ($payload.report.sections.sendMessage.rawLines) { return $payload.report.sections.sendMessage.rawLines }
        if ($harvest.sendMessage) { return $harvest.sendMessage }
        return Section-Lines $raw '# --- C1 send-message logs ---'
    }
    'send_copy_hotkey_button_log_20260604.txt' = {
        if ($payload.report.sections.sendCopyHotkey.rawLines) { return $payload.report.sections.sendCopyHotkey.rawLines }
        if ($harvest.sendCopyHotkey) { return $harvest.sendCopyHotkey }
        return Section-Lines $raw '# --- C2 send-copy-hotkey logs ---'
    }
    'closed_loop_success_log_20260604.txt' = {
        $lines = @()
        if ($harvest.closedLoop) {
            $lines += $harvest.closedLoop | Where-Object { $_ -match 'DISPATCH_RESULT.*ok=1|\bok=1\b' }
        }
        if (-not $lines.Count) { $lines = Section-Lines $raw '# --- C3 closed-loop success ---' }
        return $lines
    }
    'closed_loop_failure_log_20260604.txt' = {
        $lines = @()
        if ($harvest.closedLoop) {
            $lines += $harvest.closedLoop | Where-Object { $_ -match 'ok=0|DISPATCH_FAILED' }
        }
        if (-not $lines.Count) { $lines = Section-Lines $raw '# --- C4 closed-loop fail ---' }
        return $lines
    }
    'upload_button_log_20260604.txt' = {
        if ($harvest.upload) { return $harvest.upload }
        return Section-Lines $raw '# --- C5 upload ---'
    }
    'runtime_edge_cases_log_20260604.txt' = {
        $edge = @()
        if ($payload.report.sections.emptyInput.rawLines) { $edge += $payload.report.sections.emptyInput.rawLines }
        if ($payload.report.sections.duplicateClick.rawLines) { $edge += $payload.report.sections.duplicateClick.rawLines }
        if ($harvest.edgeCases) { $edge += $harvest.edgeCases }
        if (-not $edge.Count) { $edge = Section-Lines $raw '# --- C6 edge cases ---' }
        return $edge
    }
}

foreach ($name in $maps.Keys) {
    $getter = $maps[$name]
    $lines = & $getter
    if (-not $lines -or ($lines.Count -eq 0)) {
        Write-Host "[SKIP_EMPTY] $name"
        continue
    }
    $body = ($lines | ForEach-Object { "$_" }) -join "`n"
    $out = Join-Path $OutDir $name
    Set-Content -Path $out -Value $body -Encoding UTF8
    Write-Host "[WROTE] $out ($((Get-Item $out).Length) bytes)"
}

Write-Host '[SPLIT] Done. Run tools/validate_runtime_verification_logs.ps1'
