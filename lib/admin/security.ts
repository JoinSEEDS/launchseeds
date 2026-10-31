/** Administrative access is opt-in, and is independent of wallet identity.
 * Sessions are signed, short lived, HttpOnly cookies. Never pass the admin
 * password or session key to the client, process manager or log output.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { IngressRateLimiter } from "../trusted-client";

export const ADMIN_COOKIE = "launchseeds_admin";
export const SESSION_SECONDS = 4 * 60 * 60;
const MAX_FUTURE_SECONDS = 60;
const LOGIN_MAX_BYTES = 2_048;
const badLogin = new IngressRateLimiter("admin-login", 5, 15 * 60_000, 60);

export function adminEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment.LAUNCHSEEDS_ADMIN_ENABLED === "true" &&
    (environment.LAUNCHSEEDS_ADMIN_PASSWORD?.length ?? 0) >= 20 &&
    (environment.LAUNCHSEEDS_ADMIN_SESSION_SECRET?.length ?? 0) >= 32
  );
}

export function secureComparison(actual: string, expected: string): boolean {
  const a = createHash("sha256").update(actual).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function validPassword(
  value: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    adminEnabled(environment) &&
    typeof value === "string" &&
    value.length <= 256 &&
    secureComparison(value, environment.LAUNCHSEEDS_ADMIN_PASSWORD!)
  );
}

export function sessionSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`launchseeds-admin-v1:${payload}`)
    .digest("base64url");
}

export function issueSession(
  now = Date.now(),
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (!adminEnabled(environment))
    throw new Error("Admin access is not configured");
  const payload = `${Math.floor(now / 1000)}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${sessionSignature(payload, environment.LAUNCHSEEDS_ADMIN_SESSION_SECRET!)}`;
}

export function verifySession(
  value: string | null | undefined,
  now = Date.now(),
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!adminEnabled(environment) || !value || value.length > 256) return false;
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    !/^\d{10}$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{22}$/.test(parts[1]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[2])
  )
    return false;
  const issued = Number(parts[0]);
  const seconds = Math.floor(now / 1000);
  if (
    issued > seconds + MAX_FUTURE_SECONDS ||
    seconds - issued >= SESSION_SECONDS
  )
    return false;
  const expected = sessionSignature(
    `${parts[0]}.${parts[1]}`,
    environment.LAUNCHSEEDS_ADMIN_SESSION_SECRET!,
  );
  return secureComparison(parts[2], expected);
}

/** No X-Forwarded-* trust: deployment must terminate TLS at a trusted ingress. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const self = new URL(request.url).origin;
  if (origin !== self) throw new AdminHttpError("Forbidden", 403);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin")
    throw new AdminHttpError("Forbidden", 403);
}

export class AdminHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function cookieValue(
  request: Request,
  name = ADMIN_COOKIE,
): string | null {
  const cookies = request.headers.get("cookie") || "";
  for (const field of cookies.split(";")) {
    const [key, ...values] = field.trim().split("=");
    if (key === name) return values.join("=");
  }
  return null;
}

export function requireAdmin(request: Request): void {
  if (!adminEnabled()) throw new AdminHttpError("Not found", 404);
  if (!verifySession(cookieValue(request)))
    throw new AdminHttpError("Authentication required", 401);
}

/** Admin API key for scripts and tools outside the browser (`[launchseeds] admin_api_key`,
 * at least 32 characters): `Authorization: Bearer <key>`. Unset disables key access. */
export function hasAdminApiKey(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const key = environment.LAUNCHSEEDS_ADMIN_API_KEY ?? "";
  const given = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S{1,256})$/)?.[1];
  return (
    environment.LAUNCHSEEDS_ADMIN_ENABLED === "true" &&
    key.length >= 32 &&
    !!given &&
    secureComparison(given, key)
  );
}

export function isAdmin(request: Request): boolean {
  return verifySession(cookieValue(request));
}

function localHttpRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

export function adminCookie(
  request: Request,
  session: string,
  maxAge = SESSION_SECONDS,
): string {
  // Secure cookies in deployment. Localhost HTTP is supported for development.
  const secure =
    localHttpRequest(request) && process.env.LAUNCHSEEDS_LIVE_OPERATIONS !== "true"
      ? ""
      : "; Secure";
  return `${ADMIN_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secure}`;
}

export function adminResponse(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extra,
    },
  });
}

export function adminError(error: unknown): Response {
  if (error instanceof AdminHttpError)
    return adminResponse({ error: error.message }, error.status);
  // Never reflect SDK, command, filesystem or log errors to unauthenticated users.
  return adminResponse({ error: "Administrative operation unavailable." }, 503);
}

export function enforceAdminAction(request: Request): void {
  requireAdmin(request);
  assertSameOrigin(request);
  if (request.headers.get("x-launchseeds-admin-action") !== "1")
    throw new AdminHttpError("Forbidden", 403);
}

export async function readLogin(request: Request): Promise<string> {
  assertSameOrigin(request);
  if (!adminEnabled()) throw new AdminHttpError("Not found", 404);
  const quota = badLogin.check(request);
  if (!quota.allowed) throw new AdminHttpError("Too many attempts", 429);
  if (
    !(request.headers.get("content-type") || "").startsWith("application/json")
  )
    throw new AdminHttpError("Invalid request", 415);
  const length = Number(request.headers.get("content-length") || "0");
  if (length > LOGIN_MAX_BYTES)
    throw new AdminHttpError("Invalid request", 413);
  // Read a bounded stream; request.text() would allocate arbitrarily large
  // bodies when a caller omits Content-Length or uses chunked transfer.
  const reader = request.body?.getReader();
  if (!reader) throw new AdminHttpError("Invalid request", 400);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LOGIN_MAX_BYTES) {
      await reader.cancel();
      throw new AdminHttpError("Invalid request", 413);
    }
    chunks.push(Buffer.from(value));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new AdminHttpError("Invalid request", 400);
  }
  const password = (value as { password?: unknown } | null)?.password;
  if (!validPassword(password))
    throw new AdminHttpError("Incorrect credentials", 401);
  return password as string;
}
