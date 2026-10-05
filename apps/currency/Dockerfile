# Currency Dashboard - Next.js app
# Multi-stage, pnpm monorepo, air-gapped fonts (no Google Fonts fetch).
# Hinglish comments: har block ka arth

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ---- Deps stage: pnpm install with workspace resolution ----
FROM base AS deps
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
COPY packages/ui ./packages/ui
COPY apps/currency/package.json ./apps/currency/package.json
COPY packages/*/package.json ./packages/
RUN PYTHON=/usr/bin/python3 npm_config_build_from_source=true \
    pnpm config set shamefully-hoist true && \
    pnpm install --frozen-lockfile --prefer-offline

# ---- Builder stage: compile Next.js ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY apps/currency ./apps/currency

WORKDIR /app/apps/currency
# 4GB heap - 76% ceiling ke andar (monorepo Next.js builds memory heavy hote hain)
ENV NODE_OPTIONS="--max-old-space-size=4096"

# ---- NEXT_PUBLIC_* ko BUILD TIME par pass karo ----
#
# Next.js inhe `next build` ke dauraan source me inline kar deta hai, runtime par
# nahi - isliye compose ka `environment:` block in vars ke liye DEAD hai.
#
# Isi wajah se ye app click ledger me dikhai nahi deta tha: tracker
# `NEXT_PUBLIC_APP_SURFACE` padhta tha, par value `undefined` thi, to fallback
# chala aur app apna naam nahi, apna port bhejti thi.
ARG NEXT_PUBLIC_APP_SURFACE=currency
ARG NEXT_PUBLIC_CURRENCY_API=http://localhost:8086
ENV NEXT_PUBLIC_APP_SURFACE=$NEXT_PUBLIC_APP_SURFACE
ENV NEXT_PUBLIC_CURRENCY_API=$NEXT_PUBLIC_CURRENCY_API

RUN node /app/node_modules/next/dist/bin/next build

# ---- Runner stage: minimal standalone output ----
FROM node:20-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Port 3007 (saare 7 apps ke baad - koi conflict nahi)
ENV PORT=3007
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
WORKDIR /app

COPY --from=builder --chown=nextjs:nodejs /app/apps/currency/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/currency/.next/static ./apps/currency/.next/static

USER nextjs
EXPOSE 3007

# ---- WHY THIS PROBES `/api/live` AND NOT `/` ----
#
# `/` is gated behind a session in this app's middleware. A container with no
# session answers 401 there, the probe reads that as "unhealthy", and Docker
# restarts a healthy process - then the probe fails again, forever. Six healthy
# containers sat in exactly that restart loop while serving traffic correctly.
#
# A liveness probe answers one question: can this process still respond? It must
# not consult anything that can change for an unrelated reason, or it restarts
# things it cannot fix. `/api/live` has no dependency, no version and no uptime,
# so the only thing that fails it is the process being unable to answer.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3007/api/live || exit 1
CMD ["node", "apps/currency/server.js"]
