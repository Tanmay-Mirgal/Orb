import { connectorConfig } from 'core';
import { notify } from 'database';
import { db } from '@/lib/db';
import { clientIp, enforceRateLimit } from '../api';
import { auditConnectorLifecycle } from './audit';
import { ConnectResponse, connectRoute, readBodyText } from './http';
import { OAuthError, authenticateClient, exchangeAuthorizationCode, refreshTokens, revokeByToken } from './oauth';

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };

/** `application/x-www-form-urlencoded` (RFC 6749) or JSON. Values that are not strings are rejected. */
async function readForm(req: Request): Promise<Record<string, string>> {
  const text = await readBodyText(req, 64 * 1024);
  if ((req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new OAuthError('invalid_request', 'The request body is not valid JSON');
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new OAuthError('invalid_request', 'The request body must be a JSON object');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) {
      if (typeof v !== 'string') throw new OAuthError('invalid_request', `${k} must be a string`);
      out[k] = v;
    }
    return out;
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function oauthErrorResponse(err: OAuthError): ConnectResponse {
  return new ConnectResponse({ error: err.error, error_description: err.description }, { status: err.status, headers: { ...NO_STORE, ...err.headers } });
}

/** `POST /api/connect/v1/oauth/token`. Errors follow RFC 6749 (`{ error, error_description }`) as the protocol requires. */
export const tokenRoute = connectRoute(async ({ req, requestId }) => {
  await enforceRateLimit(`cp1:token:${clientIp(req) ?? 'unknown'}`, 60, 60);
  try {
    const form = await readForm(req);
    const client = authenticateClient(req, form);
    if (form.grant_type === 'authorization_code') {
      const result = await exchangeAuthorizationCode(client, form);
      await afterGrantCreated({ ...result, clientId: client.clientId, requestId, ip: clientIp(req), orgName: result.response.tenant.name });
      return new ConnectResponse(result.response, { headers: NO_STORE });
    }
    if (form.grant_type === 'refresh_token') {
      const result = await refreshTokens(client, form);
      return new ConnectResponse(result.response, { headers: NO_STORE });
    }
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
  } catch (err) {
    if (err instanceof OAuthError) return oauthErrorResponse(err);
    throw err;
  }
});

async function afterGrantCreated(args: { grantId: string; orgId: string; userId: string; clientId: string; requestId: string; ip: string | null; orgName: string }) {
  await auditConnectorLifecycle({
    orgId: args.orgId,
    userId: args.userId,
    action: 'connector.grant_created',
    grantId: args.grantId,
    clientId: args.clientId,
    requestId: args.requestId,
    ip: args.ip,
    targetType: 'connector_grant',
    targetId: args.grantId,
  });
  // In-app only: the person who clicked Allow can see (and undo) what they connected.
  await notify(db, {
    userIds: [args.userId],
    orgId: args.orgId,
    category: 'security',
    type: 'security.connector_connected',
    title: `${connectorConfig().hubName} is now connected to ${args.orgName}`,
    body: 'You can disconnect it at any time in Settings → Connected apps.',
    href: '/dashboard/settings',
  });
}

/** `POST /api/connect/v1/oauth/revoke` (RFC 7009): always 200, whether or not the token was known. */
export const revokeRoute = connectRoute(async ({ req, requestId }) => {
  await enforceRateLimit(`cp1:revoke:${clientIp(req) ?? 'unknown'}`, 60, 60);
  let token: string | undefined;
  try {
    token = (await readForm(req)).token;
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
  }
  if (token) {
    const revoked = await revokeByToken(token);
    if (revoked) {
      await auditConnectorLifecycle({
        orgId: revoked.orgId,
        userId: revoked.userId,
        action: 'connector.grant_revoked',
        grantId: revoked.grantId,
        clientId: revoked.clientId,
        requestId,
        ip: clientIp(req),
        targetType: 'connector_grant',
        targetId: revoked.grantId,
        metadata: { by: 'client' },
      });
    }
  }
  return new ConnectResponse({}, { headers: NO_STORE });
});
