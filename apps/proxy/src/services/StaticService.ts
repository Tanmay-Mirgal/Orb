import { StorageClient } from 'storage';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import express from 'express';
import mime from 'mime-types';

export class StaticService {
  private storage: StorageClient;
  private cacheDir = path.join('/tmp', 'orb-cache');

  constructor() {
    this.storage = new StorageClient({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
      secretKey: process.env.MINIO_SECRET_KEY || 'password123',
    });
    
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async ensureArtifactCached(deploymentId: string): Promise<string> {
    const deployCacheDir = path.join(this.cacheDir, deploymentId);
    if (fs.existsSync(deployCacheDir)) {
      return deployCacheDir;
    }

    // Download and unzip
    const zipPath = path.join(this.cacheDir, `${deploymentId}.zip`);
    try {
      const stream = await this.storage.downloadArtifact('orb-artifacts', `deployments/${deploymentId}.zip`);
      
      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(zipPath);
        stream.pipe(fileStream);
        stream.on('error', reject);
        fileStream.on('finish', resolve);
      });
      
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(deployCacheDir, true);
      
      // Cleanup zip
      fs.unlinkSync(zipPath);
      return deployCacheDir;
    } catch (e) {
      console.error(`Failed to cache artifact for ${deploymentId}:`, e);
      throw e;
    }
  }

  async handleRequest(req: express.Request, res: express.Response, deploymentId: string) {
    try {
      const deployDir = await this.ensureArtifactCached(deploymentId);
      
      // Basic static file resolution
      let reqPath = req.path;
      if (reqPath === '/') reqPath = '/index.html';
      
      let fullPath = path.join(deployDir, reqPath);
      
      // HTML extension fallback
      if (!fs.existsSync(fullPath) && fs.existsSync(fullPath + '.html')) {
        fullPath += '.html';
      }
      
      // SPA Fallback
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(deployDir, 'index.html');
      }

      if (fs.existsSync(fullPath)) {
        const type = mime.lookup(fullPath) || 'application/octet-stream';
        res.setHeader('Content-Type', type);
        
        // Caching headers optimization
        if (fullPath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          // Immutable assets (js, css, images, etc.) cache for 1 year
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }

        fs.createReadStream(fullPath).pipe(res);
      } else {
        res.status(404).send('Not Found');
      }
    } catch (error) {
      res.status(500).send('Internal Server Error: Failed to load artifact');
    }
  }
}
