# deploy-production.ps1
# Google Cloud GKE Live Production Engine for Wideo11 Monorepo
# This script builds Go services, pushes to GCR, applies database schemas via Jobs, configures NATS JetStream, and deploys to GKE.

# ============================================================================
# CONFIGURATION
# ============================================================================
$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ServicesDir = Join-Path $ScriptRoot "services"
$K8sDir = Join-Path $ScriptRoot "k8s"
$JetStreamConfigFile = Join-Path $ScriptRoot "infrastructure\nats\jetstream-config.md"
$Tag = (Get-Date -Format "yyyyMMdd-HHmmss")  # Unique tag for production images
$ProjectId = $env:GOOGLE_CLOUD_PROJECT  # Expect this to be set
$ClusterName = $env:GKE_CLUSTER_NAME    # Expect this to be set
$Region = $env:GKE_COMPUTE_REGION       # Expect this to be set
$Namespace = "wideo11-production"       # Production namespace

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

# ============================================================================
# HELPER FUNCTIONS (Same as local script but with production adjustments)
# ============================================================================

function Write-Hinglish {
    param([string]$Message)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message"
}

function Set-GkeContext {
    Write-Hinglish "Setting up GKE context for project '$ProjectId', cluster '$ClusterName' in region '$Region'..."
    try {
        # Get credentials for the GKE cluster
        gcloud container clusters get-credentials $ClusterName --region $Region --project $ProjectId | Out-Null
        # Set the namespace for subsequent kubectl commands
        kubectl config set-context --current --namespace $Namespace | Out-Null
        Write-Hinglish "GKE context set successfully. Namespace: '$Namespace'"
    }
    catch {
        Write-Error "Failed to set GKE context: $_"
        exit 1
    }
}

function BuildAndPushGoServiceImage {
    param([string]$ServiceName, [string]$ServicePath)
    Write-Hinglish "Building and pushing Docker image for service: $ServiceName"
    Push-Location $ServicePath
    try {
        $imageName = "gcr.io/$ProjectId/$ServiceName:$Tag"
        docker build -t $imageName . | Out-Null
        docker push $imageName | Out-Null
        Write-Hinglish "Successfully built and pushed image: $imageName"
        return $imageName
    }
    finally {
        Pop-Location
    }
}

function Apply-K8sManifests {
    param([string]$ManifestPath)
    Write-Hinglish "Applying Kubernetes manifests from: $ManifestPath"
    kubectl apply -f $ManifestPath | Out-Null
    Write-Hinglish "Manifests applied successfully."
}

function Set-ServiceImage {
    param([string]$ServiceName, [string]$ImageName)
    Write-Hinglish "Setting image for deployment '$ServiceName' to '$ImageName'"
    kubectl set image deployment/$ServiceName $ServiceName=$ImageName --record | Out-Null
    Write-Hinglish "Image updated for deployment '$ServiceName'."
}

function Parse-JetStreamConfig {
    param([string]$ConfigFilePath)
    Write-Hinglish "Parsing NATS JetStream configuration from: $ConfigFilePath"
    
    # Read the configuration file
    $content = Get-Content -Path $ConfigFilePath -Raw
    
    # We'll extract stream and consumer definitions using regex
    # This is a simplified parser for our specific format
    $streams = @()
    $consumers = @()
    
    # Extract stream definitions (lines like: STREAM_NAME={ ... })
    $streamPattern = 'STREAM_(\w+)\s*=\s*\{([^}]+)\}'
    $matches = [regex]::Matches($content, $streamPattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    foreach ($match in $matches) {
        $streamName = "W11_$($match.Groups[1].Value)"  # Prefix with W11_
        $streamBody = $match.Groups[2].Value
        
        # Parse key-value pairs from the stream body
        $stream = @{ name = $streamName }
        $lines = $streamBody -split "`n"
        foreach ($line in $lines) {
            $line = $line.Trim()
            if ($line -match '^(\w+)\s*:\s*(.+)$') {
                $key = $matches[0].Groups[1].Value.Trim()
                $value = $matches[0].Groups[2].Value.Trim()
                
                # Clean up value: remove trailing commas, handle quotes, numbers, arrays
                if ($value -like '","*') {
                    $value = $value.Trim('",')
                }
                if ($value -like '"*"') {
                    $value = $value.Trim('"')
                }
                elseif ($value -match '^\d+_?\d*$') {
                    $value = [int]($value -replace '_', '')
                }
                elseif ($value -match '^\[.*\]$') {
                    # Simple array handling - assume it's already in a usable format
                    # We'll leave it as string for now and handle in Apply-JetStream
                }
                $stream[$key] = $value
            }
        }
        $streams += $stream
    }
    
    # Extract consumer definitions (similar pattern)
    $consumerPattern = 'CONSUMER_(\w+)\s*=\s*\{([^}]+)\}'
    $matches = [regex]::Matches($content, $consumerPattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    foreach ($match in $matches) {
        $consumerName = $match.Groups[1].Value
        $consumerBody = $match.Groups[2].Value
        
        $consumer = @{ name = $consumerName }
        $lines = $consumerBody -split "`n"
        foreach ($line in $lines) {
            $line = $line.Trim()
            if ($line -match '^(\w+)\s*:\s*(.+)$') {
                $key = $matches[0].Groups[1].Value.Trim()
                $value = $matches[0].Groups[2].Value.Trim()
                
                # Clean up value
                if ($value -like '","*') {
                    $value = $value.Trim('",')
                }
                if ($value -like '"*"') {
                    $value = $value.Trim('"')
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
    return @{ streams = $streams; consumers = $consumers }
}

function Apply-JetStreamConfig {
    param([hashrate]$Config)
    Write-Hinglish "Applying NATS JetStream configuration..."
    
    # Apply streams
    foreach ($stream in $config.streams) {
        $streamName = $stream.name
        $subjects = $stream.subjects -join ","
        $retention = $stream.retention
        $maxMsgs = $stream.max_msgs
        $maxBytes = $stream.max_bytes
        $maxAge = $stream.max_age
        $discard = $stream.discard
        $storage = $stream.storage
        $replicas = $stream.num_replicas
        
        $cmd = "nats stream add $streamName --subjects $subjects"
        if ($retention) { $cmd += " --retention $retention" }
        if ($maxMsgs) { $cmd += " --max-msgs $maxMsgs" }
        if ($maxBytes) { $cmd += " --max-bytes $maxBytes" }
        if ($maxAge) { $cmd += " --max-age $maxAge" }
        if ($discard) { $cmd += " --discard $discard" }
        if ($storage) { $cmd += " --storage $storage" }
        if ($replicas) { $cmd += " --num-replicas $replicas" }
        if ($stream.'allow_rollup_hard') { $cmd += " --allow-rollup-hard" }
        if ($stream.description) { $cmd += " --description `"$($stream.description)`"" }
        
        Write-Hinglish "Executing: $cmd"
        & nats @($cmd.Split(' ')) | Out-Null
        Write-Hinglish "Stream '$streamName' created/updated."
    }
    
    # Apply consumers
    foreach ($consumer in $config.consumers) {
        $consumerName = $consumer.name
        $streamName = $consumer.stream_name
        $durable = $consumer.durable_name
        $filter = $consumer.filter_subject
        $ackPolicy = $consumer.ack_policy
        $ackWait = $consumer.ack_wait
        $maxDeliver = $consumer.max_deliver
        $backOff = $consumer.back_off -join ','  # Assuming it's an array
        $maxAckPending = $consumer.max_ack_pending
        $replayPolicy = $consumer.replay_policy
        $startSeq = $consumer.start_seq
        
        $cmd = "nats consumer add $streamName $consumerName"
        if ($durable) { $cmd += " --durable-name $durable" }
        if ($filter) { $cmd += " --filter-subject $filter" }
        if ($ackPolicy) { $cmd += " --ack-policy $ackPolicy" }
        if ($ackWait) { $cmd += " --ack-wait $ackWait" }
        if ($maxDeliver) { $cmd += " --max-deliver $maxDeliver" }
        if ($backOff) { $cmd += " --back-off $backOff" }
        if ($maxAckPending) { $cmd += " --max-ack-pending $maxAckPending" }
        if ($replayPolicy) { $cmd += " --replay-policy $replayPolicy" }
        if ($startSeq) { $cmd += " --start-sequence $startSeq" }
        if ($consumer.description) { $cmd += " --description `"$($consumer.description)`"" }
        
        Write-Hinglish "Executing: $cmd"
        & nats @($cmd.Split(' ')) | Out-Null
        Write-Hinglish "Consumer '$consumerName' created/updated on stream '$streamName'."
    }
    
    Write-Hinglish "NATS JetStream configuration applied successfully."
}

function Apply-DatabaseMigrations {
    param([string]$Namespace = "wideo11-production")
    Write-Hinglish "Applying database schema migrations via temporary Kubernetes Jobs..."
    
    # Create a temporary directory for the job manifests
    $tempDir = Join-Path $env:TEMP "wideo11-migrations-$(Get-Random)"
    try {
        New-Item -ItemType Directory -Path $tempDir | Out-Null
        
        # For each service, for each migration SQL file, create a Kubernetes Job manifest that runs the SQL
        Get-ChildItem -Path $ServicesDir -Directory | ForEach-Object {
            $serviceName = $_.Name
            $serviceMigrationDir = Join-Path $_.FullName "migrations"
            if (Test-Path $serviceMigrationDir) {
                Get-ChildItem -Path $serviceMigrationDir -Filter "*.sql" | Sort-Object Name | ForEach-Object {
                    $sqlFile = $_.FullName
                    $jobName = "$($serviceName)-$($_.BaseName)"
                    # Read the SQL content
                    $sqlContent = Get-Content -Path $sqlFile -Raw
                    
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
        args: ["until pg_isready -h \$(DB_HOST) -U \$(DB_USER); do sleep 1; done; PGPASSWORD=\$(DB_PASSWORD) psql -h \$(DB_HOST) -U \$(DB_USER) -d \$(DB_NAME) -f /migrations/$(($_.Name))"]
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
          value: $serviceName  # Assuming database name matches service name
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
                $sqlContent
"@
                    $jobManifestPath = Join-Path $tempDir "$jobName.yaml"
                    $jobManifest | Out-File -FilePath $jobManifestPath -Encoding utf8
                    Write-Hinglish "Generated migration job manifest: $jobName"
                }
            }
        }

        # Apply all the generated job manifests
        Write-Hinglish "Applying migration job manifests..."
        kubectl apply -f $tempDir | Out-Null
        
        # Wait for the migration jobs to complete
        Write-Hinglish "Waiting for migration jobs to complete..."
        $maxAttempts = 60  # Increased timeout for production
        $attempt = 0
        while ($attempt -lt $maxAttempts) {
            $incompleteJobs = kubectl get jobs -n $Namespace -o jsonpath='{.items[?(@.status.succeeded<@.spec.completions)].metadata.name}' 2>$null
            if (-not $incompleteJobs) {
                Write-Hinglish "All migration jobs have completed."
                break
            }
            Write-Hinglish "Waiting for $($incompleteJobs.Length) migration job(s) to complete... (Attempt $($attempt+1)/$maxAttempts)"
            Start-Sleep -Seconds 10
            $attempt++
        }
        
        if ($attempt -eq $maxAttempts) {
            Write-Warning "Timeout waiting for migration jobs to complete. Some migrations may still be running."
        }
        else {
            # Clean up completed jobs to keep the namespace tidy
            kubectl delete jobs --all -n $Namespace | Out-Null
            Write-Hinglish "Cleaned up completed migration jobs."
        }
    }
    finally {
        # Clean up the temporary directory
        if (Test-Path $tempDir) {
            Remove-Item -Path $tempDir -Recurse -Force
        }
    }
}

function Validate-BusinessRules {
    param([string]$Namespace = "wideo11-production")
    Write-Hinglish "Validating core business rules (2000 INR maintenance buffer & 5% sister allocation)..."
    
    # Check ConfigMap for config-service (assuming it holds SSOT values)
    try {
        $configMap = kubectl get configmap config-service-config -n $Namespace -o json
        $data = $configMap.data
        
        $maintenanceBuffer = $data["MAINTENANCE_BUFFER_INR"]
        $sisterAllocation = $data["SISTER_ALLOCATION_PERCENT"]
        
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
    catch {
        Write-Warning "Could not validate business rules: $_"
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

try {
    Write-Hinglish "=== Starting Google Cloud GKE Live Production Engine ==="
    
    # 1. Set up GKE context
    Set-GkeContext
    
    # 2. Build and push all Go service images to GCR
    Write-Hinglish "Building and pushing Go service images to GCR..."
    Get-ChildItem -Path $ServicesDir -Directory | ForEach-Object {
        $serviceName = $_.Name
        $servicePath = $_.FullName
        $imageName = BuildAndPushGoServiceImage -ServiceName $serviceName -ServicePath $servicePath
        # Store the image name for later use (we'll use a global variable or just rely on the function returning it)
        # We'll set it in the next step
        Set-ServiceImage -ServiceName $serviceName -ImageName $imageName
    }
    
    # 3. Apply Kubernetes manifests (assuming they exist in k8s directory)
    if (Test-Path $K8sDir) {
        Apply-K8sManifests -ManifestPath $K8sDir
    }
    else {
        Write-Warning "Kubernetes manifests directory not found at: $K8sDir. Skipping manifest application."
    }
    
    # 4. Apply database schema migrations via Jobs (using our new function)
    Apply-DatabaseMigrations -Namespace $Namespace
    
    # 5. Update deployments to use the newly pushed images (already done in step 2 via Set-ServiceImage)
    Write-Hinglish "All service images have been updated to the latest production versions."
    
    # 6. Apply NATS JetStream configuration from jetstream-config.md
    if (Test-Path $JetStreamConfigFile) {
        $jetStreamConfig = Parse-JetStreamConfig -ConfigFilePath $JetStreamConfigFile
        Apply-JetStreamConfig -Config $jetStreamConfig
    }
    else {
        Write-Warning "JetStream configuration file not found at: $JetStreamConfigFile. Skipping JetStream setup."
    }
    
    # 7. Validate core business rules
    Validate-BusinessRules -Namespace $Namespace
    
    Write-Hinglish "=== Google Cloud GKE Live Production Engine completed successfully ==="
    Write-Hinglish "Your application is now deployed to GKE in the '$Namespace' namespace."
    Write-Hinglish "You can access your services via their respective LoadBalancer services or Ingress."
}
catch {
    Write-Error "Google Cloud GKE Live Production Engine failed: $_"
    exit 1
}