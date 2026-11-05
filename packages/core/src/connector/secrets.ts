import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config';

/**
 * Webhook signing secrets must be recoverable (we sign with them), so they are encrypted at rest with AES-256-GCM.
 * Same envelope as `core/crypto` (`enc:v1:<keyId>:<iv>:<tag>:<ciphertext>`) but a separate, versioned keyring:
 * `CONNECTOR_ENCRYPTION_KEY` signs new rows, `CONNECTOR_ENCRYPTION_KEY_PREVIOUS` (comma separated) keeps old rows readable.
 */
const PREFIX = 'enc:v1:';

function deriveKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return createHash('sha256').update(trimmed).digest();
}

const keyIdOf = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8);

interface Keyring {
  signature: string;
  current: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
}

let cached: Keyring | undefined;

function keyring(): Keyring {
  const primary = env('CONNECTOR_ENCRYPTION_KEY');
  if (!primary) throw new Error('CONNECTOR_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32');
  const previous = env('CONNECTOR_ENCRYPTION_KEY_PREVIOUS') ?? '';
  const signature = `${primary}|${previous}`;
  if (cached?.signature === signature) return cached;
  const currentKey = deriveKey(primary);
  const byId = new Map<string, Buffer>([[keyIdOf(currentKey), currentKey]]);
  for (const raw of previous.split(',').map((s) => s.trim()).filter(Boolean)) {
    const key = deriveKey(raw);
    byId.set(keyIdOf(key), key);
  }
  cached = { signature, current: { id: keyIdOf(currentKey), key: currentKey }, byId };
  return cached;
}

/** `aad` binds the ciphertext to its row (the webhook id), so values cannot be swapped between rows. */
export function encryptConnectorSecret(plaintext: string, aad: string): string {
  const { current } = keyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${PREFIX}${current.id}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptConnectorSecret(stored: string, aad: string): string {
  if (!stored.startsWith(PREFIX)) throw new Error('Connector secret is not encrypted');
  const [id, iv, tag, data] = stored.slice(PREFIX.length).split(':');
  if (!id || !iv || !tag || !data) throw new Error('Malformed encrypted connector secret');
  const key = keyring().byId.get(id);
  if (!key) throw new Error(`No connector encryption key with id ${id}; set CONNECTOR_ENCRYPTION_KEY_PREVIOUS`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
