# Step 6: Integration & Finalization

## Goal
Ensure all components communicate correctly and handle edge cases gracefully.

## Action Items
1. **End-to-End Testing:**
   - Trigger a deployment from the Web Dashboard.
   - Ensure the Worker picks it up, logs are streamed via Websockets/Redis to the UI, the artifact is built via Docker, and uploaded to MinIO.
   - Ensure the Proxy successfully resolves a custom domain to the new deployment and serves it (both Static and SSR paths).

2. **Error Handling & Resilience:**
   - Verify that build failures correctly mark the deployment as `failed` and do not override the currently `active` deployment.
   - Ensure the proxy serves a graceful 502/404 page if a deployment doesn't exist or crashes.
   - Test Redis OOM scenario (ensure `--maxmemory-policy noeviction` prevents data loss).

3. **Production Readiness:**
   - Review environment variables.
   - Add centralized logging.
   - Document deployment procedures (e.g., how to scale the worker nodes).
