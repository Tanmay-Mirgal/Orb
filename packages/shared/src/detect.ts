import type { ProjectType } from './constants';

/**
 * Framework / runtime detection. Pure and isomorphic: the dashboard feeds it files fetched through the
 * GitHub contents API, the build worker feeds it the cloned workspace. Same answer in both places.
 */

export interface FileProbe {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string | undefined>;
}

export type Runtime = 'node' | 'python' | 'go' | 'docker' | 'static';
export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export interface Detection {
  /** Preset id, e.g. `nextjs`, `vite`, `express`, `flask`, `static-html`, `dockerfile`. */
  framework: string;
  frameworkName: string;
  runtime: Runtime;
  suggestedType: ProjectType;
  packageManager?: PackageManager;
  installCommand: string;
  buildCommand: string;
  /** Empty for static sites. */
  startCommand: string;
  /** Static sites: directory (relative to the root directory) that is published. */
  outputDirectory: string;
  port: number;
  nodeMajor?: number;
  hasDockerfile: boolean;
  notes: string[];
}

export const SUPPORTED_NODE_MAJORS = [18, 20, 22, 24] as const;
export const DEFAULT_NODE_MAJOR = 22;

/** Maps `.nvmrc` / `engines.node` strings (`v20.11.1`, `>=18`, `^22`, `lts/*`) to a supported image major. */
export function pickNodeMajor(spec: string | undefined): number {
  if (!spec) return DEFAULT_NODE_MAJOR;
  const match = /(\d{2})/.exec(spec);
  if (!match) return DEFAULT_NODE_MAJOR;
  const wanted = Number(match[1]);
  const highest = SUPPORTED_NODE_MAJORS[SUPPORTED_NODE_MAJORS.length - 1]!;
  if (/[<>]/.test(spec)) {
    // A range such as ">=18" is satisfied by the default; never downgrade a modern project.
    return DEFAULT_NODE_MAJOR >= wanted ? DEFAULT_NODE_MAJOR : highest;
  }
  return SUPPORTED_NODE_MAJORS.find((m) => m >= wanted) ?? highest;
}

function joinPath(root: string, file: string): string {
  const clean = root.replace(/^\.?\/*/, '').replace(/\/+$/, '');
  return clean ? `${clean}/${file}` : file;
}

interface PackageJson {
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
}

function runScript(pm: PackageManager, script: string): string {
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'pnpm') return `pnpm run ${script}`;
  return `npm run ${script}`;
}

function installFor(pm: PackageManager, hasLock: boolean): string {
  if (pm === 'pnpm') return hasLock ? 'pnpm install --frozen-lockfile' : 'pnpm install';
  if (pm === 'yarn') return hasLock ? 'yarn install --frozen-lockfile' : 'yarn install';
  return hasLock ? 'npm ci' : 'npm install';
}

export async function detectProject(probe: FileProbe, rootDirectory = ''): Promise<Detection> {
  const at = (file: string) => joinPath(rootDirectory, file);
  const hasDockerfile = await probe.exists(at('Dockerfile'));
  const notes: string[] = [];

  const base: Detection = {
    framework: 'unknown',
    frameworkName: 'Unknown',
    runtime: 'static',
    suggestedType: 'static',
    installCommand: '',
    buildCommand: '',
    startCommand: '',
    outputDirectory: '.',
    port: 3000,
    hasDockerfile,
    notes,
  };

  const pkgRaw = await probe.read(at('package.json'));
  if (pkgRaw !== undefined) {
    let pkg: PackageJson = {};
    try {
      pkg = JSON.parse(pkgRaw) as PackageJson;
    } catch {
      notes.push('package.json is not valid JSON');
    }
    return detectNode(probe, at, pkg, base);
  }

  const requirements = (await probe.read(at('requirements.txt'))) ?? '';
  const pyproject = (await probe.read(at('pyproject.toml'))) ?? '';
  if (requirements || pyproject || (await probe.exists(at('Pipfile')))) {
    return detectPython(at, probe, requirements.toLowerCase() + '\n' + pyproject.toLowerCase(), base);
  }

  if (await probe.exists(at('go.mod'))) {
    return {
      ...base,
      framework: 'go',
      frameworkName: 'Go',
      runtime: 'go',
      suggestedType: 'web_service',
      installCommand: 'go mod download',
      buildCommand: 'go build -o app .',
      startCommand: './app',
      port: 8080,
    };
  }

  if (hasDockerfile) {
    return {
      ...base,
      framework: 'dockerfile',
      frameworkName: 'Dockerfile',
      runtime: 'docker',
      suggestedType: 'web_service',
      port: await detectExposedPort(probe, at('Dockerfile')),
    };
  }

  if ((await probe.exists(at('index.html'))) || (await probe.exists(at('public/index.html')))) {
    const publicDir = !(await probe.exists(at('index.html')));
    return {
      ...base,
      framework: 'static-html',
      frameworkName: 'Static HTML',
      runtime: 'static',
      outputDirectory: publicDir ? 'public' : '.',
    };
  }

  notes.push('No supported project files found. Choose a build configuration manually or add a Dockerfile.');
  return base;
}

async function detectExposedPort(probe: FileProbe, dockerfilePath: string): Promise<number> {
  const content = (await probe.read(dockerfilePath)) ?? '';
  const match = /^\s*EXPOSE\s+(\d{2,5})/im.exec(content);
  return match ? Number(match[1]) : 8080;
}

async function detectNode(
  probe: FileProbe,
  at: (f: string) => string,
  pkg: PackageJson,
  base: Detection,
): Promise<Detection> {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const has = (name: string) => name in deps;
  const scripts = pkg.scripts ?? {};
  const notes = base.notes;

  let pm: PackageManager = 'npm';
  let hasLock = false;
  if (await probe.exists(at('pnpm-lock.yaml'))) {
    pm = 'pnpm';
    hasLock = true;
  } else if (await probe.exists(at('yarn.lock'))) {
    pm = 'yarn';
    hasLock = true;
  } else if (await probe.exists(at('package-lock.json'))) {
    hasLock = true;
  }

  const nvmrc = (await probe.read(at('.nvmrc'))) ?? (await probe.read(at('.node-version')));
  const nodeMajor = pickNodeMajor(nvmrc?.trim() || pkg.engines?.node);
  const install = installFor(pm, hasLock);
  const build = scripts.build ? runScript(pm, 'build') : '';
  const start = scripts.start ? runScript(pm, 'start') : pkg.main ? `node ${pkg.main}` : 'node index.js';

  const staticSite = (
    framework: string,
    frameworkName: string,
    outputDirectory: string,
  ): Detection => ({
    ...base,
    framework,
    frameworkName,
    runtime: 'node',
    suggestedType: 'static',
    packageManager: pm,
    installCommand: install,
    buildCommand: build || runScript(pm, 'build'),
    startCommand: '',
    outputDirectory,
    nodeMajor,
  });

  const service = (framework: string, frameworkName: string, startCommand: string, port = 3000): Detection => ({
    ...base,
    framework,
    frameworkName,
    runtime: 'node',
    suggestedType: 'web_service',
    packageManager: pm,
    installCommand: install,
    buildCommand: build,
    startCommand,
    outputDirectory: '.',
    port,
    nodeMajor,
  });

  if (!hasLock) notes.push('No lockfile found: builds are not reproducible. Commit your lockfile.');

  if (has('next')) return service('nextjs', 'Next.js', runScript(pm, 'start'));
  if (has('nuxt')) return service('nuxt', 'Nuxt', 'node .output/server/index.mjs');
  if (has('@remix-run/node') || has('@remix-run/serve') || has('react-router')) {
    if (scripts.start) return service('remix', 'Remix / React Router', runScript(pm, 'start'));
  }
  if (has('astro')) {
    if (has('@astrojs/node')) return service('astro-ssr', 'Astro (SSR)', 'node ./dist/server/entry.mjs', 4321);
    return staticSite('astro', 'Astro', 'dist');
  }
  if (has('@sveltejs/kit')) {
    if (has('@sveltejs/adapter-node')) return service('sveltekit', 'SvelteKit (Node)', 'node build');
    return staticSite('sveltekit-static', 'SvelteKit (static)', 'build');
  }
  if (has('gatsby')) return staticSite('gatsby', 'Gatsby', 'public');
  if (has('@docusaurus/core')) return staticSite('docusaurus', 'Docusaurus', 'build');
  if (has('@11ty/eleventy')) return staticSite('eleventy', 'Eleventy', '_site');
  if (has('react-scripts')) return staticSite('cra', 'Create React App', 'build');
  if (has('@vue/cli-service')) return staticSite('vue-cli', 'Vue CLI', 'dist');
  if (has('@angular/core')) {
    notes.push('Angular output folder is dist/<project>/browser. Adjust the output directory if it differs.');
    return staticSite('angular', 'Angular', 'dist');
  }
  if (has('vite')) return staticSite('vite', 'Vite', 'dist');

  if (has('@nestjs/core')) {
    return service(
      'nestjs',
      'NestJS',
      scripts['start:prod'] ? runScript(pm, 'start:prod') : 'node dist/main',
    );
  }
  for (const [dep, id, name] of [
    ['express', 'express', 'Express'],
    ['fastify', 'fastify', 'Fastify'],
    ['koa', 'koa', 'Koa'],
    ['hono', 'hono', 'Hono'],
    ['@hapi/hapi', 'hapi', 'Hapi'],
  ] as const) {
    if (has(dep)) return service(id, name, start);
  }

  if (scripts.start) return service('node', 'Node.js', start);
  if (scripts.build) {
    notes.push('Build script found without a framework. Assuming a static output in "dist".');
    return staticSite('node-static', 'Node.js build', 'dist');
  }
  return service('node', 'Node.js', start);
}

async function detectPython(
  at: (f: string) => string,
  probe: FileProbe,
  deps: string,
  base: Detection,
): Promise<Detection> {
  const notes = base.notes;
  const common = {
    ...base,
    runtime: 'python' as const,
    suggestedType: 'web_service' as const,
    installCommand: (await probe.exists(at('requirements.txt'))) ? 'pip install -r requirements.txt' : 'pip install .',
    buildCommand: '',
    port: 8000,
  };
  const hasGunicorn = deps.includes('gunicorn');
  if (deps.includes('fastapi')) {
    return { ...common, framework: 'fastapi', frameworkName: 'FastAPI', startCommand: 'uvicorn main:app --host 0.0.0.0 --port $PORT' };
  }
  if (deps.includes('flask')) {
    if (!hasGunicorn) notes.push('Add gunicorn to requirements.txt for a production-grade Flask server.');
    return {
      ...common,
      framework: 'flask',
      frameworkName: 'Flask',
      startCommand: hasGunicorn ? 'gunicorn app:app --bind 0.0.0.0:$PORT' : 'python app.py',
    };
  }
  if (deps.includes('django')) {
    notes.push('Set the start command to gunicorn <your_project>.wsgi --bind 0.0.0.0:$PORT.');
    return { ...common, framework: 'django', frameworkName: 'Django', startCommand: 'gunicorn config.wsgi --bind 0.0.0.0:$PORT' };
  }
  return { ...common, framework: 'python', frameworkName: 'Python', startCommand: 'python main.py' };
}
