$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path $PSScriptRoot -Parent
$terraformDirectory = Join-Path $projectRoot 'terraform'
$frontendBuild = Join-Path $projectRoot 'frontend\dist'

if (-not (Test-Path -LiteralPath $frontendBuild -PathType Container)) {
    throw "Frontend build not found at '$frontendBuild'. Run scripts/build.ps1 first."
}

Push-Location $terraformDirectory
try {
    $bucketName = terraform output -raw site_bucket_name
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the S3 bucket name from Terraform state.' }

    $distributionId = terraform output -raw cloudfront_distribution_id
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the CloudFront distribution ID from Terraform state.' }
} finally {
    Pop-Location
}

if ([string]::IsNullOrWhiteSpace($bucketName) -or $bucketName -eq 'null') {
    throw 'Terraform returned an empty S3 bucket name.'
}
if ([string]::IsNullOrWhiteSpace($distributionId) -or $distributionId -eq 'null') {
    throw 'Terraform returned an empty CloudFront distribution ID. Confirm the second Terraform apply completed.'
}

aws s3 sync $frontendBuild "s3://$bucketName" --delete
if ($LASTEXITCODE -ne 0) { throw 'S3 upload failed. Check the AWS CLI profile and permissions.' }

aws cloudfront create-invalidation --distribution-id $distributionId --paths '/*'
if ($LASTEXITCODE -ne 0) { throw 'CloudFront invalidation failed. Check the AWS CLI profile and permissions.' }
