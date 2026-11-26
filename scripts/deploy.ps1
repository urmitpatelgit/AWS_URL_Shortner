param([switch]$Apply)
$ErrorActionPreference='Stop'; $root=Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'build.ps1')
Push-Location (Join-Path $root 'terraform'); terraform init; terraform fmt -recursive; terraform validate; terraform plan -out=tfplan
if($Apply){Write-Host 'Applying the reviewed Terraform plan. This creates AWS resources and may incur charges.';terraform apply tfplan}
Pop-Location
