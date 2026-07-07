import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// In-memory rate limiter
// NOTE: Vercel serverless functions are stateless between cold starts, so this
// provides per-instance limiting. It's meaningful protection against bursts and
// automated scanners; for cross-instance enforcement you'd need a Redis store.
// ---------------------------------------------------------------------------

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

/** Returns true if the request is allowed, false if rate-limited. */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

/** Extract the best available client IP from a Next.js request. */
export function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Timing-safe secret verification
// Hashes both strings to equal length before comparing, so even length
// differences don't leak information via early exits.
// ---------------------------------------------------------------------------
import { createHash } from 'crypto';

export function safeCompareSecret(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** True if the provided value matches any secret in the list. */
export function verifyAnySecret(provided: string, secrets: string[]): boolean {
  if (!provided || secrets.length === 0) return false;
  return secrets.some((s) => safeCompareSecret(provided, s));
}
