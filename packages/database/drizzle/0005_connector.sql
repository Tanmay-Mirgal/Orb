CREATE TABLE "connector_codes" (
	"code_hash" varchar(64) PRIMARY KEY NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"user_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" varchar(128) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"grant_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"webhook_id" uuid NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"response_code" integer,
	"response_excerpt" text,
	"last_error" varchar(255),
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "connector_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"payload" jsonb NOT NULL,
	"external_ref" jsonb,
	"seq" bigserial NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"dispatched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"user_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"access_hash" varchar(64) NOT NULL,
	"access_expires_at" timestamp NOT NULL,
	"refresh_hash" varchar(64) NOT NULL,
	"refresh_family_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"refresh_expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"revoke_reason" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "connector_idempotency" (
	"grant_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"state" varchar(12) DEFAULT 'processing' NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "connector_idempotency_grant_id_key_pk" PRIMARY KEY("grant_id","key")
);
--> statement-breakpoint
CREATE TABLE "connector_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"deadline_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "connector_used_refresh" (
	"refresh_hash" varchar(64) PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"event_filter" text[] NOT NULL,
	"description" varchar(255),
	"secret_enc" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"disabled_reason" varchar(64),
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"failing_since" timestamp,
	"last_delivery_at" timestamp,
	"last_delivery_status" varchar(16),
	"last_response_code" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "via" varchar(16);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "client_id" varchar(128);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "grant_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "request_id" varchar(64);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "external_ref" jsonb;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "created_via" varchar(16);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "external_ref" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "created_via" varchar(16);--> statement-breakpoint
ALTER TABLE "connector_codes" ADD CONSTRAINT "connector_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_codes" ADD CONSTRAINT "connector_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_codes" ADD CONSTRAINT "connector_codes_grant_id_connector_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."connector_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_deliveries" ADD CONSTRAINT "connector_deliveries_event_id_connector_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."connector_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_deliveries" ADD CONSTRAINT "connector_deliveries_webhook_id_connector_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."connector_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_events" ADD CONSTRAINT "connector_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_grants" ADD CONSTRAINT "connector_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_grants" ADD CONSTRAINT "connector_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_idempotency" ADD CONSTRAINT "connector_idempotency_grant_id_connector_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."connector_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_operations" ADD CONSTRAINT "connector_operations_grant_id_connector_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."connector_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_operations" ADD CONSTRAINT "connector_operations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_used_refresh" ADD CONSTRAINT "connector_used_refresh_grant_id_connector_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."connector_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_webhooks" ADD CONSTRAINT "connector_webhooks_grant_id_connector_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."connector_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_webhooks" ADD CONSTRAINT "connector_webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_codes_expires_idx" ON "connector_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_deliveries_event_webhook_idx" ON "connector_deliveries" USING btree ("event_id","webhook_id");--> statement-breakpoint
CREATE INDEX "connector_deliveries_due_idx" ON "connector_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "connector_deliveries_webhook_idx" ON "connector_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_events_seq_idx" ON "connector_events" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "connector_events_org_order_idx" ON "connector_events" USING btree ("org_id","tx_id","seq");--> statement-breakpoint
CREATE INDEX "connector_events_pending_idx" ON "connector_events" USING btree ("seq") WHERE dispatched_at IS NULL;--> statement-breakpoint
CREATE INDEX "connector_events_created_idx" ON "connector_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_grants_access_hash_idx" ON "connector_grants" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_grants_refresh_hash_idx" ON "connector_grants" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "connector_grants_user_idx" ON "connector_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "connector_grants_org_idx" ON "connector_grants" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "connector_idempotency_expires_idx" ON "connector_idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "connector_operations_grant_idx" ON "connector_operations" USING btree ("grant_id","created_at");--> statement-breakpoint
CREATE INDEX "connector_operations_open_idx" ON "connector_operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "connector_used_refresh_grant_idx" ON "connector_used_refresh" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "connector_webhooks_grant_idx" ON "connector_webhooks" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "connector_webhooks_org_status_idx" ON "connector_webhooks" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "audit_logs_grant_idx" ON "audit_logs" USING btree ("grant_id","created_at");