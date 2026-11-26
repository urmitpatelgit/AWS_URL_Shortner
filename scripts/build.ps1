$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location (Join-Path $root 'backend'); npm install --omit=dev; Pop-Location
$zip=Join-Path $root 'terraform\lambda.zip'; if(Test-Path $zip){Remove-Item -LiteralPath $zip -Force}
Compress-Archive -Path (Join-Path $root 'backend\src'),(Join-Path $root 'backend\node_modules') -DestinationPath $zip
Push-Location (Join-Path $root 'frontend'); npm install; npm run build; Pop-Location
