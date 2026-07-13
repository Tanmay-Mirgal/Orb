import * as Minio from 'minio';
import { Readable } from 'stream';

export class StorageClient {
  private client: Minio.Client;

  constructor(options: Minio.ClientOptions) {
    this.client = new Minio.Client(options);
  }

  async ensureBucket(bucketName: string) {
    const exists = await this.client.bucketExists(bucketName);
    if (!exists) {
      await this.client.makeBucket(bucketName, 'us-east-1');
    }
  }

  async uploadArtifact(bucketName: string, objectName: string, stream: Readable | Buffer | string, size?: number) {
    await this.ensureBucket(bucketName);
    if (size) {
      await this.client.putObject(bucketName, objectName, stream as any, size);
    } else {
      await this.client.putObject(bucketName, objectName, stream as any);
    }
  }

  async downloadArtifact(bucketName: string, objectName: string): Promise<Readable> {
    return await this.client.getObject(bucketName, objectName);
  }

  async checkObjectExists(bucketName: string, objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(bucketName, objectName);
      return true;
    } catch (err: any) {
      if (err.code === 'NotFound') {
        return false;
      }
      throw err;
    }
  }
}
