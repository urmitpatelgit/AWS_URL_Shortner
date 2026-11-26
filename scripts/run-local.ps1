$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location (Join-Path $root 'frontend')
if (!(Test-Path 'node_modules')) { npm install }
npm run dev -- --host 127.0.0.1
Pop-Location
