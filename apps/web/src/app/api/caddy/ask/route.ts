import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  // Caddy will make a GET request to this endpoint with ?domain=example.com
  // For now, we allow all domains to generate on-demand TLS
  return new NextResponse('OK', { status: 200 });
}
