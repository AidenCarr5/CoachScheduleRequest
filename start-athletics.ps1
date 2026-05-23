$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$env:SITE_CONFIG_PATH = "site/athletics.config.json"
$env:SITE_DATA_PATH = "site/athletics-data.js"
$env:REQUESTS_FILE = "storage/athletics-requests.json"
$env:COACH_ACCOUNTS_FILE = "storage/athletics-coach-accounts.json"
$env:STATUS_MONITOR_FILE = "storage/athletics-diamond-status-monitor.json"
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "55aiden55"
if (-not $env:PORT) {
  $env:PORT = "4184"
}

$nodeCommand = $null
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
foreach ($candidate in @((Join-Path $projectRoot "node.exe"), $bundledNode, "node")) {
  if ($candidate -eq "node") {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command) {
      $nodeCommand = $command.Source
      break
    }
  } elseif (Test-Path $candidate) {
    $nodeCommand = $candidate
    break
  }
}

if (-not $nodeCommand) {
  throw "Node.js was not found. Install Node.js or place node.exe in the project folder."
}

& $nodeCommand server.js
