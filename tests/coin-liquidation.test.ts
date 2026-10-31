import { test, expect } from "bun:test";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { CoinLiquidationSchema, tickLiquidations, type CoinLiquidationChain, type LiquidationSale } from "../src/server/coin-liquidation";
import { UserBatchStateSchema } from "../src/server/user-batch-engine";

function fixture(columnStatus: string) {
  const store = new Store(openLaunchseedsData(":memory:")), token = insertToken(store, { mint: "2".repeat(32) });
  const signer = "4".repeat(32), fresh = "5".repeat(32), deployer = "6".repeat(32), destination = "3".repeat(32);
  store.repo.userBatches.insert(token.id, 0, JSON.stringify(UserBatchStateSchema.parse({ version: 1, status: columnStatus, config: { slots: [100_000_000, 50_000_000], exit: { kind: "immediate" } }, proceedsWallet: destination, mint: token.mint, buyers: [{ name: "ace", wallet: signer, budgetLamports: "100000000", batchIndex: 0, role: "signer" }, { name: "f", wallet: fresh, budgetLamports: "50000000", batchIndex: 0, role: "fresh" }] })), Date.now());
  store.repo.userBatches.startLiquidation(token.id, JSON.stringify(CoinLiquidationSchema.parse({ version: 2, mint: token.mint, destination, requestedBy: "admin", status: "pending", wallets: [
    { wallet: signer, role: "signer", batchIndex: 0 }, { wallet: fresh, role: "fresh", batchIndex: 0 }, { wallet: deployer, role: "deployer", batchIndex: null },
  ] })), Date.now());
  const holdings = new Map<string, { amount: bigint; accounts: number }>([[signer, { amount: 500n, accounts: 1 }], [fresh, { amount: 0n, accounts: 0 }], [deployer, { amount: 900n, accounts: 1 }]]);
  const sales: Array<{ payer: string; sales: LiquidationSale[] }> = [], sweeps: string[] = [], confirmed = new Set<string>();
  let n = 0;
  const chain: CoinLiquidationChain = {
    holdings: async (wallet) => holdings.get(wallet)!,
    prepareSale: async (_mint, payer, list) => { sales.push({ payer, sales: list }); return { transaction: `t${++n}`, signature: `s${n}`, lastValidBlockHeight: 100 }; },
    prepareSweep: async (wallet, to) => { sweeps.push(`${wallet[0]}->${to[0]}`); return { transaction: `t${++n}`, signature: `s${n}`, lastValidBlockHeight: 100 }; },
    expired: async () => false, simulate: async () => null, send: async () => {},
    status: async (sig) => (confirmed.has(sig) ? "confirmed" : "pending"),
  };
  const read = () => CoinLiquidationSchema.parse(JSON.parse(store.repo.userBatches.liquidation(token.id)!.stateJson));
  const setColumn = (status: string) => { const row = store.repo.userBatches.byToken(token.id)[0]!; store.repo.userBatches.save(row.id, row.revision, JSON.stringify({ ...JSON.parse(row.stateJson), status }), Date.now()); };
  return { store, chain, sales, sweeps, holdings, confirmed, read, setColumn, signer, deployer };
}

test("liquidation sells every wallet in one transaction once the columns sold, then sweeps only the deployer", async () => {
  const f = fixture("holding");
  try {
    await tickLiquidations(f.store.repo, f.chain);
    expect(f.sales).toHaveLength(0); // waits for the column
    f.setColumn("exited");
    await tickLiquidations(f.store.repo, f.chain);
    // One transaction, deployer pays; the unpaid column keeps its signer's account; the empty fresh wallet is skipped.
    expect(f.sales).toEqual([{ payer: f.deployer, sales: [{ wallet: f.signer, amount: 500n, close: false }, { wallet: f.deployer, amount: 900n, close: true }] }]);
    expect(f.read().status).toBe("selling");
    f.confirmed.add("s1"); f.holdings.set(f.signer, { amount: 0n, accounts: 1 }); f.holdings.set(f.deployer, { amount: 0n, accounts: 0 });
    await tickLiquidations(f.store.repo, f.chain); // landed
    await tickLiquidations(f.store.repo, f.chain); // nothing left to sell: sweep the deployer
    expect(f.sweeps).toEqual(["6->3"]);
    f.confirmed.add("s2");
    await tickLiquidations(f.store.repo, f.chain);
    expect(f.read().status).toBe("done");
    expect(f.sales).toHaveLength(1);
    expect(f.store.repo.userBatches.activeLiquidations()).toHaveLength(0);
  } finally { f.store.close(); }
});
