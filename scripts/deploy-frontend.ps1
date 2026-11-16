# ==============================================================================
# ADAS Gaze-Contingent Audio Project - Frontend Deploy Script
# ==============================================================================
param (
    [string]$Region = "ap-northeast-2",
    [string]$BucketName = "adas-gaze-audio-frontend-334333507672",
    [string]$DistributionId = "E2O6BXRO5Q08KN"
)

$ErrorActionPreference = "Stop"

# Resolve AWS CLI v2 path
$AwsExe = "C:\Users\Ajay Vishal\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe"
if (-not (Test-Path $AwsExe)) {
    $AwsExe = (Get-Command aws.exe -ErrorAction SilentlyContinue).Source
    if (-not $AwsExe) {
        $AwsExe = "aws"
    }
}

Write-Host "==> Checking AWS CLI authentication..." -ForegroundColor Cyan
try {
    $caller = & $AwsExe sts get-caller-identity | ConvertFrom-Json
    Write-Host "Authenticated as $($caller.Arn) (Account: $($caller.Account))" -ForegroundColor Green
} catch {
    Write-Warning "AWS credentials expired or not found. Initiating login..."
    & $AwsExe login
    $caller = & $AwsExe sts get-caller-identity | ConvertFrom-Json
    Write-Host "Authenticated as $($caller.Arn)" -ForegroundColor Green
}

# Determine project directory
$projectDir = if (Test-Path "$PSScriptRoot\..\package.json") {
    Resolve-Path "$PSScriptRoot\.."
} else {
    Get-Location
}

Write-Host "==> Building frontend in $projectDir..." -ForegroundColor Cyan
Set-Location $projectDir
npm run build

$distPath = Join-Path $projectDir "dist"
if (-not (Test-Path $distPath)) {
    throw "Build folder dist does not exist at $distPath!"
}

Write-Host "==> Syncing build assets to S3: s3://$BucketName (Region: $Region)..." -ForegroundColor Cyan
& $AwsExe s3 sync $distPath "s3://$BucketName" --delete --region $Region

Write-Host "==> Creating CloudFront cache invalidation for $DistributionId..." -ForegroundColor Cyan
$invalidation = & $AwsExe cloudfront create-invalidation --distribution-id $DistributionId --paths "/*" | ConvertFrom-Json
Write-Host "Invalidation ID created: $($invalidation.Invalidation.Id)" -ForegroundColor Green

Write-Host "`n✅ Deployment complete!" -ForegroundColor Green
Write-Host "Live URL: https://d3ok0soe3kf2h1.cloudfront.net`n" -ForegroundColor Yellow
