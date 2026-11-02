# syntax=docker/dockerfile:1.7
#
# One multi-target Dockerfile for every Orb service. Build from the repository root:
#   docker build --target web    -t orb-web .
#   docker build --target worker -t orb-worker .
#   docker build --target proxy  -t orb-proxy .
#   docker build --target runner -t orb-runner .
#   docker build --target tools  -t orb-tools .     # migrations + one-off scripts

ARG NODE_VERSION=22

# ── dependency layer (cached until a package.json or the lockfile changes) ───────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/proxy/package.json apps/proxy/
COPY apps/runner/package.json apps/runner/
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS source
COPY . .

# ── tools: run migrations / maintenance scripts with the full workspace ──────────────────────────────
FROM source AS tools
ENV NODE_ENV=production
CMD ["npm", "run", "db:migrate"]

# ── web (Next.js standalone server) ──────────────────────────────────────────────────────────────────
FROM source AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_BASE_DOMAIN
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL NEXT_PUBLIC_BASE_DOMAIN=$NEXT_PUBLIC_BASE_DOMAIN
# Placeholders only so `next build` can import server modules; real values come from the runtime environment.
RUN DATABASE_URL=postgresql://build:build@localhost/build ENCRYPTION_KEY=build BETTER_AUTH_SECRET=build npm run build -w web

FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ── backend services: bundle with tsup, install only production dependencies ─────────────────────────
FROM source AS worker-build
RUN npm run build -w worker
FROM source AS proxy-build
RUN npm run build -w proxy
FROM source AS runner-build
RUN npm run build -w runner

FROM deps AS worker-deps
RUN npm ci --omit=dev -w worker
FROM deps AS proxy-deps
RUN npm ci --omit=dev -w proxy
FROM deps AS runner-deps
RUN npm ci --omit=dev -w runner

# The worker drives `docker build` through the host's Docker socket and clones with git.
FROM node:${NODE_VERSION}-bookworm-slim AS worker
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:latest /buildx /usr/libexec/docker/cli-plugins/docker-buildx
WORKDIR /app
COPY --from=worker-deps /repo/node_modules ./node_modules
COPY --from=worker-build /repo/apps/worker/dist ./dist
EXPOSE 9101
CMD ["node", "dist/index.js"]

FROM node:${NODE_VERSION}-bookworm-slim AS proxy
ENV NODE_ENV=production
WORKDIR /app
COPY --from=proxy-deps /repo/node_modules ./node_modules
COPY --from=proxy-build /repo/apps/proxy/dist ./dist
USER node
EXPOSE 8000 9100
HEALTHCHECK --interval=15s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8000/__orb/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

# The runner talks to the Docker daemon over its socket (it must be able to start containers).
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runner-deps /repo/node_modules ./node_modules
COPY --from=runner-build /repo/apps/runner/dist ./dist
EXPOSE 9102
CMD ["node", "dist/index.js"]
