import { describe, expect, test } from "bun:test";
import { ApiError } from "../lib/api-security";
import {
  signClientIdentity,
  trustedClientKey,
  IngressRateLimiter,
} from "../lib/trusted-client";
const secret = "0123456789abcdef0123456789abcdef0123456789";
function request(id: string, signature = signClientIdentity(id, secret)) {
  return new Request("https://launchseeds.xyz/api/launches", {
    headers: {
      "x-launchseeds-edge-client": id,
      "x-launchseeds-edge-signature": signature,
    },
  });
}

describe("signed ingress identity", () => {
  test("valid edge HMAC authenticates a rate-limit subject", () => {
    expect(
      trustedClientKey(request("client_123456"), { secret, production: true }),
    ).toBe("client_123456");
  });
  test("forged signatures are rejected", () => {
    expect(() =>
      trustedClientKey(request("client_123456", "0".repeat(64)), {
        secret,
        production: true,
      }),
    ).toThrow(ApiError);
  });
  test("a caller cannot change a signed identity", () => {
    const signature = signClientIdentity("client_123456", secret);
    expect(() =>
      trustedClientKey(request("client_999999", signature), {
        secret,
        production: true,
      }),
    ).toThrow();
  });
  test("missing ingress secret blocks live mutations", () => {
    expect(() =>
      trustedClientKey(request("client_123456"), {
        secret: "",
        production: true,
      }),
    ).toThrow();
  });
  test("unsigned client works only in explicit development mode", () => {
    const req = new Request("http://localhost:3000/api/launches");
    expect(trustedClientKey(req, { secret: "", production: false })).toBe(
      "local-development",
    );
    expect(() => trustedClientKey(req, { secret, production: true })).toThrow();
  });
  test("invalid identifier formats fail before HMAC comparison", () => {
    expect(() => signClientIdentity("bad space", secret)).toThrow();
    expect(() => signClientIdentity("valid_12345", "short")).toThrow();
    expect(() =>
      trustedClientKey(
        new Request("https://launchseeds.xyz", {
          headers: {
            "x-launchseeds-edge-client": "bad space",
            "x-launchseeds-edge-signature": "f".repeat(64),
          },
        }),
        { secret, production: true },
      ),
    ).toThrow();
  });
});

describe("independent quotas", () => {
  test("one noisy client does not consume another client's personal quota", () => {
    const old = process.env.LAUNCHSEEDS_EDGE_CLIENT_SECRET;
    const oldLive = process.env.LAUNCHSEEDS_LIVE_OPERATIONS;
    process.env.LAUNCHSEEDS_EDGE_CLIENT_SECRET = secret;
    process.env.LAUNCHSEEDS_LIVE_OPERATIONS = "true";
    try {
      const limiter = new IngressRateLimiter("test-votes", 2, 10_000, 100);
      const a = request("client_aaaaaa"),
        b = request("client_bbbbbb");
      expect(limiter.check(a, 1000).allowed).toBe(true);
      expect(limiter.check(a, 1001).allowed).toBe(true);
      expect(limiter.check(a, 1002).allowed).toBe(false);
      expect(limiter.check(b, 1002).allowed).toBe(true);
    } finally {
      if (old === undefined) delete process.env.LAUNCHSEEDS_EDGE_CLIENT_SECRET;
      else process.env.LAUNCHSEEDS_EDGE_CLIENT_SECRET = old;
      if (oldLive === undefined) delete process.env.LAUNCHSEEDS_LIVE_OPERATIONS;
      else process.env.LAUNCHSEEDS_LIVE_OPERATIONS = oldLive;
    }
  });
});
