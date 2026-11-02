import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { GetOptions, GetResult, ObjectHead, ObjectStorage, PutOptions } from './types';

/**
 * Filesystem-backed storage for local development and single-node installs.
 * Do NOT use in multi-node production: edge nodes and build workers must see the same objects.
 */
export class FsStorage implements ObjectStorage {
  readonly driver = 'fs' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolves a key to a path and refuses anything that escapes the root (`..`, absolute paths). */
  private resolve(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return resolved;
  }

  async ensureReady(): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true });
  }

  async ping(): Promise<void> {
    await fsp.access(this.root, fs.constants.R_OK | fs.constants.W_OK);
  }

  async put(key: string, body: Buffer | string | Readable, _options?: PutOptions, _size?: number): Promise<void> {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      await fsp.writeFile(tmp, body);
    } else {
      await pipeline(body, fs.createWriteStream(tmp));
    }
    await fsp.rename(tmp, target);
  }

  private etagFor(stat: fs.Stats): string {
    return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  }

  async get(key: string, options: GetOptions = {}): Promise<GetResult | null> {
    const target = this.resolve(key);
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(target);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    const etag = this.etagFor(stat);
    if (options.ifNoneMatch && options.ifNoneMatch === etag) {
      return { body: Readable.from([]), size: 0, etag, notModified: true };
    }
    const range = options.range ? /^bytes=(\d*)-(\d*)$/.exec(options.range) : null;
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        return {
          body: fs.createReadStream(target, { start, end }),
          size: end - start + 1,
          etag,
          contentRange: `bytes ${start}-${end}/${stat.size}`,
        };
      }
    }
    return { body: fs.createReadStream(target), size: stat.size, etag };
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const stat = await fsp.stat(this.resolve(key));
      return stat.isFile() ? { size: stat.size, etag: this.etagFor(stat) } : null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    for await (const { key } of this.list(prefix)) {
      await this.delete(key);
      removed++;
    }
    // best effort: drop the now-empty directory tree for directory-style prefixes
    await fsp.rm(this.resolve(prefix.replace(/\/+$/, '')), { recursive: true, force: true }).catch(() => undefined);
    return removed;
  }

  async *list(prefix: string): AsyncIterable<{ key: string; size: number }> {
    const startDir = path.dirname(this.resolve(`${prefix}x`));
    const stack = [startDir];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          const key = path.relative(this.root, full).split(path.sep).join('/');
          if (key.startsWith(prefix) && !key.endsWith('.tmp')) {
            const stat = await fsp.stat(full);
            yield { key, size: stat.size };
          }
        }
      }
    }
  }
}
