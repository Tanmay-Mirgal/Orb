import { NextResponse } from 'next/server';
import { verifyGithubSignature } from 'core';
import { eq, ilike, organizations, projectRepositories, projects } from 'database';
import { branchName } from 'shared';
import { db } from '@/lib/db';
import { getRedis } from '@/server/infra';
import { createDeployment } from '@/server/services/deployments';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

interface PushPayload {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: { full_name?: string };
  head_commit?: { id?: string; message?: string; author?: { name?: string } } | null;
  pusher?: { name?: string };
}

/**
 * GitHub push webhook => git-driven deployments.
 *  - pushes to a project's production branch deploy to production (when auto-deploy is on);
 *  - pushes to any other branch create a preview deployment (when the project and plan allow it).
 * The HMAC signature is mandatory: there is no unauthenticated mode.
 */
export async function POST(req: Request) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret is not configured' }, { status: 503 });
  }

  const rawBody = await req.text();
  if (!verifyGithubSignature(rawBody, req.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = req.headers.get('x-github-event');
  if (event === 'ping') return NextResponse.json({ ok: true });
  if (event !== 'push') return NextResponse.json({ ignored: event });

  // GitHub retries on timeouts: make delivery idempotent.
  const delivery = req.headers.get('x-github-delivery');
  if (delivery) {
    const fresh = await getRedis().set(`orb:webhook:${delivery}`, '1', 'EX', 3600, 'NX');
    if (!fresh) return NextResponse.json({ ignored: 'duplicate delivery' });
  }

  let payload: PushPayload;
  try {
    payload = JSON.parse(rawBody) as PushPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const fullName = payload.repository?.full_name;
  const ref = payload.ref;
  if (!fullName || !ref?.startsWith('refs/heads/') || payload.deleted) {
    return NextResponse.json({ ignored: 'not a branch push' });
  }
  const branch = ref.slice('refs/heads/'.length);
  if (!branchName.safeParse(branch).success) return NextResponse.json({ ignored: 'unsupported branch name' });

  const message = payload.head_commit?.message ?? '';
  if (/\[(skip ci|ci skip|skip deploy|skip orb)\]/i.test(message)) {
    return NextResponse.json({ ignored: 'skipped by commit message' });
  }

  const linked = await db
    .select({ project: projects, repository: projectRepositories, org: organizations })
    .from(projectRepositories)
    .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(ilike(projectRepositories.githubRepositoryName, fullName));

  const triggered: Array<{ projectId: string; deploymentId: string; environment: string }> = [];
  for (const { project, repository, org } of linked) {
    const isProduction = repository.branch === branch;
    if (isProduction && !project.autoDeploy) continue;
    if (!isProduction && !project.previewDeployments) continue;
    try {
      const deployment = await createDeployment({
        project,
        repository,
        orgPlan: org.plan,
        environment: isProduction ? 'production' : 'preview',
        trigger: 'git_push',
        branch,
        commitSha: payload.after ?? payload.head_commit?.id ?? null,
        commitMessage: message || null,
        commitAuthor: payload.head_commit?.author?.name ?? payload.pusher?.name ?? null,
      });
      triggered.push({ projectId: project.id, deploymentId: deployment.id, environment: deployment.environment });
      await audit(null, {
        orgId: org.id,
        action: 'deployment.create',
        targetType: 'deployment',
        targetId: deployment.id,
        metadata: { trigger: 'git_push', branch, repo: fullName },
      });
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'webhook deployment failed', projectId: project.id, err: String(error) }));
    }
  }
  return NextResponse.json({ triggered });
}

