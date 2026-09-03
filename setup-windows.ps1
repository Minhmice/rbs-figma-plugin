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

Write-Host "Building background app..."
npm.cmd run build:server
npx.cmd pkg packaging\server.bundle.cjs --targets node22-win-x64 --output dist\MagnificStock.exe
node.exe scripts\hide-console.mjs dist\MagnificStock.exe

Write-Host "Setup complete. Run dist\MagnificStock.exe, then open Figma plugin."
