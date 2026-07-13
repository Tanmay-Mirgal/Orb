import * as https from 'https';
import * as http from 'http';

export class CertService {
  private readonly baseDomain: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor() {
    this.baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.tanmaymirgal.dev';
    this.maxRetries = 12;       // 12 attempts
    this.retryDelayMs = 5000;   // 5 seconds between each attempt = ~60s total
  }

  /**
   * Provisions an SSL certificate for the given project subdomain by
   * hitting the project URL, which triggers Caddy's on-demand TLS flow.
   * Retries until cert is valid or timeout.
   */
  async provisionCert(
    projectName: string,
    log: (msg: string) => Promise<void>
  ): Promise<boolean> {
    const hostname = `${projectName}.${this.baseDomain}`;
    const url = `https://${hostname}`;

    await log(`[cert] Provisioning SSL certificate for ${hostname}...`);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const result = await this.pingHttps(hostname);

      if (result.success) {
        await log(`[cert] ✓ SSL certificate provisioned for ${hostname}`);
        return true;
      }

      if (result.certError) {
        // Cert is still being issued by Caddy — keep retrying
        await log(`[cert] Waiting for certificate... (attempt ${attempt}/${this.maxRetries})`);
      } else if (result.connectionRefused) {
        // Proxy isn't reachable at all — likely DNS/infra issue
        await log(`[cert] Connection refused to ${hostname} — check proxy/DNS (attempt ${attempt}/${this.maxRetries})`);
      } else {
        // Got a response (even 4xx/5xx) — cert is valid, that's all we need
        await log(`[cert] ✓ SSL certificate provisioned for ${hostname} (HTTP ${result.statusCode})`);
        return true;
      }

      if (attempt < this.maxRetries) {
        await this.sleep(this.retryDelayMs);
      }
    }

    await log(`[cert] ⚠ Certificate provisioning timed out for ${hostname}. Deployment marked success anyway — cert may provision on first browser visit.`);
    return false; // non-fatal — we still mark deployment as success
  }

  private pingHttps(hostname: string): Promise<{
    success: boolean;
    certError: boolean;
    connectionRefused: boolean;
    statusCode?: number;
  }> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname,
          port: 443,
          path: '/',
          method: 'GET',
          timeout: 8000,
          // Properly verify cert — this is how we know cert is truly valid
          rejectUnauthorized: true,
        },
        (res) => {
          resolve({ success: true, certError: false, connectionRefused: false, statusCode: res.statusCode });
          res.resume(); // drain response
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, certError: true, connectionRefused: false });
      });

      req.on('error', (err: any) => {
        const code = err.code || '';
        if (
          code === 'ECONNREFUSED' ||
          code === 'ENOTFOUND' ||
          code === 'ETIMEDOUT'
        ) {
          // Proxy/DNS not reachable
          resolve({ success: false, certError: false, connectionRefused: true });
        } else if (
          code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
          code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
          code === 'CERT_HAS_EXPIRED' ||
          code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
          err.message?.includes('certificate')
        ) {
          // Cert exists but is still wrong/being provisioned — keep retrying
          resolve({ success: false, certError: true, connectionRefused: false });
        } else {
          // Unknown error — treat as cert not ready yet
          resolve({ success: false, certError: true, connectionRefused: false });
        }
      });

      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
