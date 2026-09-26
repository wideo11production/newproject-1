$ErrorActionPreference = "Stop"
$ServicesDir = Join-Path $PSScriptRoot "services"
$K8sDir = Join-Path $PSScriptRoot "k8s"
$JetStreamConfigFile = Join-Path $PSScriptRoot "infrastructure\nats\jetstream-config.md"
$Tag = (Get-Date -Format "yyyyMMdd-HHmmss")  # Unique tag for production images
$ProjectId = $env:GOOGLE_CLOUD_PROJECT       # Expect this to be set
$ClusterName = $env:GKE_CLUSTER_NAME         # Expect this to be set
$Region = $env:GKE_COMPUTE_REGION            # Expect this to be set
$Namespace = "wideo11-production"            # Production namespace

# Validate required environment variables
if (-not $ProjectId) {
    Write-Error "Environment variable GOOGLE_CLOUD_PROJECT is not set."
    exit 1
}
if (-not $ClusterName) {
    Write-Error "Environment variable GKE_CLUSTER_NAME is not set."
    exit 1
}
if (-not $Region) {
    Write-Error "Environment variable GKE_COMPUTE_REGION is not set."
    exit 1
}

function Write-Hinglish {
    param([string]$Message)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')]$Message"
}

function Set-GkeContext {
    Write-Hinglish "Setting up GKE context for project '$ProjectId', cluster '$ClusterName' in region '$Region'..."
    try {
        # Get credentials for the GKE cluster
        gcloud container clusters get-credentials $ClusterName --region $Region --project $ProjectId | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "gcloud failed to fetch cluster credentials" }
        # Set the namespace for subsequent kubectl commands
        kubectl config set-context --current --namespace $Namespace | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "kubectl failed to set namespace context" }
        Write-Hinglish "GKE context set successfully. Namespace: '$Namespace'"
    }
    catch {
        Write-Error "Failed to set GKE context: $_"
        exit 1
    }
}

function BuildAndPushGoServiceImage {
    param(
        [string]$ServiceName,
        [string]$ServicePath
    )

    Push-Location $ServicePath

    try {
        $imageName = "$Region-docker.pkg.dev/$ProjectId/wideo11/${ServiceName}:$Tag"

        Write-Hinglish "Building image for $ServiceName"

        docker build --pull --no-cache -t $imageName .

        if ($LASTEXITCODE -ne 0) {
            throw "Docker build failed for $ServiceName"
        }

        docker push $imageName

        if ($LASTEXITCODE -ne 0) {
            throw "Docker push failed for $ServiceName"
        }

        Write-Hinglish "Pushed: $imageName"

        return $imageName
    }
    finally {
        Pop-Location
    }
}

function Invoke-K8sManifests {
    param([string]$ManifestPath)
    Write-Hinglish "Applying Kubernetes manifests from: $ManifestPath"
    kubectl apply -f $ManifestPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "kubectl apply failed for $ManifestPath" }
    Write-Hinglish "Manifests applied successfully."
}

function Set-ServiceImage {
    param([string]$ServiceName, [string]$ImageName)
    Write-Hinglish "Setting image for deployment '$ServiceName' to '$ImageName'"
    kubectl set image deployment/$ServiceName $ServiceName=$ImageName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to update image for deployment $ServiceName" }
    Write-Hinglish "Image updated for deployment '$ServiceName'."
}

function Convert-JetStreamConfig {
    param([string]$ConfigFilePath)
    Write-Hinglish "Parsing NATS JetStream configuration from: $ConfigFilePath"
    
    # Read the configuration file
    $content = Get-Content -Path $ConfigFilePath -Raw
    
    $streams = @()
    $consumers = @()
    
    # Extract stream definitions
    $streamPattern = 'STREAM_(\w+)\s*=\s*\{([^}]+)\}'
    $streamMatches = [regex]::Matches($content, $streamPattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    foreach ($match in $streamMatches) {$streamName = "W11_$($match.Groups[1].Value)"  # Prefix with W11_
        $streamBody = $match.Groups[2].Value
        
        $stream = @{ name = $streamName }
        $lines = $streamBody -split "
"
        foreach ($line in $lines) {
            $line = $line.Trim()
            if ($line -match '^(\w+)\s*:\s*(.+)$') {
                $key = $Matches[1].Trim()
                $value = $Matches[2].Trim()
                
                # Clean up value
                $value = $value.TrimEnd(',')
                if ($value -match '^"(.*)"$') {
                    $value = $Matches[1]
                }
                elseif ($value -match '^\[(.*)\]$') {
                    $arrayContent = $Matches[1]
                    $items = $arrayContent -split ',' | ForEach-Object { $_.Trim().Trim('"').Trim("'") } | Where-Object { $_ }
                    $value = $items
                }
                elseif ($value -match '^\d+_?\d*$') {
                    $value = [int]($value -replace '_', '')
                }
                $stream[$key] = $value
            }
        }
        $streams += $stream
    }
    
    # Extract consumer definitions
    $consumerPattern = 'CONSUMER_(\w+)\s*=\s*\{([^}]+)\}'
    $consumerMatches = [regex]::Matches($content, $consumerPattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    foreach ($match in $consumerMatches) {
        $consumerName = $match.Groups[1].Value
        $consumerBody = $match.Groups[2].Value
        
        $consumer = @{ name = $consumerName }
        $lines = $consumerBody -split "
"
            foreach ($line in $lines) {
            $line = $line.Trim()
            if ($line -match '^(\w+)\s*:\s*(.+)$') {
                $key = $Matches[1].Trim()
                $value = $Matches[2].Trim()
                
                # Clean up value
                $value = $value.TrimEnd(',')
                if ($value -match '^"(.*)"$') {
                    $value =$Matches[1]
                }
                elseif ($value -match '^\[(.*)\]$') {
                    $arrayContent = $Matches[1]
                    $items =$arrayContent -split ',' | ForEach-Object { $_.Trim().Trim('"').Trim("'") } | Where-Object { $_ }
                    $value = $items
                }
                elseif ($value -match '^\d+_?\d*$') {
                    $value = [int]($value -replace '_', '')
                }
                $consumer[$key] = $value
            }
        }
        $consumers += $consumer
    }
    
    Write-Hinglish "Parsed $($streams.Count) stream(s) and $($consumers.Count) consumer(s) from configuration."
    return @{ streams = $streams; consumers =$consumers }
}

function Set-JetStreamConfig {
    param([hashtable]$Config)
    Write-Hinglish "Applying NATS JetStream configuration..."
    
    # Apply streams
    foreach ($stream in $Config.streams) {
        $streamName = $stream.name
        $subjects = if ($stream.subjects -is [array]) { $stream.subjects -join "," } else { $stream.subjects }
        $retention = $stream.retention
        $maxMsgs = $stream.max_msgs
        $maxBytes = $stream.max_bytes
        $maxAge = $stream.max_age
        $discard = $stream.discard
        $storage = $stream.storage
        $replicas = $stream.num_replicas
        $cliArgs = @("stream", "add", $streamName, "--subjects", $subjects)
        if ($retention) { $cliArgs += @("--retention", $retention) }
        if ($maxMsgs) { $cliArgs += @("--max-msgs", $maxMsgs) }
        if ($maxBytes) { $cliArgs += @("--max-bytes", $maxBytes) }
        if ($maxAge) { $cliArgs += @("--max-age", $maxAge) }
        if ($discard) { $cliArgs += @("--discard", $discard) }
        if ($storage) { $cliArgs += @("--storage", $storage) }
        if ($replicas) { $cliArgs += @("--num-replicas", $replicas) }
        if ($stream.'allow_rollup_hard') {$cliArgs += "--allow-rollup-hard" }
        if ($stream.description) { $cliArgs += @("--description", $stream.description) }
        
        Write-Hinglish "Executing: nats $($cliArgs -join ' ')"
        & nats @cliArgs | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "NATS failed to configure stream $streamName" }
        Write-Hinglish "Stream '$streamName' created/updated."
    }
    
    # Apply consumers
    foreach ($consumer in $Config.consumers) {
        $consumerName =$consumer.name
        $streamName = $consumer.stream_name
        $durable = $consumer.durable_name
        $filter = $consumer.filter_subject
        $ackPolicy = $consumer.ack_policy
        $ackWait = $consumer.ack_wait
        $maxDeliver = $consumer.max_deliver
        $backOff = if ($consumer.back_off -is [array]) { $consumer.back_off -join ',' } else { $consumer.back_off }
        $maxAckPending = $consumer.max_ack_pending
        $replayPolicy = $consumer.replay_policy
        $startSeq = $consumer.start_seq
        $cliArgs = @("consumer", "add", $streamName, $consumerName)
        if ($durable) { $cliArgs += @("--durable-name", $durable) }
        if ($filter) { $cliArgs += @("--filter-subject", $filter) }
        if ($ackPolicy) { $cliArgs += @("--ack-policy", $ackPolicy) }
        if ($ackWait) { $cliArgs += @("--ack-wait", $ackWait) }
        if ($maxDeliver) { $cliArgs += @("--max-deliver", $maxDeliver) }
        if ($backOff) { $cliArgs += @("--back-off", $backOff) }
        if ($maxAckPending) { $cliArgs += @("--max-ack-pending", $maxAckPending) }
        if ($replayPolicy) { $cliArgs += @("--replay-policy", $replayPolicy) }
        if ($startSeq) { $cliArgs += @("--start-sequence", $startSeq) }
        if ($consumer.description) { $cliArgs += @("--description", $consumer.description) }
        
        Write-Hinglish "Executing: nats $($cliArgs -join ' ')"
        & nats @cliArgs | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "NATS failed to configure consumer $consumerName" }
        Write-Hinglish "Consumer '$consumerName' created/updated on stream '$streamName'."
    }
    
    Write-Hinglish "NATS JetStream configuration applied successfully."
}

function Invoke-DatabaseMigrations {
    param([string]$Namespace = "wideo11-production")
    Write-Hinglish "Applying database schema migrations via temporary Kubernetes Jobs..."
    
    $tempDir = Join-Path $env:TEMP "wideo11-migrations-$(Get-Random)"
    try {
        New-Item -ItemType Directory -Path $tempDir | Out-Null
        
        Get-ChildItem -Path $ServicesDir -Directory | ForEach-Object {
            $serviceName = $_.Name
            $serviceMigrationDir = Join-Path $_.FullName "migrations"
            
            if (Test-Path $serviceMigrationDir) {
                Get-ChildItem -Path $serviceMigrationDir -Filter "*.sql" | Sort-Object Name | ForEach-Object {
                    $jobName = "$($serviceName)-$($_.BaseName)"
                    $sqlContent = Get-Content -Path $_.FullName -Raw
                    $indentedSql = ($sqlContent -split "`r?\n" | ForEach-Object { "    $_" }) -join "`n"
                    
                    $jobManifest = @"
apiVersion: batch/v1
kind: Job
metadata:
  name: $jobName
  namespace: $Namespace
spec:
  template:
    spec:
      containers:
      - name: migrator
        image: postgres:15
        command: ["sh", "-c"]
        args: ["until pg_isready -h `$DB_HOST -U `$DB_USER; do sleep 1; done; PGPASSWORD=`$DB_PASSWORD psql -h `$DB_HOST -U `$DB_USER -d `$DB_NAME -f /migrations/$($_.Name)"]
        env:
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: host
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: username
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        - name: DB_NAME
          value: $serviceName
        volumeMounts:
        - name: migration-volume
          mountPath: /migrations
      volumes:
      - name: migration-volume
        configMap:
          name: $jobName-configmap
      restartPolicy: Never
  backoffLimit: 4
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: $jobName-configmap
  namespace: $Namespace
data:
  $($_.Name): |
$indentedSql

"@
                    $jobManifestPath = Join-Path $tempDir "$jobName.yaml"
                    $jobManifest | Out-File -FilePath $jobManifestPath -Encoding utf8
                    Write-Hinglish "Generated migration job manifest: $jobName"
                }
            }
        }

        Write-Hinglish "Applying migration job manifests..."
        kubectl apply -f $tempDir | Out-Null
        
        Write-Hinglish "Waiting for migration jobs to complete..."
        $maxAttempts = 60; $attempt = 0
        
        while ($attempt -lt $maxAttempts) {
            $incompleteJobsRaw = kubectl get jobs -n $Namespace -o jsonpath='{.items[?(@.status.succeeded<@.spec.completions)].metadata.name}' 2>$null
            $incompleteJobs = ($incompleteJobsRaw -split '\s+') | Where-Object { $_ }
            
            if (-not $incompleteJobs) {
                Write-Hinglish "All migration jobs have completed."
                break
            }
            Write-Hinglish "Waiting for $($incompleteJobs.Count) migration job(s) to complete... (Attempt$($attempt + 1)/$maxAttempts)"
            Start-Sleep -Seconds 10
            $attempt++
        }
        
        if ($attempt -eq $maxAttempts) {
            Write-Warning "Timeout waiting for migration jobs to complete. Some migrations may still be running."
        }
        else {
            kubectl delete jobs --all -n $Namespace | Out-Null
            Write-Hinglish "Cleaned up completed migration jobs."
        }
    }
    finally {
        if (Test-Path $tempDir) {
            Remove-Item -Path $tempDir -Recurse -Force
        }
    }
}

function Confirm-BusinessRules {
    param([string]$Namespace = "wideo11-production")
    Write-Hinglish "Validating core business rules (2000 INR maintenance buffer & 5% sister allocation)..."
    
    try {
        $configMapJson = kubectl get configmap config-service-config -n $Namespace -o json 2>$null
        if ($configMapJson) {
            $configMap = $configMapJson | ConvertFrom-Json
            $data = $configMap.data
            
            $maintenanceBuffer = $data.MAINTENANCE_BUFFER_INR
            $sisterAllocation = $data.SISTER_ALLOCATION_PERCENT
            
            if ($maintenanceBuffer -eq "2000") {
                Write-Hinglish "✓ Maintenance buffer validation passed: $maintenanceBuffer INR"
            }
            else {
                Write-Warning "✗ Maintenance buffer validation failed: expected '2000', got '$maintenanceBuffer'"
            }
            
            if ($sisterAllocation -eq "5") {
                Write-Hinglish "✓ Sister allocation validation passed: $sisterAllocation%"
            }
            else {
                Write-Warning "✗ Sister allocation validation failed: expected '5', got '$sisterAllocation'"
            }
        }
        else {
            Write-Warning "ConfigMap 'config-service-config' not found in namespace '$Namespace'."
        }
    }
    catch {
        Write-Warning "Could not validate business rules: $_"
    }
}

try {
    Write-Hinglish "=== Starting Google Cloud GKE Live Production Engine ==="
    
    # 1. Set up GKE context
    Set-GkeContext
    
    # 2. Build and push all Go service images to GCR
    Write-Hinglish "Building and pushing Go service images to GCR..."
    $pushedImages = @{}
    Get-ChildItem -Path $ServicesDir -Directory | ForEach-Object {
        $serviceName = $_.Name
        $servicePath = $_.FullName
        $imageName = BuildAndPushGoServiceImage -ServiceName $serviceName -ServicePath $servicePath; $pushedImages[$serviceName] = $imageName
    }
    
    # 3. Apply Kubernetes manifests
    if (Test-Path $K8sDir) {
        Invoke-K8sManifests -ManifestPath $K8sDir
    }
    else {
        Write-Warning "Kubernetes manifests directory not found at: $K8sDir. Skipping manifest application."
    }
    
    # 4. Apply database schema migrations via Jobs
    Invoke-DatabaseMigrations -Namespace $Namespace
    
    # 5. Update deployments to use newly pushed images
    Write-Hinglish "Updating deployments to use newly pushed images..."
    foreach ($serviceName in $pushedImages.Keys) {
        Set-ServiceImage -ServiceName $serviceName -ImageName $pushedImages[$serviceName]
    }
    
    # 6. Apply NATS JetStream configuration from jetstream-config.md
    if (Test-Path $JetStreamConfigFile) {
        $jetStreamConfig = Convert-JetStreamConfig -ConfigFilePath $JetStreamConfigFile
        Set-JetStreamConfig -Config $jetStreamConfig
    }
    else {
        Write-Warning "JetStream configuration file not found at: $JetStreamConfigFile. Skipping JetStream setup."
    }
    
    # 7. Validate core business rules
    Confirm-BusinessRules -Namespace $Namespace
    
    Write-Hinglish "=== Google Cloud GKE Live Production Engine completed successfully ==="
    Write-Hinglish "Your application is now deployed to GKE in the '$Namespace' namespace."
    Write-Hinglish "You can access your services via their respective LoadBalancer services or Ingress."
}
catch {
    Write-Error "Google Cloud GKE Live Production Engine failed: $_"
    exit 1
}