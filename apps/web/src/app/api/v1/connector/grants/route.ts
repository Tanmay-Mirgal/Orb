import { connectorEnabled, connectorHubName } from 'core';
import { forbidden, notFound, route } from '@/server/api';
import { authenticate } from '@/server/context';
import { listConnectedApps } from '@/server/connector/connected-apps';

export const dynamic = 'force-dynamic';

/** Connected apps of the signed-in user (and, for team admins, of their teams). Dashboard session only. */
export const GET = route(async ({ req }) => {
  if (!connectorEnabled()) throw notFound('Route');
  const auth = await authenticate(req);
  if (auth.via !== 'session') throw forbidden('Sign in to the dashboard to manage connected apps');
  return { hubName: connectorHubName(), ...(await listConnectedApps(auth.userId)) };
});
