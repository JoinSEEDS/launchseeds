import { expect, test } from "bun:test";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { UserBatchEngine, UserBatchStateSchema, type UserBatchChain } from "../src/server/user-batch-engine";
import { PUMP_INITIAL_VIRTUAL_BASE, postBundleMarketCapLamports } from "../src/domain/user-funded-batches";

const SUPPLY = 1_000_000_000_000_000n;
/** A fresh Pump curve after a buy that put `lamports` into it. */
function curveAfter(lamports: bigint) {
  const k = 30_000_000_000n * PUMP_INITIAL_VIRTUAL_BASE, quote = 30_000_000_000n + lamports, base = k / quote;
  return { virtualQuote: quote, virtualBase: base, bundleRaw: PUMP_INITIAL_VIRTUAL_BASE - base };
}

test("the post-bundle market cap is where 1 and 4 SOL bundles leave the curve, about 29.8 and 35.8 SOL", () => {
  const one = curveAfter(987_700_000n), four = curveAfter(3_950_600_000n); // after Pump's 1.25% buy fee
  const cap = (c: ReturnType<typeof curveAfter>) => postBundleMarketCapLamports({ ...c, supply: SUPPLY }) / 1e9;
  expect(cap(one)).toBeCloseTo(29.83, 1);
  expect(cap(four)).toBeCloseTo(35.84, 1);
  // Later trades move the reserves but not the answer: it is fixed by what the bundle bought.
  const later = { virtualQuote: 31_500_000_000n, virtualBase: (30_000_000_000n * PUMP_INITIAL_VIRTUAL_BASE) / 31_500_000_000n };
  expect(postBundleMarketCapLamports({ ...later, supply: SUPPLY, bundleRaw: one.bundleRaw }) / 1e9).toBeCloseTo(29.83, 1);
});

test("for a minute after its time a wallet only sells above the post-bundle market cap, then at market", async () => {
  const store = new Store(openLaunchseedsData(":memory:")), token = insertToken(store, { mint: "2".repeat(32) });
  let clock = 1_000_000, floorClear = false;
  const calls: Array<bigint | undefined> = [];
  const chain = {
    sellFeeCap: 0n, settlementFeeCap: 0n,
    fills: async () => ({ fills: [100n], cost: 1_000_000n }),
    prepareSale: async (_s: unknown, _m: unknown, _u: unknown, bundleRaw?: bigint) => {
      calls.push(bundleRaw);
      if (bundleRaw !== undefined && !floorClear) throw new Error("This sale is too large to clear its market cap floor");
      return { transaction: "t", signature: `s${calls.length}`, lastValidBlockHeight: 100 };
    },
    needsRefresh: async () => false, simulate: async () => "not yet", send: async () => {}, status: async () => "unknown",
    failedFee: async () => null, absentAfterExpiry: async () => false, saleReceipt: async () => null,
    preparePayout: async () => ({ transaction: "p", signature: "p", lastValidBlockHeight: 100 }), payoutReceipt: async () => null,
    marketCapUsd: async () => 0, prepareTrancheBuy: async () => ({ transaction: "b", signature: "b", lastValidBlockHeight: 100 }),
  } as unknown as UserBatchChain;
  const column = (i: number, seconds: number) => UserBatchStateSchema.parse({ version: 1, status: "buying", config: { slots: [100_000_000], exit: { kind: "after", seconds, holdFloorSeconds: 60 } }, proceedsWallet: "3".repeat(32), mint: token.mint, buyers: [{ name: `w${i}`, wallet: String(i + 4).repeat(32), budgetLamports: "100000000", batchIndex: i, role: "signer" }] });
  store.repo.userBatches.insert(token.id, 0, JSON.stringify(column(0, 0)), clock);
  store.repo.userBatches.insert(token.id, 1, JSON.stringify(column(1, 3)), clock);
  const engine = new UserBatchEngine(store.repo, chain, () => clock);
  const read = (i: number) => UserBatchStateSchema.parse(JSON.parse(store.repo.userBatches.byToken(token.id).find((r) => r.batchIndex === i)!.stateJson));
  try {
    await engine.tick(); await engine.tick();
    expect(read(0).status).toBe("holding");
    await engine.tick();
    expect(calls.at(-1)).toBe(200n); // both columns' fills: the whole bundle
    expect(read(0).sale).toBeNull(); // the market cap is below the post-bundle level: no sale yet
    floorClear = true;
    await engine.tick();
    expect(read(0).floorSale).toBe(true);
    // A minute past its time the hold is over: the floor sale is dropped for one at market.
    clock += 61_000;
    await engine.tick();
    expect(calls).toContain(undefined); // the first wallet, now at market
    expect(calls.at(-1)).toBe(200n); // the second wallet is still within its own minute
    expect(read(0).floorSale).toBe(false);
  } finally { store.close(); }
});
