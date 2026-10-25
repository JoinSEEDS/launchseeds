/** Transport boundaries for all anonymous public API endpoints. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiJson(
  value: unknown,
  status = 200,
  extra?: HeadersInit,
): Response {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return Response.json(value, { status, headers });
}

/** Same-site browser mutations are always expected to have a matching origin. */
export function requireSameOrigin(request: Request): void {
  // A configured public origin is authoritative behind a reverse proxy, where
  // the internal request URL may legitimately use http://localhost.
  const publicBase =
    typeof process !== "undefined" ? process.env.PUBLIC_BASE_URL : undefined;
  const expected = publicBase
    ? new URL(publicBase).origin
    : new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (!origin || origin !== expected) {
    throw new ApiError("Origin not allowed.", 403);
  }
}

export function requireJsonContentType(request: Request): void {
  const value = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(value)) {
    throw new ApiError("Expected application/json.", 415);
  }
}

/**
 * Check actual bytes read rather than trusting Content-Length or JS string
 * length. A streaming consumer stops immediately when the limit is crossed.
 */
export async function readBoundedJson<T = Record<string, unknown>>(
  request: Request,
  maxBytes = 8192,
): Promise<T> {
  requireJsonContentType(request);
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    throw new ApiError("Request too large.", 413);
  }
  if (!request.body) throw new ApiError("Empty JSON body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ApiError("Request too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes === 0) throw new ApiError("Empty JSON body.");
  const combined = new Uint8Array(bytes);
  let cursor = 0;
  for (const chunk of chunks) {
    combined.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    throw new ApiError("Invalid UTF-8 JSON body.");
  }
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiError("Expected a JSON object.");
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Invalid JSON body.");
  }
}

/**
 * An in-process bound, deliberately NOT a security boundary for multi-worker
 * deployments. Never use raw X-Forwarded-For: clients can forge it unless a
 * trusted proxy canonicalizes it. This limiter handles overall accidental
 * load; production must enforce IP/identity limits at a trusted edge.
 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly capacity = 8192,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || windowMs < 1) {
      throw new Error("Invalid rate limit configuration.");
    }
  }

  check(key: string, now = Date.now()) {
    if (this.buckets.size >= this.capacity) this.prune(now);
    const record = this.buckets.get(key);
    const bucket =
      record && record.until > now
        ? record
        : { count: 0, until: now + this.windowMs };
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return {
      allowed: bucket.count <= this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.until - now) / 1000)),
    };
  }

  prune(now = Date.now()) {
    for (const [key, value] of this.buckets) {
      if (value.until <= now) this.buckets.delete(key);
    }
    if (this.buckets.size < this.capacity) return;
    // Bound memory even under a spray of unique identifiers.
    const toDelete = Math.max(1, Math.floor(this.capacity / 4));
    let remaining = toDelete;
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if (--remaining === 0) break;
    }
  }

  clear() {
    this.buckets.clear();
  }
}

export function requestError(error: unknown): Response {
  if (error instanceof ApiError)
    return apiJson({ error: error.message }, error.status);
  if (error instanceof SyntaxError)
    return apiJson({ error: "Invalid JSON body." }, 400);
  return apiJson({ error: "Request could not be completed." }, 503);
}

export function extractPathId(request: Request, prefix: string): string {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(`${prefix}/`)) throw new ApiError("Not found.", 404);
  const id = pathname.slice(prefix.length + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(id) || id.includes("/")) {
    throw new ApiError("Not found.", 404);
  }
  return id;
}

/** Private launch-status handle: sha256(CA) prefix, or a pre-2026-10-25 launch id. */
export const LAUNCH_HANDLE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function extractPathHandle(request: Request, prefix: string): string {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(`${prefix}/`)) throw new ApiError("Not found.", 404);
  const handle = pathname.slice(prefix.length + 1);
  if (!LAUNCH_HANDLE.test(handle)) throw new ApiError("Not found.", 404);
  return handle;
}

/** Public token routes are addressed by CA (base58 mint), never internal ids. */
export function extractPathMint(request: Request, prefix: string, suffix = ""): string {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(`${prefix}/`) || !pathname.endsWith(suffix))
    throw new ApiError("Not found.", 404);
  const mint = pathname.slice(prefix.length + 1, pathname.length - suffix.length);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new ApiError("Not found.", 404);
  return mint;
}

export function assertVotingPayload(body: Record<string, unknown>) {
  const action = body.action;
  if (action !== "challenge" && action !== "vote") {
    throw new ApiError("Unknown voting action.");
  }
  if (typeof body.wallet !== "string" || body.wallet.length > 64) {
    throw new ApiError("Invalid wallet.");
  }
  if (action === "vote") {
    if (typeof body.nonce !== "string" || !/^[0-9a-f]{32}$/.test(body.nonce)) {
      throw new ApiError("Invalid voting challenge.");
    }
    if (typeof body.signature !== "string" || body.signature.length > 100) {
      throw new ApiError("Invalid signature.");
    }
  }
  return action;
}
