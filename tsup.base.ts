import type { Options } from 'tsup';

/**
 * Shared bundling config for the backend services.
 * Workspace packages ship as TypeScript source, so they are bundled into the service; every
 * third-party package stays external and is resolved from node_modules at runtime (BullMQ, pino and the
 * AWS SDK load files relative to themselves and must not be inlined).
 */
export function serviceConfig(workspacePackages: string[]): Options {
  const workspace = new Set(workspacePackages);
  return {
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    clean: true,
    sourcemap: true,
    noExternal: workspacePackages,
    esbuildPlugins: [
      {
        name: 'externalize-third-party',
        setup(build) {
          build.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.path.startsWith('node:')) return undefined;
            const name = args.path.startsWith('@') ? args.path.split('/').slice(0, 2).join('/') : args.path.split('/')[0]!;
            if (workspace.has(name)) return undefined;
            return { path: args.path, external: true };
          });
        },
      },
    ],
  };
}
