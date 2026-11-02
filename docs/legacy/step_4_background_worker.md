# Step 4: Background Worker

## Goal
Develop the headless Node.js process that polls Redis, clones code, runs sandboxed builds, and uploads artifacts.

## Action Items
1. **Initialize Worker App (`apps/worker`):**
   - Create a Node.js project.
   - Install BullMQ, `@octokit/rest`, `simple-git`, Dockerode (for Docker interactions).

2. **Implement the State Machine (`src/processor.ts`):**
   - **Initialization:** Query DB for project details, create `/tmp/deployments/<id>` workspace, emit Redis logs.
   - **Cloning (`GitService`):** Clone repositories (inject temporary GitHub tokens for private repos).
   - **Framework Detection (`DetectorService`):** Analyze package manager lock files and `package.json` to infer framework and build commands.
   - **Environment Variables:** Decrypt and inject `.env` into the ephemeral workspace.

3. **Docker Sandboxing (`DockerService`):**
   - Generate `.kyro-build.sh`.
   - Spin up a `node:20-alpine` container, mount the workspace, and execute the build script securely.
   - Stream logs to Redis for real-time UI updates.

4. **Artifact Upload & Cleanup (`ArtifactService`):**
   - Zip/stream the built output to MinIO (`deployments/<id>`).
   - Clean up the `/tmp` directory.
   - Mark deployment as `success` and `active` in the DB.

5. **Verify:**
   - Run the worker and verify it successfully picks up a job from Redis, builds a sample React/Next.js app, and stores the artifact in MinIO.
