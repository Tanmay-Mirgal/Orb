import { deploymentUrl, emailTemplates, platformConfig } from 'core';
import { deployments, eq, notify, orgMemberIds, organizations, projects } from 'database';
import { NotificationType } from 'shared';
import type { WorkerContext } from './context';

/**
 * Tells the right people that a deployment finished or failed (in-app + e-mail, honouring their preferences).
 * Safe to call from several code paths: a Redis lock makes each (deployment, outcome) notify exactly once.
 * Never throws — a notification problem must not turn a successful deployment into a failed job.
 */
export async function notifyDeployment(ctx: WorkerContext, deploymentId: string, outcome: 'ready' | 'failed'): Promise<void> {
  try {
    const first = await ctx.redis.set(`orb:notified:${deploymentId}:${outcome}`, '1', 'EX', 86_400, 'NX');
    if (!first) return;
    const [row] = await ctx.db
      .select({ deployment: deployments, project: projects, orgId: organizations.id })
      .from(deployments)
      .innerJoin(projects, eq(projects.id, deployments.projectId))
      .innerJoin(organizations, eq(organizations.id, projects.orgId))
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!row) return;
    const { deployment, project, orgId } = row;
    const isPreview = deployment.environment === 'preview';
    const dashboardUrl = `${platformConfig().dashboardUrl}/dashboard/projects/${project.slug ?? ''}`;
    const creator = deployment.createdBy ?? project.userId;

    if (outcome === 'ready') {
      if (isPreview) return; // previews are noisy; they show up in the bell's deployment list
      const url = deploymentUrl(project.slug ?? deployment.subdomain ?? '');
      await notify(ctx.db, {
        userIds: [creator],
        orgId,
        category: 'deployments',
        type: NotificationType.DEPLOYMENT_READY,
        title: `${project.name} is live`,
        body: deployment.commitMessage ?? 'Deployment finished.',
        href: `/dashboard/projects/${project.slug ?? ''}`,
        email: () => emailTemplates.deploymentReady({ projectName: project.name, url, commitMessage: deployment.commitMessage, environment: deployment.environment, dashboardUrl }),
      });
      return;
    }

    const admins = isPreview ? [] : await orgMemberIds(ctx.db, orgId, ['owner', 'admin']);
    await notify(ctx.db, {
      userIds: [creator, ...admins],
      orgId,
      category: 'deployments',
      type: NotificationType.DEPLOYMENT_FAILED,
      title: `${project.name} failed to deploy`,
      body: deployment.errorMessage ?? 'Open the build log for details.',
      href: `/dashboard/projects/${project.slug ?? ''}`,
      email: () => emailTemplates.deploymentFailed({ projectName: project.name, error: deployment.errorMessage, commitMessage: deployment.commitMessage, dashboardUrl }),
    });
  } catch (err) {
    ctx.logger.warn({ deploymentId, outcome, err: String(err) }, 'deployment notification failed');
  }
}
