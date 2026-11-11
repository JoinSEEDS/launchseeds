import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { openLaunchseedsData } from "../src/db";
import { bondingCurve, creatorVault, feeFromTransaction, syncCoinFees } from "../src/server/coin-fees";
import { insertToken } from "./fixtures";
import { Store } from "../src/server/store";

const treasury = Keypair.generate().publicKey.toBase58(), mint = Keypair.generate().publicKey.toBase58();
const vault = creatorVault(treasury), curve = bondingCurve(mint);
const trade = (vaultDelta: number, keys = [Keypair.generate().publicKey.toBase58(), curve, vault], blockTime = 100) => ({
  blockTime,
  transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })) } },
  meta: { err: null, preBalances: keys.map(() => 1_000_000), postBalances: keys.map((k) => (k === vault ? 1_000_000 + vaultDelta : 1_000_000)) },
});

test("a trade's fee is the creator vault's increase in that transaction", () => {
  expect(feeFromTransaction(trade(12_345), vault, curve)).toBe(12_345n);
  expect(feeFromTransaction(trade(0), vault, curve)).toBeNull();
  expect(feeFromTransaction(trade(500, [Keypair.generate().publicKey.toBase58(), vault]), vault, curve)).toBeNull();
  expect(feeFromTransaction({ ...trade(500), meta: { ...trade(500).meta, err: { x: 1 } } }, vault, curve)).toBeNull();
});

test("fees are recorded once per trade, oldest first, and resume after the last one", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  try {
    const token = insertToken(store, { status: "live", mint } as never);
    const chain = [
      { signature: "s3", fee: 300, time: 30 },
      { signature: "s2", fee: 200, time: 20 },
      { signature: "s1", fee: 100, time: 10 },
    ];
    let visible = chain.slice(1);
    const rpc = (async (method: string, params: any[]) => {
      if (method === "getSignaturesForAddress") {
        const until = params[1].until;
        const list = visible.map((c) => ({ signature: c.signature, err: null, blockTime: c.time }));
        return until ? list.slice(0, list.findIndex((s) => s.signature === until)) : list;
      }
      const c = chain.find((x) => x.signature === params[0])!;
      return trade(c.fee, [Keypair.generate().publicKey.toBase58(), curve, vault], c.time);
    }) as never;
    expect(await syncCoinFees({ repo: store.repo, rpc, tokenId: token.id, mint, treasury })).toBe(2);
    expect(store.repo.challenges.earned(token.id)).toBe(270n);
    visible = chain;
    expect(await syncCoinFees({ repo: store.repo, rpc, tokenId: token.id, mint, treasury })).toBe(1);
    expect(await syncCoinFees({ repo: store.repo, rpc, tokenId: token.id, mint, treasury })).toBe(0);
    expect(store.repo.challenges.earned(token.id)).toBe(540n);
    expect(store.repo.challenges.latestFee(token.id)?.signature).toBe("s3");
  } finally {
    store.close();
  }
});

test("a coin's balance: earned minus paid minus what open challenges and approved completions promise", () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  try {
    const token = insertToken(store, { status: "live", mint } as never), c = store.repo.challenges;
    c.recordFee(token.id, "a", 1_000_000n, 1);
    const wallet = Keypair.generate().publicKey.toBase58();
    const challenge = c.createChallenge({ tokenId: token.id, title: "Post a video", description: "", minRewardLamports: 50_000n, maxRewardLamports: 200_000n, maxWinners: 3, createdBy: wallet, now: 1 });
    // Open slots are held at the maximum reward.
    expect(c.balance(token.id)).toEqual({ earned: 900_000n, paid: 0n, promised: 600_000n, available: 300_000n });
    const s = c.createSubmission({ challengeId: challenge.id, tokenId: token.id, wallet, proofUrl: "https://x.com/a/status/1", requestedLamports: 180_000n, now: 2 });
    expect(c.submission(s.id)?.requestedLamports).toBe("180000");
    expect(c.moveSubmission(s.id, "pending", { status: "approved", awardedLamports: "120000", decidedAt: 3 })).toBe(true);
    expect(c.moveSubmission(s.id, "pending", { status: "rejected", decidedAt: 3 })).toBe(false);
    // An approved completion holds its approved amount, not the maximum.
    expect(c.balance(token.id).promised).toBe(400_000n + 120_000n);
    expect(c.moveSubmission(s.id, "approved", { status: "paid", paidAt: 4 })).toBe(true);
    expect(c.balance(token.id)).toEqual({ earned: 900_000n, paid: 120_000n, promised: 400_000n, available: 380_000n });
    expect(c.closeChallenge(challenge.id, 5)).toBe(true);
    expect(c.balance(token.id)).toEqual({ earned: 900_000n, paid: 120_000n, promised: 0n, available: 780_000n });
    expect(c.owedAll()).toBe(880_000n);
  } finally {
    store.close();
  }
});

test("a trade that touches two of the treasury's coins is credited to neither", () => {
  const other = Keypair.generate().publicKey.toBase58(), otherCurve = bondingCurve(other);
  const shared = trade(9_000, [Keypair.generate().publicKey.toBase58(), curve, otherCurve, vault]);
  expect(feeFromTransaction(shared, vault, curve, new Set([otherCurve]))).toBe("ambiguous");
  expect(feeFromTransaction(trade(9_000), vault, curve, new Set([otherCurve]))).toBe(9_000n);
});

test("fee tracking stops instead of skipping history it could not read", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  try {
    const token = insertToken(store, { status: "live", mint } as never);
    const rpc = (async (method: string) => (method === "getSignaturesForAddress" ? Array.from({ length: 1000 }, (_, i) => ({ signature: `s${Math.random()}${i}`, err: null })) : null)) as never;
    await expect(syncCoinFees({ repo: store.repo, rpc, tokenId: token.id, mint, treasury })).rejects.toThrow("fee tracking paused");
    expect(store.repo.challenges.latestFee(token.id)).toBeNull();
  } finally {
    store.close();
  }
});

test("a coin's bundle profit counts toward its challenge money; a loss counts as none", () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  try {
    const token = insertToken(store, { status: "live", mint: Keypair.generate().publicKey.toBase58() } as never), c = store.repo.challenges;
    const column = (budget: string, paid: string) => store.repo.userBatches.insert(token.id, 0, JSON.stringify({ status: "settled", paidLamports: paid, buyers: [{ budgetLamports: budget }] }), 1);
    column("250000000", "440000000"); // sent 0.264 with the reserve, got 0.44 back
    expect(c.bundleProfit(token.id)).toBe(176_000_000n);
    expect(c.earned(token.id)).toBe(176_000_000n);
    const loser = insertToken(store, { status: "live", mint: Keypair.generate().publicKey.toBase58() } as never);
    store.repo.userBatches.insert(loser.id, 0, JSON.stringify({ status: "settled", paidLamports: "200000000", buyers: [{ budgetLamports: "250000000" }] }), 1);
    expect(c.bundleProfit(loser.id)).toBe(0n);
  } finally { store.close(); }
});
