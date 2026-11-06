import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { UserBatchEngine, UserBatchStateSchema, saleBuyers, type UserBatchChain } from "../src/server/user-batch-engine";
import { UserBatchesSchema, floorSaleMinimum, startingMcapSol } from "../src/domain/user-funded-batches";
import { columnsExport, mountLaunchColumns, parseColumnsImport, simpleSetup } from "../lib/launch-columns";

const SUPPLY = 1_000_000_000_000_000n;
const K = 30_000_000_000 * 1_073_000_000_000_000;
/** A pump-like curve at `quote` lamports of virtual SOL. */
const curve = (quote: number) => ({ q: quote, b: K / quote });
const mcap = (c: { q: number; b: number }) => c.q / c.b * Number(SUPPLY);
const sold = (c: { q: number; b: number }, sell: number) => {
  const after = { b: c.b + sell, q: K / (c.b + sell) };
  return { net: c.q - after.q, after };
};

describe("floor sale minimum", () => {
  const sell = 40_000_000_000_000, floorLamports = 40_000_000_000;
  const minimum = (c: { q: number; b: number }) => floorSaleMinimum({
    virtualQuote: BigInt(Math.round(c.q)), virtualBase: BigInt(Math.round(c.b)), supply: SUPPLY, sellRaw: BigInt(sell),
    floorLamports,
  })!;

  test("a sale pays the minimum exactly when it ends at or above the floor", () => {
    const min = Number(minimum(curve(60_000_000_000)));
    for (const quote of [36_000_000_000, 38_000_000_000, 40_000_000_000, 45_000_000_000, 60_000_000_000, 80_000_000_000]) {
      const { net, after } = sold(curve(quote), sell);
      // Within a lamport of rounding, the on-chain minimum and the floor agree.
      expect(net * 0.9875 >= min - 1).toBe(mcap(after) >= floorLamports * (1 - 1e-6));
    }
  });
  test("the minimum does not depend on where the curve is when it is prepared", () => {
    const a = minimum(curve(60_000_000_000)), b = minimum(curve(35_000_000_000));
    expect(Math.abs(Number(a - b))).toBeLessThan(5);
  });
  test("d/acc's wallet 2: a sale that would end under its floor can no longer clear", () => {
    // The curve and sale of the launch that exposed the 2% fee assumption.
    const c = curve(30_095_900_000), raw = 3_365_186_884_254n;
    const paid = (c.q - K / (c.b + Number(raw))) * 0.9875;
    const minimum = floorSaleMinimum({ virtualQuote: BigInt(c.q), virtualBase: BigInt(Math.round(c.b)), supply: SUPPLY, sellRaw: raw, floorLamports: 2720 / 96.5 * 1e9 })!;
    expect(paid).toBeLessThan(Number(minimum));
    expect(Number(minimum) - paid).toBeGreaterThan(700_000);
  });
  test("a sale too large for the floor can never clear", () => {
    const c = curve(60_000_000_000);
    expect(floorSaleMinimum({ virtualQuote: BigInt(c.q), virtualBase: BigInt(Math.round(c.b)), supply: SUPPLY, sellRaw: 2_000_000_000_000_000n, floorLamports: 10_000_000_000_000 })).toBeNull();
  });
  test("the starting market cap starts at pump's opening level and rises with the buys", () => {
    expect(startingMcapSol(0)).toBeCloseTo(27.96, 1);
    expect(startingMcapSol(1_000_000_000)).toBeGreaterThan(startingMcapSol(0));
  });
});

function ladder(exit: Record<string, unknown> = { kind: "ladder", usd: 20_000 }) {
  const store = new Store(openLaunchseedsData(":memory:")), token = insertToken(store, { mint: "2".repeat(32), launchedAt: 1 });
  let count = 0, receipt: bigint | null = null, simulation: string | null = null, status: "unknown" | "failed" = "unknown";
  const prepared: Array<{ wallets: string[]; floor?: number; forced: boolean; minimum: bigint | null }> = [], sent: string[] = [];
  const chain: UserBatchChain = {
    sellFeeCap: 0n, settlementFeeCap: 0n,
    fills: async () => null,
    prepareSale: async (state, minimum, floor) => {
      prepared.push({ wallets: saleBuyers(state).map((b) => b.wallet), floor, forced: state.forced, minimum });
      count++; return { transaction: `sale${count}`, signature: `sale${count}`, lastValidBlockHeight: 100 };
    },
    needsRefresh: async () => false, simulate: async () => simulation, send: async (t) => { sent.push(t); },
    status: async () => status, failedFee: async () => 5_000n, absentAfterExpiry: async () => false,
    saleReceipt: async () => receipt,
    preparePayout: async () => ({ transaction: "payout", signature: "payout", lastValidBlockHeight: 100 }), payoutReceipt: async () => null,
    marketCapUsd: async () => 0, prepareTrancheBuy: async () => { throw new Error("no buy"); },
  };
  const buyers = ["4", "5", "6"].map((c, i) => ({ name: `w${i}`, wallet: c.repeat(32), budgetLamports: "50000000", tranche: 0, role: "fresh" as const }));
  const state = UserBatchStateSchema.parse({
    version: 1, status: "holding", tranche: 0, proceedsWallet: "3".repeat(32), mint: token.mint, buyers,
    config: { slots: [50_000_000, 50_000_000, 50_000_000], trigger: { kind: "delay", seconds: 5 }, exit },
    fills: ["10", "20", "30"], buyCostLamports: "150000000",
  });
  store.repo.userBatches.insert(token.id, 4, JSON.stringify(state), Date.now());
  const row = () => store.repo.userBatches.byToken(token.id)[0]!;
  const read = () => UserBatchStateSchema.parse(JSON.parse(row().stateJson));
  return {
    store, token, read, prepared, sent, engine: new UserBatchEngine(store.repo, chain),
    receipt: (v: bigint | null) => { receipt = v; }, simulate: (v: string | null) => { simulation = v; }, fail: () => { status = "failed"; },
    force: () => store.repo.userBatches.save(row().id, row().revision, JSON.stringify({ ...read(), forced: true }), Date.now()),
  };
}

describe("ladder and floor exits", () => {
  test("wallets sell one at a time and the net adds up; a blocked wallet waits", async () => {
    const f = ladder();
    try {
      await f.engine.tick(); // prepares wallet 1
      expect(f.prepared).toEqual([{ wallets: ["4".repeat(32)], floor: 20_000, forced: false, minimum: null }]);
      f.simulate("below the floor");
      await f.engine.tick();
      expect(f.read().status).toBe("holding"); expect(f.sent).toEqual([]);
      f.simulate(null);
      await f.engine.tick(); expect(f.read().status).toBe("exiting"); expect(f.sent).toEqual(["sale1"]);
      f.receipt(100n); await f.engine.tick();
      expect(f.read()).toMatchObject({ status: "holding", ladderIndex: 1, ladderNet: "100", sale: null });
      await f.engine.tick(); expect(f.prepared[1]!.wallets).toEqual(["5".repeat(32)]);
      await f.engine.tick(); await f.engine.tick();
      expect(f.read()).toMatchObject({ status: "holding", ladderIndex: 2, ladderNet: "200" });
      await f.engine.tick(); await f.engine.tick(); await f.engine.tick();
      expect(f.prepared[2]!.wallets).toEqual(["6".repeat(32)]);
      expect(f.read()).toMatchObject({ status: "exited", netSaleLamports: "300" });
    } finally { f.store.close(); }
  });
  test("finalizing mid-ladder sells every remaining wallet in one sale, at market", async () => {
    const f = ladder();
    try {
      await f.engine.tick(); await f.engine.tick(); f.receipt(100n); await f.engine.tick();
      expect(f.read().ladderIndex).toBe(1);
      f.receipt(null); f.force();
      await f.engine.tick();
      expect(f.prepared.at(-1)).toEqual({ wallets: ["4", "5", "6"].map((c) => c.repeat(32)), floor: undefined, forced: true, minimum: null });
      await f.engine.tick(); f.receipt(250n); await f.engine.tick();
      expect(f.read()).toMatchObject({ status: "exited", netSaleLamports: "350" });
    } finally { f.store.close(); }
  });
  test("finalizing while a ladder sale is in flight still sells the rest", async () => {
    const f = ladder();
    try {
      await f.engine.tick(); await f.engine.tick();
      expect(f.read().status).toBe("exiting");
      f.force(); f.receipt(100n); await f.engine.tick();
      expect(f.read()).toMatchObject({ status: "holding", ladderIndex: 1, ladderNet: "100" });
      f.receipt(null); await f.engine.tick();
      expect(f.prepared.at(-1)!.wallets).toHaveLength(3);
    } finally { f.store.close(); }
  });
  test("a failed ladder sale retries the same wallet", async () => {
    const f = ladder();
    try {
      await f.engine.tick(); await f.engine.tick(); f.fail(); await f.engine.tick();
      expect(f.read()).toMatchObject({ status: "holding", ladderIndex: 0, sale: null, buyCostLamports: "150005000" });
    } finally { f.store.close(); }
  });
  test("a floor sale sells all wallets together, and waits while another of the coin's sales is landing", async () => {
    const f = ladder({ kind: "floor", usd: 30_000 });
    try {
      const other = UserBatchStateSchema.parse({ ...f.read(), status: "exiting" });
      f.store.repo.userBatches.insert(f.token.id, 5, JSON.stringify(other), Date.now());
      const first = f.store.repo.userBatches.byToken(f.token.id)[1]!;
      await f.engine.tick();
      expect(f.prepared).toEqual([]);
      f.store.repo.userBatches.save(first.id, first.revision + 1, JSON.stringify({ ...other, status: "settled" }), Date.now());
      const row = f.store.repo.userBatches.byToken(f.token.id)[1]!;
      f.store.repo.userBatches.save(row.id, row.revision, JSON.stringify({ ...other, status: "settled" }), Date.now());
      await f.engine.tick();
      expect(f.prepared[0]).toMatchObject({ floor: 30_000 });
      expect(f.prepared[0]!.wallets).toHaveLength(3);
    } finally { f.store.close(); }
  });
  test("a state saved before ladders existed still loads", () => {
    const state = UserBatchStateSchema.parse({ version: 1, status: "holding", config: { slots: [50_000_000], exit: { kind: "immediate" } }, proceedsWallet: "3".repeat(32), mint: "2".repeat(32), buyers: [{ name: "a", wallet: "4".repeat(32), budgetLamports: "1" }] });
    expect(state.ladderIndex).toBe(0); expect(state.ladderNet).toBe("0");
  });
  test("only tranches may ladder", () => {
    const column = { slots: [50_000_000], exit: { kind: "ladder", usd: 1 } };
    expect(UserBatchesSchema.safeParse({ columns: [column], proceedsWallet: "3".repeat(32) }).success).toBe(false);
    expect(() => parseColumnsImport("1,0.1,ladder 20k")).toThrow("a column sells in one transaction");
  });
});

describe("simple mode", () => {
  const base = { wallets: "4", sol: "0.1", floor: "30000", trancheWallets: "0", trancheSol: "0.1", seconds: "10", trancheFloor: "" };
  test("wallets fill as few columns as they fit, evenly", () => {
    const sizes = (wallets: string) => simpleSetup({ ...base, wallets }).columns.map((c) => c.slots.length);
    expect(sizes("1")).toEqual([1]); expect(sizes("4")).toEqual([4]); expect(sizes("5")).toEqual([3, 2]);
    expect(sizes("6")).toEqual([3, 3]); expect(sizes("13")).toEqual([4, 3, 3, 3]); expect(sizes("16")).toEqual([4, 4, 4, 4]);
  });
  test("the import format carries floors and ladders", () => {
    const parsed = parseColumnsImport("1,0.1,floor 30k\nt1,0.1,after 10s,ladder 25.5k\n");
    expect(parsed.columns[0]).toMatchObject({ exit: "floor", floorUsd: "30000" });
    expect(parsed.tranches[0]).toMatchObject({ exit: "ladder", floorUsd: "25500" });
    expect(parseColumnsImport(columnsExport(parsed.columns, "abc", parsed.tranches))).toMatchObject({ columns: parsed.columns, tranches: parsed.tranches });
  });
  test("the form starts simple and produces floor and ladder exits; Advanced shows them", () => {
    const dom = new JSDOM(`<section id="controls"><button id="mode-simple"></button><button id="mode-advanced"></button><div id="launch-simple"></div><div id="launch-columns"></div><div id="launch-tranches" hidden></div>
      <button id="add-column"></button><button id="add-tranche"></button><button id="columns-import"></button><button id="columns-export"></button>
      <input type="file" id="columns-import-file" /><p id="columns-import-status" hidden></p><input id="f-proceeds-wallet" /></section>`);
    const previous = { document: globalThis.document, HTMLElement: globalThis.HTMLElement };
    Object.assign(globalThis, { document: dom.window.document, HTMLElement: dom.window.HTMLElement });
    try {
      const doc = dom.window.document;
      const form = mountLaunchColumns(doc.getElementById("controls")!, () => {});
      const simple = doc.getElementById("launch-simple")!;
      const set = (label: string, value: string, index = 0) => {
        const input = [...simple.querySelectorAll<HTMLInputElement>("input")].filter((node) => node.getAttribute("aria-label")!.startsWith(label))[index]!;
        input.value = value; input.dispatchEvent(new dom.window.Event("input"));
      };
      (doc.getElementById("f-proceeds-wallet") as HTMLInputElement).value = "3".repeat(32);
      expect(doc.getElementById("launch-columns")!.hidden).toBe(true);
      expect(doc.getElementById("add-tranche")!.hidden).toBe(true);
      expect(form.read(10_000).error).toContain("market cap");
      set("Wallets", "6"); set("Sell all", "30000");
      expect(form.read(10_000).error).toBeNull();
      set("Wallets", "2", 1);
      expect(form.read(10_000).error).toContain("tranche");
      set("Sell one by one", "25000");
      const value = form.read(10_000).value!;
      expect(value.columns.map((c) => c.exit)).toEqual([{ kind: "floor", usd: 30_000 }, { kind: "floor", usd: 30_000 }]);
      expect(value.tranches![0]).toMatchObject({ slots: [100_000_000, 100_000_000], exit: { kind: "ladder", usd: 25_000 }, trigger: { kind: "delay", seconds: 10 } });
      form.setSolUsd(150);
      expect(simple.textContent).toContain("Starting market cap ≈ $");
      expect(form.summary().at(-1)![1]).toContain("sells one by one, keeping mcap above $25,000");
      doc.getElementById("mode-advanced")!.click();
      expect(simple.hidden).toBe(true);
      expect(doc.getElementById("launch-columns")!.querySelectorAll("fieldset")).toHaveLength(2);
      expect(form.read(10_000).value).toEqual(value);
    } finally { Object.assign(globalThis, previous); }
  });
});

test("a bundle under the launch minimum is reported, not left to fail silently", () => {
  const dom = new JSDOM(`<section id="c"><div id="launch-columns"></div><div id="launch-tranches" hidden></div><button id="add-column"></button><button id="add-tranche"></button><button id="columns-import"></button><button id="columns-export"></button><input type="file" id="columns-import-file" /><p id="columns-import-status" hidden></p><input id="f-proceeds-wallet" /></section>`);
  const previous = { document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  Object.assign(globalThis, { document: dom.window.document, HTMLElement: dom.window.HTMLElement });
  try {
    const doc = dom.window.document;
    const form = mountLaunchColumns(doc.getElementById("c")!, () => {});
    (doc.getElementById("f-proceeds-wallet") as HTMLInputElement).value = "3".repeat(32);
    const { value } = form.read(10_000);
    form.restore({ ...value!, columns: [{ slots: [30_000_000, 30_000_000], exit: { kind: "floor", usd: 2_700 } }] }, 10_000);
    expect(form.read(10_000).error).toContain("at least 0.1 SOL");
  } finally { Object.assign(globalThis, previous); }
});
