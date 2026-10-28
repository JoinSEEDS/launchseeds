import { describe, expect, test } from "bun:test";
import {
  ApiError,
  FixedWindowLimiter,
  apiJson,
  assertVotingPayload,
  extractPathId,
  readBoundedJson,
  requireSameOrigin,
} from "../lib/api-security";

const api =
  "https://launchseeds.example/api/strategies/550e8400-e29b-41d4-a716-446655440000";
const jsonRequest = (value: unknown, headers: Record<string, string> = {}) =>
  new Request(api, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://launchseeds.example",
      ...headers,
    },
    body: JSON.stringify(value),
  });

describe("API transport validation", () => {
  test("parses bounded JSON objects", async () => {
    expect(await readBoundedJson(jsonRequest({ action: "challenge" }))).toEqual(
      { action: "challenge" },
    );
  });

  test("rejects JSON arrays and primitives", async () => {
    await expect(readBoundedJson(jsonRequest([1, 2]))).rejects.toThrow(
      "object",
    );
    await expect(readBoundedJson(jsonRequest(4))).rejects.toThrow("object");
  });

  test("enforces request size by bytes", async () => {
    const request = jsonRequest(
      { name: "🙂".repeat(100) },
      { "content-length": "1" },
    );
    await expect(readBoundedJson(request, 100)).rejects.toMatchObject({
      status: 413,
    });
  });

  test("refuses a fabricated over-limit content length", async () => {
    const request = jsonRequest({ ok: true }, { "content-length": "10000" });
    await expect(readBoundedJson(request, 100)).rejects.toMatchObject({
      status: 413,
    });
  });

  test("rejects unsupported media types", async () => {
    const request = jsonRequest({ ok: true }, { "content-type": "text/plain" });
    await expect(readBoundedJson(request)).rejects.toMatchObject({
      status: 415,
    });
  });

  test("does not accept forged Origin headers", () => {
    expect(() =>
      requireSameOrigin(jsonRequest({}, { origin: "https://evil.example" })),
    ).toThrow(ApiError);
    expect(() =>
      requireSameOrigin(jsonRequest({}, { origin: "https://launchseeds.example" })),
    ).not.toThrow();
  });

  test("validates token path with no extra segments", () => {
    expect(extractPathId(new Request(api), "/api/strategies")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(() =>
      extractPathId(new Request(`${api}/other`), "/api/strategies"),
    ).toThrow();
  });

  test("adds no-store and nosniff to responses", () => {
    const response = apiJson({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("request limiting and wallet shape", () => {
  test("rate-limit windows reset and capacity remains bounded", () => {
    const limiter = new FixedWindowLimiter(2, 1000, 4);
    expect(limiter.check("a", 1).allowed).toBe(true);
    expect(limiter.check("a", 2).allowed).toBe(true);
    expect(limiter.check("a", 3).allowed).toBe(false);
    expect(limiter.check("a", 1002).allowed).toBe(true);
    for (const key of ["b", "c", "d", "e"]) limiter.check(key, 1003);
    limiter.prune(3000);
    expect(limiter.check("a", 3000).allowed).toBe(true);
  });

  test("rejects unknown actions and oversized signatures", () => {
    expect(() =>
      assertVotingPayload({ action: "delete", wallet: "abc" }),
    ).toThrow();
    expect(() =>
      assertVotingPayload({
        action: "vote",
        wallet: "abc",
        nonce: "ab",
        signature: "x",
      }),
    ).toThrow();
    expect(() =>
      assertVotingPayload({
        action: "vote",
        wallet: "abc",
        nonce: "a".repeat(32),
        signature: "x".repeat(101),
      }),
    ).toThrow();
  });
});

test("same-origin reads accept Sec-Fetch-Site from our pages and refuse other sites", async () => {
  const { requireSameOriginRead } = await import("../lib/api-security");
  const request = (headers: Record<string, string>) => new Request("http://localhost:3010/api/clone?mint=x", { headers });
  expect(() => requireSameOriginRead(request({ "sec-fetch-site": "same-origin" }))).not.toThrow();
  expect(() => requireSameOriginRead(request({ origin: "http://localhost:3010" }))).not.toThrow();
  expect(() => requireSameOriginRead(request({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }))).toThrow("Origin not allowed");
  expect(() => requireSameOriginRead(request({}))).toThrow("Origin not allowed");
});
