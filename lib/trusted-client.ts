/**
 * Rate-limit identity supplied by a trusted ingress. Raw X-Forwarded-For,
 * CF-Connecting-IP and browser-supplied wallet strings are not identities.
 * The ingress must REMOVE incoming x-launchseeds-edge-* headers, generate a
 * privacy-preserving stable key, and sign it with a server-only HMAC secret.
 *
 * Limits here are defense-in-depth. Multi-replica ingress MUST use a shared
 * counter before forwarding; these maps are only local emergency fuses.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError, FixedWindowLimiter } from "./api-security";

const ID_RE = /^[a-zA-Z0-9:_-]{8,128}$/;
const SIGNATURE_RE = /^[a-f0-9]{64}$/;
const HEADER_ID = "x-launchseeds-edge-client";
const HEADER_SIGNATURE = "x-launchseeds-edge-signature";

export function signClientIdentity(identity: string, secret: string): string {
  if (!ID_RE.test(identity) || secret.length < 32)
    throw new Error("Invalid trusted ingress identity or secret.");
  return createHmac("sha256", secret)
    .update(`launchseeds-edge-v1:${identity}`)
    .digest("hex");
}

/** In production, unsigned/missing ingress identity fails closed. */
export function trustedClientKey(
  request: Request,
  options: { secret?: string; production?: boolean } = {},
): string {
  const secret = options.secret ?? process.env.LAUNCHSEEDS_EDGE_CLIENT_SECRET ?? "";
  const production =
    options.production ?? process.env.LAUNCHSEEDS_LIVE_OPERATIONS === "true";
  if (!secret || secret.length < 32) {
    if (production)
      throw new ApiError("Trusted ingress rate limiting is unavailable.", 503);
    return "local-development";
  }
  const id = request.headers.get(HEADER_ID) ?? "";
  const signature = request.headers.get(HEADER_SIGNATURE) ?? "";
  if (!ID_RE.test(id) || !SIGNATURE_RE.test(signature))
    throw new ApiError("Trusted client identity is missing.", 403);
  const expected = Buffer.from(signClientIdentity(id, secret), "hex");
  const actual = Buffer.from(signature, "hex");
  if (!timingSafeEqual(expected, actual))
    throw new ApiError("Invalid trusted client identity.", 403);
  return id;
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
