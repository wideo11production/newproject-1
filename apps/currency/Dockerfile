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
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3007/ || exit 1
CMD ["node", "apps/currency/server.js"]
