import express from 'express';
import { RoutingService } from './services/RoutingService';
import { StaticService } from './services/StaticService';
import { RunnerService } from './services/RunnerService';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

const routingService = new RoutingService();
const staticService = new StaticService();
const runnerService = new RunnerService(staticService);

console.log('🚀 Orb Edge Proxy initializing...');

app.use(async (req, res, next) => {
  try {
    const host = req.hostname;
    
    // Resolve host
    const resolution = await routingService.resolveHost(host);
    
    if (!resolution) {
      res.status(404).send(\`
        <html>
          <body style="font-family: system-ui; background: #09090b; color: white; display: flex; align-items: center; justify-content: center; height: 100vh;">
            <div style="text-align: center;">
              <h1>Deployment Not Found</h1>
              <p style="color: #a1a1aa;">The domain <strong>\${host}</strong> is not configured or has no active deployments.</p>
            </div>
          </body>
        </html>
      \`);
      return;
    }

    if (resolution.isStatic) {
      await staticService.handleRequest(req, res, resolution.deploymentId);
    } else {
      await runnerService.handleRequest(req, res, resolution.deploymentId);
    }
  } catch (error) {
    console.error('Error handling request:', error);
    res.status(500).send('Internal Edge Proxy Error');
  }
});

app.listen(port, () => {
  console.log(\`🌍 Edge proxy listening on port \${port}\`);
});
