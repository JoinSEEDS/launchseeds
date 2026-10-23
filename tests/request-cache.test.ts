import { describe, test, expect } from "bun:test";
import { RequestCache } from "../lib/request-cache";

describe("bounded read-only upstream request cache", () => {
  test("returns a recent response without calling its loader again", async () => {
    const cache = new RequestCache<string>(2000);
    let calls = 0;
    expect(
      await cache.get("a", async () => {
        calls++;
        return "response";
      }),
    ).toBe("response");
    expect(
      await cache.get("a", async () => {
        calls++;
        return "new";
      }),
    ).toBe("response");
    expect(calls).toBe(1);
    expect(cache.inspect("a")?.value).toBe("response");
  });
  test("coalesces concurrent identical RPC observations", async () => {
    const cache = new RequestCache<string>(2000);
    let calls = 0;
    let finish: ((s: string) => void) | undefined;
    const loader = () => {
      calls++;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    };
    const first = cache.get("same", loader);
    const second = cache.get("same", loader);
    expect(cache.pendingCount).toBe(1);
    expect(calls).toBe(1);
    finish?.("finalized");
    expect(await first).toBe("finalized");
    expect(await second).toBe("finalized");
    expect(cache.pendingCount).toBe(0);
  });
  test("different wallets have distinct pending requests", async () => {
    const cache = new RequestCache<number>(2000);
    let calls = 0;
    await Promise.all([
      cache.get("token:A", async () => ++calls),
      cache.get("token:B", async () => ++calls),
    ]);
    expect(calls).toBe(2);
    expect(cache.size).toBe(2);
  });
  test("a rejected request is never cached as a balance", async () => {
    const cache = new RequestCache<number>(2000);
    await expect(
      cache.get("a", async () => {
        throw Error("rpc down");
      }),
    ).rejects.toThrow("rpc down");
    expect(cache.size).toBe(0);
    expect(cache.pendingCount).toBe(0);
    expect(await cache.get("a", async () => 10)).toBe(10);
  });
  test("an explicit expiration timestamp causes a fresh request", async () => {
    const cache = new RequestCache<number>(10);
    let calls = 0;
    await cache.get("a", async () => ++calls);
    const first = cache.inspect("a")!;
    expect(await cache.get("a", async () => ++calls, first.expiresAt)).toBe(2);
    expect(calls).toBe(2);
  });
  test("bounded capacity evicts older observations", async () => {
    const cache = new RequestCache<number>(5000, 2);
    await cache.get("a", async () => 1);
    await cache.get("b", async () => 2);
    await cache.get("c", async () => 3);
    expect(cache.size).toBe(2);
    expect(cache.inspect("a")).toBeNull();
    expect(cache.inspect("b")?.value).toBe(2);
    expect(cache.inspect("c")?.value).toBe(3);
  });
  test("invalidate removes a cached entry, but not unrelated observations", async () => {
    const cache = new RequestCache<number>(2000);
    await cache.get("a", async () => 1);
    await cache.get("b", async () => 2);
    cache.invalidate("a");
    expect(cache.inspect("a")).toBeNull();
    expect(cache.inspect("b")?.value).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
  test("misconfigured limits and unsafe keys are rejected", async () => {
    expect(() => new RequestCache(0)).toThrow();
    expect(() => new RequestCache(5000, 0)).toThrow();
    expect(() => new RequestCache(60_001)).toThrow();
    const cache = new RequestCache<number>(5000);
    await expect(cache.get("", async () => 1)).rejects.toThrow();
    await expect(cache.get("x".repeat(513), async () => 1)).rejects.toThrow();
  });
});
