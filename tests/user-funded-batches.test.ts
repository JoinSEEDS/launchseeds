import { test, expect } from "bun:test";
import { allocateUserBatches, batchMinimumOutput, batchTotal, userBatchFunding, UserBatchesSchema } from "../src/domain/user-funded-batches";
import { parseLaunchSettings, DEFAULT_LAUNCH_SETTINGS } from "../src/domain/launch-settings";

const proceedsWallet = "1".repeat(32);
const columns = [
  { slots: [100_000_000, 50_000_000], exit: { kind: "profit" as const, profitBps: 200 } },
  { slots: [30_000_000], exit: { kind: "immediate" as const } },
  { slots: [40_000_000, 40_000_000, 40_000_000, 40_000_000], exit: { kind: "time" as const, at: 5_000 } },
  { slots: [60_000_000], exit: { kind: "profit" as const, profitBps: 1_000 } },
];

test("columns carry each slot's exact buy; the launch buy is their sum", () => {
  const plan = { columns, proceedsWallet };
  const allocation = allocateUserBatches(plan, 1_000);
  expect(allocation.map((c) => c.budgets.map(Number))).toEqual(columns.map((c) => c.slots));
  expect(allocation.map((c) => c.amount)).toEqual([150_000_000n, 30_000_000n, 160_000_000n, 60_000_000n]);
  expect(batchTotal(plan)).toBe(400_000_000n);
});

test("one to four columns, one to four slots each, at least 0.03 SOL per slot", () => {
  expect(UserBatchesSchema.safeParse({ columns: [...columns, columns[0]], proceedsWallet }).success).toBe(false);
  expect(UserBatchesSchema.safeParse({ columns: [], proceedsWallet }).success).toBe(false);
  expect(UserBatchesSchema.safeParse({ columns: [{ slots: [1, 2, 3, 4, 5].map(() => 30_000_000), exit: { kind: "immediate" } }], proceedsWallet }).success).toBe(false);
  expect(UserBatchesSchema.safeParse({ columns: [{ slots: [29_999_999], exit: { kind: "immediate" } }], proceedsWallet }).success).toBe(false);
  expect(UserBatchesSchema.safeParse({ columns: [{ slots: [4_000_000_000, 1_000_000_001], exit: { kind: "immediate" } }], proceedsWallet }).success).toBe(false);
  expect(() => allocateUserBatches({ columns: [{ slots: [30_000_000], exit: { kind: "time", at: 999 } }], proceedsWallet }, 1_000)).toThrow("before the scheduled launch");
});

test("settings require the launch buy to equal the columns' slots", () => {
  const base = { ...DEFAULT_LAUNCH_SETTINGS, scheduledAt: 1_000, feesTo: "3".repeat(32) };
  const userBatches = { columns: columns.slice(0, 2), proceedsWallet };
  expect(parseLaunchSettings({ ...base, userBatches, bundleLamports: 180_000_000 }).userBatches?.columns).toHaveLength(2);
  expect(() => parseLaunchSettings({ ...base, userBatches, bundleLamports: 190_000_000 })).toThrow();
});

test("combined net target includes remaining costs and rounds upward", () => {
  const minimum = batchMinimumOutput(1_000_000_001n, 200, 50_000n, 100_000n);
  expect(minimum).toBe(1_020_150_002n);
  expect(() => batchMinimumOutput(100n, -1, 0n, 0n)).toThrow();
});

test("payment covers every buy, each wallet's reserve, the tip and fees", () => {
  const quote = userBatchFunding({ totalBuy: 1_000_000_000n, walletCount: 5, baseFee: 20_000_000n, serviceFee: 30_000_000n, reservePerWallet: 14_000_000n, bundleTip: 100_000n });
  expect(quote.buyerReserve).toBe(70_000_000n);
  expect(quote.required).toBe(1_120_100_000n);
  expect(() => userBatchFunding({ totalBuy: 1n, walletCount: 17, baseFee: 0n, serviceFee: 0n, reservePerWallet: 0n, bundleTip: 0n })).toThrow();
});
