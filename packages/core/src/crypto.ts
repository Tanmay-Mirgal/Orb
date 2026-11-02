import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from './config';

/**
 * Envelope format: `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64url, AES-256-GCM).
 * - `keyId` lets us rotate: set ENCRYPTION_KEY to the new key and keep the old one in
 *   ENCRYPTION_KEY_PREVIOUS (comma separated); old rows still decrypt, new writes use the new key.
 * - `aad` binds a ciphertext to its row (e.g. `${projectId}:${key}`) so values cannot be swapped between rows.
 */
const PREFIX = 'enc:v1:';

function deriveKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return createHash('sha256').update(trimmed).digest();
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

interface Keyring {
  signature: string;
  current: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
}

let cachedKeyring: Keyring | undefined;

function keyring(): Keyring {
  const primary = env('ENCRYPTION_KEY');
  if (!primary) {
    throw new Error('ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32');
  }
  const previous = env('ENCRYPTION_KEY_PREVIOUS') ?? '';
  const signature = `${primary}|${previous}`;
  if (cachedKeyring?.signature === signature) return cachedKeyring;
  const currentKey = deriveKey(primary);
  const byId = new Map<string, Buffer>();
  byId.set(keyId(currentKey), currentKey);
  for (const raw of previous.split(',').map((s) => s.trim()).filter(Boolean)) {
    const k = deriveKey(raw);
    byId.set(keyId(k), k);
  }
  cachedKeyring = { signature, current: { id: keyId(currentKey), key: currentKey }, byId };
  return cachedKeyring;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string, aad?: string): string {
  const { current } = keyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${current.id}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/** Values without the envelope prefix are treated as legacy plaintext (see `db:encrypt-legacy`). */
export function decryptSecret(stored: string, aad?: string): string {
  if (!isEncrypted(stored)) return stored;
  const [id, iv, tag, data] = stored.slice(PREFIX.length).split(':');
  if (!id || !iv || !tag || !data) throw new Error('Malformed encrypted value');
  const key = keyring().byId.get(id);
  if (!key) throw new Error(`No encryption key with id ${id}; set ENCRYPTION_KEY_PREVIOUS`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time comparison that is safe for inputs of different length. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export const API_TOKEN_PREFIX = 'orb_';

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomToken(32)}`;
  return { token, hash: sha256Hex(token), prefix: token.slice(0, 12) };
}

export function generateDomainVerificationToken(): string {
  return randomBytes(16).toString('hex');
}
