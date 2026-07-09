import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deployments } from 'database';
import { Queue } from 'bullmq';
import { JobPayload } from 'shared';
import Redis from 'ioredis';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const queue = new Queue('deployments', { connection });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectId, githubRepositoryName, branch, buildCommand, outputDirectory, envVars } = body;

    if (!projectId || !githubRepositoryName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Insert deployment record
    const insertResult = await db.insert(deployments).values({
      projectId,
      status: 'QUEUED',
      commitMessage: 'Manual deployment triggered from dashboard',
    }).returning();

    const deployment = insertResult[0];

    // Push to BullMQ
    const payload: JobPayload = {
      deploymentId: deployment.id,
      projectId,
      githubRepositoryName,
      githubRepositoryId: 0, // Mock id
      branch: branch || 'main',
      buildCommand: buildCommand || '',
      outputDirectory: outputDirectory || '.next',
      environmentVariables: envVars || {},
    };

    await queue.add('deploy-job', payload);

    return NextResponse.json({ success: true, deployment });
  } catch (error) {
    console.error('Error triggering deployment:', error);
    return NextResponse.json({ error: 'Failed to trigger deployment' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    
    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }
    
    // We import eq from drizzle-orm dynamically here or at top level
    const { eq, desc } = require('drizzle-orm');
    
    const projectDeployments = await db.select().from(deployments).where(eq(deployments.projectId, projectId)).orderBy(desc(deployments.createdAt));
    
    return NextResponse.json({ deployments: projectDeployments });
  } catch (error) {
    console.error('Error fetching deployments:', error);
    return NextResponse.json({ error: 'Failed to fetch deployments' }, { status: 500 });
  }
}
