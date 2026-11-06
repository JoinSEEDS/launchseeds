import { expect, test } from "bun:test";
import { UserBatchesSchema, allocateTranches, trancheFunding } from "../src/domain/user-funded-batches";
import { scheduledCommitment } from "../src/domain/scheduled-plan";

const proceedsWallet = "3".repeat(32);
const columns = [{ slots: [100_000_000], exit: { kind: "profit" as const, profitBps: 200 } }];

test("launches without tranches keep the exact settings (and plan hash) they had", () => {
  const parsed = UserBatchesSchema.parse({ columns, proceedsWallet });
  expect("tranches" in parsed).toBe(false);
  const commitment = scheduledCommitment({ name: "A", symbol: "A", image: "x" }, { userBatches: parsed } as never, []);
  expect(JSON.stringify(commitment)).not.toContain("tranches");
});

test("tranches: delay or market-cap triggers, funded from the deposit wallet", () => {
  const parsed = UserBatchesSchema.parse({ columns, proceedsWallet, tranches: [
    { slots: [50_000_000, 50_000_000], trigger: { kind: "delay", seconds: 5 }, exit: { kind: "profit", profitBps: 1000 } },
    { slots: [200_000_000], trigger: { kind: "mcap", usd: 25_000 }, exit: { kind: "immediate" } },
  ] });
  expect(parsed.tranches![1]!.trigger).toEqual({ kind: "mcap", usd: 25_000, direction: "above", withinSeconds: 86_400 });
  expect(parsed.tranches![0]!.slippageBps).toBe(500);
  // 0.3 buys + 3 reserves + 2 fee budgets + the rent buffer.
  expect(trancheFunding(parsed, 14_000_000n)).toBe(300_000_000n + 42_000_000n + 200_000n + 1_000_000n);
  expect(trancheFunding({ columns } as never, 14_000_000n)).toBe(0n);
  expect(() => allocateTranches({ ...parsed, tranches: [{ ...parsed.tranches![0]!, exit: { kind: "time", at: 1 } }] }, 10)).toThrow(/before the scheduled launch/);
  expect(UserBatchesSchema.safeParse({ columns, proceedsWallet, tranches: [{ slots: [1], trigger: { kind: "delay", seconds: 5 }, exit: { kind: "immediate" } }] }).success).toBe(false);
});
