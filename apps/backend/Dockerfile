# HOMIGO backend — production container (Cloud Run / Kubernetes).
# Bun runtime + Prisma. Multi-stage so the runtime image carries only what it needs.
# syntax=docker/dockerfile:1

# ---- deps: install with the frozen lockfile ----
FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- build: generate the Prisma client (needs the schema) ----
FROM oven/bun:1.3-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY prisma ./prisma
RUN bunx prisma generate
COPY src ./src

# ---- runtime: minimal, non-root, reads $PORT (Cloud Run sets it) ----
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
# tsconfig.json carries the `@/*` → `./src/*` path mapping that Bun uses to resolve imports at
# runtime — without it the app crashes with "Cannot find module '@/...'".
COPY --from=build /app/tsconfig.json ./tsconfig.json
# Writable upload dir owned by the non-root user. NOTE: on Cloud Run this filesystem is EPHEMERAL
# (uploads vanish on instance recycle) — production should write uploads to GCS/object storage.
RUN mkdir -p /app/uploads && chown -R bun:bun /app/uploads
# Cloud Run injects PORT (default 8080); the app reads process.env.PORT.
ENV PORT=8080
EXPOSE 8080
USER bun
# Container healthcheck (k8s liveness/Cloud Run startup probe hit /health directly).
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["bun", "run", "src/index.ts"]
