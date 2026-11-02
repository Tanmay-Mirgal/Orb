<div align="center">

# 🔮 Orb

**A multi-tenant deployment platform — Vercel + Render in one self-hosted product.**
Static sites, SSR apps, backend web services, background workers and cron jobs, deployed from Git, with custom domains, automatic TLS, instant rollbacks and a team-ready dashboard.

</div>

---

## Contents

1. [What Orb is](#1-what-orb-is)
2. [Feature matrix (Vercel / Render parity)](#2-feature-matrix-vercel--render-parity)
3. [Architecture](#3-architecture)
4. [Tech stack and why](#4-tech-stack-and-why)
5. [What changed in v2 and why](#5-what-changed-in-v2-and-why)
6. [Repository layout](#6-repository-layout)
7. [Run it locally](#7-run-it-locally)
8. [Deploy Orb to production](#8-deploy-orb-to-production)
9. [Using the platform](#9-using-the-platform)
10. [Scaling guide](#10-scaling-guide)
11. [Security model](#11-security-model)
12. [Operations](#12-operations)
13. [Verification status](#13-verification-status)
14. [Roadmap](#14-roadmap)

---

## 1. What Orb is

Orb lets many customers ("teams") connect GitHub repositories and get **production deployments with zero server management**:

| You push… | Orb builds… | And serves it as… |
|---|---|---|
| a Vite / React / Astro / Docusaurus / plain-HTML repo | in an isolated container | a **Static Site** on object storage + edge proxy |
| a Next.js / Nuxt / Express / Fastify / NestJS / Flask / FastAPI / Go repo, or any repo with a `Dockerfile` | a container image | a **Web Service** (N replicas, health-checked, zero-downtime releases) |
| a queue consumer / bot | a container image | a **Background Worker** (no public port) |
| a script that must run on a schedule | a container image | a **Cron Job** (one-off container per tick) |

Everything a customer needs is built in: environment variables, custom domains with automatic HTTPS, preview deployments, instant rollback, build + runtime logs, analytics, teams with roles, API tokens and an audit log.

---

## 2. Feature matrix (Vercel / Render parity)

✅ implemented in this repo · 🟡 partial · 🛣 roadmap (see [§14](#14-roadmap))

| Capability | Vercel | Render | Orb |
|---|:-:|:-:|:-:|
| Git-driven deploys (push → build → live) | ✓ | ✓ | ✅ GitHub webhook, HMAC-verified, idempotent |
| Static sites on a CDN-friendly edge | ✓ | ✓ | ✅ per-file objects, ETag, Range, immutable caching |
| SSR frameworks (Next.js, Nuxt, …) | ✓ | ✓ | ✅ run as containerised web services |
| Backend web services (Node, Python, Go, Docker) | – | ✓ | ✅ |
| Background workers | – | ✓ | ✅ |
| Cron jobs | – | ✓ | ✅ (BullMQ job schedulers → one-off containers) |
| Dockerfile deploys | – | ✓ | ✅ (root dir + custom path) |
| Framework auto-detection | ✓ | – | ✅ same detector in dashboard and worker |
| Preview deployments per branch | ✓ | ✓ | ✅ immutable URL per deployment |
| Instant rollback / promote | ✓ | ✓ | ✅ pointer flip (static) / re-release (services) |
| Zero-downtime releases | ✓ | ✓ | ✅ new instances must be healthy before traffic moves |
| Health checks, auto-restart, self-healing | – | ✓ | ✅ restart policy + reconciler reschedules lost instances |
| Horizontal scaling (instances) & instance sizes | – | ✓ | ✅ per-plan CPU/RAM limits, anti-affinity placement |
| Environment variables (build / runtime / per environment) | ✓ | ✓ | ✅ AES-256-GCM at rest, sensitive values never readable |
| Custom domains + automatic TLS | ✓ | ✓ | ✅ DNS-TXT ownership proof, on-demand certs, www/apex redirects |
| Wildcard platform subdomains | ✓ | ✓ | ✅ `<project>.<base>` + immutable `<project>-<id>.<base>` |
| Redirects / rewrites / headers config | ✓ | ✓ | ✅ `orb.json` |
| Build logs (live) + runtime logs | ✓ | ✓ | ✅ cursor-polled from Redis, archived to object storage |
| Analytics (requests, bandwidth, latency, errors) | ✓ | – | ✅ edge counters → hourly rollups |
| Teams, roles, audit log | ✓ | ✓ | ✅ owner / admin / member / viewer |
| REST API + personal access tokens | ✓ | ✓ | ✅ `/api/v1/*` |
| Plans & quotas | ✓ | ✓ | ✅ enforced server-side (billing/Stripe: 🛣) |
| Metrics, health probes | ✓ | ✓ | ✅ `/healthz` `/readyz` `/metrics` on every service |
| Global multi-region edge / anycast CDN | ✓ | 🟡 | 🟡 put Cloudflare/any CDN in front; multi-region 🛣 |
| Scale-to-zero, autoscaling, persistent disks, managed DBs | – | ✓ | 🛣 |
| Preview comments, PR status checks | ✓ | 🟡 | 🛣 |

---

## 3. Architecture

```
                         ┌───────────────────────────── Internet ─────────────────────────────┐
                         │  orb.example.com        *.apps.example.com        customer.com      │
                         └───────────┬──────────────────────┬───────────────────────┬──────────┘
                                     ▼                      ▼                       ▼
                         ┌──────────────────────────────────────────────────────────────────────┐
                         │ Caddy  (TLS)   wildcard cert via DNS-01 · on-demand certs for custom  │
                         │ domains, authorised by  GET /api/internal/caddy/ask  (verified only)  │
                         └───────────┬──────────────────────────────────┬───────────────────────┘
                                     ▼                                  ▼
        ┌─────────────────────────────────────┐        ┌─────────────────────────────────────────────┐
        │ web  — Next.js 16 (stateless xN)     │        │ proxy — edge router (stateless xN)           │
        │ dashboard · REST /api/v1 · auth      │        │ host → route cache (LRU, Redis-invalidated)   │
        │ GitHub webhook · internal APIs       │        │ static: manifest + S3 objects (ETag, Range)   │
        └───────┬───────────────┬──────────────┘        │ service: round-robin + passive health + WS    │
                │ enqueue       │ read/write            │ metrics → Redis counters → Postgres           │
                ▼               ▼                       └───────┬───────────────────────┬──────────────┘
        ┌──────────────┐ ┌─────────────┐                        │ static files          │ HTTP(S)
        │ Redis        │ │ PostgreSQL  │◄──── routes ───────────┘                       ▼
        │ BullMQ queues│ │ source of   │                                   ┌──────────────────────────┐
        │ logs, pub/sub│ │ truth       │                                   │ runner nodes (agents)     │
        │ rate limits  │ └──────▲──────┘                                   │ Docker: limits, health,   │
        └──┬────────▲──┘        │                                          │ log shipping, heartbeat   │
           │        │           │                                          │ node A · node B · …       │
           ▼        │           │                                          └────────────▲─────────────┘
   ┌─────────────────┴───────────┴──────────────┐   start/stop/run-once (BullMQ, per node)│
   │ worker (horizontally scalable)              │──────────────────────────────────────┘
   │  build:  clone → detect → docker build      │        ┌─────────────────────────────────┐
   │          → static: upload to S3             │───────►│ Object storage (S3 API)          │
   │          → service: push image              │        │ AWS S3 · R2 · B2 · Spaces · Garage│
   │  release: schedule, health-gate, flip route │        └─────────────────────────────────┘
   │  maintenance: DNS checks, metrics rollups,  │        ┌─────────────────────────────────┐
   │   reconciler, GC, cron                      │───────►│ Container registry (registry:2,  │
   └─────────────────────────────────────────────┘        │ GHCR, ECR, …)                    │
                                                          └─────────────────────────────────┘
```

### Components

| Service | Role | Scales by |
|---|---|---|
| **web** (`apps/web`) | Dashboard, REST API, auth, webhooks, internal endpoints. Holds no state. | more replicas behind a load balancer |
| **proxy** (`apps/proxy`) | Edge router. Resolves `Host` → deployment, serves static files from object storage, reverse-proxies services (incl. WebSockets), records analytics. | more replicas (route caches stay coherent via Redis pub/sub) |
| **worker** (`apps/worker`) | Build pipeline, release scheduler, maintenance jobs. All work arrives through BullMQ, so any number of workers cooperate. | more replicas; per-team concurrency limit gives fair scheduling |
| **runner** (`apps/runner`) | One agent per machine that runs customer containers. Registers itself with a TTL heartbeat in Redis — no database access. | add machines; the scheduler bin-packs onto them |
| **PostgreSQL** | Source of truth (teams, projects, deployments, instances, domains, encrypted env vars, usage). | read replicas / managed Postgres / PgBouncer |
| **Redis** | Job queues, live logs, rate limits, route invalidation, node heartbeats. | managed Redis / replication |
| **Object storage** | Static-site files, archived build logs. | any S3-compatible provider |
| **Caddy** | TLS termination, wildcard + on-demand certificates, HTTP/2/3. | one per public IP / DNS round-robin / cloud LB |

### Request and deployment flows

**Deploy (`git push`)** — GitHub → `POST /api/webhooks/github` (HMAC verified, delivery-id de-duplicated) → deployment row (`QUEUED`, immutable subdomain, frozen config snapshot) → BullMQ `builds` → worker: shallow clone (token passed via git env config, never argv) → detect framework → generate a Dockerfile (or use yours) → `docker build` with secrets mounted through BuildKit `--mount=type=secret` (never `ARG`/`ENV`, so they stay out of image layers) →
- **static:** the exported output directory is uploaded as one object per file + a manifest; the project's production pointer flips; edges are invalidated. `READY`.
- **service/worker/cron:** image is pushed to the registry; a `release` job asks the scheduler to start N instances on runner nodes (CPU/RAM-limited, `cap-drop ALL`, `no-new-privileges`, per-tenant network isolation), waits until every instance passes its health check, **then** flips traffic and drains the previous deployment 20 s later. If anything fails the old deployment keeps serving — no downtime.

**Rollback** — `POST /api/v1/deployments/:id/promote` on an older `READY` deployment: static = pointer flip (instant); services = instances are (re)started and health-gated first, then the pointer flips.

**Custom domain** — add `app.example.com` → Orb returns a TXT record (`_orb-challenge.app.example.com = orb-verification=<token>`) and a CNAME/A record. Ownership is proven via TXT (prevents dangling-CNAME takeovers); the worker re-checks DNS every 5 minutes; the domain is served — and Caddy is allowed to request a certificate — only once verified.

**Self-healing** — the reconciler compares what was scheduled with what each node's heartbeat reports. Missing container or dead node ⇒ instance marked `LOST`, edges invalidated, a release tops the deployment back up on healthy nodes.

---

## 4. Tech stack and why

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere, npm workspaces monorepo | one type system from DB row to React component; shared validators/detectors run in browser and worker |
| Dashboard + API | **Next.js 16** (App Router), React 19, Tailwind 4, Recharts | existing UI investment; route handlers give a typed REST API without another service |
| Auth | **Better Auth** + GitHub OAuth, sessions in Redis *and* Postgres | stateless web tier; a Redis flush cannot log users out |
| Database | **PostgreSQL 17** + **Drizzle ORM** + SQL migrations | relational integrity for tenancy; idempotent migrations upgrade v1 databases in place |
| Queue / coordination | **BullMQ on Redis** | durable jobs, retries, delayed jobs, repeatable schedulers, stalled-job recovery, request/reply to runner nodes |
| Object storage | **S3 API** via AWS SDK v3 (`fs` driver for dev) | **MinIO removed** (community edition is in maintenance mode). Any S3-compatible store works: AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Wasabi, Garage, SeaweedFS |
| Builds | **Docker BuildKit** with generated Dockerfiles | one mechanism for every language; secret mounts; output exported with `--output type=local` (no bind mounts, no root-owned leftovers, works in Docker-outside-of-Docker) |
| Runtime | **Docker** engine on runner nodes (dockerode) | resource limits, restart policy, health gating, network isolation |
| Edge | Node `http` + `http-proxy`, `lru-cache` | tiny hot path; WebSocket support; no framework overhead |
| TLS | **Caddy 2** | automatic HTTPS; wildcard (DNS-01) + on-demand certificates |
| Observability | **pino** JSON logs, **prom-client** `/metrics`, `/healthz`, `/readyz` | drop-in for Prometheus/Grafana/Loki |
| Tests / build | **Vitest**, **tsup**, **PGlite** (in-process Postgres for migration tests) | fast, no external services needed to run the suite |

---

## 5. What changed in v2 and why

v1 was a working MVP; v2 turns it into something you can sell. The biggest gaps closed:

**Product capabilities** — web services / workers / cron (v1: static + one Node process), teams & roles (v1: single user), versioned REST API & tokens, rollbacks, previews, health-gated releases, analytics, audit log, plans.

**Scalability** (v1 ran customer code *inside the proxy process* and cached artifacts in `/tmp`):
- customer code now runs in resource-limited containers on separate runner nodes, scheduled by the worker;
- the edge is stateless and fetches static files from object storage on demand (v1 downloaded + unzipped whole artifacts);
- state moved out of process memory: route invalidation, sessions, rate limits and logs all live in Redis/Postgres;
- queue jobs carry only a deployment id, are idempotent, and per-team build concurrency prevents noisy neighbours.

**Security fixes** (all present in v1):

| v1 problem | v2 fix |
|---|---|
| Customer Node process spawned with the proxy's full `process.env` (DB credentials leaked to tenants) | containers receive only the project's own variables |
| Env vars stored in plaintext although the README said "encrypted" | AES-256-GCM, bound to `projectId:key`, key rotation, `db:encrypt-legacy` for old rows |
| Env values interpolated into a shell script (`export K="V"`) → shell injection | values written to a `0600` file, single-quote escaped, mounted as a BuildKit secret; keys validated |
| `/api/deployments`, logs, domains, env endpoints had no ownership checks (any user ↔ any project) | every route resolves caller → membership → permission; non-members get 404 |
| Caddy `ask` endpoint approved every hostname (certificate-farming / Let's Encrypt rate-limit DoS) | approves only the dashboard, existing project/deployment hosts and **verified** custom domains |
| Custom domains accepted by A/CNAME only; anyone could claim anyone's domain | TXT ownership proof; unverified claims are never served and can be replaced by the real owner |
| GitHub webhook signature optional | mandatory HMAC (constant-time), replay protection by delivery id |
| Build containers: no limits, `chmod 777`, `sudo rm -rf` | BuildKit builds, timeouts, cancel, no sudo, non-root runtime users |
| Unescaped hostname in the 404 page (reflected XSS) | all interpolations HTML-escaped |
| README advertised a webhook URL that did not exist | `/api/webhooks/github` documented below |

**Infrastructure** — multi-target `Dockerfile`, production `docker-compose`, CI (typecheck, tests, builds, image builds), PM2 config, wildcard-TLS Caddyfile, dev compose with an optional S3 profile.

---

## 6. Repository layout

```
apps/
  web/        Next.js dashboard + REST API (/api/v1) + webhooks + internal endpoints
  worker/     BullMQ workers: build pipeline · release scheduler · maintenance jobs
  proxy/      edge router: static serving, reverse proxy, WebSockets, analytics
  runner/     per-machine agent that runs customer containers
packages/
  shared/     isomorphic domain code: enums, plans, validators (zod), framework detection, orb.json engine
  core/       server utilities: config, crypto, Redis/BullMQ, logging, rate-limit, DNS verification, GitHub, ops server
  storage/    ObjectStorage interface: S3 driver + filesystem driver
  database/   Drizzle schema, SQL migrations (+ legacy v1 upgrade), env resolver, domain verifier
deploy/       production compose file, Caddy-with-DNS-plugin image
Dockerfile    multi-target: web | worker | proxy | runner | tools
Caddyfile     TLS edge (dashboard, wildcard, custom domains)
```

---

## 7. Run it locally

Requirements: Node ≥ 22, Docker (for Postgres/Redis and for real builds), ~2 GB free disk for `node_modules`.

```bash
npm install
cp .env.example .env       # fill BETTER_AUTH_SECRET, ENCRYPTION_KEY, INTERNAL_API_TOKEN (openssl rand -hex 32),
                           # GITHUB_CLIENT_ID/SECRET (OAuth app, callback http://localhost:3000/api/auth/callback/github)
docker compose up -d       # Postgres 17 + Redis 7  (optional: --profile registry / --profile s3)
npm run db:migrate
npm run dev                # web :3000 · worker · proxy :8000 · runner  (all with live reload)
```

With `BASE_DOMAIN=localhost`, a project `blog` is served at `http://blog.localhost:8000` (browsers resolve `*.localhost` to 127.0.0.1).
Storage defaults to the `fs` driver (`./.orb-data`). To use S3 locally: `docker compose --profile s3 up -d` and set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=http://localhost:8333`, `S3_BUCKET=orb`, `S3_FORCE_PATH_STYLE=true`.

Useful scripts: `npm run typecheck` · `npm test` · `npm run build` · `npm run db:generate` (after editing `packages/database/src/schema.ts`).

---

## 8. Deploy Orb to production

> **AWS EC2 par step-by-step (har command ke saath):** [docs/DEPLOY_AWS_EC2.md](docs/DEPLOY_AWS_EC2.md)

### 8.1 What you need

| Item | Notes |
|---|---|
| A domain | e.g. `example.com`. Choose `DASHBOARD_HOST=orb.example.com` and `BASE_DOMAIN=orb.example.com` (apps at `<slug>.orb.example.com`) |
| DNS | `A orb.example.com → <server>` and `A *.orb.example.com → <server>` (wildcard also covers `cname.orb.example.com`, the CNAME target for customers) |
| Wildcard TLS | Caddy needs your DNS provider's plugin for DNS-01 (`deploy/caddy/Dockerfile` builds Cloudflare; swap the module for yours) and an API token in `CLOUDFLARE_API_TOKEN` |
| GitHub OAuth app | callback `https://orb.example.com/api/auth/callback/github` |
| GitHub App *(webhooks)* | webhook URL `https://orb.example.com/api/webhooks/github`, secret → `GITHUB_APP_WEBHOOK_SECRET`, subscribe to **Push** |
| Object storage | for anything beyond one machine: an S3-compatible bucket (`STORAGE_DRIVER=s3`) |
| Registry | for more than one runner node: `REGISTRY_URL` (+ credentials) |

### 8.2 Single host with Docker Compose

```bash
cp .env.example .env     # set BASE_DOMAIN, DASHBOARD_HOST, secrets, GitHub, ACME_EMAIL, POSTGRES_PASSWORD, ...
docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build
```

This starts Postgres, Redis, a registry, runs migrations, then web, proxy, worker, runner and Caddy.
Firewall: expose only 80/443 (and 22 from your IP). The runner publishes container ports on the `docker0` address, not on the internet.

### 8.3 VM with PM2 (the v1 EC2 layout)

```bash
npm ci && npm run build && npm run db:migrate
pm2 startOrReload ecosystem.config.js --update-env && pm2 save
sudo cp Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy     # needs the DNS-plugin Caddy build
```
`.github/workflows/deploy.yml` automates exactly this over SSH; `.github/workflows/ci.yml` gates it.

### 8.4 Upgrading from v1

1. Back up Postgres. 2. Pull v2, `npm ci`, **`npm run db:migrate`** — detects the v1 schema, baselines it and upgrades in place: every user with projects gets a personal team, old projects join it, `SUCCESS`→`READY`, already-active domains are grandfathered as verified, duplicate env vars are collapsed.
3. Set the new variables (`INTERNAL_API_TOKEN`, `STORAGE_DRIVER`/`S3_*`, `REGISTRY_URL` if multi-node, `GITHUB_APP_WEBHOOK_SECRET` is now mandatory).
4. **`npm run db:encrypt-legacy`** to encrypt existing plaintext env vars.
5. v1 deployments live as zip files in MinIO and are **not served by v2** — click *Deploy* once per project. (MinIO can be shut down afterwards.)

---

## 9. Using the platform

**Create a project** → pick the repo → Orb detects framework, commands, port; adjust and deploy. Settings live under *Project → Settings*; changes apply to the next deployment (deployments are immutable and keep a snapshot of the settings they were built with).

**Supported out of the box** — Next.js, Nuxt, Remix/React Router, Astro (static + SSR), SvelteKit, Gatsby, Docusaurus, Eleventy, CRA, Vue CLI, Angular, Vite, Express, Fastify, Koa, Hono, Hapi, NestJS, generic Node, Flask, FastAPI, Django (set the start command), Go, plain HTML, and **anything with a Dockerfile**. npm / yarn / pnpm are detected from the lockfile; Node version from `.nvmrc` / `engines`.

**Environment variables** — scope: *build*, *runtime* or *both*; target: *all*, *production* or *preview* (a specific target overrides `all`). "Sensitive" values can be replaced but never read back; build logs mask them. Paste a whole `.env` file to import. Changes apply on the next deployment.

**`orb.json`** (static sites, repo root or root directory):

```json
{
  "cleanUrls": true,
  "spa": true,
  "redirects": [{ "source": "/old/:slug", "destination": "/blog/:slug", "permanent": true }],
  "rewrites":  [{ "source": "/docs/*", "destination": "/guides/:splat" }],
  "headers":   [{ "source": "/*", "headers": [{ "key": "X-Frame-Options", "value": "DENY" }] }]
}
```

**Previews** — enable *Preview deployments* and push any other branch: you get an immutable `<project>-<id>.<base-domain>` URL per deployment (plan permitting).

**Services must** listen on `0.0.0.0:$PORT`, answer the health-check path (default `/`; any non-5xx counts for `/`, an explicit path must return < 400), and log to stdout/stderr — logs appear under *Runtime Logs*.

**REST API** — create a token in *Settings → API tokens*, then:

```bash
curl -H "Authorization: Bearer orb_…" -H "X-Orb-Org: <team-id>" https://orb.example.com/api/v1/projects
curl -X POST -H "Authorization: Bearer orb_…" https://orb.example.com/api/v1/projects/<id>/deployments -d '{}'
```

| Endpoint | |
|---|---|
| `GET/POST /api/v1/projects` · `GET/PATCH/DELETE /api/v1/projects/:id` | projects |
| `GET/POST /api/v1/projects/:id/deployments` | list / trigger |
| `POST /api/v1/deployments/:id/{cancel,promote,redeploy}` · `GET …/logs?from=N` | lifecycle & build logs |
| `GET/PUT /api/v1/projects/:id/env` · `DELETE …/env/:envId` | environment variables (`PUT` accepts `{dotenv:"…"}`) |
| `GET/POST /api/v1/projects/:id/domains` · `PATCH/DELETE …/:domain` · `POST …/:domain/verify` | custom domains |
| `GET /api/v1/projects/:id/{analytics,runtime-logs}` | metrics & live logs |
| `GET/POST /api/v1/orgs` · `…/:orgId/{members,audit-logs}` | teams |
| `GET/POST/DELETE /api/v1/tokens` · `GET /api/v1/me` · `GET /api/v1/github/{repos,branches,detect}` | account |
| `GET /api/health` | readiness (Postgres + Redis) |

Roles: **viewer** (read) · **member** (deploy, env) · **admin** (+ domains, promote/rollback, members, delete) · **owner** (+ delete team). Errors are `{ "error", "code" }` JSON; rate limits return `429` + `Retry-After`.

---

## 10. Scaling guide

| Bottleneck | What to do |
|---|---|
| Dashboard/API load | run more `web` replicas (stateless); put a load balancer in front |
| Request volume | more `proxy` replicas; put a CDN (Cloudflare, Fastly) in front of static traffic — responses carry correct `Cache-Control`/`ETag` |
| Build queue depth | more `worker` replicas and/or higher `WORKER_CONCURRENCY`; plan limits keep one team from starving others. Put workers on **dedicated build machines** (see Security) |
| Not enough capacity for services | add machines running the `runner` agent (`NODE_ID`, `RUNNER_ADDRESS`, `RUNNER_BIND_IP` = private IP, shared Redis, `CONTROL_PLANE_URL`, `INTERNAL_API_TOKEN`, `REGISTRY_URL`); the scheduler places replicas by free CPU/RAM with anti-affinity |
| Postgres connections | `DATABASE_POOL_MAX` per process; PgBouncer (`DATABASE_PREPARE=false` for transaction pooling); managed Postgres with replicas |
| Storage | any S3-compatible service scales independently; static sites are cached in the edge (64 MB LRU, configurable) |
| Region/latency | run an edge + runner set per region behind geo-DNS or a CDN (control plane stays central) — multi-region scheduling is on the roadmap |

Stateless by design: nothing a replica holds in memory is authoritative (route caches are invalidated through Redis pub/sub within milliseconds).

---

## 11. Security model

- **Tenancy:** every API call is authenticated (session cookie or token), mapped to team membership, and checked against a role→permission matrix. Cross-tenant ids return `404`.
- **Secrets:** env vars encrypted at rest; internal runner API protected by `INTERNAL_API_TOKEN`; runners have no database access; API tokens stored as SHA-256 hashes and shown once; GitHub private key only in the worker/web environment.
- **Builds:** user commands never enter Dockerfile text (they run from shell scripts); build secrets use BuildKit secret mounts; builds are time-boxed and cancelable; git credentials never touch argv or `.git/config`; repo/branch/path inputs are validated and re-validated in the worker.
- **Runtime:** containers run non-root, `cap-drop ALL`, `no-new-privileges`, memory/CPU/PID limits, no swap, inter-container communication disabled on the shared network.
- **Edge:** per-IP rate limiting, header sanitisation (`x-orb-*` stripped), escaped error pages, path-traversal rejection, API rate limits per team plan.

**Hardening checklist for a public, multi-tenant launch** (not automated here):
1. The worker and runner mount `/var/run/docker.sock` — that is root on the host. Run **builds and customer containers on machines that hold no other secrets**, ideally behind a rootless/sandboxed runtime (gVisor, Kata, Firecracker) and separate from Postgres/Redis.
2. Block container egress to private ranges and the cloud metadata endpoint (`169.254.169.254`) with a `DOCKER-USER` iptables rule.
3. Keep Redis/Postgres on a private network with passwords/TLS; never expose the `*_OPS_PORT` ports (`/metrics`) publicly.
4. Consider storing GitHub tokens with Better Auth's `encryptOAuthTokens` and moving private-repo access fully to the GitHub App (`project_repositories.installation_id` is wired in the worker).
5. Add abuse controls appropriate to your audience (email verification, payment before paid plans, takedown process).

---

## 12. Operations

| Need | How |
|---|---|
| Health | web `GET /api/health` · proxy `GET /__orb/health` · every service `GET :<OPS_PORT>/readyz` |
| Metrics | `GET :<OPS_PORT>/metrics` (Prometheus) — worker 9101, proxy 9100, runner 9102 |
| Logs | structured JSON (pino) on stdout, `LOG_LEVEL` |
| Migrations | `npm run db:migrate` (idempotent, safe to run on every deploy); new migration: edit `schema.ts` → `npm run db:generate` |
| Key rotation | set the new `ENCRYPTION_KEY`, move the old one to `ENCRYPTION_KEY_PREVIOUS`; old rows keep decrypting, new writes use the new key |
| Draining a runner | stop the agent; containers keep running (restart policy); stale heartbeats cause the reconciler to reschedule if the machine is really gone |
| Retention | per-plan: older deployments' artifacts are garbage-collected hourly and marked `ARCHIVED` (rollback targets are the newest N) |

---

## 13. Verification status

Checked in this repository's development environment:

- ✅ TypeScript strict typecheck passes in all 8 workspaces; `next build` (Next 16.2.10) succeeds; the three services bundle with tsup and start (failing only on missing Redis/config, as expected).
- ✅ 28 automated tests: crypto round-trip/rotation/AAD, webhook signatures, GitHub App JWT, framework detection, `orb.json` engine, `.env` parsing, shell quoting, secret redaction, Dockerfile generation (injection-safety, secret mounts, non-root), the static edge handler end-to-end over HTTP (redirects, rewrites, headers, clean URLs, 404 page, traversal, ETag/304, immutable caching), and the **database migrations on a fresh database and on a v1 database with data (idempotent re-run)** using in-process Postgres.

**Not yet exercised end-to-end** (no Docker daemon, Redis or Postgres server was available where this was written): real `docker build`s of the generated Dockerfiles, runner container lifecycle/health gating, the BullMQ request/reply path between worker and runner, the S3 driver against a live provider, Caddy configuration, and GitHub OAuth/webhook flows. The code paths are implemented and type-checked, but run a staging deployment and a few sample repos (one static, one Next.js, one Dockerfile) before taking customers.

---

## 14. Roadmap

Not implemented yet (the architecture leaves room for each): Stripe billing & metering · e-mail invitations and notifications · GitHub App install flow UI & PR comments/status checks · scale-to-zero and autoscaling · persistent disks, managed Postgres/Redis, private networking between services · wildcard/transfer of custom domains · image/artifact garbage collection on registries and runner disks · per-node runner tokens · multi-region edge/runners · build cache sharing between workers · Dockerfile-less Rust/Java/PHP/Ruby support (they work today via Dockerfile) · CLI.

---

<div align="center">

Built by [Tanmay Mirgal](https://tanmaymirgal.dev)

</div>
