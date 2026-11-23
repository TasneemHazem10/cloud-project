$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$container = 'localstack-blood-donation'
$bucket = 'blood-donation-frontend'
$function = 'auth-identity-api'
$role = 'auth-lambda-role'
$apiName = 'auth-api'
$stage = 'prod'
$region = 'us-east-1'

function Invoke-AwsLocal {
  param(
    [switch]$AllowFailure,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$AwsArgs
  )
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & docker exec $container awslocal @AwsArgs 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($code -ne 0 -and -not $AllowFailure) {
    throw "awslocal $($AwsArgs -join ' ') failed with exit $code`: $($output -join ' ')"
  }
  return $output
}

function Invoke-DockerCp {
  param([string]$Source, [string]$Destination)
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & docker cp $Source $Destination 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($code -ne 0) {
    throw "docker cp failed with exit $code`: $($output -join ' ')"
  }
}

function Write-ContainerFile {
  param([string]$Path, [string]$Content)
  $temp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($temp, $Content)
  Invoke-DockerCp $temp "${container}:$Path"
  Remove-Item $temp -Force
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

Write-Host 'Waiting for LocalStack health endpoint...'
$healthy = $false
for ($i = 0; $i -lt 45; $i++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing 'http://localhost:4566/_localstack/health' -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $healthy = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $healthy) {
  throw 'LocalStack did not become healthy at http://localhost:4566.'
}
Write-Host 'LocalStack is healthy.'

$envVars = @{}
foreach ($line in Get-Content (Join-Path $root 'backend\.env')) {
  if ($line -match '^([^#=]+)=(.*)$') {
    $envVars[$Matches[1].Trim()] = Convert-EnvValue $Matches[2]
  }
}
$rootEnv = Join-Path $root '.env.local'
if (Test-Path $rootEnv) {
  foreach ($line in Get-Content $rootEnv) {
    if ($line -match '^([^#=]+)=(.*)$') {
      $envVars[$Matches[1].Trim()] = Convert-EnvValue $Matches[2]
    }
  }
}
$envVars['CORS_ORIGINS'] = 'http://localhost:4566,http://localhost:8080'
$envVars['NODE_ENV'] = 'production'
$variables = [ordered]@{}
foreach ($key in $envVars.Keys) {
  $variables[$key] = [string]$envVars[$key]
}
$environmentJson = @{ Variables = $variables } | ConvertTo-Json -Compress -Depth 5
Write-ContainerFile '/tmp/auth-env.json' $environmentJson
Write-Host 'Prepared Lambda environment from backend/.env and .env.local (secrets never printed).'

$account = (Invoke-AwsLocal sts get-caller-identity --query Account --output text).Trim()
$roleArn = "arn:aws:iam::$account`:role/$role"

$assumePolicy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
$logPolicy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":"*"}]}'
Write-ContainerFile '/tmp/auth-assume.json' $assumePolicy
Write-ContainerFile '/tmp/auth-logs-policy.json' $logPolicy
Invoke-AwsLocal -AllowFailure iam create-role --role-name $role --assume-role-policy-document file:///tmp/auth-assume.json | Out-Null
Invoke-AwsLocal iam put-role-policy --role-name $role --policy-name cloudwatch-logs --policy-document file:///tmp/auth-logs-policy.json | Out-Null
Invoke-AwsLocal -AllowFailure logs create-log-group --log-group-name "/aws/lambda/$function" | Out-Null
Write-Host "Created IAM role '$role', CloudWatch log group '/aws/lambda/$function'."

$stageDir = Join-Path ([System.IO.Path]::GetTempPath()) 'auth-api-lambda-stage'
if (Test-Path $stageDir) {
  Remove-Item $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir | Out-Null
Copy-Item (Join-Path $root 'backend\*') $stageDir -Recurse -Force
Remove-Item (Join-Path $stageDir '.env') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $stageDir '.env.local') -Force -ErrorAction SilentlyContinue
$zip = Join-Path $root 'auth-api.zip'
if (Test-Path $zip) {
  Remove-Item $zip -Force
}
New-LinuxZip -SourceDir $stageDir -ZipPath $zip
Invoke-DockerCp $zip "${container}:/tmp/auth-api.zip"

Invoke-AwsLocal -AllowFailure lambda delete-function --function-name $function | Out-Null
Invoke-AwsLocal lambda create-function `
  --function-name $function `
  --runtime nodejs20.x `
  --role $roleArn `
  --handler handler.handler `
  --zip-file fileb:///tmp/auth-api.zip `
  --environment file:///tmp/auth-env.json `
  --timeout 30 `
  --memory-size 512 `
  --output text | Out-Null
$functionArn = (Invoke-AwsLocal lambda get-function --function-name $function --query Configuration.FunctionArn --output text).Trim()
Write-Host "Deployed Lambda: $functionArn"

$existingApisRaw = @(Invoke-AwsLocal apigateway get-rest-apis --query "items[?name=='$apiName'].id" --output text)
$existingApis = ($existingApisRaw -join ' ').Trim()
foreach ($existingId in ($existingApis -split '\s+')) {
  if ($existingId) {
    Invoke-AwsLocal -AllowFailure apigateway delete-rest-api --rest-api-id $existingId | Out-Null
  }
}
$apiId = (Invoke-AwsLocal apigateway create-rest-api --name $apiName --query id --output text).Trim()
$resourcesRaw = Invoke-AwsLocal apigateway get-resources --rest-api-id $apiId
$resources = ($resourcesRaw -join "`n") | ConvertFrom-Json
$rootResourceId = ($resources.items | Where-Object { $_.path -eq '/' } | Select-Object -First 1).id
$proxyRaw = Invoke-AwsLocal apigateway create-resource --rest-api-id $apiId --parent-id $rootResourceId --path-part '{proxy+}'
$proxyResource = ($proxyRaw -join "`n") | ConvertFrom-Json
$proxyId = $proxyResource.id
Invoke-AwsLocal apigateway put-method --rest-api-id $apiId --resource-id $proxyId --http-method ANY --authorization-type NONE | Out-Null
$integrationUri = "arn:aws:apigateway:$region`:lambda:path/2015-03-31/functions/$functionArn/invocations"
Invoke-AwsLocal apigateway put-integration `
  --rest-api-id $apiId `
  --resource-id $proxyId `
  --http-method ANY `
  --type AWS_PROXY `
  --integration-http-method POST `
  --uri $integrationUri | Out-Null
$sourceArn = "arn:aws:execute-api:$region`:$account`:$apiId/*/*"
Invoke-AwsLocal -AllowFailure lambda add-permission `
  --function-name $function `
  --statement-id apigw-invoke `
  --action lambda:InvokeFunction `
  --principal apigateway.amazonaws.com `
  --source-arn $sourceArn | Out-Null
Invoke-AwsLocal apigateway create-deployment --rest-api-id $apiId --stage-name $stage | Out-Null
$invokeUrl = "http://localhost:4566/restapis/$apiId/$stage/_user_request_"
Write-Host "Deployed API Gateway REST API: $apiId (stage $stage)"

$config = @"
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const isAwsEmulator = window.location.hostname.includes('localstack') || window.location.port === '4566';

const API_BASE_URL = isAwsEmulator
  ? '$invokeUrl/api/auth'
  : isLocal
    ? 'http://localhost:3000/api/auth'
    : 'https://YOUR-API-PROJECT.vercel.app/api/auth';

const TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
"@
Set-Content -Path (Join-Path $root 'frontend\js\config.js') -Value $config -Encoding UTF8

Invoke-AwsLocal -AllowFailure s3 mb "s3://$bucket" | Out-Null
Invoke-AwsLocal -AllowFailure s3 rm "s3://$bucket" --recursive | Out-Null
Invoke-DockerCp (Join-Path $root 'frontend\.') "${container}:/tmp/frontend/"
Invoke-AwsLocal s3 cp /tmp/frontend/ "s3://$bucket/" --recursive | Out-Null
Write-Host "Uploaded frontend to S3 bucket '$bucket'."

$health = Invoke-WebRequest -UseBasicParsing "$invokeUrl/api/auth/health" -TimeoutSec 30
if ($health.StatusCode -ne 200) {
  throw "API Gateway health check failed with status $($health.StatusCode)."
}

Write-Host 'LocalStack deployment complete.'
Write-Host "API Gateway URL: $invokeUrl"
Write-Host "S3 frontend URL: http://localhost:4566/$bucket/index.html"
Write-Host "Lambda function: $function"
Write-Host "CloudWatch log group: /aws/lambda/$function"
