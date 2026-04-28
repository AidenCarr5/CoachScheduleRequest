$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not $env:ADMIN_PASSWORD) {
  $env:ADMIN_PASSWORD = "55aiden55"
}

if (-not $env:PORT) {
  $env:PORT = "4173"
}

function Get-NodeCommand {
  $candidates = @(
    (Join-Path $projectRoot "node.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    "node"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -eq "node") {
      $command = Get-Command node -ErrorAction SilentlyContinue
      if ($command) {
        return $command.Source
      }
      continue
    }

    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Node.js was not found. Install Node.js on this laptop or place node.exe in the project folder."
}

Write-Host ""
Write-Host "LaSalle Titans coach scheduler host"
Write-Host "Project: $projectRoot"
Write-Host "Port: $($env:PORT)"
Write-Host ""

$nodeCommand = Get-NodeCommand
Write-Host "Using Node: $nodeCommand"
Write-Host "Close this window or press Ctrl+C to stop the server."
Write-Host ""

while ($true) {
  & $nodeCommand "server.js"
  $exitCode = $LASTEXITCODE

  if ($exitCode -eq 0) {
    break
  }

  Write-Host ""
  Write-Host "Server stopped unexpectedly with exit code $exitCode. Restarting in 5 seconds..." -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}
