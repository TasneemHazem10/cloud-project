$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bucket = 'blood-donation-frontend'
$function = 'auth-identity-api'
$role = 'auth-lambda-role'
$apiName = 'auth-http-api'
$legacyRestApiName = 'auth-api'
$region = 'us-east-1'
$endpoint = 'http://localhost:4566'
$profile = 'floci'

function Invoke-Floci {
  param(
    [switch]$AllowFailure,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$AwsArgs
  )
  $old = $ErrorActionPreference
  if ($AllowFailure) {
    $ErrorActionPreference = 'Continue'
  }
  $output = & aws --profile $profile --region $region --endpoint-url $endpoint @AwsArgs 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($code -ne 0 -and -not $AllowFailure) {
    throw "aws $($AwsArgs -join ' ') failed with exit $code`: $($output -join ' ')"
  }
  return $output
}

function Convert-EnvValue {
  param([string]$Value)
  $v = $Value.Trim()
  if ($v.Length -ge 2) {
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
  }
  return $v
}

function New-LinuxZip {
  param([string]$SourceDir, [string]$ZipPath)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
  }
  $stream = [System.IO.File]::Open($ZipPath, [System.IO.FileMode]::Create)
  $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
  $prefixLength = [System.IO.Path]::GetFullPath($SourceDir).TrimEnd('\', '/').Length + 1
  Get-ChildItem -Path $SourceDir -Recurse -Force -File | ForEach-Object {
    $relative = $_.FullName.Substring($prefixLength).Replace('\', '/')
    $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($_.FullName)
    $fileStream.CopyTo($entryStream)
    $fileStream.Dispose()
    $entryStream.Dispose()
  }
  $archive.Dispose()
  $stream.Dispose()
}

Write-Host 'Waiting for Floci health endpoint...'
$healthy = $false
for ($i = 0; $i -lt 45; $i++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "$endpoint/_floci/health" -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $healthy = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $healthy) {
  throw "Floci did not become healthy at $endpoint. Run: npm run aws:up"
}
Write-Host 'Floci is healthy.'

$envVars = @{}
foreach ($line in Get-Content (Join-Path $root 'backend\.env')) {
  if ($line -match '^([^#=]+)=(.*)$') {
    $envVars[$Matches[1].Trim()] = Convert-EnvValue $Matches[2]
  }
}
$envVars['CORS_ORIGINS'] = 'http://localhost:4566,http://localhost:8080'
$envVars['NODE_ENV'] = 'production'
$variables = [ordered]@{}
foreach ($key in $envVars.Keys) {
  $variables[$key] = [string]$envVars[$key]
}
$envPath = Join-Path ([System.IO.Path]::GetTempPath()) 'auth-lambda-env.json'
$envJson = @{ Variables = $variables } | ConvertTo-Json -Compress -Depth 5
[System.IO.File]::WriteAllText($envPath, $envJson, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Prepared Lambda environment from backend/.env (secrets never printed).'

$account = (@(Invoke-Floci sts get-caller-identity --query Account --output text) -join '').Trim()
$roleArn = "arn:aws:iam::$account`:role/$role"

$assumePolicy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
$logPolicy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":"*"}]}'
$assumePath = Join-Path ([System.IO.Path]::GetTempPath()) 'auth-assume-role.json'
$logPolicyPath = Join-Path ([System.IO.Path]::GetTempPath()) 'auth-logs-policy.json'
[System.IO.File]::WriteAllText($assumePath, $assumePolicy)
[System.IO.File]::WriteAllText($logPolicyPath, $logPolicy)
Invoke-Floci -AllowFailure iam create-role --role-name $role --assume-role-policy-document "file://$assumePath" | Out-Null
Invoke-Floci iam put-role-policy --role-name $role --policy-name cloudwatch-logs --policy-document "file://$logPolicyPath" | Out-Null
Invoke-Floci -AllowFailure logs create-log-group --log-group-name "/aws/lambda/$function" | Out-Null
Write-Host "Created IAM role '$role' and CloudWatch log group '/aws/lambda/$function'."

$stageDir = Join-Path ([System.IO.Path]::GetTempPath()) 'auth-api-lambda-stage'
if (Test-Path $stageDir) {
  Remove-Item $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir | Out-Null
Copy-Item (Join-Path $root 'backend\*') $stageDir -Recurse -Force
Get-ChildItem -Path $stageDir -Force -Filter '.env*' | Where-Object { $_.Name -ne '.env.example' } | Remove-Item -Recurse -Force
$zip = Join-Path $root 'backend\lambda.zip'
New-LinuxZip -SourceDir $stageDir -ZipPath $zip
Write-Host "Packaged Lambda code from backend/ into backend/lambda.zip (.env excluded)."

Invoke-Floci -AllowFailure lambda delete-function --function-name $function | Out-Null
Push-Location $root
try {
  Invoke-Floci lambda create-function `
    --function-name $function `
    --runtime nodejs24.x `
    --handler lambda.handler `
    --role $roleArn `
    --zip-file fileb://backend/lambda.zip `
    --environment "file://$envPath" `
    --timeout 10 `
    --output text | Out-Null
} finally {
  Pop-Location
}
$functionArn = (@(Invoke-Floci lambda get-function --function-name $function --query Configuration.FunctionArn --output text) -join '').Trim()
Write-Host "Deployed Lambda: $functionArn"

# Remove the earlier non-lab API deployment so only the lab-style HTTP API remains.
$legacyApis = (@(Invoke-Floci -AllowFailure apigateway get-rest-apis --query "items[?name=='$legacyRestApiName'].id" --output text) -join ' ').Trim()
foreach ($legacyId in ($legacyApis -split '\s+')) {
  if ($legacyId) {
    Invoke-Floci -AllowFailure apigateway delete-rest-api --rest-api-id $legacyId | Out-Null
  }
}
$existingApis = (@(Invoke-Floci apigatewayv2 get-apis --query "Items[?Name=='$apiName'].ApiId" --output text) -join ' ').Trim()
foreach ($existingId in ($existingApis -split '\s+')) {
  if ($existingId) {
    Invoke-Floci -AllowFailure apigatewayv2 delete-api --api-id $existingId | Out-Null
  }
}

$apiId = (@(Invoke-Floci apigatewayv2 create-api --name $apiName --protocol-type HTTP --query ApiId --output text) -join '').Trim()
$integrationUri = "arn:aws:lambda:$region`:$account`:function:$function"
$integrationId = (@(Invoke-Floci apigatewayv2 create-integration `
  --api-id $apiId `
  --integration-type AWS_PROXY `
  --payload-format-version 2.0 `
  --integration-uri $integrationUri `
  --query IntegrationId --output text) -join '').Trim()

$routes = @(
  'GET /api/auth/health',
  'GET /api/auth/ready',
  'GET /api/auth/metrics',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'GET /api/auth/me',
  'PUT /api/auth/profile',
  'GET /api/auth/eligibility',
  'GET /api/auth/donations',
  'POST /api/auth/donations',
  'GET /api/auth/donors/{donorId}/eligibility',
  'OPTIONS /api/auth/health',
  'OPTIONS /api/auth/ready',
  'OPTIONS /api/auth/metrics',
  'OPTIONS /api/auth/register',
  'OPTIONS /api/auth/login',
  'OPTIONS /api/auth/me',
  'OPTIONS /api/auth/profile',
  'OPTIONS /api/auth/eligibility',
  'OPTIONS /api/auth/donations',
  'OPTIONS /api/auth/donors/{donorId}/eligibility'
)
foreach ($route in $routes) {
  Invoke-Floci apigatewayv2 create-route --api-id $apiId --route-key $route --target "integrations/$integrationId" --query RouteKey --output text | Out-Null
}
Invoke-Floci apigatewayv2 create-stage --api-id $apiId --stage-name '$default' --auto-deploy | Out-Null
$sourceArn = "arn:aws:execute-api:$region`:$account`:$apiId/*"
Invoke-Floci -AllowFailure lambda add-permission `
  --function-name $function `
  --statement-id apigw-invoke `
  --action lambda:InvokeFunction `
  --principal apigateway.amazonaws.com `
  --source-arn $sourceArn | Out-Null

$invokeUrl = "http://${apiId}.execute-api.localhost.floci.io:4566"
Write-Host "Deployed API Gateway HTTP API: $apiId with $($routes.Count) routes and stage `$default."

$configuredRoutes = (@(Invoke-Floci apigatewayv2 get-routes --api-id $apiId --query 'Items[].RouteKey' --output text) -join ' ').Trim()
$configuredStage = (@(Invoke-Floci apigatewayv2 get-stages --api-id $apiId --query 'Items[].StageName' --output text) -join ' ').Trim()
Write-Host "Verified routes: $configuredRoutes"
Write-Host "Verified stage: $configuredStage"

$config = @"
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const isAwsEmulator = window.location.hostname.includes('floci') || window.location.port === '4566';

const API_BASE_URL = isAwsEmulator
  ? '$invokeUrl/api/auth'
  : isLocal
    ? 'http://localhost:3000/api/auth'
    : 'https://YOUR-API-PROJECT.vercel.app/api/auth';

const TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
"@
Set-Content -Path (Join-Path $root 'frontend\js\config.js') -Value $config -Encoding UTF8

Invoke-Floci -AllowFailure s3 mb "s3://$bucket" | Out-Null
Invoke-Floci s3 sync (Join-Path $root 'frontend') "s3://$bucket" `
  --exclude 'package.json' --exclude 'vercel.json' --exclude 'node_modules/*' | Out-Null
Invoke-Floci s3 cp (Join-Path $root 'frontend\css') "s3://$bucket/css" --recursive --content-type text/css | Out-Null
Invoke-Floci s3 cp (Join-Path $root 'frontend\js') "s3://$bucket/js" --recursive --content-type text/javascript | Out-Null
Write-Host "Uploaded frontend to S3 bucket '$bucket'."

$healthOk = $false
for ($i = 0; $i -lt 3 -and -not $healthOk; $i++) {
  $healthBody = & node -e "fetch(process.argv[1], { signal: AbortSignal.timeout(30000) }).then(async r => { if (!r.ok) process.exit(1); process.stdout.write(await r.text()); }).catch(() => process.exit(1))" "$invokeUrl/api/auth/health" 2>$null
  if ($LASTEXITCODE -eq 0 -and $healthBody -match '"status"\s*:\s*"ok"') {
    $healthOk = $true
  } elseif ($i -lt 2) {
    Start-Sleep -Seconds 5
  }
}
if (-not $healthOk) {
  throw "API Gateway health check failed: $invokeUrl/api/auth/health"
}
Write-Host "Health check passed: $invokeUrl/api/auth/health"

Write-Host 'Floci deployment complete.'
Write-Host "API Gateway URL: $invokeUrl"
Write-Host "S3 frontend URL: $endpoint/$bucket/index.html"
Write-Host "Lambda function: $function"
Write-Host "CloudWatch log group: /aws/lambda/$function"
