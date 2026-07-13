import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { domains } from 'database';
import { eq, and } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import dns from 'dns/promises';

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId, domain } = await req.json();
    if (!projectId || !domain) return NextResponse.json({ error: 'Project ID and domain required' }, { status: 400 });

    const targetCname = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.tanmaymirgal.dev';
    let isValid = false;
    let errorDetail = '';

    try {
      // 1. Try resolving CNAME
      const cnames = await dns.resolveCname(domain);
      if (cnames.some(c => c.toLowerCase() === targetCname.toLowerCase())) {
        isValid = true;
      } else {
        errorDetail = `CNAME points to ${cnames.join(', ')} instead of ${targetCname}`;
      }
    } catch (e: any) {
      // If CNAME fails (e.g. ENODATA), try A record
      try {
        const aRecords = await dns.resolve4(domain);
        // For Orb platform, we might just assume any A record check passes if it resolves,
        // or check against a specific IP. For now, if it resolves, we can consider it valid,
        // or check against an env variable NEXT_PUBLIC_A_RECORD_TARGET.
        // Let's assume we need it to point to 13.207.186.41 (from EC2 screenshot) if not specified
        const targetIp = process.env.NEXT_PUBLIC_A_RECORD_TARGET || '13.207.186.41';
        if (aRecords.includes(targetIp)) {
          isValid = true;
        } else {
          errorDetail = `A record points to ${aRecords.join(', ')} instead of ${targetIp}`;
        }
      } catch (err: any) {
        errorDetail = `DNS Resolution failed: ${err.message}`;
      }
    }

    const newStatus = isValid ? 'active' : 'error';

    await db.update(domains)
      .set({ status: newStatus })
      .where(and(eq(domains.domain, domain), eq(domains.projectId, projectId)));

    return NextResponse.json({ success: true, status: newStatus, errorDetail: isValid ? null : errorDetail });
  } catch (error: any) {
    console.error('Verify domain error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
