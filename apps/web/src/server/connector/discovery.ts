import { env, platformConfig } from 'core';
import { CONNECTOR_VERSION, buildManifest, buildOpenApi } from 'shared';
import { ConnectResponse, connectRoute } from './http';

const DEFAULT_DOCS_URL = 'https://github.com/Tanmay-Mirgal/Orb/blob/main/docs/CONNECTOR.md';

const options = () => ({ baseUrl: platformConfig().dashboardUrl, docsUrl: env('CONNECTOR_DOCS_URL') ?? DEFAULT_DOCS_URL });

const PUBLIC_CACHE = { 'cache-control': 'public, max-age=300' };

/** `GET /.well-known/ecosystem-connector.json` and `GET /api/connect/v1/manifest` (identical, cacheable for 5 minutes). */
export const manifestRoute = connectRoute(async () => new ConnectResponse(buildManifest(options()), { headers: PUBLIC_CACHE }));

export const openApiRoute = connectRoute(async () => new ConnectResponse(buildOpenApi(options()), { headers: PUBLIC_CACHE }));

/** No secrets and no tenant data. */
export const healthRoute = connectRoute(async () => ({ status: 'ok', version: CONNECTOR_VERSION, time: new Date().toISOString() }));
