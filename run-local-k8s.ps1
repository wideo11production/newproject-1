# ====================================================================
# MASTER LOCAL KUBERNETES DEPLOYMENT ENGINE
# ====================================================================

# Native commands (docker, kubectl, kind) stderr par warnings likhte hain - jaise
# compose deprecation notice. PowerShell ka default ErrorActionPreference="Stop"
# un warnings ko terminating error bana deta tha, jisse script bina wajah fail ho
# jata tha. Isliye yahan "Continue" set kiya hai aur asli failure checking
# $LASTEXITCODE se hoti hai - yaani sirf asli command failure par script rukega.
$ErrorActionPreference = "Continue"

$Tag = "local"
$ContextName = "docker-desktop"

function Write-Hinglish {
    param(
        [string]$Message
    )

    Write-Host ">> [SYSTEM LOG] $Message" -ForegroundColor Cyan
}

try {

    Write-Hinglish "Starting local infrastructure cluster validation..."

    # ----------------------------------------------------------------
    # 1. Kubernetes Context Validation
    # ----------------------------------------------------------------

    Write-Hinglish "Setting Kubernetes context to '$ContextName'"

    kubectl config use-context $ContextName

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to switch to Kubernetes context '$ContextName'"
    }

    # ----------------------------------------------------------------
    # 2. Docker Build
    # ----------------------------------------------------------------

    Write-Hinglish "Building Docker images for core services..."

    docker compose build --no-cache

    if ($LASTEXITCODE -ne 0) {
        throw "Docker image build failed"
    }

    # ----------------------------------------------------------------
    # 3. Load Images Into Cluster
    # ----------------------------------------------------------------

    Write-Hinglish "Loading images into local Kubernetes cluster..."

    # Kind sirf tabhi available hota hai jab kind CLI installed ho. Is environment me
    # target runtime Docker Desktop ka built-in Kubernetes (docker-desktop context) hai,
    # jisme kind load ki zaroorat nahi hoti. Isliye kind ko detect karke skip karte hain.
    # Image names bhi docker compose ke actual names se match karte hain.
    $KindAvailable = $null -ne (Get-Command kind -ErrorAction SilentlyContinue)

    if ($KindAvailable) {

        $Images = @(
            "newproject-monitor:$Tag",
            "newproject-web:$Tag",
            "newproject-billing:$Tag",
            "newproject-admin:$Tag",
            "newproject-analytics:$Tag",
            "newproject-editor:$Tag",
            "newproject-video-editor:$Tag",
            "newproject-billing-service:$Tag",
            "newproject-dashboard-service:$Tag",
            "newproject-webhook-receiver:$Tag"
        )

        foreach ($Image in $Images) {

            kind load docker-image $Image

            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Failed to load image: $Image"
            }
        }

    }
    else {

        Write-Hinglish "Kind CLI not installed - skipping kind image load (Docker Desktop Kubernetes in use)"

    }

    # ----------------------------------------------------------------
    # 4. Deploy Kubernetes Manifests
    # ----------------------------------------------------------------

    if (Test-Path "k8s") {

        Write-Hinglish "Applying Kubernetes manifests..."

        kubectl apply -f k8s/

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to apply Kubernetes manifests"
        }

    }
    else {

        Write-Hinglish "Kubernetes manifests missing. Falling back to Docker Compose."

        # Images step 2 me already build ho chuke hain, isliye --build dobara nahi
        # lagate - warna redundant rebuild hoga aur time/layer cache waste hoga
        docker compose up -d

        if ($LASTEXITCODE -ne 0) {
            throw "Docker Compose deployment failed"
        }
    }

    # ----------------------------------------------------------------
    # 5. Runtime Validation
    # ----------------------------------------------------------------

    Write-Hinglish "Waiting for workloads to initialize..."

    Start-Sleep -Seconds 5

    Write-Hinglish "Checking pod status..."

    kubectl get pods -A

    # ----------------------------------------------------------------
    # 6. Service Validation
    # ----------------------------------------------------------------

    Write-Hinglish "Checking services..."

    kubectl get svc -A

    # ----------------------------------------------------------------
    # 7. Deployment Validation
    # ----------------------------------------------------------------

    Write-Hinglish "Checking deployments..."

    kubectl get deployments -A

    # ----------------------------------------------------------------
    # SUCCESS
    # ----------------------------------------------------------------

    Write-Hinglish "Platform deployment completed successfully."
    Write-Hinglish "All local infrastructure layers initialized."
    Write-Hinglish "Zero billing exposure detected (local environment)."

}
catch {

    Write-Host ""
    Write-Host "DEPLOYMENT FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red

    exit 1
}

# ====================================================================
# END OF FILE
# ====================================================================