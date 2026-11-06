import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { SolardLaunchProvider } from "../src/server/solard";
import type { TraderClient } from "../src/server/solard-sdk";
import { insertToken } from "./fixtures";

function provider(store = new Store(openLaunchseedsData(":memory:"))) {
  const wallets: Array<{ name: string; address: string }> = [];
  const add = (name: string) => { const w = { name, address: Keypair.generate().publicKey.toBase58() }; wallets.push(w); return w; };
  const sdk = { listWallets: () => wallets, createWallet: add, importWallet: (_k: string, name: string) => add(name) } as unknown as TraderClient;
  return Object.assign(new SolardLaunchProvider(sdk, store, "https://api.mainnet-beta.solana.com", 20_000_000, async () => ({ metadataUri: "ipfs://x" })), { add });
}

test("each column's first slot is a distinct reused pool signer; other slots are fresh wallets for this coin", () => {
  const previous = process.env.LAUNCHSEEDS_REUSE_WALLETS;
  process.env.LAUNCHSEEDS_REUSE_WALLETS = "ace,art,bet,sun,cat";
  try {
    const mint = Keypair.generate().publicKey.toBase58();
    const plan = provider().planColumns({ id: 1, mintSignerRef: `launchseeds-mint-${mint}` }, [[100n, 50n], [30n], [40n, 40n, 40n], [60n]]);
    expect(plan.map((b) => [b.batchIndex, b.role])).toEqual([
      [0, "signer"], [0, "fresh"], [1, "signer"], [2, "signer"], [2, "fresh"], [2, "fresh"], [3, "signer"],
    ]);
    const signers = plan.filter((b) => b.role === "signer").map((b) => b.name);
    expect(new Set(signers).size).toBe(4);
    for (const name of signers) expect(["ace", "art", "bet", "sun", "cat"]).toContain(name);
    const fresh = plan.filter((b) => b.role === "fresh").map((b) => b.name);
    expect(fresh).toEqual([`launchseeds-bundle-${mint}-0-1`, `launchseeds-bundle-${mint}-2-1`, `launchseeds-bundle-${mint}-2-2`]);
    expect(plan.map((b) => b.budgetLamports)).toEqual(["100", "50", "30", "40", "40", "40", "60"]);
    // The same coin always gets the same signers (planning, preparation, execution agree).
    expect(provider().planColumns({ id: 1, mintSignerRef: `launchseeds-mint-${mint}` }, [[1n], [1n], [1n], [1n]]).map((b) => b.name)).toEqual(signers);
    process.env.LAUNCHSEEDS_REUSE_WALLETS = "ace,art";
    expect(() => provider().planColumns({ id: 1, mintSignerRef: `launchseeds-mint-${mint}` }, [[1n], [1n], [1n]])).toThrow(/need 3 signing wallets/);
  } finally {
    if (previous === undefined) delete process.env.LAUNCHSEEDS_REUSE_WALLETS; else process.env.LAUNCHSEEDS_REUSE_WALLETS = previous;
  }
});

test("fresh wallets of a settled launch are reused; busy ones are not; a launch keeps its choices; tranches get fresh wallets", () => {
  const previous = process.env.LAUNCHSEEDS_REUSE_WALLETS;
  process.env.LAUNCHSEEDS_REUSE_WALLETS = "ace,art,bet,sun,cat";
  const store = new Store(openLaunchseedsData(":memory:"));
  try {
    const p = provider(store);
    const old = insertToken(store, { mint: Keypair.generate().publicKey.toBase58(), fundingWallet: Keypair.generate().publicKey.toBase58() });
    const a = p.add("launchseeds-bundle-old-0-1"), b = p.add("launchseeds-bundle-old-0-2");
    const run = (status: string, buyers: Array<{ name: string; address: string }>) => JSON.stringify({ status, buyers: buyers.map((w) => ({ name: w.name, wallet: w.address, role: "fresh", budgetLamports: "1" })) });
    store.repo.userBatches.insert(old.id, 0, run("settled", [a, b]), Date.now());
    const mint = Keypair.generate().publicKey.toBase58();
    const plan = p.planColumns({ id: 99, mintSignerRef: `launchseeds-mint-${mint}` }, [[1n, 1n, 1n]], [[2n, 2n]]);
    // Two settled wallets are reused, then new ones are made.
    expect(plan.map((x) => x.wallet).slice(1, 3)).toEqual([a.address, b.address]);
    expect(plan.slice(3).map((x) => [x.tranche, x.role, x.name])).toEqual([[0, "fresh", `launchseeds-bundle-${mint}-t0-0`], [0, "fresh", `launchseeds-bundle-${mint}-t0-1`]]);
    expect(plan[3]!.batchIndex).toBeUndefined();
    // Saved for launch 99, they are busy for any other launch...
    const live = insertToken(store, { mint, fundingWallet: Keypair.generate().publicKey.toBase58() });
    store.repo.scheduledPlans.save({ tokenId: live.id, buyersJson: JSON.stringify(plan), planHash: "h", createdAt: 1 });
    const other = p.planColumns({ id: 100, mintSignerRef: `launchseeds-mint-${Keypair.generate().publicKey.toBase58()}` }, [[1n, 1n]]);
    expect([a.address, b.address]).not.toContain(other[1]!.wallet);
    // ...and re-planning launch 99 keeps them, in their slots.
    const again = p.planColumns({ id: live.id, mintSignerRef: `launchseeds-mint-${mint}` }, [[1n, 1n, 1n]], [[2n, 2n]]);
    expect(again.map((x) => x.wallet)).toEqual(plan.map((x) => x.wallet));
  } finally {
    store.close();
    if (previous === undefined) delete process.env.LAUNCHSEEDS_REUSE_WALLETS; else process.env.LAUNCHSEEDS_REUSE_WALLETS = previous;
  }
});
