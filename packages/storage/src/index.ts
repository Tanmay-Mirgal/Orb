import * as path from 'node:path';
import { FsStorage } from './fs';
import { S3Storage } from './s3';
import type { ObjectStorage } from './types';

export * from './types';
export { FsStorage } from './fs';
export { S3Storage, type S3StorageConfig } from './s3';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Key layout. Keeping it in one place lets the worker, proxy and API agree without coupling. */
export const storageKeys = {
  siteManifest: (deploymentId: string) => `sites/${deploymentId}/.orb/manifest.json`,
  siteFile: (deploymentId: string, filePath: string) => `sites/${deploymentId}/files/${filePath}`,
  sitePrefix: (deploymentId: string) => `sites/${deploymentId}/`,
  buildLog: (deploymentId: string) => `logs/${deploymentId}/build.log`,
};

/**
 * Builds the storage driver from the environment:
 *   STORAGE_DRIVER=fs|s3            (default: s3 when S3_BUCKET is set, otherwise fs)
 *   STORAGE_FS_ROOT=./.orb-data     (fs driver)
 *   S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE  (s3 driver)
 */
export function createStorageFromEnv(): ObjectStorage {
  const driver = env('STORAGE_DRIVER') ?? (env('S3_BUCKET') ? 's3' : 'fs');
  if (driver === 'fs') {
    return new FsStorage(env('STORAGE_FS_ROOT') ?? path.resolve(process.cwd(), '.orb-data', 'storage'));
  }
  if (driver !== 's3') throw new Error(`Unknown STORAGE_DRIVER "${driver}" (expected "fs" or "s3")`);
  const bucket = env('S3_BUCKET');
  if (!bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
  const forcePathStyle = env('S3_FORCE_PATH_STYLE');
  return new S3Storage({
    bucket,
    region: env('S3_REGION') ?? 'us-east-1',
    endpoint: env('S3_ENDPOINT'),
    accessKeyId: env('S3_ACCESS_KEY_ID'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: forcePathStyle === undefined ? undefined : ['1', 'true', 'yes'].includes(forcePathStyle.toLowerCase()),
  });
}
