import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';

export class DockerService {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async buildProject(
    workspacePath: string,
    buildCommand: string = 'npm run build',
    installCommand: string = 'npm install',
    outputDirectory: string = '.next',
    envVars: Record<string, string> = {},
    logCallback: (log: string) => void
  ): Promise<boolean> {
    const buildScriptContent = `#!/bin/sh
set -e
echo "[docker] Starting build process..."
cd /workspace
echo "[docker] Injecting environment variables..."
${Object.entries(envVars).map(([k, v]) => `export ${k}="${v}"`).join('\n')}
echo "[docker] Running install command: ${installCommand}"
${installCommand}
echo "[docker] Running build command: ${buildCommand}"
${buildCommand}
echo "[docker] Build completed successfully."
`;
    
    const scriptPath = path.join(workspacePath, '.orb-build.sh');
    fs.writeFileSync(scriptPath, buildScriptContent, { mode: 0o755 });

    logCallback('[docker] Preparing build container...');
    
    // Ensure node:20-alpine is available locally (in real-world you might pull it first)
    // await this.docker.pull('node:20-alpine');
    
    // Resolve absolute path for volume mount (works differently on Windows/Linux)
    const absoluteWorkspacePath = path.resolve(workspacePath);
    // On windows docker desktop, paths like D:\... need to be formatted correctly if using WSL2, but dockerode handles standard paths reasonably well if Docker Desktop is configured for it.
    // For safety, we'll convert backslashes to forward slashes for the bind mount string if needed, or let dockerode handle it.
    const bindPath = absoluteWorkspacePath.replace(/\\/g, '/');

    try {
      const container = await this.docker.createContainer({
        Image: 'node:20-alpine',
        Cmd: ['/bin/sh', '/workspace/.orb-build.sh'],
        HostConfig: {
          Binds: [`${bindPath}:/workspace`],
          AutoRemove: false,
        },
        Env: Object.entries(envVars).map(([k, v]) => `${k}=${v}`),
      });

      logCallback('[docker] Starting container...');
      await container.start();

      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

      stream.on('data', (chunk: Buffer) => {
        // Docker multiplexed stream parsing (stdout/stderr mix)
        // Usually, the first 8 bytes are the header: [type, 0, 0, 0, size1, size2, size3, size4]
        // But for simplicity in this implementation, we just convert to string.
        const output = chunk.toString('utf8');
        // Clean up some weird docker stream chars
        const cleanOutput = output.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
        if (cleanOutput.trim()) {
          logCallback(cleanOutput);
        }
      });

      const waitResult = await container.wait();
      
      // Cleanup container
      await container.remove();
      
      return waitResult.StatusCode === 0;
    } catch (error: any) {
      logCallback(`[error] Docker build failed: ${error.message}`);
      return false;
    }
  }
}
