# Superadmin App - dedicated master control panel
# Ye app user app se completely ALAG hai (separate entity, port 3008).
# Multi-stage, pnpm monorepo, air-gapped fonts.
#
# Hinglish comments: har block ka arth
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ---- Deps ----
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
COPY apps/superadmin/package.json ./apps/superadmin/package.json
COPY packages/*/package.json ./packages/
RUN PYTHON=/usr/bin/python3 npm_config_build_from_source=true \
    pnpm config set shamefully-hoist true && \
    pnpm install --frozen-lockfile --prefer-offline

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY apps/superadmin ./apps/superadmin

WORKDIR /app/apps/superadmin
ENV NODE_OPTIONS="--max-old-space-size=4096"

# ---- NEXT_PUBLIC_* ko BUILD TIME par pass karo ----
#
# Next.js inhe `next build` ke dauraan source me inline kar deta hai, runtime
# par nahi. Isliye compose ka `environment:` block in vars ke liye DEAD hai -
# bundle pehle hi compile ho chuka hota hai. Ye ARG block usi ko build time
# par wapas laata hai.
#
# Har app me har `NEXT_PUBLIC_*` read site par ek hardcoded fallback hai, aur wahi
# sahi value hai - isliye bug chup-chaap tha. Click ledger me hi nikla: editor
# apne events `port-3002` (fallback) label ke saath bhej raha tha, `editor`
# nahi.
#
# NOTE: sirf wahi vars yahan hain jo BROWSER me padhe jaate hain aur jinki value
# host se resolve ho sakti hai. Koi compose-internal hostname (`auth-service`,
# `dashboard-service`) jaan-boojh kar nahi daala gaya - browser unhe resolve hi
# nahi kar sakta, to ek kaam karne wala fallback badal kar chup-chaap toota URL
# mil jata.
ARG NEXT_PUBLIC_APP_SURFACE=superadmin
ENV NEXT_PUBLIC_APP_SURFACE=$NEXT_PUBLIC_APP_SURFACE
RUN node /app/node_modules/next/dist/bin/next build

# ---- Runner ----
FROM node:20-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3008
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
WORKDIR /app

COPY --from=builder --chown=nextjs:nodejs /app/apps/superadmin/.next/standalone ./
# ---- YEH PATH PEHLE GALAT THI ----
#
# Pehle ye `./.next/static` tha. `output: 'standalone'` me Next.js monorepo ka
# path apne server bundle me PRESERVE karta hai - matlab `/app/server.js`
# `apps/superadmin/.next/static` me static dhoondta hai, `/app/.next/static`
# me nahi.
#
# Iska matlab: HTML sahi serve hota hai (usme sahi chunk hash likhe hote hain),
# par wo chunks disk par hote hi nahi. Har `/_next/static/**.js` par server
# 404 page return karta tha - jo browser ke liye JavaScript nahi, balki HTML
# hai. `script` tag parse error throw karta hai, hydration kabhi hoti hi nahi.
#
# Isiliye is app ka POORA client-side behaviour mara hua tha: tracker nahi
# chal raha tha, buttons click nahi ho rahe the. Ye tab pata chala jab click
# ledger check kiya gaya aur superadmin par zero events aaye, jabki baaki chhe
# apps par ek-ek aa rahe the.
#
# Baaki paanch apps ka path sahi hai - har ek `./apps/<name>/.next/static` use
# karta hai. `monitor` ka apna `distDir` (`.next-monitor`) hai, isliye wo
# `./apps/monitor/.next-monitor/static` karta hai - apne distDir ke hisab se,
# jo bhi sahi hai.
COPY --from=builder --chown=nextjs:nodejs /app/apps/superadmin/.next/static ./apps/superadmin/.next/static

USER nextjs
EXPOSE 3008
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3008/ || exit 1
CMD ["node", "apps/superadmin/server.js"]
