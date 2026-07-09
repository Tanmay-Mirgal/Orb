# Orb - AI Deployment Platform

Orb is a headless, developer-focused SaaS platform for deploying web applications. 

## Architecture Overview
The platform consists of four primary components:
1. **Web Dashboard (`apps/web`)**: A Next.js (App Router) interface for managing projects and deployments.
2. **Background Worker (`apps/worker`)**: A headless Node.js BullMQ processor that clones code, builds it in Docker containers, and uploads artifacts to MinIO.
3. **Edge Proxy (`apps/proxy`)**: An Express.js ingress server that intercepts traffic (e.g. `*.orb.dev`), dynamically downloads the required artifact from MinIO, and serves it (either statically or via a dynamically spawned SSR Node process).
4. **Infrastructure Services**: Managed via Docker Compose. Includes PostgreSQL (database), Redis (queueing and log streaming), and MinIO (S3-compatible artifact storage).

## Production Deployment Procedures

### 1. Environment Variables
Ensure the `.env` file in the root is securely configured. Critical keys include:
- `DATABASE_URL`: Connection string for PostgreSQL.
- `REDIS_URL`: Connection string for Redis.
- `MINIO_ACCESS_KEY` & `MINIO_SECRET_KEY`: Storage credentials.
- `ENCRYPTION_KEY`: For encrypting environment variables before storing them in Postgres.

### 2. Infrastructure Setup
Start the base dependencies:
```bash
docker compose up -d
```
Ensure all services are running without restarts. Verify MinIO is accessible and the buckets are created automatically by the storage package.

### 3. Scaling the Worker Nodes
The Background Worker is stateless and interacts solely through BullMQ and the Docker Socket.
To scale build capacity:
1. Run `npx tsx src/index.ts` in `apps/worker` across multiple servers.
2. Ensure each worker has access to the central Redis instance.
3. Ensure Docker is running on the worker hosts (mount `/var/run/docker.sock` if containerized).

### 4. Edge Proxy Configuration
The Edge Proxy should be placed behind an SSL termination layer like NGINX or Cloudflare.
- Run the proxy on port `8000`.
- Configure NGINX to forward all wildcard domains (e.g., `*.orb.dev`) to `http://127.0.0.1:8000`.

### 5. Resiliency & Edge Cases
- **OOM Prevention**: Redis must be configured with `--maxmemory-policy noeviction` (as done in `docker-compose.yml`) to ensure jobs are never silently dropped.
- **Failed Builds**: If a build fails inside the Docker sandbox, the worker marks the deployment as `FAILED`. The proxy will ignore it and continue routing traffic to the last known `SUCCESS` deployment.

## Running Locally (Development)
```bash
# Terminal 1: Web Dashboard
cd apps/web && npm run dev

# Terminal 2: Edge Proxy
cd apps/proxy && npx tsx src/index.ts

# Terminal 3: Background Worker
cd apps/worker && npx tsx src/index.ts
```
