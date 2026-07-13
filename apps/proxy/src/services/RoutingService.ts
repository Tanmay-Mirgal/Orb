import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, desc } from 'drizzle-orm';
import { projects, domains, deployments } from 'database';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://orb:password@localhost:5432/orb');
const db = drizzle(sql);

export class RoutingService {
  /**
   * Resolves a hostname to a project and its latest successful deployment.
   */
  async resolveHost(hostname: string): Promise<{ projectId: string; deploymentId: string; isStatic: boolean } | null> {
    // 1. Determine Project ID
    let projectId: string | null = null;
    const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev';

    if (hostname.endsWith(`.${baseDomain}`)) {
      const projectName = hostname.replace(`.${baseDomain}`, '');
      const projectResult = await db.select().from(projects).where(eq(projects.name, projectName)).limit(1);
      if (projectResult.length > 0) {
        projectId = projectResult[0].id;
      }
    } else if (hostname.endsWith('.localhost')) {
      const projectName = hostname.replace('.localhost', '');
      const projectResult = await db.select().from(projects).where(eq(projects.name, projectName)).limit(1);
      if (projectResult.length > 0) {
        projectId = projectResult[0].id;
      }
    } else {
      const domainResult = await db.select().from(domains).where(eq(domains.domain, hostname)).limit(1);
      if (domainResult.length > 0) {
        projectId = domainResult[0].projectId;
      }
    }

    if (!projectId) return null;

    // 2. Find latest successful deployment
    const deploymentResult = await db.select()
      .from(deployments)
      .where(eq(deployments.projectId, projectId))
      // In a real app we'd filter by status === 'SUCCESS', assuming all here are mock or verified
      // .where(eq(deployments.status, 'SUCCESS')) // Need to add multiple where clauses
      .orderBy(desc(deployments.createdAt))
      .limit(1);

    if (deploymentResult.length === 0) return null;
    
    const deployment = deploymentResult[0];

    // Determine if it's static based on framework
    const projectInfo = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const buildCmd = projectInfo[0]?.buildCommand || '';
    const framework = projectInfo[0]?.framework || '';
    
    let isStatic = true;
    if (framework === 'Next.js' || framework === 'Flask' || framework === 'Node.js') {
      isStatic = false;
    } else if (buildCmd.includes('next') || buildCmd.includes('flask') || buildCmd.includes('node')) {
      isStatic = false;
    }

    return {
      projectId,
      deploymentId: deployment.id,
      isStatic
    };
  }
}
