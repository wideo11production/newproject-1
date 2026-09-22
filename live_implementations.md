# Live Implementation Steps Document

## Prerequisites List
Before starting deployment on the live production platform, the following must be ready:

1. **Infrastructure**
   - Kubernetes cluster (minimum 3 nodes) with RBAC enabled
   - Nginx Ingress Controller installed and configured
   - HashiCorp Vault installed and initialized with appropriate policies
   - PostgreSQL cluster with multi-replica setup (primary and at least two replicas)
   - Redis cluster with multi-replica setup (primary and at least two replicas)
   - Object storage (e.g., MinIO or AWS S3) for media files and backups
   - Monitoring stack (Prometheus, Alertmanager) installed
   - Logging stack (ELK or Loki) installed
   - DNS configured for wideo11.com and all subdomains (api.wideo11.com, web.wideo11.com, admin.wideo11.com, editor.wideo11.com, monitor.wideo11.com, etc.)
   - SSL/TLS certificates for all domains (via Let's Encrypt or Vault)

2. **Access Keys and Secrets**
   - AWS access keys (if using S3) or MinIO access credentials
   - Database credentials (PostgreSQL, Redis) stored in Vault
   - API keys for third-party services (e.g., payment providers, email services)
   - JWT secret keys for authentication
   - Encryption keys for sensitive data at rest
   - GitHub/GitLab access tokens for CI/CD
   - SSH keys for server access

3. **Baseline Infrastructure**
   - Base Docker images built and pushed to a private registry
   - CI/CD pipeline (e.g., GitHub Actions, GitLab CI) configured to build and deploy
   - Namespace segregation in Kubernetes (e.g., dev, staging, prod)
   - Resource quotas and limits defined for each namespace
   - PersistentVolumeClaims provisioned for stateful services
   - Ingress rules configured for all subdomains
   - Network policies configured to restrict traffic between services
   - PodDisruptionBudgets for high availability
   - Vault policies for service-to-service authentication

4. **Environment Configuration**
   - Root .env file with all required variables (see .env.example for reference)
   - Separate .env files for each environment (dev, staging, prod)
   - SSOT (Single Source of Truth) configuration files for UI settings, network providers, etc.
   - Feature flags configuration (if using a service like LaunchDarkly or custom)
   - Specific variables for monetization policies:
        * MINIMUM_BALANCE_BUFFER=2000 (in INR, or equivalent in other currencies via dynamic pricing)
        * SISTER_SHARE_PERCENTAGE (e.g., 15.0 for 15%)
        * INACTIVITY_THRESHOLD_DAYS=190 (for nominee triggering)
        * NETWORK_PROVIDER_PRIMARY and NETWORK_PROVIDER_SECONDARY (e.g., AIRTEL, TATA)
   - Blacklist tables for hardware, email, and identity must be pre-created in the database.

5. **Security and Compliance**
   - Penetration test report for the application and infrastructure
   - Compliance with relevant standards (e.g., GDPR, HIPAA if applicable)
   - Data processing agreements with third-party vendors
   - Incident response plan defined
   - Backup and disaster recovery procedures tested## Step-by-Step Blueprint
Follow these steps in order to ensure zero margin for error:

### Step 1: Prepare the Environment
1.1. Provision the Kubernetes cluster with the required node pools (e.g., general purpose, compute optimized, memory optimized).
1.2. Install and configure the Nginx Ingress Controller with TLS termination.
1.3. Install and initialize HashiCorp Vault, enabling the Kubernetes auth method.
1.4. Deploy the PostgreSQL operator (e.g., Crunchy Data) and create a PostgreSQL cluster with synchronous replication.
1.5. Deploy the Redis operator (e.g., Redis Enterprise) and create a Redis cluster with replication.
1.6. Provision object storage buckets for media, backups, and static assets.
1.7. Install the Prometheus Operator (kube-prometheus-stack) and configure scraping for Kubernetes services.
1.8. Install the Loki stack for log aggregation.
1.9. Configure external DNS to point to the cluster's ingress controller IP.
1.10. Obtain and install SSL/TLS certificates for all subdomains via cert-manager or Vault.

### Step 2: Configure Security and Secrets
2.1. Store all database credentials, API keys, and secrets in Vault with appropriate policies.
2.2. Configure Kubernetes secrets to reference Vault dynamic secrets where possible.
2.3. Set up service accounts and roles for each microservice with least privilege access.
2.4. Enable audit logging for the Kubernetes API server and Vault.
2.5. Configure network policies to deny all traffic by default and explicitly allow required service-to-service communication.
2.6. Enable Pod Security Standards (restricted) for all namespaces.
2.7. Configure image scanning for vulnerabilities in the CI/CD pipeline.
2.8. Set up runtime security monitoring (e.g., Falco) for anomaly detection.

### Step 3: Deploy Foundational Services
3.1. Deploy the configuration service (if externalized) or ConfigMaps for static configuration.
3.2. Deploy the database migration jobs to initialize the schema.
3.3. Deploy the core microservices (User, Auth, Video, Notification) in the following order:
     - Auth service (depends on database)
     - User service (depends on Auth and database)
     - Video service (depends on User, Auth, and object storage)
     - Notification service (depends on User and email/SMS providers)
3.4. Verify each service's health endpoints and log output.
3.5. Set up horizontal pod autoscalers (HPA) for each service based on CPU and memory utilization.
3.6. Configure resource requests and limits for each container.

### Step 4: Implement Phase 1: Next.js, Architecture & Core Logic
4.1. Update the Next.js applications (web, admin, editor, monitor) to use Next.js 14+.
4.2. Implement optimization boundaries:
     - Mark components as "use client" only when necessary (e.g., for browser APIs, state that requires interactivity).
     - Use Server-Side Rendering (SSR) for initial data fetching and static generation (SSG) for cacheable content.
     - Optimize images with the Next.js <Image /> component, using priority for above-the-fold images.
     - Implement component lazy loading with dynamic() for non-critical components.
4.3. Implement Parallel Routes using @slots in the app router for layouts that require independent sub-routes.
4.4. Create default.js files for each slot to handle fallback states gracefully.
4.5. Implement authentication with Next-Auth:
     - Use JWT strategy for session management.
     - Secure cookies with SameSite, Secure, and HttpOnly flags.
     - Implement refresh token rotation to prevent token theft.
4.6. Create a comprehensive middleware.ts file that:
     - Protects all routes by default.
     - Allows access to open public routes (e.g., landing page, public blog posts, login/signup pages).
     - Redirects unauthenticated users to the login page.
     - Validates session and redirects to logout if invalid.
     - Prevents caching of sensitive responses.
4.7. Eliminate all hardcoded values:
     - Replace all URLs with process.env.NEXT_PUBLIC_* (for client-side) or process.env.* (for server-side).
     - Move all configuration to .env files and validate at build time.
     - Use a configuration service or feature flag service for dynamic runtime configuration.
4.8. Implement WORKSPACE MONETIZATION & POLICY RULES (SSOT):
     - Implement the ?2000 Minimum Balance buffer logic in the billing and wallet services.
     - Implement the Dual-Stage Confirmation Deletion Flow with Account Hold in the user management service.
     - Implement Nominee Isolation & Inactivity Hard-Locks:
           * Background scheduler for inactivity tracking (190 days).
           * Balance masking in nominee withdrawal interface.
           * Post-withdrawal event trigger to update creator profile to PERMANENTLY_CLOSED.
           * Immutable security blacklist table for hardware, email, and identity.
4.9. Implement a centralized error boundary and logging mechanism.
4.10. Write unit and integration tests for the authentication flow and middleware.
4.11. Perform a security audit of the Next.js applications (e.g., using npm audit, Snyk).

### Step 5: Implement Phase 2: UI/UX Consistency
5.1. Custom Observability Dashboard:
     - Build a streamlined, high-performance monitoring panel on port 3001 using custom Shadcn UI grid components.
     - Map directly to local Prometheus event scrapers (avoid exposing Prometheus directly).
     - Implement dark theme with CSS variables (slate-grey background, electric blue/green accents).
     - Ensure crisp grid lines and precise time-series charts replicating Grafana's look.
     - Make the dashboard fully keyboard accessible and ARIA compliant.
5.2. Video Editor UI/UX:
     - Replicate the Movavi Video Editor layout: dark charcoal color blocks, floating panels, multitrack timeline.
     - Implement a canvas for video preview using HTML5 <canvas> with hardware acceleration if available.
     - Build a timeline component with tracks for video, audio, and subtitles.
     - Enable track dragging, splitting, and precise offset adjustments.
     - Implement floating, movable panels for tools, properties, and media library.
     - Use a state management library (e.g., Zustand, Redux Toolkit) to handle the complex state of the editor.
     - Ensure smooth performance by using requestAnimationFrame for timeline updates and minimizing DOM operations.
5.3. SSOT Settings:
     - Create a settings service that stores user preferences in the database (or in a dedicated settings microservice).
     - Implement a settings context in React that fetches user-specific settings on login.
     - Provide a settings UI that allows users to modify preferences and saves them immediately.
     - Ensure settings are applied globally without requiring a page refresh (use context or state management).
     - Version the settings schema to handle backward compatibility.

### Step 6: Implement Phase 3: Dedicated Sister's Dashboard
6.1. Read-Only Dashboard:
     - Create a new Next.js route (e.g., /sister-dashboard) that is accessible only by the Sister's account.
     - Implement strict authorization middleware that checks for the Sister's role or specific permissions.
     - Ensure the dashboard is read-only: disable all forms, buttons, and interactive elements that could modify state.
     - Use a separate layout that hides navigation to other parts of the application.
6.2. Financial Tracking:
     - Implement an API endpoint that returns today’s total revenue and the Sister's exact split/share.
     - Calculate the split based on the SISTER_SHARE_PERCENTAGE environment variable.
     - Cache the result for a short duration (e.g., 1 minute) to reduce database load.
     - Display the information in a prominent, easy-to-read widget on the dashboard.
6.3. Dynamic Profit Sharing:
     - Read the SISTER_SHARE_PERCENTAGE from the .env file at runtime (or from a configuration service).
     - Allow the percentage to be a floating-point number (e.g., 15.5 for 15.5%).
     - Ensure the percentage is validated (between 0 and 100) and defaults to a safe value if invalid.
     - Document that adjusting this variable over a 2-year horizon requires no code changes, only a redeploy or config update.

### Step 7: Implement Phase 4: Monorepo, Microservices & GKE Cloud Infrastructure
7.1. Domain & Subdomains Setup:
     - Verify that all required subdomains (api, web, admin, editor, monitor, sister, etc.) are configured in Hostinger DNS to point to the cluster's ingress IP.
     - Configure Ingress rules for each subdomain to route to the appropriate service.
     - Use path-based routing if necessary (e.g., /api/* to the API gateway).
7.2. Automated Communication:
     - Set up a secure, authenticated Postfix server (or use a managed service like Amazon SES, SendGrid) for email delivery.
     - Configure email templates with professional branding (header, footer, unsubscribe link).
     - Implement rate limiting and spam checking to maintain sender reputation.
     - Use DNS records (SPF, DKIM, DMARC) to prevent email spoofing.
7.3. Database & Schemas:
     - Ensure all Go microservices use GORM with strictly defined structs.
     - Automate migrations using a tool like golang-migrate or GORM's auto-migrate (in development only; use explicit migrations in production).
     - Store migration scripts in version control and apply them via CI/CD.
     - Prohibit manual updates to the database schema; all changes must go through the migration process.

### Step 8: Implement Phase 5: High-Availability, Auto-Healing, and Automated Dynamic Failover
8.1. Cluster Orchestration:
     - Configure Horizontal Pod Autoscaler (HPA) for each microservice based on custom metrics (e.g., request latency, queue depth).
     - Install and configure the Nginx Ingress Controller for TLS termination and load balancing.
     - Deploy HashiCorp Vault in HA mode (consul backend or integrated storage) and configure services to retrieve dynamic secrets.
8.2. Database & Cache Clusters:
     - Set up PostgreSQL with synchronous replication (primary and at least two replicas) using a Patroni cluster or similar.
     - Configure Redis with replication (primary and at least two replicas) using Redis Sentinel or Redis Cluster.
     - Implement connection pooling in the application to handle failover gracefully.
     - Set up automated backups (e.g., using Velero for Kubernetes volumes, pgBackRest for PostgreSQL).
8.3. SSOT Network Provider Switching:
     - Define network provider configuration in the .env file (e.g., NETWORK_PROVIDER_PRIMARY=AIRTEL, NETWORK_PROVIDER_SECONDARY=TATA).
     - Create a configuration service that reads these variables and provides the appropriate network settings to services.
     - Ensure that changing the .env triggers a rolling restart of services to pick up the new configuration.
8.4. Zero-Lag Hybrid Plan A & Plan B Auto-Healing Loop:
     - **Active-Standby Monitoring**: Deploy Plan B services in active-standby mode (same as Plan A but not receiving live traffic). Use a load balancer to direct traffic only to Plan A under normal conditions. Continuously monitor Plan A health endpoints.
     - **Instant Failover Processing**: Implement a health check mechanism (e.g., using Prometheus and Alertmanager) that detects Plan A failure (e.g., high error rates, latency spikes, or node downtime). Trigger an automated script (via webhook or Kubernetes job) to update the load balancer to redirect traffic to Plan B.
     - **Autonomous Diagnostics & RCA Report**: While Plan B handles live traffic, Plan A runs automated healing scripts (e.g., self-healing operators, Kubernetes self-healing via restart policies). Simultaneously trigger a background diagnostics agent to trace and log the precise breakdown event (e.g., connection timeouts, DNS resolution failure on Airtel/Tata, memory leaks, corrupt WAL logs). Generate an explicit Root Cause Analysis (RCA) incident post-mortem report on the custom metrics panel (port 3001), outlining *what failed, why it broke, how it was healed, and the preventative validation rule added to ensure this exact failure pattern never breaks down the failover mechanism again.*
     - **Delta Sync & Graceful Switchback**: Once Plan A is verified healthy, do not cut back traffic immediately. Plan A must first connect to Plan B's storage logs, download all data written during the outage, compile the chronological audit trail, and only execute a seamless switchback once delta synchronization hits 100%. Plan B then returns to active-standby.
8.5. Advanced Auto-Healing, Self-Reporting, and Root Cause Analysis (RCA) Engine:
     - This is already covered in 8.4.3 (Autonomous Diagnostics & RCA Report). Ensure the RCA report includes a 'Developer Post-Mortem & Mental Replica' text summary block.

### Step 9: Final Validation and Cutover
9.1. Conduct end-to-end testing of all critical user journeys (login, video upload, editing, playback, payment, etc.).
9.2. Perform load testing to verify the system can handle expected peak traffic.
9.3. Execute chaos engineering experiments (e.g., using LitmusChaos) to validate failover and auto-healing mechanisms.
9.4. Review all logs and metrics for anomalies.
9.5. Obtain sign-off from security and compliance teams.
9.6. Schedule the cutover during a low-traffic window.
9.7. Monitor closely post-cutover and have a rollback plan ready.

