$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$localEnvPath = Join-Path $projectRoot "local-env.ps1"
if (Test-Path $localEnvPath) {
  . $localEnvPath
}

if (-not $env:ADMIN_PASSWORD) {
  $env:ADMIN_PASSWORD = "55aiden55"
}

if (-not $env:PORT) {
  $env:PORT = "4173"
}

function Get-CommandPathOrThrow {
  param(
    [string[]]$Candidates,
    [string]$DisplayName,
    [string]$InstallHelp
  )

  foreach ($candidate in $Candidates) {
    if ($candidate -eq "") {
      continue
    }

    if ($candidate -in @("node", "cloudflared")) {
      $command = Get-Command $candidate -ErrorAction SilentlyContinue
      if ($command) {
        return $command.Source
      }
      continue
    }

    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "$DisplayName was not found. $InstallHelp"
}

$nodeCommand = Get-CommandPathOrThrow -Candidates @(
  (Join-Path $projectRoot "node.exe"),
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
  "node"
) -DisplayName "Node.js" -InstallHelp "Install Node.js on this laptop or place node.exe in the project folder."

$cloudflaredCommand = Get-CommandPathOrThrow -Candidates @(
  (Join-Path $projectRoot "cloudflared.exe"),
  "cloudflared"
) -DisplayName "cloudflared" -InstallHelp "Install cloudflared from Cloudflare or place cloudflared.exe in the project folder."

Write-Host ""
Write-Host "LaSalle Titans public host"
Write-Host "Project: $projectRoot"
Write-Host "Port: $($env:PORT)"
Write-Host "Node: $nodeCommand"
Write-Host "Cloudflared: $cloudflaredCommand"
Write-Host ""
Write-Host "This window starts both the local server and the public Cloudflare Quick Tunnel."
Write-Host "Keep this window open."
Write-Host ""

$serverArgs = @(
  "-NoExit",
  "-Command",
  "& { Set-Location '$projectRoot'; `$env:ADMIN_PASSWORD='$($env:ADMIN_PASSWORD)'; `$env:PORT='$($env:PORT)'; `$env:DISCORD_WEBHOOK_URL='$($env:DISCORD_WEBHOOK_URL)'; & '$nodeCommand' 'server.js' }"
)

$serverProcess = Start-Process -FilePath "powershell" -ArgumentList $serverArgs -PassThru

try {
  Start-Sleep -Seconds 3
  Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/health" -f $env:PORT) | Out-Null
} catch {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
  }
  throw "The local server did not start correctly on port $($env:PORT)."
}

Write-Host "Local server is up. Launching Cloudflare Quick Tunnel..." -ForegroundColor Green
Write-Host ""
Write-Host "When Cloudflare prints the https://...trycloudflare.com URL, that is the public link you share with coaches."
Write-Host ""

& $cloudflaredCommand tunnel --url ("http://localhost:{0}" -f $env:PORT)
