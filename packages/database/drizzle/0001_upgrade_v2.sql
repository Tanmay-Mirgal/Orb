CREATE TABLE IF NOT EXISTS "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" text,
	"actor_type" varchar(16) DEFAULT 'user' NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(255),
	"metadata" jsonb,
	"ip" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"node_id" varchar(128) NOT NULL,
	"container_id" varchar(128),
	"address" varchar(255),
	"host_port" integer,
	"status" varchar(16) DEFAULT 'STARTING' NOT NULL,
	"cpu_millis" integer DEFAULT 0 NOT NULL,
	"memory_mb" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"stopped_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(16) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"plan" varchar(32) DEFAULT 'free' NOT NULL,
	"is_personal" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_hourly" (
	"project_id" uuid NOT NULL,
	"bucket" timestamp NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"bytes_out" bigint DEFAULT 0 NOT NULL,
	"status_2xx" bigint DEFAULT 0 NOT NULL,
	"status_3xx" bigint DEFAULT 0 NOT NULL,
	"status_4xx" bigint DEFAULT 0 NOT NULL,
	"status_5xx" bigint DEFAULT 0 NOT NULL,
	"duration_ms_total" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_hourly_project_id_bucket_pk" PRIMARY KEY("project_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "environment" varchar(16) DEFAULT 'production' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "trigger" varchar(16) DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "branch" varchar(255);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "commit_author" varchar(255);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "subdomain" varchar(100);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "config" jsonb;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "image_ref" varchar(512);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "file_count" integer;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "error_message" text;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "build_started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "build_finished_at" timestamp;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "ready_at" timestamp;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "status" varchar(50) DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "verification_token" varchar(64);
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "redirect_to" varchar(255);
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "environment_variables" ADD COLUMN IF NOT EXISTS "target" varchar(16) DEFAULT 'all' NOT NULL;
--> statement-breakpoint
ALTER TABLE "environment_variables" ADD COLUMN IF NOT EXISTS "scope" varchar(16) DEFAULT 'both' NOT NULL;
--> statement-breakpoint
ALTER TABLE "environment_variables" ADD COLUMN IF NOT EXISTS "is_secret" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "environment_variables" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_repositories" ADD COLUMN IF NOT EXISTS "installation_id" bigint;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "slug" varchar(255);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "org_id" uuid;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "type" varchar(32) DEFAULT 'static' NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "start_command" varchar(255);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "dockerfile_path" varchar(255);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "port" integer DEFAULT 3000 NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "health_check_path" varchar(255) DEFAULT '/' NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "instance_plan" varchar(32) DEFAULT 'free' NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "instance_count" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cron_schedule" varchar(100);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "auto_deploy" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "preview_deployments" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "current_deployment_id" uuid;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
-- Backfill: every existing user that owns projects gets a personal team, and their projects move into it.
INSERT INTO "organizations" ("name", "slug", "plan", "is_personal", "created_by")
SELECT u."name" || '''s Team', 'team-' || substr(md5(u."id"), 1, 12), 'free', true, u."id"
FROM "user" u
WHERE EXISTS (SELECT 1 FROM "projects" p WHERE p."userId" = u."id")
  AND NOT EXISTS (
    SELECT 1 FROM "memberships" m JOIN "organizations" o ON o."id" = m."org_id"
    WHERE m."user_id" = u."id" AND o."is_personal"
  )
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "memberships" ("org_id", "user_id", "role")
SELECT o."id", o."created_by", 'owner' FROM "organizations" o
WHERE o."is_personal" AND o."created_by" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "projects" p
SET "org_id" = (SELECT o."id" FROM "organizations" o WHERE o."created_by" = p."userId" AND o."is_personal" ORDER BY o."created_at" LIMIT 1)
WHERE p."org_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "org_id" SET NOT NULL;
--> statement-breakpoint
-- Backfill: slugs for projects created before slugs existed; legacy "dynamic" frameworks become web services.
UPDATE "projects"
SET "slug" = trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || substr(md5("id"::text), 1, 6)
WHERE "slug" IS NULL;
--> statement-breakpoint
UPDATE "projects" SET "type" = 'web_service' WHERE "framework" IN ('Next.js', 'Node.js', 'Flask');
--> statement-breakpoint
UPDATE "deployments" SET "status" = 'READY' WHERE "status" = 'SUCCESS';
--> statement-breakpoint
-- Domains that were already serving traffic keep working (grandfathered as verified).
UPDATE "domains" SET "verified_at" = "created_at" WHERE "status" = 'active' AND "verified_at" IS NULL;
--> statement-breakpoint
UPDATE "domains" SET "verification_token" = replace(gen_random_uuid()::text, '-', '') WHERE "verification_token" IS NULL;
--> statement-breakpoint
-- (project, key, target) becomes unique: keep the newest of any legacy duplicates.
DELETE FROM "environment_variables" e
WHERE e."id" NOT IN (
  SELECT DISTINCT ON ("projectId", "key", "target") "id" FROM "environment_variables"
  ORDER BY "projectId", "key", "target", "created_at" DESC, "id"
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "instances" ADD CONSTRAINT "instances_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "instances" ADD CONSTRAINT "instances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "usage_hourly" ADD CONSTRAINT "usage_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects" ADD CONSTRAINT "projects_current_deployment_id_deployments_id_fk" FOREIGN KEY ("current_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_org_created_idx" ON "audit_logs" USING btree ("org_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instances_deployment_idx" ON "instances" USING btree ("deployment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instances_node_status_idx" ON "instances" USING btree ("node_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instances_project_idx" ON "instances" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_idx" ON "memberships" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployments_project_created_idx" ON "deployments" USING btree ("projectId","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployments_status_idx" ON "deployments" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domains_project_idx" ON "domains" USING btree ("projectId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domains_status_idx" ON "domains" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "env_vars_project_key_target_idx" ON "environment_variables" USING btree ("projectId","key","target");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_idx" ON "projects" USING btree ("org_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deployments" ADD CONSTRAINT "deployments_subdomain_unique" UNIQUE("subdomain");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects" ADD CONSTRAINT "projects_slug_unique" UNIQUE("slug");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
