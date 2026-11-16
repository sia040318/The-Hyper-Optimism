# ADAS Project Deployment & AWS Guide

## 1. Quick Deployment Command
From the project folder:
```bash
npm run deploy
```
Or execute the PowerShell script:
```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/deploy-frontend.ps1
```

---

## 2. Infrastructure & Account Specifications

> [!CAUTION]
> **STRICT AWS ACCOUNT ISOLATION DIRECTIVE**
> Never query, modify, or list unrelated S3 buckets or resources in this account. Only interact with the dedicated project resources below.

* **AWS Account ID**: `334333507672`
* **Default Profile Region**: `ap-south-1` (Mumbai)
* **Project Hosting Region**: `ap-northeast-2` (Seoul) — *Always specify `--region ap-northeast-2` for S3 commands.*
* **S3 Bucket**: `s3://adas-gaze-audio-frontend-334333507672`
* **CloudFront Distribution ID**: `E2O6BXRO5Q08KN`
* **Public Domain / Live URL**: **https://d3ok0soe3kf2h1.cloudfront.net**

---

## 3. Important Notes for Agents & CLI Tools

1. **AWS CLI V2 vs V1**:
   * This machine has both Python AWS CLI v1 (`aws.cmd`) and AWS CLI v2 (`C:\Users\Ajay Vishal\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe`).
   * When invoking `aws login` (SSO/IAM Identity Center authentication), agents must execute **AWS CLI v2** directly.
2. **Re-authenticating**:
   * If session is expired, run `aws login` (or invoke AWS CLI v2 `login`). It will provide a browser authorization link.
3. **Region Explicit Parameter**:
   * Because the AWS profile's default region is `ap-south-1` but the S3 bucket is in `ap-northeast-2`, all S3 commands **must include `--region ap-northeast-2`** to prevent `PermanentRedirect` / `IllegalLocationConstraintException`.
4. **Local Inspection**:
   * To inspect locally in browser: `npm run dev`.
   * On Windows, run with `BypassSandbox: true` so the dev server port `5173` is accessible in the user's browser.
