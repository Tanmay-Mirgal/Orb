import { connectorEnabled } from 'core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { ApiError, assertSameOrigin, clientIp, enforceRateLimit } from '../api';
import { listMemberships } from '../orgs';
import { auditConnectorLifecycle } from './audit';
import { consentOptions, createAuthorizationCode, redirectWith, validateAuthorizeRequest } from './oauth';

/**
 * Handles the consent form (`POST /connect/authorize/decision`). Nothing in the form is trusted: the authorize
 * request is validated again from scratch and the chosen team must be one the signed-in user may connect.
 */

const noStore = { 'cache-control': 'no-store' } as const;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function htmlError(status: number, message: string): Response {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connection not completed</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.25rem">Connection not completed</h1><p>${escapeHtml(message)}</p><p><a href="/dashboard">Back to Orb</a></p></body>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...noStore } });
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...noStore } });
}

export async function decideConsent(req: Request): Promise<Response> {
  if (!connectorEnabled()) return htmlError(404, 'Not found.');
  try {
    assertSameOrigin(req);
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) if (typeof value === 'string' && key.length < 64 && value.length < 2048) params[key] = value;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      const original = new URLSearchParams(Object.entries(params).filter(([k]) => !['decision', 'org_id'].includes(k))).toString();
      return redirectTo(`/login?next=${encodeURIComponent(`/connect/authorize?${original}`)}`);
    }
    await enforceRateLimit(`cp1:consent:${session.user.id}`, 20, 60);

    const validation = validateAuthorizeRequest(params);
    if (!validation.ok) {
      if (validation.display === 'page') return htmlError(400, validation.message);
      return redirectTo(redirectWith(validation.redirectUri, { error: validation.error, error_description: validation.description, state: validation.state }));
    }
    const { request } = validation;

    if (params.decision !== 'allow') {
      return redirectTo(redirectWith(request.redirectUri, { error: 'access_denied', error_description: 'The user denied the request', state: request.state }));
    }

    const options = consentOptions(await listMemberships(session.user.id), request.scopes);
    const chosen = options.find((o) => o.org.id === params.org_id);
    if (!chosen) return htmlError(400, 'Choose one of your teams. You can only connect a team in which your role allows the requested access.');

    const code = await createAuthorizationCode({ userId: session.user.id, orgId: chosen.org.id, scopes: chosen.grantable, request });
    await auditConnectorLifecycle({
      orgId: chosen.org.id,
      userId: session.user.id,
      action: 'connector.consent_given',
      clientId: request.clientId,
      ip: clientIp(req),
      metadata: { scopes: chosen.grantable, withheld: chosen.withheld },
    });
    return redirectTo(redirectWith(request.redirectUri, { code, state: request.state }));
  } catch (err) {
    if (err instanceof ApiError) return htmlError(err.status, err.message);
    console.error(JSON.stringify({ level: 'error', msg: 'consent decision failed', err: err instanceof Error ? err.message : String(err) }));
    return htmlError(500, 'Something went wrong. Please try again.');
  }
}
