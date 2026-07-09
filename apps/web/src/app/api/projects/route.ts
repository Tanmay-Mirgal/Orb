import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, projectRepositories } from 'database';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, githubRepositoryName, githubRepositoryId, branch, framework, buildCommand, outputDirectory } = body;

    if (!name || !githubRepositoryName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Insert project record
    const insertResult = await db.insert(projects).values({
      name,
      userId: session.user.id,
      framework: framework || 'Next.js',
      buildCommand: buildCommand || 'npm run build',
      outputDirectory: outputDirectory || '.next',
    }).returning();

    const project = insertResult[0];

    // Insert repository record
    await db.insert(projectRepositories).values({
      projectId: project.id,
      githubRepositoryId: githubRepositoryId || 0,
      githubRepositoryName,
      branch: branch || 'main'
    });

    return NextResponse.json({ success: true, project });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
