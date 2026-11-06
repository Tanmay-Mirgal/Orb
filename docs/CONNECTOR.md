# Orb ecosystem connector (CP1)

Orb implements **Connector Protocol v1 (CP1)**: the contract a central platform (the *Hub*) uses to create projects, trigger / cancel / promote deployments, manage environment variables and domains, read logs and analytics, and receive deployment events. Orb is the **Ship** stage of the ecosystem: once a team has designed and coded an app, the Hub creates the Orb project from its GitHub repository, sets env vars, deploys, and reacts to the result.

* Off by default. With `CONNECTOR_ENABLED` not `true`, every `/api/connect/v1/*` route, `/.well-known/ecosystem-connector.json` and `/connect/authorize` answer **404**, the UI entries are hidden, no outbox row is written and no worker job runs.
* Everything lives under `/api/connect/v1`, plus the discovery document and the consent page.
* The manifest, the request validation and the OpenAPI document are generated from **one registry** (`packages/shared/src/connector`), so they cannot drift apart.

```
GET /.well-known/ecosystem-connector.json     discovery (same as /api/connect/v1/manifest, cacheable 5 min)
GET /api/connect/v1/openapi.json              OpenAPI 3.1
GET /api/connect/v1/health                    { status, version, time }
GET /connect/authorize                        consent page (user facing)
```

## 1. Enabling it

1. Generate secrets (`openssl rand -hex 32` each) and set, in the server `.env` (see `.env.example`):

   | Variable | Meaning |
   |---|---|
   | `CONNECTOR_ENABLED` | `true` |
   | `CONNECTOR_HUB_NAME` | shown on the consent page and in "via …" tags |
   | `CONNECTOR_HUB_CLIENT_ID` / `CONNECTOR_HUB_CLIENT_SECRET` | the Hub is one pre-registered confidential OAuth client (secret ≥ 32 chars) |
   | `CONNECTOR_HUB_REDIRECT_URIS` | comma separated, **exact match**; https only (`http://localhost:*` is accepted outside production) |
   | `CONNECTOR_TOKEN_PEPPER` | tokens are stored as `HMAC-SHA256(pepper, token)`. Changing it logs every app out |
   | `CONNECTOR_ENCRYPTION_KEY` (+ `_PREVIOUS`) | AES-256-GCM key for webhook signing secrets; must differ from the pepper |
   | `CONNECTOR_DOCS_URL` | optional link in the manifest |
   | `CONNECTOR_ALLOW_PRIVATE_WEBHOOKS` | **development only**: allow `http` / localhost webhooks. Ignored in production |

   Web and worker validate these at boot and refuse to start with a clear message when something is missing.
2. Run the migration (`npm run db:migrate`, adds `0005_connector`).
3. Restart **web and worker**. The worker starts the webhook dispatcher (`orb-connector-webhooks` queue, every 5 s) and the hourly retention job only when the flag is on.
4. Give the Hub `…/.well-known/ecosystem-connector.json` and the client id/secret.

Rolling back: set `CONNECTOR_ENABLED=false` and restart. Data stays in its tables, nothing else changes.

## 2. Authentication: OAuth 2.0 authorization code + PKCE

```
GET  /connect/authorize?response_type=code&client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256
POST /api/connect/v1/oauth/token      (form or JSON; client auth: HTTP Basic or client_id/client_secret in the body)
POST /api/connect/v1/oauth/revoke     (RFC 7009: always 200)
```

* PKCE (`S256`) and `state` are mandatory. An unknown client or a `redirect_uri` that is not an exact match renders an error page and is **never redirected to**; other errors go back to the client as `?error=…&state=…`.
* The user signs in with Orb's normal login, then sees the consent page: what is requested in plain language, and a **team picker** that only offers teams where their role allows at least one requested scope. A grant is pinned to exactly one team and receives only the scopes that role allows (a viewer is never granted a write scope).
* Authorization codes are single use, 60 s, bound to client, user, team, scopes, redirect URI and challenge. A second use revokes the tokens issued from the first.
* Tokens are opaque: access `cp1_orb_…` (1 h), refresh `cp1r_orb_…` (90 d, **rotating**: every refresh returns a new refresh token; presenting an already rotated one revokes the whole grant, so serialize refreshes).
* The token endpoint and revoke endpoint answer RFC 6749 errors (`{ "error": "invalid_grant", "error_description": "…" }`), everything else uses the CP1 error shape.

```bash
VERIFIER=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
# open in the browser: https://orb.example.com/connect/authorize?response_type=code&client_id=hub&redirect_uri=https%3A%2F%2Fhub.example.com%2Fcb&scope=orb%3Aprojects%3Aread%20orb%3Aprojects%3Awrite&state=xyz&code_challenge=$CHALLENGE&code_challenge_method=S256

curl -s -u "hub:$CLIENT_SECRET" https://orb.example.com/api/connect/v1/oauth/token \
  -d grant_type=authorization_code -d code=$CODE -d redirect_uri=https://hub.example.com/cb -d code_verifier=$VERIFIER
# → { "token_type":"Bearer", "access_token":"cp1_orb_…", "expires_in":3600, "refresh_token":"cp1r_orb_…",
#     "scope":"orb:projects:read orb:projects:write", "tenant":{"id":"…","name":"Acme","kind":"organization"}, "user":{…} }

curl -s -u "hub:$CLIENT_SECRET" https://orb.example.com/api/connect/v1/oauth/token -d grant_type=refresh_token -d refresh_token=$REFRESH
curl -s https://orb.example.com/api/connect/v1/oauth/revoke -d token=$ACCESS
```

Every request re-evaluates the acting user's **current** role in the pinned team: a downgrade, a removal from the team or a revocation takes effect on the very next call. A connector token can never mint tokens, grants or API keys, and sending `X-Orb-Org` / `?orgId=` for another team is `403 forbidden`.

### Scopes

| Scope | Needs this Orb role (and permission) |
|---|---|
| `orb:orgs:read`, `orb:projects:read`, `orb:deployments:read`, `orb:domains:read`, `orb:logs:read`, `orb:analytics:read`, `orb:events:read` | viewer (`org:read` / `project:read`) |
| `orb:github:read` | member (`project:create`): lists the connecting user's own repositories |
| `orb:projects:write`, `orb:deployments:write`, `orb:env:write` | member |
| `orb:webhooks:manage` | member (`token:manage`); always comes with `orb:events:read` |
| `orb:domains:write` | admin (`domain:manage`) |

`deployments.promote` additionally needs the **admin** role, exactly like the dashboard. Project deletion is intentionally not part of v1. Values of sensitive environment variables are never returned.

## 3. Conventions

* JSON in and out (`application/json; charset=utf-8`), no CORS headers (server to server). Ids are strings, timestamps ISO-8601 UTC. Every entity has `id` and `webUrl` (deep link into Orb) and, where it applies, `createdAt`, `updatedAt`, `metadata` (≤ 2 KB) and `externalRef`.
* **Errors** are always `{ "error": { "code", "message", "details"?, "retryable", "requestId", …extra } }`:
  `unauthorized` 401 · `insufficient_scope` 403 (+`requiredScope`) · `forbidden` 403 · `not_found` 404 · `validation_failed` 400/413 (+`details[{path,message}]`) · `conflict` 409 · `idempotency_conflict` 422 · `plan_limit` 402 (+`limit`, `kind`) · `precondition_failed` 412 (+`reason`, `fixUrl`) · `rate_limited` 429 (+`Retry-After`) · `upstream_failed` 502 · `unavailable` 503 · `internal` 500. `retryable` is true only for 429/502/503/5xx.
  Missing GitHub link: `412 precondition_failed` with `reason: "github_not_connected"` and a `fixUrl`.
* **Request ids**: send `X-Request-Id` (≤ 128 chars of `[A-Za-z0-9._:-]`) or one is generated; it is echoed in the response header and the error body, and recorded in the audit log.
* **Pagination**: `?limit=` (default 50, max 200) and `?cursor=`; responses are `{ "items": [], "nextCursor": "…"|null }`. Cursors are opaque and stable under concurrent inserts.
* **Idempotency**: every `POST /actions/{name}` accepts `Idempotency-Key` (≤ 128 chars). Same key + same request replays the stored response with `Idempotent-Replay: true` (24 h); same key + different request is `422 idempotency_conflict`; a concurrent duplicate is `409 conflict` with `Retry-After: 1`. Failed requests do not keep the key, so they can be retried once fixed. Keys are per grant.
* **Rate limits**: 120 requests/min per grant (`X-RateLimit-Limit/Remaining/Reset`, `429` + `Retry-After`), shared through Redis, plus the team's plan limit (`apiRatePerMinute`).
* **Unknown fields** in a body or query are rejected (`400`) unless the caller sends `Prefer: unknown-fields=ignore`.
* Bodies are limited to 1 MiB (`413`).

## 4. Resources (GET)

All take `Authorization: Bearer cp1_orb_…`. The manifest lists the exact scope, query schema and output schema of each.

| Resource | Path | Scope |
|---|---|---|
| `orgs.list` | `/orgs` (the pinned team, the user's role, plan summary) | `orb:orgs:read` |
| `projects.list` | `/projects?type=&query=` | `orb:projects:read` |
| `projects.get` | `/projects/{id}` | `orb:projects:read` |
| `projects.deployments` | `/projects/{id}/deployments?environment=&status=` | `orb:deployments:read` |
| `deployments.get` | `/deployments/{id}` (status, branch, commit, environment, url, `buildDurationMs`, error, `externalRef`) | `orb:deployments:read` |
| `deployments.logs` | `/deployments/{id}/logs?cursor=` → `{ items:[{index,text}], nextCursor, done, status }` | `orb:logs:read` |
| `projects.runtimeLogs` | `/projects/{id}/runtime-logs?cursor=` | `orb:logs:read` |
| `projects.analytics` | `/projects/{id}/analytics?range=24h\|7d\|30d` | `orb:analytics:read` |
| `projects.domains` | `/projects/{id}/domains` (with the DNS records to create) | `orb:domains:read` |
| `projects.env` | `/projects/{id}/env` (key, scope, target, `sensitive`; value only if not sensitive) | `orb:projects:read` |
| `github.repos` / `github.branches` | `/github/repos`, `/github/branches?repo=owner/name` | `orb:github:read` |
| `usage.get` | `/usage` (plan quotas against usage) | `orb:orgs:read` |

`GET /me` (any valid token) returns `{ user, tenant, scopes, grantId, plan:{id,name,expiresAt,limits,usage}, capabilities:{ githubConnected, githubLogin, githubAppInstallUrl, plan, role } }`. `scopes` are the effective scopes (grant ∩ the user's current role).

Ids of another team answer **404 `not_found`**, never 403, so ids cannot be probed; tenant isolation is enforced in the data-access layer.

## 5. Actions (`POST /actions/{name}`)

Body `{ "input": { … } }`. Synchronous actions answer `200 { "output": { … } }`; the one asynchronous action answers `202 { "operation": { "id", "status": "pending", "pollUrl" } }`. Inputs are strict zod schemas published as JSON Schema 2020-12 in the manifest.

```bash
H='-H "Authorization: Bearer cp1_orb_…" -H "Content-Type: application/json"'
A=https://orb.example.com/api/connect/v1/actions

# Framework detection (same detector the build worker uses)
curl $H $A/projects.detectFramework -d '{"input":{"repository":{"fullName":"acme/site","branch":"main"}}}'

# Create a project (+ first deployment). deploy needs orb:deployments:write.
curl $H -H "Idempotency-Key: run_42-create" $A/projects.create -d '{"input":{
  "name":"Storefront","type":"static","repository":{"fullName":"acme/site"},
  "envVars":[{"key":"API_URL","value":"https://api.acme.test","sensitive":false}],
  "metadata":{"source":"hub"},"externalRef":{"hubProjectId":"prj_1","hubRunId":"run_42","hubStepId":"ship"}}}'
# → output: { project, repository, deployment|null, autoDeploy, warnings:[{code,message,fixUrl?}], pushToDeployHint }

curl $H $A/projects.update       -d '{"input":{"projectId":"…","name":"Storefront v2","branch":"main","previewDeployments":true}}'
curl $H $A/deployments.trigger   -d '{"input":{"projectId":"…","branch":"dev","externalRef":{"hubRunId":"run_43"}}}'
curl $H $A/deployments.cancel    -d '{"input":{"deploymentId":"…"}}'
curl $H $A/deployments.redeploy  -d '{"input":{"deploymentId":"…"}}'
curl $H $A/deployments.promote   -d '{"input":{"deploymentId":"…"}}'          # admin; an older deployment = instant rollback
curl $H $A/env.set               -d '{"input":{"projectId":"…","vars":[{"key":"DB_URL","value":"postgres://…","scope":"runtime","target":"production","sensitive":true}]}}'
curl $H $A/env.set               -d '{"input":{"projectId":"…","dotenv":"A=1\nB=2\n"}}'
curl $H $A/env.remove            -d '{"input":{"projectId":"…","key":"DB_URL","target":"production"}}'
curl $H $A/domains.add           -d '{"input":{"projectId":"…","domain":"www.example.com"}}'   # returns the DNS records
curl $H $A/domains.verify        -d '{"input":{"projectId":"…","domain":"www.example.com"}}'
curl $H $A/domains.remove        -d '{"input":{"projectId":"…","domain":"www.example.com"}}'
```

Notes on `projects.create`:

* `autoDeploy` tells whether **push-to-deploy is active**: pushes only reach Orb for repositories the Orb GitHub App is installed on. When it is not, `warnings` contains `github_app_not_installed` with a `fixUrl` (`…/installations/new`).
* The connecting user needs their own GitHub link in Orb; without it the answer is `412 precondition_failed` (`reason: "github_not_connected"`, `fixUrl`).
* A repository that is empty or has no detectable framework (and no explicit commands) is created **without** a first deployment and says so in `warnings` (`no_detectable_framework`); the first push builds it.
* Deployments created through the connector are recorded as trigger `api` and carry `createdVia: "connector"`; a deployment inherits its project's `externalRef` (the call's own `externalRef` is merged over it).
* Plan limits answer `402 plan_limit` with `limit` and `kind` (`projects`, `container_projects`, `instances`, `domains`, `preview_deployments`, `instance_size`).

### Long-running: `projects.waitForDeployment`

```bash
curl $H $A/projects.waitForDeployment -d '{"input":{"deploymentId":"…","timeoutSeconds":900}}'   # → 202 { operation }
curl $H https://orb.example.com/api/connect/v1/operations/<id>
# { "id","action","status":"pending|running|succeeded|failed|canceled","output"?,"error"?,"createdAt","finishedAt"? }
```

It resolves when the deployment reaches a terminal status (`READY`, `FAILED`, `CANCELED`, `ARCHIVED`): the operation **succeeds** with the final deployment (including `url` and `errorMessage`, so a `FAILED` deployment is a successful wait). After `timeoutSeconds` (max 1800) it fails with `error.code = "timeout"`. Operations are owned by the grant and kept 7 days; they are resolved when polled.

## 6. Webhooks and the event log

```bash
curl $H https://orb.example.com/api/connect/v1/webhooks -d '{"url":"https://hub.example.com/hooks/orb","events":["deployment.*","project.created"],"description":"hub"}'
# 201 → { id, url, events, status, secret:"whsec_…" }   the secret is returned ONCE
# GET /webhooks · GET|PATCH|DELETE /webhooks/{id} · GET /webhooks/{id}/deliveries · POST /webhooks/{id}/deliveries/{deliveryId}/redeliver
# GET /events?cursor=&types=deployment.*,domain.added&limit=   polling fallback
```

* Needs `orb:webhooks:manage`. At most **5 endpoints per grant**; revoking the grant removes them. Subscriptions accept exact types and `prefix.*` (or `*`).
* **URL rules (SSRF)**: `https` only in production; the host is resolved and loopback, link-local (incl. cloud metadata), private (RFC 1918 / 4193), CGNAT and reserved addresses are rejected, again at **delivery time** on the address actually connected to; redirects are never followed; 5 s to connect, 10 s in total.
* Only events about the pinned team **and** that the grant's scopes (capped by the user's current role) would let it read are delivered; the filter runs before anything is queued.

### Envelope and headers

```json
{ "id": "evt_01J…", "type": "deployment.ready", "apiVersion": "cp1", "service": "orb",
  "occurredAt": "2026-01-01T10:00:00.000Z", "tenantId": "…",
  "actor": { "id": null, "name": null, "kind": "system" },
  "externalRef": { "hubProjectId": "prj_1", "hubRunId": "run_42", "hubStepId": "ship" },
  "data": { "project": { "id": "…", "name": "Storefront", "slug": "storefront", "type": "static", "url": "https://storefront.orb.example.com" },
            "deployment": { "id": "…", "environment": "production", "branch": "main", "commitSha": "abc1234", "commitMessage": "Fix",
                            "status": "READY", "url": "https://storefront-1a2b3c4d.orb.example.com", "triggeredBy": "api", "buildDurationMs": 41200 },
            "webUrl": "https://orb.example.com/dashboard/projects/storefront?deployment=…" } }
```

`X-CP-Event`, `X-CP-Delivery` (uuid, stable across retries), `X-CP-Timestamp` (unix seconds, fresh on every attempt), `X-CP-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>`, `User-Agent: Orb-Connector/1.0`.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
export function verify(secret, headers, rawBody, toleranceSeconds = 300) {
  const ts = headers['x-cp-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSeconds) return false;
  const expected = 'v1=' + createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const given = String(headers['x-cp-signature']);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

### Delivery semantics

* **At least once**: dedupe on `id`; ordering is not guaranteed, use `occurredAt`. Success is any `2xx` within 10 s.
* Retries after 10 s, 30 s, 2 m, 10 m, 30 m, 1 h, 3 h, 6 h (**8 retries after the first attempt**, about 11 hours) with ±20 % jitter, then the delivery is abandoned. `410 Gone` disables the endpoint immediately; 50 consecutive failed deliveries or 3 days of failures disable it too (`status: "disabled"`, `disabledReason` in `GET /webhooks/{id}` and in Orb's Settings → Connected apps). `PATCH {"status":"active"}` re-enables it and resets the counters.
* **Transactional outbox**: the event row is written in the same database transaction as the change (`withOutbox`), then fanned out by the worker, so a crash between the two cannot lose an event and a rolled-back change emits none. `GET /events` serves the very same rows in commit order (`tx_id < xmin`, then `seq`), so a reader that resumes from a cursor never skips a late-committing event. It returns only events the grant may read, retained 7 days; with nothing new the response hands back your own cursor so you can poll again.
* `deployment.ready` and `deployment.failed` are emitted **once per deployment**, from the same transaction as the status change.

### Event catalogue

| Type | `data` | Notes |
|---|---|---|
| `project.created` / `.updated` / `.deleted` | `{ project }` (full project entity) | also for changes made in the dashboard |
| `deployment.queued` / `.building` / `.deploying` / `.ready` / `.failed` / `.canceled` | `{ project, deployment, webUrl }` | `deployment.errorMessage` on failure |
| `deployment.promoted` | as above + `previousDeploymentId` | the production alias moved (after READY, manually, or a rollback) |
| `service.unhealthy` / `.recovered` | `{ project, instances:{desired,running,unhealthy,lost} }` | at most one `unhealthy` per project every 10 min; `lost` = lost in the last 10 min |
| `domain.added` / `.verified` / `.verification_failed` | `{ project, domain:{domain,status,lastError,redirectTo} }` | `verified` = routes to Orb and serves TLS; `verification_failed` = a working domain broke |
| `env.updated` | `{ project, keys[], target, action }` | **keys only**, one event per request and target |
| `plan.limit_reached` | `{ limit, kind }` | at most one per team and kind every 10 min; raised for limits hit through the connector |

Events never contain secrets, tokens, env var values, registry credentials or build-log contents.

## 7. Security model

* Tokens, authorization codes and refresh tokens are stored only as `HMAC-SHA256(CONNECTOR_TOKEN_PEPPER, …)` and compared in constant time; the plaintext exists only in the token response. Webhook signing secrets are AES-256-GCM encrypted at rest (versioned key, `CONNECTOR_ENCRYPTION_KEY_PREVIOUS` for rotation, bound to the webhook id).
* The acting user's role is re-resolved on every request; scopes are least-privilege and capped by it. Cross-team ids are 404. Stored third-party credentials (GitHub, Razorpay) are never returned.
* Every connector call is written to Orb's audit log with `via: "connector"`, client id, grant id, action name and request id, never payloads. Reads are recorded at most once a minute per grant and resource so polling cannot flood the log.
* `X-Frame-Options: DENY` stays on every route (no embedding).
* Users see and revoke every connection in **Settings → Connected apps** (team admins see their team's), including webhook health and the last 20 audited calls. Deployments created through the Hub carry a "via <Hub>" tag.

## 8. Deviations and limitations (read before relying on it)

* Orb has no embed mode and no connector API key (CP1 §2.5, §8 are optional and not implemented).
* One extra table, `connector_used_refresh`, remembers rotated refresh hashes (needed for theft detection); one extra column `failing_since` supports the 3-day rule.
* "8 attempts, ≈ 11 h": implemented as the first attempt plus the 8 listed retries (the listed delays add up to 10 h 43 min).
* "50 consecutive failed deliveries" counts deliveries that used up all their retries; the 3-day rule starts at the first failed attempt.
* Events are physically kept 14 days (so deliveries can be kept 14 days) but `GET /events` serves 7.
* `plan.limit_reached` is raised for limits hit through the connector, not for limits hit in the dashboard.
* After a refresh the previous access token stops working at once (one access token per grant); serialize refreshes.
* The build pipeline's event emission (`building`, `deploying`, `ready`, `failed`) runs in the same transaction as each status change but is covered by typecheck, the identical release/reaper logic and its unit tests, not by a Docker-based end-to-end test.
* Orb's own limits apply on top: the team's plan (projects, instances, domains, concurrent builds) and API rate.

## 9. Runbook

| Symptom | Look at |
|---|---|
| Hub gets 404 everywhere | `CONNECTOR_ENABLED` is not `true` on **web**; restart after changing |
| Web or worker does not start, message mentions `CONNECTOR_*` | a variable is missing or too short; the message lists every problem |
| Authorize page says "not registered" | `client_id` or `redirect_uri` is not an exact match of `CONNECTOR_HUB_CLIENT_ID` / `CONNECTOR_HUB_REDIRECT_URIS` |
| Everyone was logged out | `CONNECTOR_TOKEN_PEPPER` changed |
| Webhook secrets "unreadable" in delivery errors | `CONNECTOR_ENCRYPTION_KEY` changed without keeping the old one in `_PREVIOUS` |
| No webhook deliveries | worker not restarted after enabling; endpoint `disabled` (see `disabledReason`); `GET /webhooks/{id}/deliveries` shows status and the last error |
| Events arrive late | the dispatcher ticks every 5 s per worker; retries follow the back-off above; use `GET /events` to heal |
| Hub wants to see why a build failed | `deployments.logs` with the deployment id from `deployment.failed` |

Retention (hourly, worker): events 14 d, operations 7 d, idempotency keys 24 h, expired codes, rotated refresh hashes after 100 d.
