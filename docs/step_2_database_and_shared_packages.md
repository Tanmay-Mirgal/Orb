# Step 2: Database & Shared Packages

## Goal
Set up the central data models, shared types, and storage clients that will be utilized by the apps.

## Action Items
1. **Database Package (`packages/database`):**
   - Initialize package: `npm init -y`.
   - Install Drizzle ORM and setup the schema in `src/schema.ts`.
   - Create schemas for:
     - Identity & Auth: `user`, `session`, `account`, `githubAccount`.
     - Project: `project`, `projectRepository`.
     - Deployments: `deployment`.
     - Infrastructure: `domain`, `environmentVariable`.
   - Setup Drizzle config and migration scripts.

2. **Storage Package (`packages/storage`):**
   - Initialize package and install the MinIO S3 client wrapper.
   - Create utilities to upload artifacts, stream downloads, and check object existence.

3. **Shared Package (`packages/shared`):**
   - Initialize package.
   - Define shared TypeScript interfaces/types (e.g., job payloads, deployment statuses).

4. **Verify:**
   - Run a migration to apply the schema to the local PostgreSQL database.
