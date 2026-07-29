param(
    [string]$SessionId = ("session-" + (Get-Date -Format "yyyyMMdd-HHmmss")),
    [string]$CliPackage = "@claude-flow/cli@latest",
    [string]$Query,
    [string]$Namespace = "patterns",
    [string]$PreTaskDescription,
    [switch]$SkipDaemon,
    [switch]$SkipVaultSync
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "session-start.mjs"
$args = @(
    $scriptPath,
    "--session-id", $SessionId,
    "--cli-package", $CliPackage,
    "--namespace", $Namespace
)

if ($Query) {
    $args += @("--query", $Query)
}
if ($PreTaskDescription) {
    $args += @("--pre-task-description", $PreTaskDescription)
}
if ($SkipDaemon) {
    $args += "--skip-daemon"
}
if ($SkipVaultSync) {
    $args += "--skip-vault-sync"
}

& node @args
if ($LASTEXITCODE -ne 0) {
    throw "Ruflo session-start wrapper failed."
}
