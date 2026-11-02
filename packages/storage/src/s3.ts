import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import type { GetOptions, GetResult, ObjectHead, ObjectStorage, PutOptions } from './types';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  /** Leave empty for AWS S3. Set for R2 / B2 / Spaces / Garage / SeaweedFS / etc. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Needed by most self-hosted S3 implementations (bucket in the path, not the hostname). */
  forcePathStyle?: boolean;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export class S3Storage implements ObjectStorage {
  readonly driver = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    const clientConfig: S3ClientConfig = {
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
      // Cloudflare R2 and several others reject the SDK's newer default checksums.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 4,
    };
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
    }
    this.client = new S3Client(clientConfig);
  }

  async ensureReady(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  async put(key: string, body: Buffer | string | Readable, options: PutOptions = {}, size?: number): Promise<void> {
    const params = {
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
      ...(size !== undefined ? { ContentLength: size } : {}),
    };
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      // PutObject via Upload handles both small and large payloads.
      await new Upload({ client: this.client, params }).done();
      return;
    }
    await new Upload({ client: this.client, params, queueSize: 4, partSize: 8 * 1024 * 1024 }).done();
  }

  async get(key: string, options: GetOptions = {}): Promise<GetResult | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Range: options.range,
          IfNoneMatch: options.ifNoneMatch,
        }),
      );
      return {
        body: res.Body as Readable,
        size: res.ContentLength ?? 0,
        etag: res.ETag,
        contentType: res.ContentType,
        contentRange: res.ContentRange,
      };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 304) {
        return { body: Readable.from([]), size: 0, etag: options.ifNoneMatch, notModified: true };
      }
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, etag: res.ETag, contentType: res.ContentType };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    let batch: string[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      removed += batch.length;
      batch = [];
    };
    for await (const { key } of this.list(prefix)) {
      batch.push(key);
      if (batch.length === 1000) await flush();
    }
    await flush();
    return removed;
  }

  async *list(prefix: string): AsyncIterable<{ key: string; size: number }> {
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) yield { key: obj.Key, size: obj.Size ?? 0 };
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
}
