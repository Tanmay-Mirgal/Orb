import { connectorEnabled } from 'core';
import { assertUuid, forbidden, notFound, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate } from '@/server/context';
import { findRevocableGrant } from '@/server/connector/connected-apps';
import { revokeGrant } from '@/server/connector/grants';

export const dynamic = 'force-dynamic';

/** Disconnects an app: its tokens stop working immediately and its webhook endpoints are removed. */
export const DELETE = route<{ id: string }>(async ({ req, params }) => {
  if (!connectorEnabled()) throw notFound('Route');
  const auth = await authenticate(req);
  if (auth.via !== 'session') throw forbidden('Sign in to the dashboard to manage connected apps');
  assertUuid(params.id, 'Connection');
  const found = await findRevocableGrant(auth.userId, params.id);
  if (!found) throw notFound('Connection');
  await revokeGrant(found.grant.id, found.by);
  await audit(auth, {
    orgId: found.grant.orgId,
    action: 'connector.grant_revoked',
    targetType: 'connector_grant',
    targetId: found.grant.id,
    metadata: { by: found.by, clientId: found.grant.clientId },
  });
  return { ok: true };
});
