import { Worker } from 'bullmq';
import { processDeploymentJob } from './processor';
import * as dotenv from 'dotenv';
import Redis from 'ioredis';

dotenv.config();

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

console.log('🚀 Orb Worker initializing...');

const worker = new Worker('deployments', processDeploymentJob, {
  connection,
  concurrency: 2, // process 2 deployments concurrently
});

worker.on('completed', (job) => {
  console.log(\`✅ Job \${job.id} has completed successfully\`);
});

worker.on('failed', (job, err) => {
  console.log(\`❌ Job \${job?.id} has failed: \${err.message}\`);
});

worker.on('error', (err) => {
  console.error(err);
});

console.log('🎧 Worker listening on "deployments" queue...');

process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await worker.close();
  process.exit(0);
});
