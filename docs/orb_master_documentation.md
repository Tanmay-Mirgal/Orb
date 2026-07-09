# Orb Platform: The Ultimate Deep-Dive Architecture Guide

Welcome to the definitive, deep-dive architectural guide for the Kyro platform. This document is designed to give you a complete, granular understanding of every single component, service, file, and database table in the Kyro ecosystem. Whether you are debugging a complex deployment issue, scaling the proxy, or onboarding as a new contributor, this document will explain *exactly* how Kyro works under the hood.

---

## 1. Architectural Philosophy & Monorepo Structure

Kyro is built to emulate the developer experience of platforms like Vercel and Netlify. To achieve this, it must do three very different things simultaneously:

1. Provide a snappy, user-friendly dashboard (Web UI).
2. Run heavy, potentially untrusted, resource-intensive background builds (Worker).
3. Handle thousands of concurrent incoming HTTP requests and route them dynamically with minimal latency (Proxy).

To isolate these concerns while sharing types and database schemas, Kyro uses a **Monorepo** architecture powered by npm workspaces.

### Workspace Layout

- `apps/web`: The Next.js dashboard and API.
- `apps/worker`: The BullMQ background job processor.
- `apps/proxy`: The Express.js dynamic reverse proxy.
- `packages/database`: Drizzle ORM schemas and migration scripts.
- `packages/storage`: The MinIO S3 client wrapper.
- `packages/shared`: Shared TypeScript definitions.

By separating the applications, Kyro ensures that a heavy Docker build crashing the worker node will *never* take down the web dashboard or the proxy router. They communicate strictly via PostgreSQL and Redis.

---

## 2. Database Schema Deep Dive (`packages/database`)

The heart of Kyro is its PostgreSQL database, managed by Drizzle ORM. Let's look at every table in `packages/database/src/schema.ts` and its purpose.

### 2.1 Identity and Authentication Tables

Kyro uses Better-Auth to handle GitHub OAuth.

- **`user`**: Stores the developer's core identity (`id`, `name`, `email`, `githubId`, `image`).
- **`session`**: Tracks active login sessions, tracking `ipAddress` and `userAgent` for security.
- **`account`**: Stores the OAuth provider tokens (`accessToken`, `refreshToken`) linking a GitHub identity to a Kyro `user`.
- **`githubAccount`**: Specific to the GitHub App integration. When a user installs the Kyro GitHub App on their repos, GitHub provides an `installationId`. This table stores that `installationId`, which is critically used by the Worker to generate short-lived access tokens to clone private repositories.

### 2.2 Project and Repository Tables

- **`project`**: The core entity. Every app deployed on Kyro is a project.
  - `slug`: The unique identifier (e.g., `my-awesome-app`).
  - `framework`: Detected automatically (e.g., Next.js, Vite) but can be overridden.
  - `buildCommand`, `installCommand`, `startCommand`, `outputDirectory`: Explicit overrides. If null, Kyro auto-detects them.
  - `rootDirectory`: Crucial for monorepo deployments where the app isn't at the root of the git repo.
- **`projectRepository`**: Links a `project` to a GitHub repo.
  - `repositoryName`, `owner`: e.g., `facebook/react`.
  - `cloneUrl`: The HTTP URL used by `simple-git` to clone the code.
  - `defaultBranch`: Usually `main` or `master`. Deployments on this branch automatically become `active`.
  - `isPrivate`: A boolean flag that tells the Worker whether it needs to inject an authentication token into the `cloneUrl`.

### 2.3 Deployment Tracking Table

- **`deployment`**: This is a complex state machine. Every time a build is triggered, a row is inserted here.
  - `status`: Transitions through `queued` -> `initializing` -> `cloning` -> `installing` -> `building` -> `uploading` -> `success` (or `failed`).
  - `commitSha`, `commitMessage`, `commitAuthorName`: Fetched during the `cloning` phase.
  - `metadata`: A JSONB column storing build logs (stdout/stderr) and specific framework metadata.
  - `artifactLocation`: The exact path in MinIO where the zipped or raw built files are stored (e.g., `deployments/<uuid>`).
  - `active`: A boolean. Only ONE deployment per project can be active. The Proxy uses this to route the primary domain.

### 2.4 Infrastructure Tables

- **`domain`**: Tracks custom hostnames (e.g., `www.myapp.com`). Contains fields for DNS verification (`dnsStatus`) and SSL certificate provisioning (`sslStatus`).
- **`environmentVariable`**: Stores the `.env` variables for projects.
  - `encryptedValue`: Kyro uses AES-256-GCM to encrypt the actual values. The database *never* sees plaintext secrets.
  - `environment`: Differentiates between `production` and `preview` variables.

---

## 3. The Web Dashboard (`apps/web`)

The Web Dashboard is built with Next.js 16 (App Router).

### 3.1 Architecture and "Feature-First" Structure

Instead of grouping files by technical type (e.g., all components in one folder, all hooks in another), Kyro groups by **Feature** (`src/features/deployment`, `src/features/projects`, `src/features/domains`). Each feature contains its own:

- `actions.ts`: Next.js Server Actions (the mutation layer).
- `services.ts`: Database query logic.
- `schemas.ts`: Zod validation schemas.
- `components/`: UI specific to that feature.

### 3.2 Triggering a Deployment (The Entry Point)

When a user clicks "Deploy" on the dashboard, the following sequence occurs in `apps/web/src/features/deployment/actions.ts`:

1. The server action validates the user owns the project.
2. It inserts a new `deployment` record into Postgres with `status: "queued"`.
3. It utilizes BullMQ to connect to the Redis instance and adds a job to the `"deployments"` queue, passing `{ deploymentId }` as the payload.
4. The HTTP request terminates, providing a snappy UX, while the background worker takes over asynchronously.

### 3.3 Environment Variable Encryption Flow

When a user inputs a secret (e.g., `DATABASE_URL`):

1. It is sent to the server action.
2. `apps/web/src/features/environment/crypto/encryption.ts` utilizes the Node.js `crypto` module.
3. It uses the `ENCRYPTION_KEY` environment variable to symmetrically encrypt the string using `aes-256-gcm`.
4. It produces a payload in the format `iv:authTag:encryptedData` (all hex encoded) and stores it in Postgres.

---

## 4. The Background Worker (`apps/worker`)

This is the most technically complex piece of Kyro. It is a headless Node.js process that polls Redis using BullMQ.

### 4.1 The `processor.ts` State Machine

The core loop of the worker is in `apps/worker/src/processor.ts`. When it receives a `deploymentId`, it executes a rigid try/catch pipeline:

**Step 1: Initialization**

- Queries the database for the project and repository details.
- Creates an ephemeral workspace directory on the host machine: `/tmp/deployments/<deploymentId>`.
- Emits a "🚀 Initializing deployment workspace..." log to Redis Pub/Sub, which the Next.js frontend listens to via websockets for live logs.

**Step 2: Cloning (`GitService`)**

- The Worker determines if the repo is private by checking the `isPrivate` flag.
- If private, it uses `@octokit/rest` with the user's `installationId` to request an ephemeral, 1-hour GitHub Access Token.
- It injects this token into the `cloneUrl` (e.g., `https://x-access-token:<token>@github.com/user/repo.git`).
- It uses `simple-git` to clone the specific branch into the `/tmp` workspace.

**Step 3: Framework Detection (`DetectorService`)**

- Kyro scans the cloned workspace.
- **Package Manager Detection**: Checks for `yarn.lock` (Yarn), `pnpm-lock.yaml` (pnpm), `bun.lockb` (Bun), or `package-lock.json` (npm).
- **Framework Detection**: Reads `package.json` dependencies. If it sees `next`, it sets the framework to Next.js. If it sees `vite`, it sets it to Vite.
- Based on the framework, it infers the output directory (e.g., `.next` for Next.js, `dist` for Vite/React) and default build commands.

**Step 4: Environment Variable Injection**

- The Worker queries the database for all variables for this project and environment.
- It uses its own copy of the `encryption.ts` utility to decrypt the `iv:authTag:encryptedData` strings back into plaintext using the master `ENCRYPTION_KEY`.
- It dynamically generates a `.env` file directly inside the `/tmp/deployments/<deploymentId>` workspace.

**Step 5: Docker Sandboxing (`DockerService`) - SECURITY CRITICAL**

- The Worker **must not** run user code directly on the host using `execSync('npm run build')`. Doing so would allow a malicious user to add an `rm -rf /` or a script that steals the master `ENCRYPTION_KEY` via a `postinstall` hook.
- Instead, `DockerService` generates a shell script (`.kyro-build.sh`) containing the installation and build commands.
- It spins up a `node:20-alpine` Docker container.
- It mounts the `/tmp/deployments/<deploymentId>` workspace into the container using a Docker Volume bind mount.
- It executes the script *inside* the container, effectively jailing the build process.
- Stdout and Stderr are streamed from the Docker daemon to a local `.log` file and published to Redis for the UI.

**Step 6: Artifact Upload (`ArtifactService`)**

- Once the Docker container successfully exits, the built files now exist in the `/tmp` workspace (e.g., in the `dist` folder).
- The `ArtifactService` walks this directory, computes a checksum to verify integrity, and streams the files to the MinIO object storage bucket (`kyro-deployments/deployments/<deploymentId>`).

**Step 7: Cleanup and Finalization**

- The `/tmp` workspace is aggressively deleted (sometimes requiring `sudo rm -rf` if the Docker container wrote files with root permissions).
- The deployment record is updated to `success`. If the branch was the default branch, the deployment is marked `active=true`, and all older deployments for that project are deactivated.

---

## 5. The Edge Proxy (`apps/proxy`)

The Proxy is an Express.js server that binds to port 80/8000. It is the only component that normal internet users interact with. It uses `http-proxy` for routing.

### 5.1 Host Resolution (`RoutingService`)

When an HTTP request arrives, the Express middleware extracts the `Host` header (e.g., `my-custom-domain.com` or `uuid-hash.kyro.app`).

- If it's a preview URL, it looks up the specific `deploymentId`.
- If it's a custom domain, it queries the `domain` table to find the linked `projectId`, and then finds the single `active=true` deployment for that project.

### 5.2 The Serve Mode Cache (Static vs SSR)

Kyro must know whether to serve files statically or act as a reverse proxy to a running Node server.

- The proxy queries MinIO: "Does `deployments/<deploymentId>/index.html` exist?"
- If YES: The deployment is considered a **Static Site** (SPA).
- If NO (and a `startCommand` exists): The deployment is considered a **Dynamic SSR App**.
  This boolean decision is cached in memory (`serveModeCache`) so MinIO isn't probed on every request.

### 5.3 Static Serving Logic

If the site is static, the Proxy acts as a sophisticated file server.

1. It translates the requested HTTP path (e.g., `/about`) to a MinIO object path (`deployments/<id>/about`).
2. It requests a download stream from MinIO.
3. **SPA Fallback**: If MinIO returns a 404, and the requested path has no file extension (like `/about`), the Proxy intentionally alters the request and fetches `/index.html` instead. This allows client-side routers (like React Router) to take over the URL.
4. **HTML Extension Fallback**: It also tries appending `.html` (e.g., `/about.html`) to support static site generators like Astro or Next.js static exports.
5. It pipes the MinIO stream directly into the `express.Response`, setting `Cache-Control` headers appropriately.

### 5.4 Dynamic SSR Serving (`RunnerService`)

If the site is dynamic (e.g., a standard Next.js app), static serving will fail because there is no root `index.html`.

1. The Proxy asks the `RunnerService` for an available local port.
2. If this deployment isn't already running, `RunnerService` spawns a local Node.js child process (e.g., `node .next/standalone/server.js`) pointing to the downloaded artifact.
3. The Proxy uses `http-proxy` to seamlessly tunnel the incoming HTTP request to `http://127.0.0.1:<dynamic-port>`.
4. If the child process crashes, the `RunnerService` catches the exit code and cleans up the port mapping.

---

## 6. Infrastructure Dependencies (Docker Compose)

The backend infrastructure is orchestrated via `docker-compose.yml`.

### 6.1 PostgreSQL (`postgres:15-alpine`)

- Kyro tunes Postgres for a PaaS workload. It explicitly overrides `shared_buffers` to 64MB and `max_connections` to 30 to keep it lightweight for local development, while adjusting `work_mem` for efficient querying.

### 6.2 Redis (`redis:7-alpine`)

- Configured strictly as a queue backend.
- Critical setting: `--maxmemory-policy noeviction`. If Redis runs out of memory, it will refuse new writes rather than evicting pending deployment jobs. This guarantees that a user's deployment is never randomly dropped.

### 6.3 MinIO (`minio/minio:latest`)

- Acts as a local Amazon S3 clone. It stores the artifacts securely. The Proxy streams from it, and the Worker uploads to it. It exposes a web UI on port 9001 for administrators to inspect stored artifacts.

---

## 7. Summary of the Flow

1. **User (Web)** -> Clicks Deploy -> **Postgres** (creates queued record) & **Redis** (pushes job).
2. **Worker** -> Pulls from Redis -> **Git** (clones) -> **Docker** (builds securely) -> **MinIO** (uploads artifact) -> **Postgres** (marks success).
3. **Visitor** -> Requests Domain -> **Proxy** -> **Postgres** (looks up deployment) -> **MinIO** (streams static) OR **RunnerService** (proxies SSR).

This decoupled architecture allows Kyro to scale horizontally. You can run one Web app, five Worker nodes across different physical servers pulling from the same Redis queue, and ten Proxy nodes behind a load balancer, providing true PaaS scalability.
