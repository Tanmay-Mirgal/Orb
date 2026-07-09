# Step 1: Initial Setup & Infrastructure

## Goal
Set up the monorepo structure, initialize the workspace, and configure the core infrastructure using Docker Compose.

## Action Items
1. **Initialize Monorepo:**
   - Run `npm init -y` at the root.
   - Configure `package.json` to include npm workspaces for `apps/*` and `packages/*`.
   - Setup TypeScript globally or create a base `tsconfig.json`.

2. **Setup Infrastructure (Docker Compose):**
   - Create a `docker-compose.yml` in the root directory.
   - Define the following services:
     - **PostgreSQL (`postgres:15-alpine`)**: Override `shared_buffers` to 64MB and `max_connections` to 30.
     - **Redis (`redis:7-alpine`)**: Set `--maxmemory-policy noeviction`.
     - **MinIO (`minio/minio:latest`)**: Expose port 9001 for the web UI and configure buckets (`kyro-deployments`).

3. **Verify:**
   - Run `docker-compose up -d` and ensure all containers are running successfully.
