import * as fs from 'fs';
import * as path from 'path';
const { ZipArchive } = require('archiver');
import { StorageClient } from 'storage';

export class ArtifactService {
  private storage: StorageClient;
  private bucketName = 'orb-artifacts';

  constructor() {
    this.storage = new StorageClient({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
      secretKey: process.env.MINIO_SECRET_KEY || 'password123',
    });
  }

  async uploadArtifact(workspacePath: string, rootDirectory: string, outputDirectory: string, deploymentId: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        await this.storage.ensureBucket(this.bucketName);
        
        const sourcePath = path.join(workspacePath, rootDirectory, outputDirectory);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`Output directory ${outputDirectory} does not exist in workspace.`);
        }

        const objectName = `deployments/${deploymentId}.zip`;
        const archive = new ZipArchive({ zlib: { level: 9 } });
        
        archive.on('error', (err) => reject(err));
        
        // MinIO putObject accepts a readable stream (the archiver instance itself is a readable stream)
        // We do not need to save to disk first.
        
        const uploadPromise = this.storage.uploadArtifact(this.bucketName, objectName, archive);
        
        archive.directory(sourcePath, false);
        await archive.finalize();
        
        await uploadPromise;
        
        resolve(objectName);
      } catch (error) {
        reject(error);
      }
    });
  }
}
