import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { environmentVariables } from 'database';
import { eq, and } from 'drizzle-orm';
import { auth } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    
    if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });

    const vars = await db.select().from(environmentVariables).where(eq(environmentVariables.projectId, projectId));
    return NextResponse.json({ envVars: vars });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to fetch env vars' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    
    if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });

    const body = await req.json();
    
    if (body.envVars && Array.isArray(body.envVars)) {
      const newVars = await db.insert(environmentVariables).values(
        body.envVars.map((ev: any) => ({ projectId, key: ev.key, value: ev.value }))
      ).returning();
      return NextResponse.json({ success: true, envVars: newVars });
    }

    const { key, value } = body;

    if (!key || !value) return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });

    const [newVar] = await db.insert(environmentVariables).values({
      projectId,
      key,
      value
    }).returning();

    return NextResponse.json({ success: true, envVar: newVar });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to add env var' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const projectId = searchParams.get('projectId');
    
    if (!id || !projectId) return NextResponse.json({ error: 'Missing id or projectId' }, { status: 400 });

    await db.delete(environmentVariables).where(and(
      eq(environmentVariables.id, id),
      eq(environmentVariables.projectId, projectId)
    ));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete env var' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, projectId, key, value } = body;

    if (!id || !projectId || !key || !value) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const [updatedVar] = await db.update(environmentVariables)
      .set({ key, value })
      .where(and(
        eq(environmentVariables.id, id),
        eq(environmentVariables.projectId, projectId)
      ))
      .returning();

    return NextResponse.json({ success: true, envVar: updatedVar });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update env var' }, { status: 500 });
  }
}
