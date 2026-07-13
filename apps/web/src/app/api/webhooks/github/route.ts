import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { projectRepositories, projects, deployments, environmentVariables } from 'database';
import { eq, and } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { JobPayload } from 'shared';
import Redis from 'ioredis';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const queue = new Queue('deployments', { connection: connection as any });

export async function POST(req: Request) {
  try {
    const signature = req.headers.get('x-hub-signature-256');
    const eventType = req.headers.get('x-github-event');
    const rawBody = await req.text();

    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    if (secret && signature) {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
      
      try {
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
      } catch (e) {
        return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
      }
    }

    if (eventType !== 'push') {
      return NextResponse.json({ message: 'Ignoring non-push event' });
    }

    const payload = JSON.parse(rawBody);
    
    // E.g. refs/heads/main
    const ref = payload.ref;
    if (!ref || !ref.startsWith('refs/heads/')) {
      return NextResponse.json({ message: 'Not a branch push' });
    }
    const branch = ref.replace('refs/heads/', '');
    
    const githubRepositoryName = payload.repository?.full_name;
    if (!githubRepositoryName) {
      return NextResponse.json({ error: 'Missing repository full_name' }, { status: 400 });
    }
    
    const commitHash = payload.head_commit?.id || payload.after;
    const commitMessage = payload.head_commit?.message || 'Auto-deployment from GitHub push';

    // Find linked projects
    const linkedRepos = await db.select()
      .from(projectRepositories)
      .where(
        and(
          eq(projectRepositories.githubRepositoryName, githubRepositoryName),
          eq(projectRepositories.branch, branch)
        )
      );

    if (linkedRepos.length === 0) {
      return NextResponse.json({ message: 'No linked projects found for this repo and branch' });
    }

    const results = [];

    for (const repo of linkedRepos) {
      const { projectId } = repo;
      
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!project) continue;

      const dbEnvVars = await db.select().from(environmentVariables).where(eq(environmentVariables.projectId, projectId));
      const envVars = dbEnvVars.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {} as Record<string, string>);

      // Create deployment
      const [deployment] = await db.insert(deployments).values({
        projectId,
        status: 'QUEUED',
        commitHash: commitHash ? commitHash.substring(0, 40) : null,
        commitMessage: commitMessage ? commitMessage.substring(0, 255) : null,
      }).returning();

      // Dispatch job
      const jobPayload: JobPayload = {
        deploymentId: deployment.id,
        projectId,
        githubRepositoryName,
        githubRepositoryId: repo.githubRepositoryId,
        branch,
        buildCommand: project.buildCommand || '',
        outputDirectory: project.outputDirectory || '.next',
        rootDirectory: project.rootDirectory || './',
        installCommand: project.installCommand || 'npm install',
        environmentVariables: envVars || {},
      };

      await queue.add('deploy-job', jobPayload);
      results.push({ projectId, deploymentId: deployment.id });
    }

    return NextResponse.json({ success: true, triggeredDeployments: results });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
