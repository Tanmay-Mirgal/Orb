import { createHash } from 'node:crypto';
import { hmacSha256Hex, randomToken, safeEqual } from '../crypto';
import { env } from '../config';

/**
 * Connector credentials are opaque: a prefix plus 32 random bytes (base64url). Only `HMAC-SHA256(pepper, token)` is
 * stored, so a database leak alone cannot be turned into working tokens.
 */
export const CONNECTOR_TOKEN_PREFIX = {
  access: 'cp1_orb_',
  refresh: 'cp1r_orb_',
  key: 'cp1k_orb_',
} as const;
export type ConnectorTokenKind = keyof typeof CONNECTOR_TOKEN_PREFIX;

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
export const AUTH_CODE_TTL_SECONDS = 60;

function pepper(): string {
  const value = env('CONNECTOR_TOKEN_PEPPER');
  if (!value) throw new Error('CONNECTOR_TOKEN_PEPPER is not set');
  return value;
}

export function hashConnectorToken(token: string, secret: string = pepper()): string {
  return hmacSha256Hex(secret, token);
}

export function generateConnectorToken(kind: ConnectorTokenKind, secret?: string): { token: string; hash: string } {
  const token = `${CONNECTOR_TOKEN_PREFIX[kind]}${randomToken(32)}`;
  return { token, hash: hashConnectorToken(token, secret) };
}

export function connectorTokenKind(token: string): ConnectorTokenKind | null {
  // `cp1r_`/`cp1k_` are checked by their full prefix, so `cp1_orb_` cannot shadow them.
  for (const kind of Object.keys(CONNECTOR_TOKEN_PREFIX) as ConnectorTokenKind[]) {
    if (token.startsWith(CONNECTOR_TOKEN_PREFIX[kind])) return kind;
  }
  return null;
}

/** Authorization codes are stored hashed too (a leaked row cannot be redeemed). */
export function generateAuthorizationCode(secret?: string): { code: string; hash: string } {
  const code = randomToken(32);
  return { code, hash: hashConnectorToken(`code:${code}`, secret) };
}

export function hashAuthorizationCode(code: string, secret?: string): string {
  return hashConnectorToken(`code:${code}`, secret);
}

// --- PKCE (RFC 7636, S256 only) ---------------------------------------------------------------------------------
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeVerifier(value: string): boolean {
  return VERIFIER.test(value);
}

export function isValidCodeChallenge(value: string): boolean {
  return CHALLENGE.test(value);
}

export function pkceChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
  return safeEqual(pkceChallengeS256(verifier), challenge);
}
