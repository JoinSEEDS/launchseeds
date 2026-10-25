/**
 * Rate-limit identity attached in-process by the server entrypoint
 * (scripts/serve-local.ts → localIngress). Headers such as X-Forwarded-For
 * are never read here; only the entrypoint, which knows the socket peer,
 * decides who a request is from.
 *
 * Limits here are per web process. Multi-replica deployments would need a
 * shared counter.
 */
import { ApiError, FixedWindowLimiter } from "./api-security";

const identities = new WeakMap<Request, string>();
let ingressActive = false;

export function bindClientIdentity(request: Request, identity: string): Request {
  identities.set(request, identity);
  ingressActive = true;
  return request;
}

/** True once requests are flowing through the identity-binding entrypoint. */
export function trustedIngressActive(): boolean {
  return ingressActive;
}

/** In production, a request without an entrypoint identity fails closed. */
export function trustedClientKey(
  request: Request,
  options: { production?: boolean } = {},
): string {
  const identity = identities.get(request);
  if (identity) return identity;
  const production =
    options.production ?? process.env.LAUNCHSEEDS_LIVE_OPERATIONS === "true";
  if (production)
    throw new ApiError("Trusted ingress rate limiting is unavailable.", 503);
  return "local-development";
}

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Independent per-client quota plus high-ceiling process-wide circuit breaker. */
export class IngressRateLimiter {
  private readonly client: FixedWindowLimiter;
  private readonly global: FixedWindowLimiter;
  constructor(
    readonly route: string,
    maxPerClient: number,
    periodMs: number,
    maxAll: number = Math.max(5000, maxPerClient * 100),
  ) {
    this.client = new FixedWindowLimiter(maxPerClient, periodMs);
    this.global = new FixedWindowLimiter(maxAll, periodMs);
  }
  check(request: Request, now = Date.now()): LimitResult {
    const identity = trustedClientKey(request);
    const all = this.global.check(this.route, now);
    if (!all.allowed) return all;
    return this.client.check(`${this.route}:${identity}`, now);
  }
}
