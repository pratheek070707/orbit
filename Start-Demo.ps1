$ErrorActionPreference = "Stop"

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }

if (-not $nodePath) {
  $bundledNode = Join-Path $PSScriptRoot "..\..\work\setup\node-v24.22.0-win-x64\node.exe"
  if (Test-Path $bundledNode) {
    $nodePath = (Resolve-Path $bundledNode).Path
  }
}

if (-not $nodePath) {
  Write-Error "Node.js 20 or newer is required. Install Node.js, then run this script again."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npmPath = if ($npmCommand) { $npmCommand.Source } else { Join-Path (Split-Path $nodePath) "npm.cmd" }

if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules\next\dist\bin\next"))) {
  if (-not (Test-Path $npmPath)) {
    Write-Error "npm was not found beside Node.js. Install Node.js with npm, then run this script again."
  }
  Push-Location $PSScriptRoot
  try {
    & $npmPath install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
}

$runtimeData = Join-Path $PSScriptRoot ".runtime\appdata"
New-Item -ItemType Directory -Path $runtimeData -Force | Out-Null
$env:APPDATA = $runtimeData
$env:NEXT_TELEMETRY_DISABLED = "1"
$port = if ($env:PORT) { $env:PORT } else { "3002" }
$devScript = Join-Path $PSScriptRoot "scripts\dev.mjs"

Write-Host "Starting Orbit."
Write-Host "When it is ready, open http://localhost:$port"
Write-Host "Keep this window open while presenting. Press Ctrl+C to stop."
Push-Location $PSScriptRoot
try {
  $env:PORT = $port
  & $nodePath $devScript
} finally {
  Pop-Location
}
