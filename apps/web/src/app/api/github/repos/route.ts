import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { accounts } from 'database';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch the GitHub access token for this user
    const accountRecords = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, session.user.id))
      .limit(1);

    const account = accountRecords[0];

    if (!account || !account.accessToken) {
      return NextResponse.json({ error: 'No GitHub account linked or access token missing' }, { status: 400 });
    }

    const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json({ error: 'Failed to fetch repositories from GitHub', details: errorData }, { status: response.status });
    }

    const repos = await response.json();
    return NextResponse.json({ repos });
  } catch (error) {
    console.error('Failed to fetch user repositories:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
