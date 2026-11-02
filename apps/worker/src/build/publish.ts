import * as fs from 'node:fs';
import * as path from 'node:path';
import mime from 'mime-types';
import { parseOrbConfig, type OrbConfig } from 'shared';
import { storageKeys, type ObjectStorage } from 'storage';
import type { WorkerConfig } from '../config';

export interface SiteManifest {
  version: 1;
  createdAt: string;
  files: Record<string, { size: number; type: string }>;
  config: OrbConfig | null;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.orb-build']);

interface FoundFile {
  rel: string;
  abs: string;
  size: number;
}

function walk(root: string, limits: WorkerConfig): FoundFile[] {
  const found: FoundFile[] = [];
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // never follow links out of the build output
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const size = fs.statSync(abs).size;
      if (size > limits.maxSiteFileBytes) {
        throw new Error(`File ${path.relative(root, abs)} is larger than ${limits.maxSiteFileBytes / 1024 / 1024} MB`);
      }
      total += size;
      if (found.length + 1 > limits.maxSiteFiles) throw new Error(`Site has more than ${limits.maxSiteFiles} files`);
      if (total > limits.maxSiteBytes) throw new Error(`Site is larger than ${limits.maxSiteBytes / 1024 / 1024} MB`);
      found.push({ rel: path.relative(root, abs).split(path.sep).join('/'), abs, size });
    }
  }
  return found;
}

/** Reads and validates `orb.json` (if present) so mistakes fail the build instead of the live site. */
export function loadOrbConfig(...dirs: string[]): OrbConfig | null {
  for (const dir of dirs) {
    const file = path.join(dir, 'orb.json');
    if (!fs.existsSync(file)) continue;
    const parsed = parseOrbConfig(fs.readFileSync(file, 'utf8'));
    if (parsed.error) throw new Error(parsed.error);
    return parsed.config ?? null;
  }
  return null;
}

/** Uploads a build output directory to object storage, one object per file, plus a manifest. */
export async function publishStaticSite(options: {
  storage: ObjectStorage;
  deploymentId: string;
  dir: string;
  config: OrbConfig | null;
  limits: WorkerConfig;
  signal?: AbortSignal;
}): Promise<{ fileCount: number; totalBytes: number }> {
  const { storage, deploymentId, dir } = options;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Output directory "${path.basename(dir)}" does not exist after the build`);
  }
  const files = walk(dir, options.limits);
  if (files.length === 0) throw new Error('The output directory is empty');

  const manifest: SiteManifest = { version: 1, createdAt: new Date().toISOString(), files: {}, config: options.config };
  const queue = [...files];
  let uploaded = 0;
  const worker = async () => {
    for (;;) {
      if (options.signal?.aborted) throw new Error('Canceled');
      const file = queue.pop();
      if (!file) return;
      const type = mime.contentType(path.basename(file.rel)) || 'application/octet-stream';
      manifest.files[file.rel] = { size: file.size, type };
      await storage.put(storageKeys.siteFile(deploymentId, file.rel), fs.createReadStream(file.abs), { contentType: type }, file.size);
      uploaded++;
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  // The manifest goes last: a deployment is only servable once it exists.
  await storage.put(storageKeys.siteManifest(deploymentId), JSON.stringify(manifest), { contentType: 'application/json' });
  return { fileCount: uploaded, totalBytes: files.reduce((n, f) => n + f.size, 0) };
}
