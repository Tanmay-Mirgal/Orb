import { StaticService } from './StaticService';
import { spawn, ChildProcess } from 'child_process';
import getPort from 'get-port';
import httpProxy from 'http-proxy';
import express from 'express';
import * as path from 'path';

export class RunnerService {
  private staticService: StaticService;
  private runningDeployments = new Map<string, { port: number, process: ChildProcess }>();
  private proxy = httpProxy.createProxyServer({});

  constructor(staticService: StaticService) {
    this.staticService = staticService;
    
    this.proxy.on('error', (err, req, res) => {
      console.error('Proxy error:', err);
      if (res && (res as any).writeHead) {
        (res as any).writeHead(502, { 'Content-Type': 'text/plain' });
        (res as any).end('Bad Gateway: The dynamic deployment is not responding.');
      }
    });
  }

  async ensureRunning(deploymentId: string): Promise<number> {
    if (this.runningDeployments.has(deploymentId)) {
      return this.runningDeployments.get(deploymentId)!.port;
    }

    // 1. Ensure artifact is cached
    const deployDir = await this.staticService.ensureArtifactCached(deploymentId);

    // 2. Allocate a port
    const port = await getPort();

    // 3. Spawn process
    console.log(`Starting dynamic deployment ${deploymentId} on port ${port}...`);
    
    // For Next.js standalone, the entry point is server.js
    // Alternatively, if it's a basic node app, it might be index.js.
    // Assuming standard Next.js standalone output for MVP.
    const serverJsPath = path.join(deployDir, 'standalone', 'server.js');
    
    // Fallback: If standalone doesn't exist, try running npm start
    const cmd = 'node';
    const args = [serverJsPath];
    
    const child = spawn(cmd, args, {
      cwd: deployDir,
      env: {
        ...process.env,
        PORT: port.toString(),
        NODE_ENV: 'production',
      }
    });

    child.stdout.on('data', (data) => console.log(`[SSR:${deploymentId}] ${data}`));
    child.stderr.on('data', (data) => console.error(`[SSR:${deploymentId}] ${data}`));

    child.on('close', (code) => {
      console.log(`[SSR:${deploymentId}] exited with code ${code}`);
      this.runningDeployments.delete(deploymentId);
    });

    this.runningDeployments.set(deploymentId, { port, process: child });

    // Wait a brief moment for the server to bind to the port
    await new Promise(resolve => setTimeout(resolve, 1500));

    return port;
  }

  async handleRequest(req: express.Request, res: express.Response, deploymentId: string) {
    try {
      const port = await this.ensureRunning(deploymentId);
      this.proxy.web(req, res, { target: `http://localhost:${port}` });
    } catch (err) {
      console.error('Failed to start deployment:', err);
      res.status(500).send('Internal Server Error: Failed to start dynamic deployment');
    }
  }
}
