param(
    [string]$CliPackage = "@claude-flow/cli@latest",
    [string]$TaskId,
    [bool]$Success = $true,
    [string]$Agent = "coder",
    [string]$PatternKey,
    [string]$PatternValue,
    [string]$PatternNamespace = "patterns",
    [switch]$SkipExportMetrics,
    [switch]$SkipPersistPatterns
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "session-end.mjs"
$args = @(
    $scriptPath,
    "--cli-package", $CliPackage,
    "--agent", $Agent,
    "--pattern-namespace", $PatternNamespace,
    "--success", ($(if ($Success) { "true" } else { "false" }))
)

if ($TaskId) {
    $args += @("--task-id", $TaskId)
}
if ($PatternKey) {
    $args += @("--pattern-key", $PatternKey)
}
if ($PatternValue) {
    $args += @("--pattern-value", $PatternValue)
}
if ($SkipExportMetrics -or $SkipPersistPatterns) {
    $args += "--no-save-state"
}

& node @args
if ($LASTEXITCODE -ne 0) {
    throw "Ruflo session-end wrapper failed."
}
