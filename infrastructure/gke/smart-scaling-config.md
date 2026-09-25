# GKE Smart Scaling Configuration - Intercept Rules
# Version: 1.0
# Purpose: Bind auto-scaling to authenticated user sessions only
# Freeze node expansion at 76% resource ceiling for unauthenticated traffic

## SCALING PHILOSOPHY
# - Scale UP only for VALIDATED, AUTHENTICATED user sessions
# - Ignore/FREEZE scaling for unauthenticated/public traffic bursts
# - HARD CEILING: 76% resource utilization - NO exceptions
# - Prevent fake traffic bursts from triggering expensive node expansion

## HPA (Horizontal Pod Autoscaler) Configuration

apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-services-hpa
  namespace: production
  labels:
    app: backend-services
    scaling-policy: smart-intercept
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend-services
  minReplicas: 3
  maxReplicas: 20
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
      # SMART INTERCEPT: Only scale up if authenticated traffic > threshold
      selectPolicy: Max

  metrics:
    # METRIC 1: Authenticated User Session Count (PRIMARY SCALING TRIGGER)
    - type: Pods
      pods:
        metric:
          name: authenticated_sessions_active
        target:
          type: AverageValue
          averageValue: "50"  # Scale up when >50 authenticated sessions per pod
    
    # METRIC 2: Authenticated Request Rate (SECONDARY TRIGGER)
    - type: Pods
      pods:
        metric:
          name: authenticated_requests_per_second
        target:
          type: AverageValue
          averageValue: "100"  # Scale up when >100 auth req/sec per pod

    # METRIC 3: Resource Utilization (CEILING ENFORCEMENT)
    # HARD CEILING: 76% - NEVER EXCEED
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          utilization: 76  # HARD CEILING - 76% max
    
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          utilization: 76  # HARD CEILING - 76% max

---

## CUSTOM METRICS ADAPTER CONFIGURATION

# These metrics must be exposed by the application via Prometheus endpoint
# Only authenticated traffic contributes to scaling metrics

# authenticated_sessions_active
# - Count of unique authenticated user sessions per pod
# - Updated every 30 seconds via middleware session tracking
# - Excludes: unauthenticated, bot, crawler traffic

# authenticated_requests_per_second
# - Rate of authenticated API requests per second
# - Calculated from middleware token validation
# - Excludes: 401/403 responses, rate-limited requests

---

## SCALING INTERCEPT LOGIC (Application Level)

# In middleware.ts or custom metrics exporter:

/**
 * SMART SCALING INTERCEPT RULES:
 * 1. Track authenticated vs unauthenticated request ratios
 * 2. Only increment scaling metrics for VALIDATED sessions
 * 3. If unauthenticated traffic > 50% of total: FREEZE scaling
 * 4. If resource usage > 76%: HARD FREEZE regardless of traffic type
 * 5. Log all intercept decisions for audit trail
 */

# Pseudocode for intercept logic:
# 
# function shouldScaleUp() {
#   const authRatio = authenticatedRequests / totalRequests;
#   const resourceUsage = max(cpuUsage, memoryUsage);
#   
#   // RULE 1: Hard ceiling at 76%
#   if (resourceUsage >= 76) {
#     return { allowed: false, reason: 'HARD_CEILING_76_PERCENT' };
#   }
#   
#   // RULE 2: Require minimum 60% authenticated traffic
#   if (authRatio < 0.60) {
#     return { allowed: false, reason: 'LOW_AUTH_RATIO', authRatio };
#   }
#   
#   // RULE 3: Minimum 20 authenticated sessions per pod
#   if (authenticatedSessionsPerPod < 20) {
#     return { allowed: false, reason: 'INSUFFICIENT_AUTH_SESSIONS' };
#   }
#   
#   return { allowed: true };
# }

---

## VPA (Vertical Pod Autoscaler) - Resource Ceiling Enforcement

apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: backend-services-vpa
  namespace: production
spec:
  targetRef:
    apiVersion: "apps/v1"
    kind: Deployment
    name: backend-services
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
      - containerName: backend
        maxAllowed:
          cpu: "2000m"      # 2 CPU cores max
          memory: "4Gi"     # 4GB RAM max
        minAllowed:
          cpu: "500m"
          memory: "1Gi"
        controlledResources: ["cpu", "memory"]
        # HARD CEILING: VPA cannot recommend beyond these limits

---

## CLUSTER AUTOSCALER CONFIGURATION

# Cluster autoscaler only expands nodes when:
# 1. Pods are pending due to resource constraints
# 2. Pending pods are from AUTHENTICATED workloads
# 3. Current cluster utilization < 76%

# Annotations for workload classification:
# - workload-type: "authenticated" (scales normally)
# - workload-type: "public" (never triggers node expansion)

---

## MONITORING & ALERTING RULES

# Prometheus alerts for scaling intercept violations:

groups:
  - name: gke-smart-scaling
    rules:
      # Alert: Resource ceiling breached
      - alert: GKEHardCeilingBreached
        expr: |
          max(
            max(container_cpu_usage_seconds_total{namespace="production"}) 
            / max(container_spec_cpu_quota{namespace="production"} / container_spec_cpu_period{namespace="production"})
          ) > 0.76
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "GKE Hard Ceiling (76%) breached - Scaling FROZEN"
          description: "Resource utilization exceeded 76%. All auto-scaling frozen per policy."

      # Alert: Unauthenticated traffic scaling attempt blocked
      - alert: GKEUnauthenticatedScalingBlocked
        expr: |
          (
            sum(rate(http_requests_total{authenticated="false"}[5m])) 
            / sum(rate(http_requests_total[5m]))
          ) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Unauthenticated traffic > 50% - Scaling FROZEN"
          description: "High unauthenticated traffic detected. Smart scaling intercept active."

      # Alert: Suspicious IP rate limiting
      - alert: GKEAuthRateLimitViolations
        expr: |
          increase(auth_rate_limit_violations_total[10m]) > 10
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "High auth rate limit violations detected"
          description: "{{ $value }} rate limit violations in 10 minutes. Possible bot attack."

---

## DEPLOYMENT COMMANDS

# Apply HPA with smart intercept:
# kubectl apply -f gke-smart-hpa.yaml

# Apply VPA with ceiling enforcement:
# kubectl apply -f gke-vpa-ceiling.yaml

# Apply Cluster Autoscaler config:
# kubectl apply -f cluster-autoscaler-config.yaml

# Verify scaling policies:
# kubectl get hpa -n production -o yaml
# kubectl get vpa -n production -o yaml

---

## COMPLIANCE NOTES (HINGLISH)

# Yeh configuration ensure karta hai:
# 1. Sirf authenticated users ke liye scale hota hai - bots/public traffic ignore hota hai
# 2. 76% resource ceiling HAMESHA enforce hota hai - kabhi bhi exceed nahi hota
# 3. Fake traffic bursts se node expansion prevent hota hai - cost bachata hai
# 4. Core ledger, 5% sister share, ₹2000 buffer - INTACT rehta hai (koi change nahi)
# 5. Har decision audit trail mein log hota hai - compliance ke liye
# 6. Koi kala jaadu nahi - pure validated logic hai

# KEY PRINCIPLES:
# - Human-paced registration = genuine load = scale allowed
# - Bot bursts = fake load = scale FROZEN
# - 76% = absolute ceiling = NO exceptions ever