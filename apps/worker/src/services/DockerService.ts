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

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(image, (err: any, stream: any) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (err: any) => {
            if (err) return reject(err);
            resolve();
          });
        });
      });
    }
  }

  private async ensureCacheVolume(volumeName: string): Promise<void> {
    try {
      await this.docker.getVolume(volumeName).inspect();
    } catch {
      await this.docker.createVolume({ Name: volumeName });
    }
  }

  async buildProject(
    workspacePath: string,
    buildCommand: string = 'npm run build',
    installCommand: string = 'npm install',
    outputDirectory: string = '.next',
    envVars: Record<string, string> = {},
    rootDirectory: string = './',
    framework: string = 'Node.js',
    logCallback: (log: string) => void
  ): Promise<boolean> {
    const isFlask = framework === 'Flask';
    const dockerImage = isFlask ? 'python:3.10-alpine' : 'node:20-alpine';
    const cacheVolume = isFlask ? 'orb-pip-cache' : 'orb-npm-cache';
    const cacheTarget = isFlask ? '/root/.cache/pip' : '/npm-cache';

    // Inline env exports
    const envExports = Object.entries(envVars)
      .map(([k, v]) => `export ${k}="${v}"`)
      .join('\n');

    let installScript = '';
    if (isFlask) {
      installScript = `
echo "[build] Installing dependencies..."
${installCommand} 2>&1
`;
    } else {
      installScript = `
export NPM_CONFIG_CACHE=/npm-cache
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
`;
    }

    let buildActionScript = '';
    if (buildCommand && buildCommand.trim() !== '') {
      // Auto-detect Next.js even if framework field is not set
      const isNextJs = framework === 'Next.js';
      if (isNextJs) {
        buildActionScript = `
echo "[build] Configuring Next.js standalone mode..."
node << 'NODEJS_EOF'
const fs = require('fs');
const configFiles = ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];
const configFile = configFiles.find(f => fs.existsSync(f));

if (!configFile) {
  fs.writeFileSync('next.config.js', "module.exports = { output: 'standalone' };\n");
  console.log('[build] Created next.config.js with standalone output.');
} else {
  let content = fs.readFileSync(configFile, 'utf8');
  if (content.includes('standalone')) {
    console.log('[build] standalone already configured in ' + configFile);
  } else {
    const isEsm = configFile.endsWith('.ts') || configFile.endsWith('.mjs');
    if (isEsm) {
      const injected = content.replace(
        /(\bconst\s+\w+\s*(?::\s*\w+(?:<\w+>)?\s*)?\s*=\s*\{)/,
        "$1\n  output: 'standalone',"
      );
      if (injected !== content) {
        fs.writeFileSync(configFile, injected);
      } else {
        const mutated = content.replace(
          /export\s+default\s+(\w+)\s*;?/,
          "$1.output = 'standalone';\nexport default $1;"
        );
        fs.writeFileSync(configFile, mutated);
      }
    } else {
      content += "\nmodule.exports.output = 'standalone';\n";
      fs.writeFileSync(configFile, content);
    }
    console.log('[build] Injected standalone output into ' + configFile);
  }
}
NODEJS_EOF
echo "[build] Running build..."
${buildCommand} 2>&1
echo "[build] Finalizing Next.js standalone server..."
mkdir -p .next/standalone/public
mkdir -p .next/standalone/.next/static
cp -r public/* .next/standalone/public/ 2>/dev/null || true
cp -r .next/static/* .next/standalone/.next/static/ 2>/dev/null || true
`;
      } else {
        // Auto-detect Next.js from filesystem
        buildActionScript = `
echo "[build] Running build..."
${buildCommand} 2>&1

# Auto-detect Next.js: if next.config.* found, finalize standalone
NEXT_CONFIG=$(ls next.config.ts next.config.mjs next.config.js next.config.cjs 2>/dev/null | head -1)
if [ -n "$NEXT_CONFIG" ] || [ -d ".next" ]; then
  echo "[build] Next.js detected - checking for standalone output..."
  if [ ! -d ".next/standalone" ]; then
    echo "[build] WARNING: .next/standalone not found. Rebuild with output:standalone configured."
    echo "[build] Injecting standalone config and rebuilding..."
    node << 'NODEJS_EOF'
const fs = require('fs');
const configFiles = ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];
const configFile = configFiles.find(f => fs.existsSync(f));
if (!configFile) {
  fs.writeFileSync('next.config.js', "module.exports = { output: 'standalone' };\n");
} else {
  let content = fs.readFileSync(configFile, 'utf8');
  if (!content.includes('standalone')) {
    const isEsm = configFile.endsWith('.ts') || configFile.endsWith('.mjs');
    if (isEsm) {
      const injected = content.replace(
        /(\bconst\s+\w+\s*(?::\s*\w+(?:<\w+>)?\s*)?\s*=\s*\{)/,
        "$1\n  output: 'standalone',"
      );
      if (injected !== content) {
        fs.writeFileSync(configFile, injected);
      } else {
        const mutated = content.replace(
          /export\s+default\s+(\w+)\s*;?/,
          "$1.output = 'standalone';\nexport default $1;"
        );
        fs.writeFileSync(configFile, mutated);
      }
    } else {
      content += "\nmodule.exports.output = 'standalone';\n";
      fs.writeFileSync(configFile, content);
    }
    console.log('[build] Injected standalone - rebuilding...');
  }
}
NODEJS_EOF
    ${buildCommand} 2>&1
  fi
  mkdir -p .next/standalone/public
  mkdir -p .next/standalone/.next/static
  cp -r public/* .next/standalone/public/ 2>/dev/null || true
  cp -r .next/static/* .next/standalone/.next/static/ 2>/dev/null || true
fi
`;
      }
    }

    const buildScriptContent = `#!/bin/sh
set -e

cd /workspace
if [ "${rootDirectory}" != "./" ] && [ "${rootDirectory}" != "." ] && [ "${rootDirectory}" != "" ]; then
  cd ${rootDirectory}
fi

${envExports}
${installScript}
${buildActionScript}

echo "[build] Fixing permissions..."
chmod -R 777 . 2>&1 || true
echo "[build] Done!"
`;

    const scriptPath = path.join(workspacePath, '.orb-build.sh');
    fs.writeFileSync(scriptPath, buildScriptContent, { mode: 0o755 });

    logCallback('[docker] Preparing build environment...');
    await this.ensureImage(dockerImage);
    await this.ensureCacheVolume(cacheVolume);

    const absoluteWorkspacePath = path.resolve(workspacePath);
    const bindPath = absoluteWorkspacePath.replace(/\\/g, '/');

    try {
      const container = await this.docker.createContainer({
        Image: dockerImage,
        Cmd: ['/bin/sh', '/workspace/.orb-build.sh'],
        HostConfig: {
          Binds: [`${bindPath}:/workspace`],
          Mounts: [
            {
              Type: 'volume',
              Source: cacheVolume,
              Target: cacheTarget,
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
