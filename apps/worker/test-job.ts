import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { JobPayload } from 'shared';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const queue = new Queue('deployments', { connection });

async function run() {
  const payload: JobPayload = {
    deploymentId: 'test-deployment-' + Date.now(),
    projectId: 'test-project',
    githubRepositoryName: 'Tanmay-Mirgal/orb',
    githubRepositoryId: 12345,
    branch: 'main',
    buildCommand: 'echo "Mock build..."',
    outputDirectory: 'docs',
    environmentVariables: {
      TEST_ENV: 'Hello World'
    }
  };

  console.log('Pushing test job to queue...');
  await queue.add('deploy-job', payload);
  console.log('Job added successfully!');
  
  process.exit(0);
}

run().catch(console.error);
