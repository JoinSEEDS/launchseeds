import { expect, test } from "bun:test";
import { hasAdminApiKey } from "../lib/admin/security";

const KEY = "k".repeat(40);
const env = { LAUNCHSEEDS_ADMIN_ENABLED: "true", LAUNCHSEEDS_ADMIN_API_KEY: KEY } as NodeJS.ProcessEnv;
const req = (auth?: string) =>
  new Request("https://launchseeds.xyz/api/admin/image", { method: "POST", headers: auth ? { authorization: auth } : {} });

test("admin API key must match, be long enough and admin must be enabled", () => {
  expect(hasAdminApiKey(req(`Bearer ${KEY}`), env)).toBe(true);
  expect(hasAdminApiKey(req(`Bearer ${KEY}x`), env)).toBe(false);
  expect(hasAdminApiKey(req(), env)).toBe(false);
  expect(hasAdminApiKey(req(`Basic ${KEY}`), env)).toBe(false);
  expect(hasAdminApiKey(req("Bearer short"), { ...env, LAUNCHSEEDS_ADMIN_API_KEY: "short" })).toBe(false);
  expect(hasAdminApiKey(req(`Bearer ${KEY}`), { ...env, LAUNCHSEEDS_ADMIN_ENABLED: "false" })).toBe(false);
});

test("admin image route rejects unauthenticated and malformed requests without generation", async () => {
  const { POST } = await import("../app/api/admin/image/route");
  const { bindClientIdentity } = await import("../lib/trusted-client");
  const previous = { enabled: process.env.LAUNCHSEEDS_ADMIN_ENABLED, key: process.env.LAUNCHSEEDS_ADMIN_API_KEY,
    password: process.env.LAUNCHSEEDS_ADMIN_PASSWORD, secret: process.env.LAUNCHSEEDS_ADMIN_SESSION_SECRET };
  process.env.LAUNCHSEEDS_ADMIN_ENABLED = "true";
  process.env.LAUNCHSEEDS_ADMIN_API_KEY = KEY;
  process.env.LAUNCHSEEDS_ADMIN_PASSWORD = "test-password-that-is-long-enough";
  process.env.LAUNCHSEEDS_ADMIN_SESSION_SECRET = "test-session-secret-".repeat(3);
  try {
    expect((await POST(req())).status).toBe(401);
    const request = new Request("https://launchseeds.xyz/api/admin/image", {
      method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: "{",
    });
    expect((await POST(bindClientIdentity(request, "admin-image-test"))).status).toBe(400);
  } finally {
    if (previous.enabled === undefined) delete process.env.LAUNCHSEEDS_ADMIN_ENABLED;
    else process.env.LAUNCHSEEDS_ADMIN_ENABLED = previous.enabled;
    if (previous.key === undefined) delete process.env.LAUNCHSEEDS_ADMIN_API_KEY;
    else process.env.LAUNCHSEEDS_ADMIN_API_KEY = previous.key;
    if (previous.password === undefined) delete process.env.LAUNCHSEEDS_ADMIN_PASSWORD;
    else process.env.LAUNCHSEEDS_ADMIN_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.LAUNCHSEEDS_ADMIN_SESSION_SECRET;
    else process.env.LAUNCHSEEDS_ADMIN_SESSION_SECRET = previous.secret;
  }
});
