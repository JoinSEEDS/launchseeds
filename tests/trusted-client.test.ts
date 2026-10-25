import { describe, expect, test } from "bun:test";
import { ApiError } from "../lib/api-security";
import {
  bindClientIdentity,
  trustedClientKey,
  IngressRateLimiter,
} from "../lib/trusted-client";

const request = (identity?: string) => {
  const req = new Request("https://launchseeds.xyz/api/launches", {
    // Browser-supplied identity headers carry no meaning.
    headers: { "x-launchseeds-edge-client": "forged_client" },
  });
  return identity ? bindClientIdentity(req, identity) : req;
};

describe("entrypoint-bound identity", () => {
  test("an identity bound by the entrypoint is the rate-limit subject", () => {
    expect(trustedClientKey(request("ip:aaaa"), { production: true })).toBe(
      "ip:aaaa",
    );
  });
  test("unbound requests fail closed in live mode", () => {
    expect(() => trustedClientKey(request(), { production: true })).toThrow(
      ApiError,
    );
  });
  test("unbound requests work only in development", () => {
    expect(trustedClientKey(request(), { production: false })).toBe(
      "local-development",
    );
  });
});

describe("independent quotas", () => {
  test("one noisy client does not consume another client's personal quota", () => {
    const limiter = new IngressRateLimiter("test-votes", 2, 10_000, 100);
    const a = request("ip:aaaa"),
      b = request("ip:bbbb");
    expect(limiter.check(a, 1000).allowed).toBe(true);
    expect(limiter.check(a, 1001).allowed).toBe(true);
    expect(limiter.check(a, 1002).allowed).toBe(false);
    expect(limiter.check(b, 1002).allowed).toBe(true);
  });
});
