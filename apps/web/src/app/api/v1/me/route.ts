import { authenticate } from '@/server/context';
import { route } from '@/server/api';
import { resolveActiveOrg } from '@/server/orgs';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const active = await resolveActiveOrg({ id: auth.userId, name: auth.userName });
  return {
    user: { id: auth.userId, name: auth.userName, email: auth.email },
    activeOrgId: active.org.id,
    organizations: active.all.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      plan: m.org.plan,
      isPersonal: m.org.isPersonal,
      role: m.role,
    })),
  };
});
