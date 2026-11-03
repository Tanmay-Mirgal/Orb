CREATE TABLE IF NOT EXISTS "project_registry_credentials" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"registry" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "source_type" varchar(16) DEFAULT 'git' NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "docker_image" varchar(255);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_registry_credentials" ADD CONSTRAINT "project_registry_credentials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
