import { randomBytes } from 'node:crypto';

/** Crockford base32 ULID: 48-bit time + 80-bit randomness, monotonic within one process so ids sort by creation. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let out = '';
  let rest = time;
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[rest % 32]! + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

const freshRandom = (): number[] => Array.from(randomBytes(16), (b) => b % 32);

function increment(chars: number[]): number[] | null {
  const next = [...chars];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  return null;
}

export function ulid(now: number = Date.now()): string {
  let time = now;
  if (time <= lastTime) {
    // Same millisecond (or the clock went back): keep counting up so the order is preserved.
    const bumped = increment(lastRandom);
    if (bumped) {
      lastRandom = bumped;
      time = lastTime;
    } else {
      time = lastTime + 1;
      lastRandom = freshRandom();
    }
  } else {
    lastRandom = freshRandom();
  }
  lastTime = time;
  return encodeTime(time) + lastRandom.map((c) => ALPHABET[c]).join('');
}

/** `evt_01J…` */
export const newEventId = (now?: number): string => `evt_${ulid(now)}`;

/** `req_…` for responses and logs. */
export const newRequestId = (): string => `req_${randomBytes(9).toString('base64url')}`;
