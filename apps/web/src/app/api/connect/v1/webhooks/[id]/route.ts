import { webhooksDelete, webhooksGet, webhooksPatch } from '@/server/connector/webhooks';

export const dynamic = 'force-dynamic';

export const GET = webhooksGet;
export const PATCH = webhooksPatch;
export const DELETE = webhooksDelete;
