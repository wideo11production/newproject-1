# ====================================================================
# VIDEO-EDITOR MULTI-STAGE DOCKERFILE (MONOREPO PNPM OPTIMIZED)
# ====================================================================
# Base: node:20-alpine - minimal footprint, pnpm package manager
# Multi-stage: base -> deps -> builder -> runner for production
# Memory: NODE_OPTIONS 1GB heap - 76% resource ceiling ke andar rehta hai
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

# Native build toolchain + config (node-gyp ke liye).
#
# bcrypt/sharp jaise native modules C++ compile karte hain. node:20-alpine me
# python3/make/g++ default NAHI hote, aur node-pre-gyp GitHub se prebuilt
# binary download karne ki koshish karta hai jo build env me BLOCKED hai.
#
# Teeno zaroori hain: toolchain compile ke liye, PYTHON node-gyp ko dikhane
# ke liye, aur build_from_source download skip karne ke liye.
# Ye INLINE set hain (ENV se nahi) kyunki pnpm install scripts child process
# me chalti hain jahan ENV block propagate nahi hota.
RUN apk add --no-cache python3 make g++ libc6-compat

COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/analytics/package.json ./apps/analytics/package.json
COPY apps/billing/package.json ./apps/billing/package.json
COPY apps/monitor/package.json ./apps/monitor/package.json
COPY apps/video-editor/package.json ./apps/video-editor/package.json
COPY apps/web/package.json ./apps/web/package.json

# Poore workspace ke app manifests copy kiye gaye hain taaki pnpm ko wahi
# workspace dikhe jo lockfile ke saath bana tha. Isse cross-app shared
# dependencies (@tanstack/react-query, next-auth wagairah) bhi install ho jaate hain
# kyunki monorepo me ye packages doosre apps declare karte hain

COPY packages/api-client ./packages/api-client
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
RUN PYTHON=/usr/bin/python3 npm_config_build_from_source=true \
    pnpm config set shamefully-hoist true && \
    pnpm install --frozen-lockfile --prefer-offline

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

COPY apps/video-editor ./apps/video-editor

# ---- Restore the app's own node_modules ----
#
# The COPY above REPLACES the whole app directory, including the
# node_modules that pnpm install created in the deps stage.
#
# External deps survive because pnpm hoists them to the root
# /app/node_modules, but WORKSPACE links (wideo11-charts, @wideo11/ui, and
# the rest) are symlinked inside the app's own node_modules. Clobbering that
# directory makes those imports unresolvable and the build fails with:
#
#   Module not found: Can't resolve 'wideo11-charts'
#
# The error names resolution rather than this COPY, which is what makes it
# slow to diagnose. Restoring node_modules AFTER the source copy fixes it -
# order matters.
COPY --from=deps /app/apps/video-editor/node_modules ./apps/video-editor/node_modules


WORKDIR /app/apps/video-editor

# Build Next.js application with production optimization
# next build: static asset optimization, code splitting, tree shaking
# Direct binary invocation: root node_modules se next binary chalata hai, isliye
# pnpm ke package-dir script resolution par depend nahi karte (MODULE_NOT_FOUND fix)
# Build heap limit 4GB deta hai taaki bade apps OOM na ho. 76% resource ceiling
ENV NODE_OPTIONS="--max-old-space-size=4096"

# ---- `NEXT_PUBLIC_*` ko BUILD TIME par pass karo ----
#
# Ye ZAROORI hai, warna ye sab chup-chaap `undefined` rehte hain.
#
# Next.js `process.env.NEXT_PUBLIC_X` ko **build** ke dauraan source code me
# literal value se replace kar deta hai - `next start` par nahi. Isliye runtime
# `environment:` block me var dene se koi fark nahi padta: browser bundle pehle
# hi compile ho chuka hota hai, usme sirf `undefined` likha hota hai.
#
# Ye chup-chaap bug hai kyunki apps me hardcoded fallbacks hain. `access-gate.tsx`
# me `process.env.NEXT_PUBLIC_LOGIN_URL ?? 'http://localhost:3000/auth/login'`
# - fallback sahi value de raha tha, isliye gate kaam karta raha, aur env var ke
# miss hone ka koi nazar nahi aayi. Wahi cheez click ledger me bhi hui: editor
# ke clicks `editor` ke bajaye `port-3002` label ke saath aa rahe the.
#
# Values `docker-compose.yml` ke build args se aati hain, `.env` se. Inhe
# runtime vars ki tarah NA likhna - `.env` me `NEXT_PUBLIC_*` sirf is build arg
# ko default dene ke liye hai.
ARG NEXT_PUBLIC_APP_SURFACE=editor
ARG NEXT_PUBLIC_AUTH_API_URL=http://localhost:8085
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ARG NEXT_PUBLIC_DASHBOARD_URL=http://localhost:3000/dashboard
ARG NEXT_PUBLIC_LOGIN_URL=http://localhost:3000/auth/login
ARG NEXT_PUBLIC_REGISTER_URL=http://localhost:3000/auth/register
ARG NEXT_PUBLIC_VERIFY_URL=http://localhost:3000/auth/verify
ARG NEXT_PUBLIC_SECURITY_SETUP_URL=http://localhost:3000/auth/security-setup

ENV NEXT_PUBLIC_APP_SURFACE=$NEXT_PUBLIC_APP_SURFACE
ENV NEXT_PUBLIC_AUTH_API_URL=$NEXT_PUBLIC_AUTH_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DASHBOARD_URL=$NEXT_PUBLIC_DASHBOARD_URL
ENV NEXT_PUBLIC_LOGIN_URL=$NEXT_PUBLIC_LOGIN_URL
ENV NEXT_PUBLIC_REGISTER_URL=$NEXT_PUBLIC_REGISTER_URL
ENV NEXT_PUBLIC_VERIFY_URL=$NEXT_PUBLIC_VERIFY_URL
ENV NEXT_PUBLIC_SECURITY_SETUP_URL=$NEXT_PUBLIC_SECURITY_SETUP_URL

RUN node /app/node_modules/next/dist/bin/next build

# ------------------------------------------------------------
# STAGE 4: RUNNER - Production runtime with minimal footprint
# ------------------------------------------------------------
FROM node:20-alpine AS runner

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

# Create non-root user for security
# Security: nextjs user minimal privileges ke saath chalega
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Set working directory
WORKDIR /app

# Copy public assets (static files) - standalone ke saath manually copy karte hain
COPY --from=builder --chown=nextjs:nodejs /app/apps/video-editor/public ./public

# Copy Next.js standalone output - self-contained minimal server bundle
# Standalone output apne aap me required node_modules include karta hai, isliye
# runner stage me poora node_modules copy karne ki zaroorat nahi - image chhoti rehti hai
COPY --from=builder --chown=nextjs:nodejs /app/apps/video-editor/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/video-editor/.next/static ./apps/video-editor/.next/static

# Switch to non-root user
USER nextjs

EXPOSE 3002

# Health check for Kubernetes liveness/readiness probes
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3002/ || exit 1

# Start Next.js production server from standalone bundle
# Monorepo me tracing root repo root hota hai, isliye standalone server.js nested path me hota hai
# Isliye nested path use karte hain - flat server.js kaam nahi karega
CMD ["node", "apps/video-editor/server.js"]

# ====================================================================
# BUILD NOTES:
# Build from monorepo root: D:\newproject
# Layer routing: deps (pnpm install) -> builder (next build) -> runner (standalone)
# Heavy node_modules layer sirf builder me rehta hai, runner image minimal rehti hai
# ====================================================================
