import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';

const NPM_CACHE_VOLUME = 'orb-npm-cache';
const IMAGE = 'node:20-alpine';

export class DockerService {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  private async ensureImage(): Promise<void> {
    try {
      await this.docker.getImage(IMAGE).inspect();
    } catch {
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(IMAGE, (err: any, stream: any) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (err: any) => {
            if (err) return reject(err);
            resolve();
          });
        });
      });
    }
  }

  private async ensureCacheVolume(): Promise<void> {
    try {
      await this.docker.getVolume(NPM_CACHE_VOLUME).inspect();
    } catch {
      await this.docker.createVolume({ Name: NPM_CACHE_VOLUME });
    }
  }

  async buildProject(
    workspacePath: string,
    buildCommand: string = 'npm run build',
    installCommand: string = 'npm install',
    outputDirectory: string = '.next',
    envVars: Record<string, string> = {},
    rootDirectory: string = './',
    logCallback: (log: string) => void
  ): Promise<boolean> {
    // Inline env exports
    const envExports = Object.entries(envVars)
      .map(([k, v]) => `export ${k}="${v}"`)
      .join('\n');

    // Optimized build script:
    // - Uses npm ci for faster installs when package-lock.json exists
    // - Sets npm cache to persistent volume
    const buildScriptContent = `#!/bin/sh
set -e
export NPM_CONFIG_CACHE=/npm-cache

cd /workspace
if [ "${rootDirectory}" != "./" ] && [ "${rootDirectory}" != "." ] && [ "${rootDirectory}" != "" ]; then
  cd ${rootDirectory}
fi

${envExports}

echo "[build] Installing dependencies..."
if [ -f "package-lock.json" ]; then
  npm ci --prefer-offline 2>&1
elif [ -f "yarn.lock" ]; then
  yarn install --frozen-lockfile 2>&1
elif [ -f "pnpm-lock.yaml" ]; then
  npx --yes pnpm install --frozen-lockfile 2>&1
else
  ${installCommand} 2>&1
fi

echo "[build] Running build..."
${buildCommand} 2>&1
echo "[build] Done!"
`;

    const scriptPath = path.join(workspacePath, '.orb-build.sh');
    fs.writeFileSync(scriptPath, buildScriptContent, { mode: 0o755 });

    logCallback('[docker] Preparing build environment...');
    await this.ensureImage();
    await this.ensureCacheVolume();

    const absoluteWorkspacePath = path.resolve(workspacePath);
    const bindPath = absoluteWorkspacePath.replace(/\\/g, '/');

    try {
      const container = await this.docker.createContainer({
        Image: IMAGE,
        Cmd: ['/bin/sh', '/workspace/.orb-build.sh'],
        HostConfig: {
          Binds: [`${bindPath}:/workspace`],
          Mounts: [
            {
              Type: 'volume',
              Source: NPM_CACHE_VOLUME,
              Target: '/npm-cache',
            }
          ],
          AutoRemove: false,
          // Resource limits for stability
          Memory: 1024 * 1024 * 1024, // 1GB
          NanoCpus: 2 * 1e9, // 2 CPUs
        },
        Env: Object.entries(envVars).map(([k, v]) => `${k}=${v}`),
        WorkingDir: '/workspace',
      });

      logCallback('[docker] Starting build container...');
      await container.start();

      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

      stream.on('data', (chunk: Buffer) => {
        const output = chunk.toString('utf8');
        const cleanOutput = output.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '').trim();
        if (cleanOutput) {
          logCallback(cleanOutput);
        }
      });

      const waitResult = await container.wait();
      await container.remove();

      return waitResult.StatusCode === 0;
    } catch (error: any) {
      logCallback(`[error] Docker build failed: ${error.message}`);
      return false;
    }
  }
}
