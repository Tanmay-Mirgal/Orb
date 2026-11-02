import { eq, organizations, projects, count } from 'database';
import { updateOrgSchema } from 'shared';
import { db } from '@/lib/db';
import { conflict, parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, orgContext, requirePermission } from '@/server/context';

export const dynamic = 'force-dynamic';

export const GET = route<{ orgId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req, params.orgId);
  return { organization: { ...org, role } };
});

export const PATCH = route<{ orgId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req, params.orgId);
  requirePermission(role, 'org:update');
  const { name } = await parseBody(req, updateOrgSchema);
  const [updated] = await db.update(organizations).set({ name, updatedAt: new Date() }).where(eq(organizations.id, org.id)).returning();
  await audit(auth, { orgId: org.id, action: 'org.update', targetType: 'org', targetId: org.id, metadata: { name } });
  return { organization: updated };
});

export const DELETE = route<{ orgId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req, params.orgId);
  requirePermission(role, 'org:delete');
  if (org.isPersonal) throw conflict('A personal team cannot be deleted');
  const [projectCount] = await db.select({ n: count() }).from(projects).where(eq(projects.orgId, org.id));
  if ((projectCount?.n ?? 0) > 0) throw conflict('Delete the team\'s projects first');
  await db.delete(organizations).where(eq(organizations.id, org.id));
  return { ok: true };
});
