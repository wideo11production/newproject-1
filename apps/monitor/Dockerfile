# ====================================================================
# MONITOR MULTI-STAGE DOCKERFILE (MONOREPO PNPM OPTIMIZED)
# ====================================================================
# Base: node:20-alpine - minimal footprint, pnpm package manager
# Multi-stage: base -> deps -> builder -> runner for production
# Memory: NODE_OPTIONS 1GB heap - 76% resource ceiling ke andar rehta hai
# Port: 3001 (monitor frontend runtime)
# Hinglish comments: har line ka arth samjhne ke liye

# ------------------------------------------------------------
# STAGE 1: BASE - Install pnpm and setup monorepo workspace
# ------------------------------------------------------------
FROM node:20-alpine AS base

# Install pnpm globally - package manager for monorepo
# pnpm native install chahiye, npm bilkul nahi - EUSAGE error se bachne ke liye
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory for monorepo root
WORKDIR /app

# ------------------------------------------------------------
# STAGE 2: DEPS - Install dependencies with pnpm workspace caching
# ------------------------------------------------------------
FROM base AS deps

# Copy root workspace configuration files first
# Ye files pnpm workspace structure aur lockfile define karte hain
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/analytics/package.json ./apps/analytics/package.json
COPY apps/billing/package.json ./apps/billing/package.json
COPY apps/editor/package.json ./apps/editor/package.json
COPY apps/monitor/package.json ./apps/monitor/package.json
COPY apps/video-editor/package.json ./apps/video-editor/package.json
COPY apps/web/package.json ./apps/web/package.json

# Poore workspace ke app manifests copy kiye gaye hain taaki pnpm ko wahi
# workspace dikhe jo lockfile ke saath bana tha. Isse cross-app shared
# dependencies (@tanstack/react-query, next-auth wagairah) bhi install ho jaate hain
# kyunki monorepo me ye packages doosre apps declare karte hain

COPY packages/api-client ./packages/api-client
COPY packages/auth ./packages/auth
COPY packages/charts ./packages/charts
COPY packages/config ./packages/config
COPY packages/constants ./packages/constants
COPY packages/dnd-dashboard ./packages/dnd-dashboard
COPY packages/editor-core ./packages/editor-core
COPY packages/eslint-config ./packages/eslint-config
COPY packages/forms ./packages/forms
COPY packages/i18n ./packages/i18n
COPY packages/push-client ./packages/push-client
COPY packages/tailwind-config ./packages/tailwind-config
COPY packages/tsconfig ./packages/tsconfig
COPY packages/ui ./packages/ui
COPY packages/utils ./packages/utils
COPY packages/video-player ./packages/video-player

# Install dependencies using pnpm with workspace support
# shamefully-hoist: dependency graph ko flat kar deta hai taaki Docker
# multi-stage boundary par module resolution na toote
# --frozen-lockfile: lockfile ke exact versions use hote hain (EUSAGE protection)
# --prefer-offline: pnpm store cache use karta hai, network calls kam
RUN pnpm config set shamefully-hoist true && pnpm install --frozen-lockfile --prefer-offline

# ------------------------------------------------------------
# STAGE 3: BUILDER - Compile Next.js application with optimization
# ------------------------------------------------------------
FROM base AS builder

# Copy flattened node_modules from deps stage - cached dependencies
# Deps stage ka flattened node_modules yahan mount hota hai
COPY --from=deps /app/node_modules ./node_modules

# Copy workspace packages (source included) from deps stage
# Workspace packages ka source deps stage se aata hai, isliye dobara copy nahi karte
COPY --from=deps /app/packages ./packages

# Copy root workspace files
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy monitor source code
COPY apps/monitor ./apps/monitor

# Set working directory to the monitor app
WORKDIR /app/apps/monitor

# Build Next.js application with production optimization
# next build: static asset optimization, code splitting, tree shaking
# Direct binary invocation: root node_modules se next binary chalata hai, isliye
# pnpm ke package-dir script resolution par depend nahi karte (MODULE_NOT_FOUND fix)
# Build heap limit 4GB deta hai taaki bade apps OOM na ho. 76% resource ceiling
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN node /app/node_modules/next/dist/bin/next build

# ------------------------------------------------------------
# STAGE 4: RUNNER - Production runtime with minimal footprint
# ------------------------------------------------------------
FROM node:20-alpine AS runner

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Create non-root user for security
# Security: nextjs user minimal privileges ke saath chalega
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Set working directory
WORKDIR /app

# monitor app ke paas public/ assets directory nahi hai, isliye kuch copy nahi karte

# Copy Next.js standalone output - self-contained minimal server bundle
# Standalone output apne aap me required node_modules include karta hai, isliye
# runner stage me poora node_modules copy karne ki zaroorat nahi - image chhoti rehti hai
COPY --from=builder --chown=nextjs:nodejs /app/apps/monitor/.next-monitor/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/monitor/.next-monitor/static ./apps/monitor/.next-monitor/static

# Switch to non-root user
USER nextjs

# Expose monitor frontend port
EXPOSE 3001

# Health check for Kubernetes liveness/readiness probes
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/ || exit 1

# Start Next.js production server from standalone bundle
# Monorepo me tracing root repo root hota hai, isliye standalone server.js nested path me hota hai
# Isliye nested path use karte hain - flat server.js kaam nahi karega
CMD ["node", "apps/monitor/server.js"]

# ====================================================================
# BUILD NOTES:
# Build from monorepo root: D:\newproject
# docker build -f apps/monitor/Dockerfile -t  .
# Layer routing: deps (pnpm install) -> builder (next build) -> runner (standalone)
# Heavy node_modules layer sirf builder me rehta hai, runner image minimal rehti hai
# ====================================================================
