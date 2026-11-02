import type { Readable } from 'node:stream';

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
}

export interface ObjectHead {
  size: number;
  etag?: string;
  contentType?: string;
}

export interface GetOptions {
  /** HTTP Range header value, e.g. `bytes=0-1023`. */
  range?: string;
  ifNoneMatch?: string;
}

export interface GetResult extends ObjectHead {
  body: Readable;
  /** True when `ifNoneMatch` matched: `body` is empty and the caller should answer 304. */
  notModified?: boolean;
  /** Present for ranged reads, e.g. `bytes 0-1023/4096`. */
  contentRange?: string;
}

/**
 * Object storage used for static-site artifacts, persisted build logs and anything else that must be
 * shared between control-plane and edge nodes. Implementations: S3-compatible (AWS S3, Cloudflare R2,
 * Backblaze B2, DigitalOcean Spaces, Wasabi, Garage, SeaweedFS, Ceph...) and a local filesystem
 * driver for development / single-node installs.
 */
export interface ObjectStorage {
  readonly driver: 'fs' | 's3';
  /** Creates the bucket / root directory if needed. Safe to call repeatedly. */
  ensureReady(): Promise<void>;
  put(key: string, body: Buffer | string | Readable, options?: PutOptions, size?: number): Promise<void>;
  /** Returns null when the key does not exist. */
  get(key: string, options?: GetOptions): Promise<GetResult | null>;
  head(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
  /** Deletes every key under `prefix` and returns how many were removed. */
  deletePrefix(prefix: string): Promise<number>;
  /** Lists keys under a prefix (paginated internally). */
  list(prefix: string): AsyncIterable<{ key: string; size: number }>;
  /** Cheap connectivity probe for readiness checks. */
  ping(): Promise<void>;
}
