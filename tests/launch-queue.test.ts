import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { advanceQueue, queueKey, queueState } from "../src/server/launch-queue";
import { TREASURY_WALLET } from "../src/server/treasury";
import { ApiError } from "../lib/api-security";

const input = JSON.stringify({ name: "Seed Cat", symbol: "SEEDCAT", description: "", image: "", website: "", x: "", telegram: "", devBuySol: "0" });
function setup() {
  process.env.LAUNCHSEEDS_MAX_BUNDLE_SOL = "3";
  const store = new Store(openLaunchseedsData(":memory:"));
  const created: string[] = [];
  let fail: Error | null = null;
  // A launch holds the treasury from the moment it is saved.
  const service = { create: async (_i: unknown, capability: string, onCreated: (id: number) => void, _s: unknown, wallet: string) => {
    if (fail) throw fail;
    const t = insertToken(store, { status: "preparing", fundingWalletName: TREASURY_WALLET, creatorWallet: wallet } as never);
    created.push(capability); onCreated(t.id);
  } } as never;
  const provider = { walletFor: () => ({ address: Keypair.generate().publicKey.toBase58() }), balanceLamports: async () => 1_000_000_000 };
  const add = (n: number) => {
    const capability = String(n).padStart(64, "0");
    store.repo.launchQueue.add({ key: queueKey(capability), capability, wallet: Keypair.generate().publicKey.toBase58(), inputJson: input, now: n });
    return queueKey(capability);
  };
  return { store, service, provider, created, add, setFail: (e: Error | null) => { fail = e; } };
}

test("requests launch in arrival order, one at a time, each told its place and wait", async () => {
  const f = setup();
  try {
    const a = f.add(1), b = f.add(2), c = f.add(3);
    expect(queueState(f.store, c)).toMatchObject({ status: "waiting", position: 3, ahead: 2 });
    await Promise.all([advanceQueue(f.store, f.service, f.provider), advanceQueue(f.store, f.service, f.provider)]);
    expect(f.created).toHaveLength(1); // the second call saw the treasury busy
    expect(queueState(f.store, a)!.status).toBe("started");
    const second = queueState(f.store, b)!;
    expect(second).toMatchObject({ status: "waiting", position: 1, ahead: 0 });
    expect((second as { etaSeconds: number }).etaSeconds).toBeGreaterThan(0);
    expect((queueState(f.store, c) as { etaSeconds: number }).etaSeconds).toBeGreaterThanOrEqual((second as { etaSeconds: number }).etaSeconds);
    // The first launch finishes; the next one goes.
    f.store.repo.tokens.all().forEach((t) => f.store.data.database.tokens.update(t.id, { status: "failed" } as never));
    await advanceQueue(f.store, f.service, f.provider);
    expect(queueState(f.store, b)!.status).toBe("started");
    expect(queueState(f.store, c)).toMatchObject({ position: 1 });
  } finally { f.store.close(); }
});

test("an empty treasury keeps the line waiting; a rejected launch fails only itself", async () => {
  const f = setup();
  try {
    const a = f.add(1), b = f.add(2);
    await advanceQueue(f.store, f.service, { ...f.provider, balanceLamports: async () => 1_000 });
    expect(queueState(f.store, a)).toMatchObject({ status: "waiting", note: "Waiting for the treasury to refill." });
    f.setFail(new ApiError("Bad image.", 400));
    await advanceQueue(f.store, f.service, f.provider);
    expect(queueState(f.store, a)).toEqual({ key: a, status: "failed", error: "Bad image." });
    f.setFail(null);
    await advanceQueue(f.store, f.service, f.provider);
    expect(queueState(f.store, b)!.status).toBe("started");
  } finally { f.store.close(); }
});

test("$SEEDS launches with its own bundle size; other coins keep the usual cap", async () => {
  const f = setup();
  const sizes: number[] = [];
  const exits: string[] = [];
  const service = { create: async (_i: unknown, _c: string, onCreated: (id: number) => void, s: { bundleLamports: number; userBatches: { columns: { exit: { kind: string; usd?: number } }[] } }) => {
    exits.push(s.userBatches.columns.map((c) => c.exit.kind + (c.exit.usd ? `:${c.exit.usd}` : "")).join(","));
    sizes.push(s.bundleLamports);
    onCreated(insertToken(f.store, { status: "failed" } as never).id);
  } } as never;
  const rich = { ...f.provider, balanceLamports: async () => 10_000_000_000 };
  try {
    process.env.LAUNCHSEEDS_SEEDS_BUNDLE_SOL = "4";
    f.add(1);
    f.store.repo.launchQueue.add({ key: "s".repeat(32), capability: "s".repeat(64), wallet: Keypair.generate().publicKey.toBase58(), inputJson: input.replace("SEEDCAT", "SEEDS"), now: 2 });
    await advanceQueue(f.store, service, rich);
    await advanceQueue(f.store, service, rich);
    expect(sizes).toEqual([3_000_000_000, 4_000_000_000]);
    // $SEEDS holds for its $5,000 floor; other coins sell on their schedule.
    expect(exits).toEqual(["after,after,after,after", "floor:5000,floor:5000,floor:5000,floor:5000"]);
  } finally { delete process.env.LAUNCHSEEDS_SEEDS_BUNDLE_SOL; f.store.close(); }
});

test("$SEEDS can buy fixed amounts per wallet and sell them at once", async () => {
  const f = setup();
  const seen: Array<{ size: number; slots: number[]; exits: string[] }> = [];
  const service = { create: async (_i: unknown, _c: string, onCreated: (id: number) => void, s: { bundleLamports: number; userBatches: { columns: { slots: number[]; exit: { kind: string } }[] } }) => {
    seen.push({ size: s.bundleLamports, slots: s.userBatches.columns.map((c) => c.slots[0]!), exits: s.userBatches.columns.map((c) => c.exit.kind) });
    onCreated(insertToken(f.store, { status: "failed" } as never).id);
  } } as never;
  try {
    process.env.LAUNCHSEEDS_SEEDS_COLUMNS_SOL = "0.1,0.2,0.3,0.4";
    process.env.LAUNCHSEEDS_SEEDS_SELL = "instant";
    f.store.repo.launchQueue.add({ key: "s".repeat(32), capability: "s".repeat(64), wallet: Keypair.generate().publicKey.toBase58(), inputJson: input.replace("SEEDCAT", "SEEDS"), now: 1 });
    // Too little in the treasury for all four: it waits rather than buying less.
    await advanceQueue(f.store, service, { ...f.provider, balanceLamports: async () => 900_000_000 });
    expect(seen).toHaveLength(0);
    await advanceQueue(f.store, service, { ...f.provider, balanceLamports: async () => 2_000_000_000 });
    expect(seen).toEqual([{ size: 1_000_000_000, slots: [100_000_000, 200_000_000, 300_000_000, 400_000_000], exits: ["immediate", "immediate", "immediate", "immediate"] }]);
  } finally { delete process.env.LAUNCHSEEDS_SEEDS_COLUMNS_SOL; delete process.env.LAUNCHSEEDS_SEEDS_SELL; f.store.close(); }
});
