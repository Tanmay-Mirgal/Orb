import { NextResponse } from 'next/server';
import { safeEqual } from 'core';
import { deployments, eq, resolveEnvVars } from 'database';
import { assertUuid, errorResponse, notFound, unauthorized } from '@/server/api';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Runner nodes fetch a deployment's runtime environment here instead of holding database credentials.
 * Authenticated with the shared INTERNAL_API_TOKEN; never expose this path on the public proxy.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const expected = process.env.INTERNAL_API_TOKEN;
    const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!expected || !safeEqual(provided, expected)) throw unauthorized();

    const { id } = await ctx.params;
    assertUuid(id, 'Deployment');
    const [deployment] = await db.select().from(deployments).where(eq(deployments.id, id)).limit(1);
    if (!deployment) throw notFound('Deployment');

    const { vars } = await resolveEnvVars(db, deployment.projectId, {
      environment: deployment.environment === 'preview' ? 'preview' : 'production',
      scope: 'runtime',
    });
    return NextResponse.json({ env: vars }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
