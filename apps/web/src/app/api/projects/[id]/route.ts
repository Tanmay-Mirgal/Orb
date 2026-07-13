import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from 'database';
import { eq, and } from 'drizzle-orm';
import { auth } from '@/lib/auth';

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await props.params;

    // Verify project belongs to user
    const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.userId, session.user.id)));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Delete project (cascade will handle related records in DB)
    await db.delete(projects).where(eq(projects.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
