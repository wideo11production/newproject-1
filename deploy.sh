# ============================================================================
# WIDeo11 Deployment Scripts
# ============================================================================

#!/bin/bash
set -e

echo "🚀 Starting Wideo11 deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
        exit 1
    fi
    
    if ! command -v kubectl &> /dev/null; then
        echo -e "${RED}kubectl is not installed. Please install kubectl first.${NC}"
        exit 1
    fi
    
    if ! command -v helm &> /dev/null; then
        echo -e "${RED}Helm is not installed. Please install Helm first.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}All prerequisites are met.${NC}"
}

# Deploy to local Docker Compose
deploy_local() {
    echo "Deploying Wideo11 locally with Docker Compose..."
    
    # Stop existing containers
    docker compose down || true
    
    # Build and start services
    docker compose build --no-cache
    docker compose up -d
    
    echo -e "${GREEN}Wideo11 is now running locally!${NC}"
    echo "Web App: http://localhost:3000"
    echo "Video Editor: http://localhost:3002"
    echo "Superadmin: http://localhost:3008"
    echo "Monitor: http://localhost:3001"
    echo "Analytics: http://localhost:3005"
    echo "Billing: http://localhost:3003"
    echo "Admin: http://localhost:3006"
    echo "Currency: http://localhost:3007"
}

# Deploy to Kubernetes (GKE)
deploy_k8s() {
    echo "Deploying Wideo11 to Kubernetes (GKE)..."
    
    # Check if kubectl is configured
    if ! kubectl cluster-info &> /dev/null; then
        echo -e "${RED}kubectl is not configured. Please configure kubectl first.${NC}"
        exit 1
    fi
    
    # Apply Kubernetes manifests
    echo "Applying Kubernetes manifests..."
    kubectl apply -f infrastructure/kubernetes/
    
    # Wait for deployments to be ready
    echo "Waiting for deployments to be ready..."
    kubectl rollout status deployment/wideo11-auth-service --timeout=300s
    kubectl rollout status deployment/wideo11-web --timeout=300s
    kubectl rollout status deployment/wideo11-video-editor --timeout=300s
    kubectl rollout status deployment/wideo11-superadmin --timeout=300s
    kubectl rollout status deployment/wido11-billing-service --timeout=300s
    
    echo -e "${GREEN}Wideo11 is now deployed to Kubernetes!${NC}"
    echo ""
    echo "To access services, use:"
    echo "  kubectl port-forward service/web 3000:3000"
    echo "  kubectl port-forward service/superadmin 3008:3008"
    echo "  kubectl port-forward service/video-editor 3002:3002"
    echo ""
    echo "Or set up an Ingress to access services externally."
}

# Main script
case "${1:-}" in
    local)
        check_prerequisites
        deploy_local
        ;;
    k8s)
        check_prerequisites
        deploy_k8s
        ;;
    *)
        echo "Usage: $0 {local|k8s}"
        echo ""
        echo "  local   - Deploy locally with Docker Compose"
        echo "  k8s     - Deploy to Kubernetes (GKE)"
        exit 1
        ;;
esac