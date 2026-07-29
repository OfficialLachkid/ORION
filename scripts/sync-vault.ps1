param(
    [string]$VaultPath = "Jacobs-2",
    [string]$BridgeSubpath = "90_Ruflo_Bridge",
    [string]$ExportPath = "data/vault-bridge/current"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "sync-vault.mjs"
$args = @(
    $scriptPath,
    "--vault-path", $VaultPath,
    "--bridge-subpath", $BridgeSubpath,
    "--export-path", $ExportPath
)

& node @args
if ($LASTEXITCODE -ne 0) {
    throw "Vault sync failed."
}
