import postgres from 'postgres';

const sql = postgres('postgresql://orb:password@localhost:5432/orb');

const setup = async () => {
  try {
    await sql`CREATE TABLE IF NOT EXISTS "environment_variables" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "projectId" uuid NOT NULL,
      "key" varchar(255) NOT NULL,
      "value" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "environment_variables_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade
    );`;
    console.log('environment_variables table created!');
    
    await sql`CREATE TABLE IF NOT EXISTS "domains" (
      "domain" varchar(255) PRIMARY KEY NOT NULL,
      "projectId" uuid NOT NULL,
      "status" varchar(50) DEFAULT 'pending' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "domains_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE cascade
    );`;
    console.log('domains table created!');
    
  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit();
  }
};

setup();
