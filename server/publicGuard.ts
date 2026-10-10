// Guard for the site's public endpoints (2026-10-10). The Gemini routes spend the owner's API
// quota and the Yahoo proxy relays requests; both used to answer anyone on the internet. A
// browser SPA cannot hold a secret, so the guard is: the request must come from this site's own
// pages (Origin/Referer host == Host) and each IP gets a request budget. Not bullet-proof
// (headers can be forged), but it stops drive-by abuse and runaway loops.
import type { IncomingMessage } from "node:http";

export function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || request.socket?.remoteAddress || "unknown";
}

function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

// True when the call comes from a page served by this same host.
export function isSameSite(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (!host) return false;
  const origin = hostOf(request.headers.origin as string | undefined);
  const referer = hostOf(request.headers.referer);
  return origin === host || (!origin && referer === host);
}

// Fixed-window counter per key. Memory only: a restart resets it, which is fine for abuse control.
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): boolean => {
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}
