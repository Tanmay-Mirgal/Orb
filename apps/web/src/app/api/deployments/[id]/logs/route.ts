import { NextResponse } from 'next/server';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const logKey = \`logs:\${id}\`;
    
    // Fetch all logs for this deployment
    const logs = await redis.lrange(logKey, 0, -1);
    
    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
