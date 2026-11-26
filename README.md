# Serverless URL Shortener

A serverless URL shortener built with React, Vite, Node.js 22 Lambda, API Gateway HTTP API, DynamoDB, S3, CloudFront, and Terraform. It creates links that expire after 30 days, atomically counts successful redirects, and displays a five-second redirect page.

## Architecture

- Private S3 bucket for the Vite site, accessed through CloudFront Origin Access Control.
- CloudFront Function serves the React entry point for short-code paths; `/api/*` goes to API Gateway.
- API Gateway HTTP API invokes separate Lambda handlers for creating and resolving links.
- DynamoDB uses on-demand billing, TTL cleanup, point-in-time recovery, and deletion protection.
- ACM provisions the CloudFront certificate in `us-east-1`; DNS is managed outside Terraform.

## Prerequisites

- Node.js 22 or later and npm.
- Terraform 1.6 or later.
- AWS CLI v2 and an AWS account with permission to create the resources in `terraform/`.
- A domain or subdomain you control, with access to its DNS records. CloudFront certificates must be issued in `us-east-1`.
- PowerShell for the included `.ps1` build, deployment, and publishing scripts.

## Clone and configure

```powershell
git clone <repository-url>
cd <repository-folder>
Copy-Item .\terraform\terraform.tfvars.example .\terraform\terraform.tfvars
```

Edit `terraform/terraform.tfvars` and replace `links.example.com` with the hostname you will use, such as `short.example.org`. Keep `create_distribution = false` and `acm_validation_record_fqdns = []` for the initial deployment. Do not commit `terraform.tfvars`, Terraform state, AWS credentials, or plan files; the provided ignore rules exclude them.

Configure your AWS CLI credentials using your preferred method, then verify the account before deployment:

```powershell
aws sts get-caller-identity
```

## Build, validate, and deploy

The deployment script builds both application packages, initializes Terraform, formats and validates the configuration, and creates a plan. It does not apply unless you pass `-Apply`.

```powershell
.\scripts\deploy.ps1
```

Review the plan. The first stage creates the DynamoDB table, Lambda functions, API, S3 bucket, and ACM certificate. These resources can incur AWS charges. If the plan is expected, apply it:

```powershell
.\scripts\deploy.ps1 -Apply
```

In the Terraform folder, retrieve the ACM DNS validation record:

```powershell
cd .\terraform
terraform output certificate_dns_validation_records
```

Add the displayed CNAME record at your DNS provider and wait for the certificate for your hostname to show **Issued** in ACM in `us-east-1`. Keep this validation record in DNS for ongoing certificate renewal.

Edit `terraform.tfvars`: set `create_distribution = true` and set `acm_validation_record_fqdns` to the full CNAME record name(s) shown by Terraform (without a trailing dot is fine). Return to the project root, review the next plan, and apply it:

```powershell
cd ..
.\scripts\deploy.ps1
.\scripts\deploy.ps1 -Apply
```

When the CloudFront distribution is ready, publish the frontend:

```powershell
.\scripts\publish.ps1
```

Create a public DNS CNAME for your hostname pointing to the `cloudfront_domain_name` output. Use DNS-only mode if your DNS provider offers an HTTP proxy toggle. The site will become available at `https://<your-hostname>` after CloudFront and DNS have propagated.

## Local development and tests

Open the frontend through Vite rather than opening `frontend/index.html` as a file:

```powershell
.\scripts\run-local.ps1
```

Run unit checks and create a production frontend build:

```powershell
Push-Location .\backend
npm ci
npm test
Pop-Location

Push-Location .\frontend
npm ci
npm test
npm run build
Pop-Location
```

The Vite development page is useful for visual work. The shortening and resolving API routes are served by the deployed API through CloudFront.

## API

- `POST /api/shorten` with JSON body `{ "longUrl": "https://example.org/page" }`.
- `GET /api/resolve/{code}` returns the destination URL for the redirect screen.

Only `http` and `https` destination URLs are accepted. Lambda checks the stored expiry on every resolution and returns `410 Gone` for expired links; DynamoDB TTL performs eventual cleanup. Successful resolutions increment `clickCount` with an atomic DynamoDB update.

## Cost and cleanup

DynamoDB uses on-demand billing and CloudFront uses Price Class 100, but deployed resources may still incur charges. Review AWS pricing for your region and usage. Terraform state is local by default; protect it and store it securely if you use a remote backend.

Before destroying the stack, empty the S3 site bucket and set `deletion_protection_enabled = false` on the DynamoDB table in `terraform/main.tf`, then apply that change. Afterward, from the Terraform directory, review and run `terraform destroy` if you intend to remove all resources. Delete the ACM and public DNS records only when they are no longer needed.
