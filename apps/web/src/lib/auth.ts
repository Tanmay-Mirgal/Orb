import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailTemplates, platformConfig } from 'core';
import { accounts, notify, sessions, users, verifications } from 'database';
import { NotificationType } from 'shared';
import { db } from '@/lib/db';
import { getRedis } from '@/server/infra';
import { ensurePersonalOrganization, syncPlanGrants } from '@/server/orgs';

const isProd = process.env.NODE_ENV === 'production';
const appUrl = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export const auth = betterAuth({
  baseURL: appUrl,
  trustedOrigins: [appUrl],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: users, account: accounts, session: sessions, verification: verifications },
  }),
  // Sessions + auth rate-limit counters live in Redis so any number of web instances share them;
  // sessions are still written to Postgres so a Redis flush does not log everyone out.
  secondaryStorage: {
    get: async (key) => getRedis().get(`orb:auth:${key}`),
    getAndDelete: async (key) => getRedis().getdel(`orb:auth:${key}`),
    // Fixed window: the TTL is only applied when the counter is created (Redis >= 7 `EXPIRE ... NX`).
    increment: async (key, ttl) => {
      const redisKey = `orb:auth:${key}`;
      const results = await getRedis().multi().incr(redisKey).expire(redisKey, ttl, 'NX').exec();
      return Number(results?.[0]?.[1] ?? 1);
    },
    set: async (key, value, ttl) => {
      if (ttl) await getRedis().set(`orb:auth:${key}`, value, 'EX', ttl);
      else await getRedis().set(`orb:auth:${key}`, value);
    },
    delete: async (key) => {
      await getRedis().del(`orb:auth:${key}`);
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    storeSessionInDatabase: true,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: { enabled: true, window: 60, max: 60, storage: 'secondary-storage' },
  advanced: {
    useSecureCookies: isProd,
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      // `repo` lets Orb list and clone private repositories on the user's behalf.
      scope: ['read:user', 'user:email', 'repo'],
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensurePersonalOrganization({ id: user.id, name: user.name });
          await notify(db, {
            userIds: [user.id],
            category: 'product',
            type: NotificationType.WELCOME,
            title: 'Welcome to Orb',
            body: 'Import a GitHub repository to deploy your first project.',
            href: '/dashboard/new',
            email: (r) => emailTemplates.welcome({ name: r.name, dashboardUrl: platformConfig().dashboardUrl }),
          });
        },
      },
    },
    session: {
      create: {
        // Runs on every sign-in: keeps complimentary plans applied to teams the user has created since.
        after: async (session) => {
          await syncPlanGrants(session.userId);
        },
      },
    },
  },
});
