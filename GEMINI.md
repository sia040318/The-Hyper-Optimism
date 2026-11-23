# Project Rules & Guidelines

> [!CAUTION]
> ### STRICT AWS ACCOUNT ISOLATION DIRECTIVE
> **DO NOT EVER TOUCH, MODIFY, LIST, OR DELETE OTHER PROJECTS OR RESOURCES IN THIS AWS ACCOUNT.**
> - All AWS operations must strictly belong to this ADAS project (`gaze-contingent-3d-audio-adas`).
> - S3 buckets, CloudFront distributions, IAM roles, or any other cloud resources MUST use project-specific prefixes (e.g., `adas-gaze-audio-*`) and MUST NOT touch, inspect, or query any unrelated buckets or stacks.

## Mandatory UI & Design System Rules
- **Before creating or editing any UI component or page, ALWAYS read `DESIGN.md` first. Strictly adhere to its tokens, typography, spacing, and anti-patterns. Build one section at a time, prioritize whitespace and hierarchy, and verify both desktop and mobile layouts.**
- Active frontend root: `The-Hyper-Optimism/` (Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui). Design tokens live in `src/globals.css`.

## Project AWS Deployment Details
- **Account ID**: `334333507672`
- **Default Profile Region**: `ap-south-1` (Mumbai)
- **Project Hosting Region**: `ap-northeast-2` (Seoul)
  * Always pass `--region ap-northeast-2` for all S3 commands on this project's bucket.
- **S3 Bucket**: `s3://adas-gaze-audio-frontend-334333507672`
- **CloudFront Distribution ID**: `E2O6BXRO5Q08KN`
- **Public Domain**: `https://d3ok0soe3kf2h1.cloudfront.net`
- **Deployment Script**: `npm run deploy` or `powershell -ExecutionPolicy Bypass -File ./scripts/deploy-frontend.ps1`

## AWS CLI & Authentication Instructions for Agents
1. **AWS CLI V2 Binary**:
   - The system has Python AWS CLI v1 in PATH (`aws.cmd`) and AWS CLI v2 (`C:\Users\Ajay Vishal\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe`).
   - For `aws login` (SSO/IAM Identity Center session), agents **must** use AWS CLI v2 directly.
2. **Session Reauthentication**:
   - If credentials expire, invoke AWS CLI v2 `login` (outside sandbox) to provide the browser login link to the user.
3. **Local Dev Server**:
   - To let the user inspect the frontend in their browser, run `npm run dev` with `BypassSandbox: true` and `IsDaemon: true` on port `5173`.

<!-- BEGIN AWS Agent Toolkit rules -->
# AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
<!-- END AWS Agent Toolkit rules -->
