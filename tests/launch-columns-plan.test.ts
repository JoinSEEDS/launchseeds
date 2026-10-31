import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { SolardLaunchProvider } from "../src/server/solard";
import type { TraderClient } from "../src/server/solard-sdk";

function provider() {
  const store = new Store(openLaunchseedsData(":memory:"));
  const wallets: Array<{ name: string; address: string }> = [];
  const add = (name: string) => { const w = { name, address: Keypair.generate().publicKey.toBase58() }; wallets.push(w); return w; };
  const sdk = { listWallets: () => wallets, createWallet: add, importWallet: (_k: string, name: string) => add(name) } as unknown as TraderClient;
  return new SolardLaunchProvider(sdk, store, "https://api.mainnet-beta.solana.com", 20_000_000, async () => ({ metadataUri: "ipfs://x" }));
}

test("each column's first slot is a distinct reused pool signer; other slots are fresh wallets for this coin", () => {
  const previous = process.env.LAUNCHSEEDS_REUSE_WALLETS;
  process.env.LAUNCHSEEDS_REUSE_WALLETS = "ace,art,bet,sun,cat";
  try {
    const mint = Keypair.generate().publicKey.toBase58();
    const plan = provider().planColumns(`launchseeds-mint-${mint}`, [[100n, 50n], [30n], [40n, 40n, 40n], [60n]]);
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
    expect(provider().planColumns(`launchseeds-mint-${mint}`, [[1n], [1n], [1n], [1n]]).map((b) => b.name)).toEqual(signers);
    process.env.LAUNCHSEEDS_REUSE_WALLETS = "ace,art";
    expect(() => provider().planColumns(`launchseeds-mint-${mint}`, [[1n], [1n], [1n]])).toThrow(/need 3 signing wallets/);
  } finally {
    if (previous === undefined) delete process.env.LAUNCHSEEDS_REUSE_WALLETS; else process.env.LAUNCHSEEDS_REUSE_WALLETS = previous;
  }
});
