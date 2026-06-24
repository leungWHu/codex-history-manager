$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

$hostName = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$port = if ($env:PORT) { $env:PORT } else { "8765" }

$condaCommand = Get-Command conda -ErrorAction SilentlyContinue
if (-not $condaCommand) {
    Write-Error "conda was not found. Install conda or add it to PATH first."
    exit 1
}

$condaPath = $condaCommand.Source
if ($condaPath -and $condaPath.EndsWith("\Scripts\conda.exe", [System.StringComparison]::OrdinalIgnoreCase)) {
    $condaRoot = Split-Path -Parent (Split-Path -Parent $condaPath)
    $condaBat = Join-Path $condaRoot "condabin\conda.bat"
    if (Test-Path -LiteralPath $condaBat) {
        $condaPath = $condaBat
    }
}

Write-Host "Conda command: $condaPath"

$envJson = & $condaPath env list --json
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to query conda environments."
    exit $LASTEXITCODE
}

$envInfo = $envJson | ConvertFrom-Json
$envPaths = @($envInfo.envs)

if ($envPaths.Count -eq 0) {
    Write-Error "No conda environments found."
    exit 1
}

Write-Host "Select conda environment:"
for ($i = 0; $i -lt $envPaths.Count; $i++) {
    $envPath = [string]$envPaths[$i]
    $envName = Split-Path -Leaf $envPath
    "{0,4}) {1} ({2})" -f ($i + 1), $envName, $envPath | Write-Host
}

$choice = Read-Host "Enter number [1]"
if ([string]::IsNullOrWhiteSpace($choice)) {
    $choice = "1"
}

$selectedNumber = 0
if (-not [int]::TryParse($choice, [ref]$selectedNumber) -or $selectedNumber -lt 1 -or $selectedNumber -gt $envPaths.Count) {
    Write-Error "Invalid selection: $choice"
    exit 1
}

$selectedPath = [string]$envPaths[$selectedNumber - 1]
$selectedName = Split-Path -Leaf $selectedPath

Write-Host "Starting Codex History Viewer..."
Write-Host "Conda env: $selectedName ($selectedPath)"
Write-Host "Host: $hostName"
Write-Host "Port: $port"
Write-Host "URL: http://${hostName}:$port"
if ($env:CODEX_HOME) {
    Write-Host "Codex home: $env:CODEX_HOME"
}
Write-Host "Keep this window open while using the web page."
Write-Host ""

$serverArgs = @("run", "--no-capture-output", "-p", $selectedPath, "python", "-u", "server.py", "--host", $hostName, "--port", $port)
if ($env:CODEX_HOME) {
    $serverArgs += @("--codex-home", $env:CODEX_HOME)
}
$serverArgs += $args

& $condaPath @serverArgs
exit $LASTEXITCODE
