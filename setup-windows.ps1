$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Has-Command([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Has-Command "node")) {
  if (-not (Has-Command "winget")) {
    throw "Node.js missing. Install Node.js LTS, then run setup again."
  }
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Has-Command "npm")) {
  throw "npm missing. Restart PowerShell, then run setup again."
}

if (-not (Has-Command "inkscape")) {
  if (Has-Command "winget") {
    winget install --id Inkscape.Inkscape -e --silent --accept-package-agreements --accept-source-agreements
  } else {
    Write-Warning "Inkscape missing. EPS/AI conversion needs Inkscape."
  }
}

npm.cmd ci
npm.cmd run build
New-Item -ItemType Directory -Force -Path (Join-Path $root "server\cookies") | Out-Null

$startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$shortcutPath = Join-Path $startup "RBS Stock Server.lnk"
$serverLog = Join-Path $root "server.log"
$command = "/c cd /d `"$root`" && npm.cmd run server > `"$serverLog`" 2>&1"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $env:ComSpec
$shortcut.Arguments = $command
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Save()

Start-Process $env:ComSpec -ArgumentList $command -WorkingDirectory $root -WindowStyle Minimized
Start-Process explorer.exe (Join-Path $root "extension")
Start-Process "chrome.exe" "chrome://extensions/" -ErrorAction SilentlyContinue

Write-Host "Setup complete. Load extension folder in Chrome once, then open Figma plugin."
