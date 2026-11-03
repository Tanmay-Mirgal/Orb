import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { decryptSecret } from 'core';
import { eq, projectRegistryCredentials, type Database } from 'database';
import { imageReferenceError, normalizeRegistryHost, parseImageReference, registryAuthKey } from 'shared';
import { runCommand } from './process';

/** Ports a web image most likely serves HTTP on, in order of preference when it declares several. */
const PREFERRED_PORTS = [80, 8080, 3000, 8000, 5000, 8888, 4000, 9000];

export interface RegistryLogin {
  username: string;
  password: string;
}

export interface PulledImage {
  /** Content digest (hex), the closest thing an image has to a commit id. */
  digest: string | null;
  sizeBytes: number;
  /** TCP ports declared with EXPOSE, ascending. */
  exposedPorts: number[];
}

/**
 * The project's saved registry login, but only when it belongs to the registry the image is pulled from. Anyone who
 * can edit a project can change its image; without this check they could point it at a registry they control and
 * receive the saved password.
 */
export async function loadRegistryLogin(
  db: Database,
  projectId: string,
  image: string,
  onSkip: (message: string) => void,
): Promise<RegistryLogin | null> {
  const [row] = await db.select().from(projectRegistryCredentials).where(eq(projectRegistryCredentials.projectId, projectId)).limit(1);
  if (!row) return null;
  const registry = parseImageReference(image)?.registry;
  if (!registry || normalizeRegistryHost(row.registry) !== registry) {
    onSkip(`[docker] The saved registry login is for ${row.registry}, not ${registry ?? 'this registry'}: pulling without credentials. Save a login for this registry in the project settings.`);
    return null;
  }
  return { username: row.username, password: decryptSecret(row.password, `${projectId}:registry`) };
}

/**
 * Chooses the port to route traffic to. An explicit port always wins; with "auto" (0) the image's own EXPOSE decides.
 * Orb sets $PORT to the chosen port, so images that honour $PORT and images that listen on a fixed port both work.
 */
export function resolveImagePort(configured: number, exposed: number[]): { port: number; note: string } {
  if (configured > 0) {
    const note =
      exposed.length > 0 && !exposed.includes(configured)
        ? `Routing to port ${configured}, but the image only declares ${exposed.join(', ')}. If the health check fails, change the Port in the project settings.`
        : `Routing to port ${configured}`;
    return { port: configured, note };
  }
  if (exposed.length === 0) {
    throw new Error('This image does not declare a port with EXPOSE. Set the Port in the project settings to the port your app listens on.');
  }
  const port = PREFERRED_PORTS.find((p) => exposed.includes(p)) ?? exposed[0]!;
  return { port, note: `Detected port ${port} from the image (declares ${exposed.join(', ')})` };
}

function hostArchitecture(): string {
  const arch = os.arch();
  return arch === 'x64' ? 'amd64' : arch;
}

interface InspectResult {
  Id?: string;
  Os?: string;
  Architecture?: string;
  Size?: number;
  RepoDigests?: string[];
  Config?: { ExposedPorts?: Record<string, unknown> | null } | null;
}

function dockerInspect(ref: string): Promise<InspectResult> {
  return new Promise((resolve, reject) => {
    execFile('docker', ['image', 'inspect', ref], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`Could not inspect ${ref}: ${err.message}`));
      try {
        resolve((JSON.parse(stdout) as InspectResult[])[0] ?? {});
      } catch {
        reject(new Error(`Could not read the metadata of ${ref}`));
      }
    });
  });
}

/** Best effort `docker rmi`, used to give disk back after a rejected or retagged image. */
function removeImage(ref: string): Promise<void> {
  return new Promise((resolve) => {
    execFile('docker', ['rmi', ref], () => resolve());
  });
}

/**
 * Fetches a customer's image into the local Docker daemon and gives it an Orb tag, after which it travels the same
 * release path as an image Orb built itself. The pull runs with its own docker config so that:
 *  - the customer's registry login is used only for this pull and is never written to the shared client config;
 *  - the platform's own registry credentials are never presented to a registry the customer chose.
 */
export async function pullImage(options: {
  image: string;
  login: RegistryLogin | null;
  /** Orb tag the pulled image is stored under (`orb/<project>:<deployment>` or `<registry>/<project>:<deployment>`). */
  tag: string;
  /** The platform's own registry (`host/prefix`): customers may not point a project at it. */
  platformRegistry: string;
  maxBytes: number;
  timeoutMs: number;
  scratchDir: string;
  onLine: (line: string) => void;
  signal: AbortSignal;
}): Promise<PulledImage> {
  const { image, login, tag, onLine, signal } = options;

  const problem = imageReferenceError(image);
  if (problem) throw new Error(problem);
  const parsed = parseImageReference(image)!;
  const platformHost = options.platformRegistry.split('/')[0]?.toLowerCase();
  if (platformHost && parsed.registry.toLowerCase() === platformHost) {
    throw new Error('That registry belongs to the platform. Use an image from a public or private registry of your own.');
  }

  const configDir = fs.mkdtempSync(path.join(options.scratchDir, 'docker-config-'));
  const auths = login ? { [registryAuthKey(parsed.registry)]: { auth: Buffer.from(`${login.username}:${login.password}`).toString('base64') } } : {};
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ auths }), { mode: 0o600 });

  let code: number;
  try {
    code = await runCommand('docker', ['pull', image], {
      env: { ...process.env, DOCKER_CONFIG: configDir },
      onLine,
      signal,
      timeoutMs: options.timeoutMs,
    });
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
  if (signal.aborted) throw new Error('Build canceled');
  if (code === 124) throw new Error(`Pulling the image timed out after ${Math.round(options.timeoutMs / 60000)} minutes`);
  if (code !== 0) {
    throw new Error(
      `Could not pull ${image}. Check the image name and tag${login ? ' and the registry credentials' : ', and add registry credentials in the project settings if the image is private'}.`,
    );
  }

  try {
    const info = await dockerInspect(image);
    if (info.Os && info.Os !== 'linux') throw new Error(`This is a ${info.Os} image. Only Linux images can run on Orb.`);
    const host = hostArchitecture();
    if (info.Architecture && info.Architecture !== host) {
      throw new Error(`This image is built for ${info.Architecture}, but Orb runs ${host} machines. Publish a ${host} (or multi-platform) image.`);
    }
    const sizeBytes = info.Size ?? 0;
    if (sizeBytes > options.maxBytes) {
      throw new Error(`The image is ${(sizeBytes / 1024 / 1024).toFixed(0)} MB, over the ${(options.maxBytes / 1024 / 1024).toFixed(0)} MB limit.`);
    }

    const exposedPorts = Object.keys(info.Config?.ExposedPorts ?? {})
      .filter((key) => key.endsWith('/tcp'))
      .map((key) => Number(key.split('/')[0]))
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535)
      .sort((a, b) => a - b);
    const digest = info.RepoDigests?.[0]?.split('@sha256:')[1] ?? info.Id?.replace(/^sha256:/, '') ?? null;

    const tagCode = await runCommand('docker', ['tag', image, tag], { onLine, signal });
    if (tagCode !== 0) throw new Error('Could not tag the pulled image');
    await removeImage(image); // keep only the Orb tag; layers stay because the Orb tag references them
    return { digest, sizeBytes, exposedPorts };
  } catch (err) {
    await removeImage(image);
    throw err;
  }
}
