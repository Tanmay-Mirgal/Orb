import { domains, eq, projects } from 'database';
import { db } from '@/lib/db';
import { route } from '@/server/api';
import { authenticate, orgContext } from '@/server/context';
import { toView } from '@/server/services/domains';

export const dynamic = 'force-dynamic';

/** Every custom domain across the active team's projects. */
export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { org } = await orgContext(auth, req);
  const rows = await db
    .select({ domain: domains, projectName: projects.name, projectSlug: projects.slug })
    .from(domains)
    .innerJoin(projects, eq(projects.id, domains.projectId))
    .where(eq(projects.orgId, org.id));
  return { domains: rows.map((r) => ({ ...toView(r.domain), projectName: r.projectName, projectSlug: r.projectSlug })) };
});
