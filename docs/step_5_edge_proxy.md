# Step 5: Edge Proxy

## Goal
Create the dynamic routing layer that serves static files from MinIO or proxies requests to running SSR servers.

## Action Items
1. **Initialize Proxy App (`apps/proxy`):**
   - Create an Express.js server binding to port 80/8000.
   - Install `http-proxy`, database client, and storage client.

2. **Host Resolution (`RoutingService`):**
   - Middleware to extract `Host` header.
   - Lookup custom domains or preview URLs in the DB to find the active `deploymentId`.

3. **Static Serving Logic:**
   - Implement logic to check if `index.html` exists in MinIO (Serve Mode Cache).
   - Route static requests directly to MinIO streams.
   - Implement SPA fallback (serve `index.html` on 404) and HTML extension fallback.

4. **Dynamic SSR Serving (`RunnerService`):**
   - If dynamic, allocate a local port.
   - Spawn a Node.js child process using the downloaded artifact.
   - Use `http-proxy` to forward requests to the child process.
   - Handle child process lifecycle and crashes.

5. **Verify:**
   - Send requests to `localhost:8000` with mock `Host` headers and verify it correctly routes to static files or dynamic servers.
