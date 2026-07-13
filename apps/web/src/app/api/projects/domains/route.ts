import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { domains } from 'database';
import { eq, and } from 'drizzle-orm';
import { auth } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ error: 'Project ID required' }, { status: 400 });

    const projectDomains = await db.select().from(domains).where(eq(domains.projectId, projectId));
    return NextResponse.json({ domains: projectDomains });
  } catch (error: any) {
    console.error('Fetch domains error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId, domain } = await req.json();
    if (!projectId || !domain) return NextResponse.json({ error: 'Project ID and domain required' }, { status: 400 });

    // Clean domain
    const cleanDomain = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    // Check if domain exists
    const existing = await db.select().from(domains).where(eq(domains.domain, cleanDomain));
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Domain already in use' }, { status: 400 });
    }

    const newDomain = await db.insert(domains).values({
      domain: cleanDomain,
      projectId,
      status: 'pending'
    }).returning();

    return NextResponse.json({ success: true, domain: newDomain[0] });
  } catch (error: any) {
    console.error('Add domain error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const domain = searchParams.get('domain');
    const projectId = searchParams.get('projectId');
    
    if (!domain || !projectId) return NextResponse.json({ error: 'Domain and Project ID required' }, { status: 400 });

    await db.delete(domains).where(and(eq(domains.domain, domain), eq(domains.projectId, projectId)));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete domain error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
