import { generateApiToken } from 'core';
import { apiTokens, count, desc, eq, and, isNull } from 'database';
import { createTokenSchema } from 'shared';
import { db } from '@/lib/db';
import { badRequest, parseBody, route } from '@/server/api';
import { authenticate } from '@/server/context';

export const dynamic = 'force-dynamic';

const MAX_TOKENS_PER_USER = 25;

export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const tokens = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, auth.userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return { tokens };
});

/** The plaintext token is returned exactly once; only its SHA-256 is stored. */
export const POST = route(async ({ req }) => {
  const auth = await authenticate(req);
  if (auth.via === 'token') throw badRequest('API tokens cannot create other API tokens');
  const input = await parseBody(req, createTokenSchema);
  const [existing] = await db.select({ n: count() }).from(apiTokens).where(and(eq(apiTokens.userId, auth.userId), isNull(apiTokens.revokedAt)));
  if ((existing?.n ?? 0) >= MAX_TOKENS_PER_USER) throw badRequest(`You can have at most ${MAX_TOKENS_PER_USER} active tokens`);

  const { token, hash, prefix } = generateApiToken();
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
  const [row] = await db.insert(apiTokens).values({ userId: auth.userId, name: input.name, tokenHash: hash, prefix, expiresAt }).returning();
  return Response.json({ token, id: row!.id, name: row!.name, prefix, expiresAt }, { status: 201 });
});
