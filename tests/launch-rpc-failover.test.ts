import { test, expect } from "bun:test";
import { probeConfiguredRpc } from "../src/server/launch-health";

test("readiness succeeds through the backup when the primary is cooling down", async () => {
  const seen: string[] = [];
  const result = await probeConfiguredRpc(
    ["primary", "backup", "backup"],
    100,
    async (url) => {
      seen.push(url);
      return {
        healthy: url === "backup",
        checkedAt: 100,
        slot: url === "backup" ? 123 : 0,
      };
    },
  );
  expect(result).toEqual({ healthy: true, checkedAt: 100, slot: 123 });
  expect(seen).toEqual(["primary", "backup"]);
});
test("a stalled primary does not delay a healthy backup", async () => {
  const result = await probeConfiguredRpc(
    ["primary", "backup"],
    100,
    async (url) => {
      if (url === "primary") return new Promise(() => {});
      return { healthy: true, checkedAt: 100, slot: 123 };
    },
  );
  expect(result.healthy).toBe(true);
});
test("all failed RPCs still block payment admission", async () => {
  const result = await probeConfiguredRpc(
    ["primary", "backup"],
    100,
    async (url) => {
      if (url === "primary") throw new Error("Transport failure");
      return { healthy: false, checkedAt: 100, slot: 0 };
    },
  );
  expect(result.healthy).toBe(false);
  expect(result.slot).toBe(0);
  expect((await probeConfiguredRpc([], 100)).healthy).toBe(false);
});
