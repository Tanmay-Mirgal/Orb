import { Job } from 'bullmq';
import { JobPayload, DeploymentStatus } from 'shared';
import { GitService } from './services/GitService';
import { DockerService } from './services/DockerService';
import { ArtifactService } from './services/ArtifactService';
import { deployments } from 'database';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as fs from 'fs';
import Redis from 'ioredis';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://orb:password@localhost:5432/orb');
const db = drizzle(sql);

const gitService = new GitService();
const dockerService = new DockerService();
const artifactService = new ArtifactService();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function processDeploymentJob(job: Job<JobPayload>) {
  const payload = job.data;
  const workspacePath = path.join('/tmp', 'orb-deployments', payload.deploymentId);
  const logKey = \`logs:\${payload.deploymentId}\`;
  
  const log = async (message: string) => {
    const timestamp = new Date().toISOString();
    const logLine = \`[\${timestamp}] \${message}\`;
    console.log(\`[\${payload.deploymentId}] \${message}\`);
    // Publish to redis for realtime and push to a list for history
    await redis.rpush(logKey, logLine);
    await redis.publish(logKey, logLine);
  };

  try {
    await log('[worker] Job picked up. Initializing workspace...');
    await db.update(deployments)
      .set({ status: DeploymentStatus.BUILDING })
      .where(eq(deployments.id, payload.deploymentId));

    // 1. Clone repository
    await log(\`[git] Cloning repository \${payload.githubRepositoryName} (branch: \${payload.branch})...\`);
    // Assuming public repo for now. In real app, fetch github token for private repos.
    await gitService.cloneRepository(
      \`https://github.com/\${payload.githubRepositoryName}.git\`,
      workspacePath,
      payload.branch
    );
    await log('[git] Repository cloned successfully.');

    // 2. Framework Detection (Mocked/Inferred for now)
    let buildCommand = payload.buildCommand || 'npm run build';
    let outputDirectory = payload.outputDirectory || '.next';
    let installCommand = 'npm install';

    if (fs.existsSync(path.join(workspacePath, 'yarn.lock'))) {
      installCommand = 'yarn install';
      if (!payload.buildCommand) buildCommand = 'yarn build';
    } else if (fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) {
      installCommand = 'npx pnpm install';
      if (!payload.buildCommand) buildCommand = 'npx pnpm build';
    }

    // 3. Docker Sandbox Build
    await log('[docker] Starting sandboxed build...');
    const buildSuccess = await dockerService.buildProject(
      workspacePath,
      buildCommand,
      installCommand,
      outputDirectory,
      payload.environmentVariables || {},
      (msg) => { log(msg).catch(console.error); }
    );

    if (!buildSuccess) {
      throw new Error('Build process failed inside Docker container.');
    }

    // 4. Artifact Upload
    await log(\`[artifact] Uploading build output from \${outputDirectory}...\`);
    await artifactService.uploadArtifact(workspacePath, outputDirectory, payload.deploymentId);
    await log('[artifact] Upload completed successfully.');

    // 5. Cleanup and Success
    await log('[worker] Cleaning up workspace...');
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    await db.update(deployments)
      .set({ status: DeploymentStatus.SUCCESS })
      .where(eq(deployments.id, payload.deploymentId));
    
    await log('[worker] Deployment completed successfully!');

  } catch (error: any) {
    await log(\`[error] Deployment failed: \${error.message}\`);
    await db.update(deployments)
      .set({ status: DeploymentStatus.FAILED })
      .where(eq(deployments.id, payload.deploymentId));
    throw error;
  }
}
