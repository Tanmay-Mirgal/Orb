import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, projectRepositories, environmentVariables } from 'database';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: req.headers
    });
    
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, githubRepositoryName, githubRepositoryId, branch, framework, buildCommand, outputDirectory, rootDirectory, installCommand, envVars } = body;

    if (!name || !githubRepositoryName || !githubRepositoryId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const uniqueSuffix = Math.random().toString(36).substring(2, 8);
    const slug = `${baseSlug}-${uniqueSuffix}`;

    const [project] = await db.insert(projects).values({
      name,
      slug,
      userId: session.user.id,
      framework,
      buildCommand,
      outputDirectory,
      rootDirectory,
      installCommand,
    }).returning();

    await db.insert(projectRepositories).values({
      projectId: project.id,
      githubRepositoryId,
      githubRepositoryName,
      branch: branch || 'main',
    });

    if (envVars && typeof envVars === 'object') {
      const entries = Object.entries(envVars);
      if (entries.length > 0) {
        await db.insert(environmentVariables).values(
          entries.map(([key, value]) => ({
            projectId: project.id,
            key: key,
            value: String(value)
          }))
        );
      }
    }

    return NextResponse.json({ success: true, project });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
