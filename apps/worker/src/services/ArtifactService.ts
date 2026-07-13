import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
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
    await this.storage.ensureBucket(this.bucketName);

    const sourcePath = path.join(workspacePath, rootDirectory, outputDirectory);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Output directory "${outputDirectory}" does not exist in workspace at: ${sourcePath}`);
    }

    const objectName = `deployments/${deploymentId}.zip`;
    const zipPath = path.join(workspacePath, `${deploymentId}.zip`);

    // Use adm-zip (pure Node.js) — no system zip command required
    const zip = new AdmZip();
    zip.addLocalFolder(sourcePath);
    zip.writeZip(zipPath);

    // Upload the zip file as a stream
    const zipStream = fs.createReadStream(zipPath);
    const zipSize = fs.statSync(zipPath).size;
    await this.storage.uploadArtifact(this.bucketName, objectName, zipStream, zipSize);

    // Cleanup temp zip
    try { fs.unlinkSync(zipPath); } catch {}

    return objectName;
  }
}
