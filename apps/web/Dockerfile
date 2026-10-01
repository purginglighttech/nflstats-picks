# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Production image for the Next.js web app (standalone output).
# CONFIG ONLY — no deploy until Fly.io credentials exist (see README.md).
# ---------------------------------------------------------------------------

FROM node:24-slim AS deps
WORKDIR /app

# Workspaces: copy manifests first for a stable layer.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Contracts must be built before the web app compiles against it.
RUN npm run build --workspace=@pickem/contracts
RUN npm run build --workspace=@pickem/web

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server + static assets.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
