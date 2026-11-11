import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { tickSeedsBurn, type SeedsBurnChain } from "../src/server/seeds-burn";
import { requestSeedsBurn } from "../src/server/seeds-view";
import { seedsBurnMessage } from "../lib/seeds-burn-message";
import { ed25519VoteVerifier } from "../src/integrations/ed25519";
import { isSeedsSymbol } from "../src/domain/seeds-split";

const addr = () => Keypair.generate().publicKey.toBase58();
function setup() {
  const seedsMint = addr();
  process.env.LAUNCHSEEDS_SEEDS_MINT = seedsMint;
  delete process.env.LAUNCHSEEDS_SEEDS_SHARE_BPS;
  const store = new Store(openLaunchseedsData(":memory:"));
  const coin = insertToken(store, { status: "live", mint: addr() } as never);
  const seeds = insertToken(store, { status: "live", mint: seedsMint, symbol: "SEEDS" } as never);
  const c = store.repo.challenges;
  c.recordFee(coin.id, "a", 1_000_000_000n, 1); // 1 SOL: 0.9 to the coin, 0.1 to $SEEDS
  c.recordFee(seeds.id, "b", 200_000_000n, 2); // all of $SEEDS' own fees go to its pool
  return { store, c, coin, seeds, seedsMint };
}

test("each coin keeps 90% of its fees for challenges; 10% and all of $SEEDS' own fees go to the $SEEDS pool", () => {
  const f = setup();
  try {
    expect(f.c.earned(f.coin.id)).toBe(900_000_000n);
    expect(f.c.earned(f.seeds.id)).toBe(0n);
    expect(f.c.seedsPool().accrued).toBe(300_000_000n);
    // Nothing is spendable until the fees are claimed into the treasury.
    expect(f.c.seedsPool().spendable).toBe(0n);
    f.c.startClaim("k", 3);
    f.c.finishClaim("k", { status: "confirmed", lamports: "1200000000" }, 4);
    expect(f.c.seedsPool().spendable).toBe(300_000_000n);
    // A partial claim covers the coins' challenge money first.
    f.c.finishClaim("k", { status: "confirmed", lamports: "1000000000" }, 5);
    expect(f.c.seedsPool().spendable).toBe(100_000_000n);
  } finally { f.store.close(); delete process.env.LAUNCHSEEDS_SEEDS_MINT; }
});

test("only an admin's fresh signed request queues a burn, within the pool, one at a time", async () => {
  const f = setup();
  try {
    f.c.startClaim("k", 3);
    f.c.finishClaim("k", { status: "confirmed", lamports: "1200000000" }, 4);
    const admin = Keypair.generate(), wallet = admin.publicKey.toBase58(), now = Date.now();
    const sign = (r: Parameters<typeof seedsBurnMessage>[0], key = admin) => bs58.encode(ed25519.sign(new TextEncoder().encode(seedsBurnMessage(r)), key.secretKey.slice(0, 32)));
    const verify = ed25519VoteVerifier.verify.bind(ed25519VoteVerifier);
    const r = { wallet, mint: f.seedsMint, lamports: "200000000", issuedAt: now, nonce: "a".repeat(32) };
    await expect(requestSeedsBurn(f.store.repo, verify, [], r, sign(r), now)).rejects.toThrow("admin");
    await expect(requestSeedsBurn(f.store.repo, verify, [wallet], { ...r, lamports: "400000000" }, sign({ ...r, lamports: "400000000" }), now)).rejects.toThrow("does not cover");
    const burn = await requestSeedsBurn(f.store.repo, verify, [wallet], r, sign(r), now);
    expect(burn.status).toBe("queued");
    expect((await requestSeedsBurn(f.store.repo, verify, [wallet], r, sign(r), now)).id).toBe(burn.id);
    const r2 = { ...r, lamports: "50000000", nonce: "b".repeat(32) };
    await expect(requestSeedsBurn(f.store.repo, verify, [wallet], r2, sign(r2), now)).rejects.toThrow("already running");
    expect(f.c.seedsPool().spendable).toBe(100_000_000n);
  } finally { f.store.close(); delete process.env.LAUNCHSEEDS_SEEDS_MINT; }
});

test("a burn buys, burns exactly what it bought, and counts what it spent; an odd buy stops in review", async () => {
  const f = setup();
  try {
    f.c.startClaim("k", 3);
    f.c.finishClaim("k", { status: "confirmed", lamports: "1200000000" }, 4);
    f.c.queueSeedsBurn({ requestKey: "c".repeat(64), authorizedBy: addr(), mint: f.seedsMint, lamports: 200_000_000n, now: 5 });
    let held = 0n, burnStatus: Awaited<ReturnType<SeedsBurnChain["status"]>> = "pending", buys = 0, receipt: Awaited<ReturnType<SeedsBurnChain["buyReceipt"]>> = "pending";
    const burned: bigint[] = [];
    const chain: SeedsBurnChain = {
      treasuryLamports: async () => 2_000_000_000n, busy: () => false,
      buy: async () => { buys++; return "buy1"; },
      buyReceipt: async () => receipt,
      prepareBurn: async (_m, amount) => { burned.push(amount); return { transaction: "t", signature: "burn1", lastValidBlockHeight: 9 }; },
      send: async () => {}, status: async () => burnStatus, expired: async () => false,
      tokenBalance: async () => held, fee: async () => 5_000n,
    };
    await tickSeedsBurn(f.store.repo, chain);
    expect(f.c.activeSeedsBurn()!.status).toBe("buying");
    await tickSeedsBurn(f.store.repo, chain);
    await tickSeedsBurn(f.store.repo, chain);
    expect(buys).toBe(1); // the saved signature is followed, never a second buy
    receipt = { bought: 5_000_000n, spent: 200_100_000n }; held = 5_000_000n;
    await tickSeedsBurn(f.store.repo, chain);
    expect(f.c.activeSeedsBurn()!.status).toBe("bought");
    await tickSeedsBurn(f.store.repo, chain);
    expect(burned).toEqual([5_000_000n]);
    burnStatus = "finalized";
    await tickSeedsBurn(f.store.repo, chain);
    const done = f.c.seedsBurns()[0]!;
    expect(done.status).toBe("done");
    expect(done.spentLamports).toBe("200105000");
    expect(f.c.seedsPool().spent).toBe(200_105_000n);

    f.c.queueSeedsBurn({ requestKey: "d".repeat(64), authorizedBy: addr(), mint: f.seedsMint, lamports: 50_000_000n, now: 6 });
    receipt = { bought: 1n, spent: 90_000_000n };
    await tickSeedsBurn(f.store.repo, chain);
    await tickSeedsBurn(f.store.repo, chain);
    expect(f.c.seedsBurns()[0]!.status).toBe("review");
  } finally { f.store.close(); delete process.env.LAUNCHSEEDS_SEEDS_MINT; }
});

test("only admins may use the SEEDS ticker", () => {
  expect(isSeedsSymbol("seeds")).toBe(true);
  expect(isSeedsSymbol("$SEEDS")).toBe(true);
  expect(isSeedsSymbol("SEEDSX")).toBe(false);
});
