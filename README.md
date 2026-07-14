<div align="center">

<h1>🔮 Orb — Self-Hosted AI Deployment Platform</h1>

<p>A headless, developer-focused SaaS platform for deploying web applications — think Vercel, but self-hosted and fully open.</p>

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle-ORM-C5F74F?style=flat-square)](https://orm.drizzle.team/)
[![BullMQ](https://img.shields.io/badge/BullMQ-Queue-red?style=flat-square)](https://docs.bullmq.io/)
[![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?style=flat-square&logo=docker)](https://www.docker.com/)
[![MinIO](https://img.shields.io/badge/MinIO-Object%20Storage-C72E49?style=flat-square)](https://min.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?style=flat-square&logo=postgresql)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)](https://redis.io/)

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Environment Variables](#-environment-variables)
- [Local Development](#-local-development)
- [EC2 Production Deployment Guide](#-ec2-production-deployment-guide)
- [Caddy Reverse Proxy](#-caddy-reverse-proxy)
- [GitHub App Setup](#-github-app-setup)
- [Troubleshooting](#-troubleshooting)

---

## 🌟 Overview

**Orb** is a self-hosted web application deployment platform. Connect your GitHub repositories, push your code, and Orb handles the rest — building your app inside a sandboxed Docker container, storing the artifact in MinIO, and routing live traffic through its edge proxy with automatic SSL.

**Key Features:**
- 🚀 **Git-based deployments** via GitHub App integration
- 🏗️ **Sandboxed Docker builds** with configurable memory/CPU limits
- 📦 **Artifact storage** on S3-compatible MinIO
- 🌐 **Dynamic wildcard subdomain routing** with automatic TLS (via Caddy)
- 📊 **Real-time build logs** streamed via Socket.io / Redis pub-sub
- 🔐 **Auth** powered by Better Auth with GitHub OAuth
- ⚙️ **Custom environment variables** per project, encrypted at rest

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet / User                       │
└───────────────┬─────────────────────────┬───────────────────┘
                │                         │
        orb.yourdomain.com       *.yourdomain.com
                │                         │
┌───────────────▼─────────────────────────▼───────────────────┐
│                    Caddy (Reverse Proxy + TLS)                │
│              On-demand TLS via HTTP-01 challenge              │
└───────────────┬─────────────────────────┬───────────────────┘
                │                         │
        localhost:3000             localhost:8000
                │                         │
┌───────────────▼──────────┐  ┌──────────▼──────────────────┐
│   Web Dashboard (Next.js) │  │  Edge Proxy (Express.js)     │
│   apps/web — Port 3000   │  │  apps/proxy — Port 8000      │
│                          │  │                              │
│  - Project Management    │  │  - Resolves domain → slug    │
│  - Deployment Triggers   │  │  - Downloads artifact from   │
│  - Real-time Log Stream  │  │    MinIO on first request    │
│  - GitHub OAuth          │  │  - Serves static or spawns   │
│                          │  │    SSR Node.js process       │
└───────────────┬──────────┘  └──────────────────────────────┘
                │
        BullMQ Job Queue (Redis)
                │
┌───────────────▼──────────────────────────────────────────────┐
│              Background Worker (Node.js / BullMQ)             │
│              apps/worker                                      │
│                                                               │
│  1. Clone repo from GitHub                                    │
│  2. Build inside sandboxed Docker container                   │
│  3. Upload artifact ZIP to MinIO                              │
│  4. Update deployment status in PostgreSQL                    │
└───────────────────────────────────────────────────────────────┘

         Infrastructure (Docker Compose)
         ┌────────────┬───────────┬──────────┐
         │ PostgreSQL │   Redis   │  MinIO   │
         │  Port 5432 │ Port 6379 │Port 9000 │
         └────────────┴───────────┴──────────┘
```

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Web Dashboard** | Next.js 16 (App Router), React 19, TypeScript |
| **Styling** | Tailwind CSS v4 |
| **Auth** | Better Auth + GitHub OAuth |
| **Database ORM** | Drizzle ORM |
| **Database** | PostgreSQL 15 |
| **Queue** | BullMQ (backed by Redis) |
| **Artifact Storage** | MinIO (S3-compatible) |
| **Edge Proxy** | Express.js v5 |
| **Build Runtime** | Docker (sandboxed containers) |
| **Log Streaming** | Redis pub-sub + Socket.io |
| **Reverse Proxy** | Caddy v2 (auto-TLS) |
| **Process Manager** | PM2 |
| **Monorepo** | npm workspaces |

---

## 📁 Project Structure

```
orb/
├── apps/
│   ├── web/           # Next.js dashboard (Port 3000)
│   ├── worker/        # BullMQ build worker
│   └── proxy/         # Edge proxy server (Port 8000)
├── packages/
│   ├── database/      # Drizzle ORM schema + migrations
│   ├── shared/        # Shared types and utilities
│   └── storage/       # MinIO client wrapper
├── docker-compose.yml # PostgreSQL + Redis + MinIO
├── ecosystem.config.js# PM2 process manager config
├── Caddyfile          # Caddy reverse proxy config
└── .env               # Root environment variables (shared)
```

---

## 🔑 Environment Variables

Create a `.env` file in the **root of the project**. All apps load from this single file.

> ⚠️ **Never commit your `.env` to version control.**

```bash
cp .env.example .env
```

### 🗄️ Database

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://orb:password@localhost:5432/orb` |

### 🔐 Authentication (Better Auth)

| Variable | Description | Example |
|---|---|---|
| `BETTER_AUTH_SECRET` | Random secret for signing sessions (min 32 chars) | Run: `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Full public URL of your web dashboard | `https://orb.yourdomain.com` |

### 🔴 Redis

| Variable | Description | Default |
|---|---|---|
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |

### 📦 MinIO (Object Storage)

| Variable | Description | Default |
|---|---|---|
| `MINIO_ENDPOINT` | MinIO hostname | `localhost` |
| `MINIO_PORT` | MinIO API port | `9000` |
| `MINIO_ACCESS_KEY` | MinIO root access key | `admin` |
| `MINIO_SECRET_KEY` | MinIO root secret key | `password123` |
| `MINIO_USE_SSL` | Use HTTPS for MinIO connections | `false` |

### 🐙 GitHub App

| Variable | Description |
|---|---|
| `GITHUB_APP_ID` | Your GitHub App's numeric ID |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key for the GitHub App (multi-line value) |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook secret configured on the GitHub App |
| `GITHUB_APP_INSTALLATION_URL` | URL for users to install the GitHub App on their org/repo |
| `GITHUB_CLIENT_ID` | OAuth App Client ID (for login with GitHub) |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret |

### 🌐 Application URLs

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_SOCKET_URL` | WebSocket server URL for real-time log streaming | `https://orb.yourdomain.com` |
| `NEXT_PUBLIC_APP_URL` | Public URL of the web dashboard | `https://orb.yourdomain.com` |
| `NEXT_PUBLIC_BASE_DOMAIN` | Base domain for deployed project subdomains (client-side) | `orb.yourdomain.com` |
| `BASE_DOMAIN` | Base domain for deployed project subdomains (server-side) | `yourdomain.com` |

### 🔒 Encryption

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting project environment variables at rest. Generate with `openssl rand -hex 32` |

### ⚙️ Worker & Build Resource Limits

| Variable | Description | Default |
|---|---|---|
| `MAX_MEMORY` | Max memory per build container | `768m` |
| `MAX_MEMORY_SWAP` | Max swap memory per build container | `3g` |
| `MAX_CPU` | Max CPU share per build container | `1.0` |
| `BUILD_NODE_OPTIONS` | Node.js options passed during build step | `--max-old-space-size=512` |
| `WORKER_CONCURRENCY` | Number of concurrent build jobs per worker instance | `1` |
| `RUNNER_MEMORY` | Memory limit for SSR runner processes | `384m` |
| `RUNNER_MEMORY_SWAP` | Swap limit for SSR runner processes | `768m` |
| `RUNNER_MAX_INSTANCES` | Max simultaneous SSR runner processes on the proxy | `3` |
| `RUNNER_IDLE_TIMEOUT_MS` | Milliseconds before an idle SSR runner process is killed | `900000` (15 min) |

---

## 💻 Local Development

### Prerequisites

- Node.js >= 20
- Docker Desktop
- npm >= 9

### Setup Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-username/orb.git
cd orb

# 2. Install all dependencies (monorepo workspaces)
npm install

# 3. Copy and configure environment variables
cp .env.example .env
# Edit .env with your values — at minimum set GITHUB_* and auth secrets

# 4. Start infrastructure services (PostgreSQL, Redis, MinIO)
docker compose up -d

# 5. Run database migrations
cd packages/database && node migrate.mjs && cd ../..

# 6. Start each service in separate terminals

# Terminal 1 — Web Dashboard (http://localhost:3000)
cd apps/web && npm run dev

# Terminal 2 — Edge Proxy (http://localhost:8000)
cd apps/proxy && npm run dev

# Terminal 3 — Background Worker
cd apps/worker && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the dashboard.

---

## ☁️ EC2 Production Deployment Guide

This is a complete, step-by-step guide to deploying Orb on an AWS EC2 instance — from a fresh Ubuntu machine to a fully running platform.

### 📋 Recommended EC2 Specs

| Resource | Minimum | Recommended |
|---|---|---|
| **Instance Type** | `t3.medium` (2 vCPU, 4 GB RAM) | `t3.large` (2 vCPU, 8 GB RAM) |
| **Storage** | 30 GB gp3 | 60 GB gp3 |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### 🔒 Security Group — Required Inbound Rules

| Port | Protocol | Source | Purpose |
|---|---|---|---|
| `22` | TCP | Your IP only | SSH access |
| `80` | TCP | `0.0.0.0/0` | HTTP (Let's Encrypt ACME challenge) |
| `443` | TCP | `0.0.0.0/0` | HTTPS (all web traffic through Caddy) |

> ⚠️ **Do NOT expose ports 3000, 5432, 6379, 8000, or 9000 publicly.** All traffic flows through Caddy on 80/443.

---

### Step 1 — SSH Into Your EC2 Instance

```bash
ssh -i your-key.pem ubuntu@<YOUR_EC2_PUBLIC_IP>
```

---

### Step 2 — Update System & Install Core Dependencies

```bash
# Update all packages
sudo apt update && sudo apt upgrade -y

# Install build tools
sudo apt install -y git curl wget unzip build-essential

# Install Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v   # Expected: v20.x.x
npm -v

# Install PM2 globally (process manager)
sudo npm install -g pm2
pm2 --version
```

---

### Step 3 — Install Docker & Docker Compose

```bash
# Install Docker Engine
curl -fsSL https://get.docker.com | sudo sh

# Add ubuntu user to docker group (avoids needing sudo for docker commands)
sudo usermod -aG docker $USER

# Apply group membership without re-login
newgrp docker

# Verify
docker --version
docker compose version
```

---

### Step 4 — Install Caddy (Reverse Proxy + Auto-TLS)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt update && sudo apt install -y caddy

# Verify
caddy version
```

---

### Step 5 — Clone the Repository

```bash
git clone https://github.com/your-username/orb.git
cd orb
```

---

### Step 6 — Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env

# Open it for editing
nano .env
```

Update these critical production values:

```env
# --- Database ---
DATABASE_URL="postgresql://orb:STRONG_DB_PASSWORD@localhost:5432/orb"

# --- Auth ---
# Generate with: openssl rand -hex 32
BETTER_AUTH_SECRET="your_64_char_hex_secret"
BETTER_AUTH_URL="https://orb.yourdomain.com"

# --- Redis ---
REDIS_HOST="localhost"
REDIS_PORT=6379

# --- MinIO ---
MINIO_ENDPOINT="localhost"
MINIO_PORT=9000
MINIO_ACCESS_KEY="admin"
MINIO_SECRET_KEY="STRONG_MINIO_PASSWORD"
MINIO_USE_SSL=false

# --- URLs ---
NEXT_PUBLIC_SOCKET_URL="https://orb.yourdomain.com"
NEXT_PUBLIC_APP_URL="https://orb.yourdomain.com"
BASE_DOMAIN="yourdomain.com"
NEXT_PUBLIC_BASE_DOMAIN="orb.yourdomain.com"

# --- GitHub App ---
GITHUB_APP_ID="your_app_id"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...paste your multi-line PEM key here...
-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET="your_webhook_secret"
GITHUB_APP_INSTALLATION_URL="https://github.com/apps/your-app-name"
GITHUB_CLIENT_ID="your_oauth_client_id"
GITHUB_CLIENT_SECRET="your_oauth_client_secret"

# --- Encryption ---
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY="your_64_char_hex_encryption_key"

# --- Docker also needs the DB password ---
# Update docker-compose.yml or keep these in sync with DATABASE_URL
```

Save and exit (`Ctrl+X` → `Y` → `Enter`).

---

### Step 7 — Start Infrastructure (PostgreSQL, Redis, MinIO)

```bash
# Start all infrastructure containers in the background
docker compose up -d

# Verify all containers are healthy
docker compose ps
# Expected: STATUS = "Up" for postgres, redis, minio

# Wait ~10 seconds then check logs for errors
docker compose logs --tail=20
```

---

### Step 8 — Install Dependencies & Run Database Migrations

```bash
# Install all workspace dependencies
npm install

# Run Drizzle migrations to create all database tables
cd packages/database
node migrate.mjs
cd ../..
```

---

### Step 9 — Build the Next.js Web Dashboard

```bash
cd apps/web
npm run build
cd ../..
```

> This generates an optimized production build in `apps/web/.next/`.

---

### Step 10 — Start All Apps with PM2

```bash
# Start all three services using the PM2 ecosystem config
pm2 start ecosystem.config.js

# Check that all processes show status: online
pm2 status

# Tail combined logs from all processes
pm2 logs

# Tail logs for a specific service
pm2 logs orb-web
pm2 logs orb-worker
pm2 logs orb-proxy
```

---

### Step 11 — Configure & Start Caddy

```bash
# Copy the project Caddyfile to the system location
sudo cp Caddyfile /etc/caddy/Caddyfile

# Edit to use your actual domain
sudo nano /etc/caddy/Caddyfile
```

Your Caddyfile should look like this:

```caddy
{
    email your@email.com
    on_demand_tls {
        ask http://localhost:3000/api/caddy/ask
    }
}

# Main dashboard
orb.yourdomain.com {
    reverse_proxy localhost:3000
}

# Wildcard deployed project subdomains (on-demand TLS)
:443 {
    tls {
        on_demand
    }
    reverse_proxy localhost:8000
}
```

```bash
# Validate config syntax
caddy validate --config /etc/caddy/Caddyfile

# Apply the new config
sudo systemctl reload caddy

# Enable Caddy to start on system boot
sudo systemctl enable caddy

# Check status
sudo systemctl status caddy
```

---

### Step 12 — Enable PM2 Auto-Start on Reboot

```bash
# Generate the startup script for your system
pm2 startup

# IMPORTANT: pm2 will print a command — copy it and run it.
# It will look something like:
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

# After running that command, save the current process list
pm2 save
```

Now if your EC2 instance reboots, Orb will restart automatically.

---

### Step 13 — Configure DNS Records

In your DNS provider (Cloudflare, Route 53, Namecheap, etc.), add:

| Type | Name | Value | Notes |
|---|---|---|---|
| `A` | `orb` | `<EC2_PUBLIC_IP>` | Dashboard subdomain |
| `A` | `*.orb` | `<EC2_PUBLIC_IP>` | Wildcard for deployed projects |

> **If using Cloudflare:** Set records to **DNS Only (grey cloud)** — do NOT enable the orange cloud proxy. Caddy needs to handle TLS directly.

DNS propagation can take anywhere from 1 minute to 1 hour.

---

### Step 14 — Verify Everything is Working

```bash
# Check all PM2 processes are online
pm2 status

# Test that the dashboard responds
curl -I https://orb.yourdomain.com

# Check infrastructure containers
docker compose ps

# Watch live logs from all services
pm2 logs --lines 50
```

Visit **`https://orb.yourdomain.com`** — you should see the Orb login page. 🎊

---

### 🔁 Updating Orb (Future Re-deploys)

```bash
cd orb

# Pull latest code changes
git pull origin main

# Reinstall dependencies (if package.json changed)
npm install

# Re-run migrations (if schema changed)
cd packages/database && node migrate.mjs && cd ../..

# Rebuild the web dashboard
cd apps/web && npm run build && cd ../..

# Reload PM2 with zero downtime
pm2 reload ecosystem.config.js
```

---

## 🔀 Caddy Reverse Proxy

Orb uses **Caddy v2** as its reverse proxy for automatic TLS certificate management.

### How On-Demand TLS Works

When a new request arrives for `myproject.orb.yourdomain.com`:

1. Caddy receives the HTTPS connection on port `443`
2. Since no cert exists yet, Caddy calls `http://localhost:3000/api/caddy/ask?domain=myproject.orb.yourdomain.com`
3. The web dashboard validates whether the domain belongs to an active deployed project
4. If valid, Caddy fetches a certificate from **Let's Encrypt** via HTTP-01 challenge
5. Traffic is then proxied to the Edge Proxy on `localhost:8000`

This gives you **unlimited custom subdomains** with automatic SSL — zero manual certificate management needed.

---

## 🐙 GitHub App Setup

Orb requires two GitHub integrations: a **GitHub App** (for repository access during builds) and a **GitHub OAuth App** (for user login).

### Create a GitHub App

1. Go to **GitHub → Settings → Developer Settings → GitHub Apps → New GitHub App**
2. Fill in:
   - **App Name:** `orb-deployment`
   - **Homepage URL:** `https://orb.yourdomain.com`
   - **Webhook URL:** `https://orb.yourdomain.com/api/github/webhook`
   - **Webhook Secret:** Generate with `openssl rand -hex 20` and save as `GITHUB_APP_WEBHOOK_SECRET`
3. **Repository Permissions:**
   - Contents → **Read**
   - Metadata → **Read**
4. **Subscribe to Events:** `Push`
5. Click **Create GitHub App**
6. Copy the **App ID** → `GITHUB_APP_ID`
7. Scroll down → **Generate a private key** → download the `.pem` file → paste contents into `GITHUB_APP_PRIVATE_KEY`
8. The installation URL is `https://github.com/apps/your-app-name` → `GITHUB_APP_INSTALLATION_URL`

### Create a GitHub OAuth App

1. Go to **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application Name:** `Orb`
   - **Homepage URL:** `https://orb.yourdomain.com`
   - **Authorization callback URL:** `https://orb.yourdomain.com/api/auth/callback/github`
3. Copy the **Client ID** → `GITHUB_CLIENT_ID`
4. Generate a **Client Secret** → `GITHUB_CLIENT_SECRET`

---

## 🛠️ Troubleshooting

### A PM2 process keeps restarting / crashing
```bash
pm2 logs orb-web --lines 100
# Look for: missing environment variables, port already in use, build errors
```

### Database connection refused
```bash
docker compose ps postgres          # Is the container running?
docker compose logs postgres        # Any startup errors?
# Verify DATABASE_URL in .env matches docker-compose.yml credentials
```

### MinIO not accessible / uploads failing
```bash
docker compose logs minio
# Check MINIO_ACCESS_KEY and MINIO_SECRET_KEY match docker-compose.yml environment vars
```

### Caddy not issuing TLS certificates
```bash
sudo journalctl -u caddy -n 50 --no-pager
# Common causes:
# - Port 80 or 443 not open in EC2 Security Group
# - DNS A record not yet propagated to EC2 IP
# - /api/caddy/ask returning non-200 for valid domains
```

### Build jobs stuck in queue / worker not processing
```bash
docker compose ps redis             # Is Redis running?
pm2 logs orb-worker --lines 50     # Any worker errors?
# Check REDIS_HOST and REDIS_PORT in .env
```

### Check the status of all services at once
```bash
pm2 status                           # App processes
docker compose ps                    # Infrastructure containers
sudo systemctl status caddy          # Reverse proxy
```

---

<div align="center">

Built with ❤️ by [Tanmay Mirgal](https://tanmaymirgal.dev)

</div>
