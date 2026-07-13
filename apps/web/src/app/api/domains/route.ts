import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { domains, projects } from 'database';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch domains and join with projects to get project name
    const userDomains = await db.select({
      domain: domains.domain,
      projectId: domains.projectId,
      status: domains.status,
      createdAt: domains.createdAt,
      projectName: projects.name,
      projectSlug: projects.slug
    })
    .from(domains)
    .innerJoin(projects, eq(domains.projectId, projects.id))
    .where(eq(projects.userId, session.user.id));

    return NextResponse.json({ domains: userDomains });
  } catch (error: any) {
    console.error('Fetch global domains error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
