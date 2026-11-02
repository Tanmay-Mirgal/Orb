-- Complimentary Team plan for the platform owner: 5 years from the day this migration runs.
-- The grant row is what keeps applying it (login hook, newly created teams); the UPDATE below applies it
-- immediately to the teams that already exist. Both statements are safe to re-run.
INSERT INTO "plan_grants" ("email", "plan", "expires_at", "note")
VALUES ('tanmaymirgal26@gmail.com', 'team', now() + interval '5 years', 'Platform owner: complimentary Team plan for 5 years')
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
UPDATE "organizations" AS o
SET "plan" = g."plan", "plan_source" = 'grant', "plan_expires_at" = g."expires_at", "updated_at" = now()
FROM "plan_grants" AS g, "memberships" AS m, "user" AS u
WHERE m."org_id" = o."id"
  AND m."role" = 'owner'
  AND u."id" = m."user_id"
  AND lower(u."email") = g."email"
  AND o."plan_source" <> 'paid'
  AND o."plan" <> g."plan";
