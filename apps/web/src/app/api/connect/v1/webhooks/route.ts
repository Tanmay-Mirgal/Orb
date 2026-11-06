import { webhooksCreate, webhooksList } from '@/server/connector/webhooks';

export const dynamic = 'force-dynamic';

export const GET = webhooksList;
export const POST = webhooksCreate;
