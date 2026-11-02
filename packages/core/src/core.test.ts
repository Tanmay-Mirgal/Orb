import { afterEach, describe, expect, it } from 'vitest';
import { createAppJwt, verifyGithubSignature } from './github';
import { decryptSecret, encryptSecret, generateApiToken, hmacSha256Hex, isEncrypted, safeEqual, sha256Hex } from './crypto';
import { generateKeyPairSync } from 'node:crypto';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
});

describe('secret encryption', () => {
  it('round-trips and binds to the AAD', () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    const stored = encryptSecret('hunter2', 'proj:KEY');
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain('hunter2');
    expect(decryptSecret(stored, 'proj:KEY')).toBe('hunter2');
    expect(() => decryptSecret(stored, 'other:KEY')).toThrow();
  });

  it('supports key rotation through ENCRYPTION_KEY_PREVIOUS', () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    const old = encryptSecret('v', 'x');
    process.env.ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(old, 'x')).toThrow();
    process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;
    expect(decryptSecret(old, 'x')).toBe('v');
  });

  it('passes legacy plaintext through and requires a key to encrypt', () => {
    expect(decryptSecret('plain')).toBe('plain');
    expect(() => encryptSecret('x')).toThrow(/ENCRYPTION_KEY/);
  });
});

describe('tokens and signatures', () => {
  it('generates hashed API tokens', () => {
    const { token, hash, prefix } = generateApiToken();
    expect(token.startsWith('orb_')).toBe(true);
    expect(hash).toBe(sha256Hex(token));
    expect(token.startsWith(prefix)).toBe(true);
  });

  it('verifies GitHub webhook signatures and rejects bad ones', () => {
    const body = '{"hello":"world"}';
    const sig = `sha256=${hmacSha256Hex('s3cret', body)}`;
    expect(verifyGithubSignature(body, sig, 's3cret')).toBe(true);
    expect(verifyGithubSignature(body, sig, 'wrong')).toBe(false);
    expect(verifyGithubSignature(body, null, 's3cret')).toBe(false);
    expect(verifyGithubSignature(body, sig, undefined)).toBe(false);
    expect(safeEqual('a', 'bb')).toBe(false);
  });

  it('creates a three-part RS256 app JWT', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const jwt = createAppJwt('12345', pem.replace(/\n/g, '\\n'));
    const [, payload] = jwt.split('.');
    expect(jwt.split('.')).toHaveLength(3);
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString()).iss).toBe('12345');
  });
});
