import { describe, test, expect } from "bun:test";
import {
  adminEnabled,
  adminCookie,
  cookieValue,
  issueSession,
  verifySession,
  secureComparison,
  validPassword,
  assertSameOrigin,
  enforceAdminAction,
  AdminHttpError,
  SESSION_SECONDS,
} from "../lib/admin/security";

const env = {
  LAUNCHSEEDS_ADMIN_ENABLED: "true",
  LAUNCHSEEDS_ADMIN_PASSWORD: "test-password-that-is-long-enough-2026",
  LAUNCHSEEDS_ADMIN_SESSION_SECRET:
    "session-key-012345678901234567890123456789abcdef",
} as NodeJS.ProcessEnv;

function req(
  path = "http://localhost:3000/api/admin/session",
  options: RequestInit = {},
) {
  return new Request(path, options);
}

describe("admin session security", () => {
  test("must be explicitly enabled and have independent long secrets", () => {
    expect(adminEnabled({})).toBe(false);
    expect(adminEnabled({ ...env, LAUNCHSEEDS_ADMIN_ENABLED: "false" })).toBe(
      false,
    );
    expect(adminEnabled({ ...env, LAUNCHSEEDS_ADMIN_PASSWORD: "short" })).toBe(
      false,
    );
    expect(
      adminEnabled({ ...env, LAUNCHSEEDS_ADMIN_SESSION_SECRET: "short" }),
    ).toBe(false);
    expect(adminEnabled(env)).toBe(true);
  });

  test("compares passwords and rejects invalid types", () => {
    expect(validPassword(env.LAUNCHSEEDS_ADMIN_PASSWORD, env)).toBe(true);
    expect(validPassword(env.LAUNCHSEEDS_ADMIN_PASSWORD + "x", env)).toBe(false);
    expect(validPassword(null, env)).toBe(false);
    expect(validPassword(123, env)).toBe(false);
    expect(secureComparison("a", "a")).toBe(true);
    expect(secureComparison("a", "b")).toBe(false);
  });

  test("session is bound to HMAC and finite age", () => {
    const now = 1_800_000_000_000;
    const session = issueSession(now, env);
    expect(verifySession(session, now, env)).toBe(true);
    expect(
      verifySession(session, now + (SESSION_SECONDS - 1) * 1_000, env),
    ).toBe(true);
    expect(verifySession(session, now + SESSION_SECONDS * 1_000, env)).toBe(
      false,
    );
    expect(verifySession(session, now - 61_000, env)).toBe(false);
    expect(verifySession(session.slice(0, -1) + "X", now, env)).toBe(false);
    expect(
      verifySession(session, now, {
        ...env,
        LAUNCHSEEDS_ADMIN_SESSION_SECRET:
          "another-long-enough-session-secret-12345",
      }),
    ).toBe(false);
  });

  test("rejects malformed and excessively long cookies", () => {
    expect(verifySession("", Date.now(), env)).toBe(false);
    expect(verifySession("0." + "x".repeat(1000), Date.now(), env)).toBe(false);
    expect(verifySession("../../", Date.now(), env)).toBe(false);
  });

  test("admin cookie remains HttpOnly and Strict", () => {
    const value = adminCookie(req(), "123");
    expect(value).toContain("HttpOnly");
    expect(value).toContain("SameSite=Strict");
    expect(value).toContain("Path=/api/admin");
    expect(
      adminCookie(req("https://example.com/api/admin/session"), "123"),
    ).toContain("Secure");
    expect(adminCookie(req(), "", 0)).toContain("Max-Age=0");
  });

  test("cookie extraction uses exact key", () => {
    expect(
      cookieValue(
        req(undefined, {
          headers: { cookie: "other=abc; launchseeds_admin=value; x=y" },
        }),
      ),
    ).toBe("value");
    expect(
      cookieValue(
        req(undefined, { headers: { cookie: "not_launchseeds_admin=value" } }),
      ),
    ).toBe(null);
  });

  test("mutation origin must be exact, never a guessed proxy header", () => {
    expect(() =>
      assertSameOrigin(
        req(undefined, {
          headers: {
            origin: "http://localhost:3000",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        req(undefined, { headers: { origin: "https://example.org" } }),
      ),
    ).toThrow(AdminHttpError);
    expect(() =>
      assertSameOrigin(
        req(undefined, { headers: { "x-forwarded-host": "localhost:3000" } }),
      ),
    ).toThrow(AdminHttpError);
    expect(() =>
      assertSameOrigin(
        req(undefined, {
          headers: {
            origin: "http://localhost:3000",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    ).toThrow(AdminHttpError);
  });
});
