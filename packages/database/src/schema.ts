import { pgTable, text, timestamp, uuid, varchar, integer, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable("user", {
					id: text("id").primaryKey(),
					name: text('name').notNull(),
					email: text('email').notNull().unique(),
					emailVerified: boolean('emailVerified').notNull(),
					image: text('image'),
					createdAt: timestamp('createdAt', { mode: 'date' }).notNull(),
					updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull()
				});

export const sessions = pgTable("session", {
					id: text("id").primaryKey(),
					expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
					token: text('token').notNull().unique(),
					createdAt: timestamp('createdAt', { mode: 'date' }).notNull(),
					updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull(),
					ipAddress: text('ipAddress'),
					userAgent: text('userAgent'),
					userId: text('userId').notNull().references(() => users.id)
				});

export const accounts = pgTable("account", {
					id: text("id").primaryKey(),
					accountId: text('accountId').notNull(),
					providerId: text('providerId').notNull(),
					userId: text('userId').notNull().references(() => users.id),
					accessToken: text('accessToken'),
					refreshToken: text('refreshToken'),
					idToken: text('idToken'),
					accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { mode: 'date' }),
					refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { mode: 'date' }),
					scope: text('scope'),
					password: text('password'),
					createdAt: timestamp('createdAt', { mode: 'date' }),
					updatedAt: timestamp('updatedAt', { mode: 'date' })
				});

export const verifications = pgTable("verification", {
					id: text("id").primaryKey(),
					identifier: text('identifier').notNull(),
					value: text('value').notNull(),
					expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
					createdAt: timestamp('createdAt', { mode: 'date' }),
					updatedAt: timestamp('updatedAt', { mode: 'date' })
				});

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  framework: varchar('framework', { length: 255 }), 
  buildCommand: varchar('build_command', { length: 255 }),
  outputDirectory: varchar('output_directory', { length: 255 }),
  rootDirectory: varchar('root_directory', { length: 255 }),
  installCommand: varchar('install_command', { length: 255 }),
});

export const projectRepositories = pgTable('project_repositories', {
  projectId: uuid('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }).primaryKey(),
  githubRepositoryId: integer('github_repository_id').notNull(),
  githubRepositoryName: varchar('github_repository_name', { length: 255 }).notNull(),
  branch: varchar('branch', { length: 255 }).default('main').notNull(),
});

export const deployments = pgTable('deployments', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('QUEUED'), 
  commitHash: varchar('commit_hash', { length: 255 }),
  commitMessage: text('commit_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const domains = pgTable('domains', {
  domain: varchar('domain', { length: 255 }).notNull().primaryKey(),
  projectId: uuid('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const environmentVariables = pgTable('environment_variables', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 255 }).notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
