import { z } from "zod";
import type { LaunchseedsRepo } from "../db/repo";
import { UserBatchStateSchema } from "./user-batch-engine";
import { MAX_TRANCHES, TRANCHE_ROW_OFFSET } from "../domain/user-funded-batches";

/** Admin "liquidate everything" for one coin, in one atomic v1 transaction:
 * every wallet the launch used sells all of its remaining tokens of the coin at
 * market, each with its own sell so its SOL stays in it (they traded with their
 * own funds), and closes its token accounts. The deployer (the deposit address
 * that created the coin) pays the fee and, once the sale lands, is swept in
 * full to the destination. The sale waits until every column has sold, so a
 * column's own tokens are never sold under it; a column that has not paid out
 * keeps its empty token account for its payout to close. */
const signed = z.object({ transaction: z.string().min(1), signature: z.string().min(1), lastValidBlockHeight: z.number().int().positive() }).strict();
export const CoinLiquidationSchema = z.object({
  version: z.literal(2),
  mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  destination: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  requestedBy: z.string(),
  /** selling: the sale is journaled and sent; sweeping: the deployer's sweep is. */
  status: z.enum(["pending", "selling", "sweeping", "done", "review"]),
  wallets: z.array(z.object({
    wallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    role: z.enum(["signer", "fresh", "deployer"]),
    /** The run (column, or TRANCHE_ROW_OFFSET + tranche) the wallet bought in. */
    batchIndex: z.number().int().min(0).max(TRANCHE_ROW_OFFSET + MAX_TRANCHES - 1).nullable(),
  }).strict()).min(1),
  tx: signed.nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null),
}).strict();
export type CoinLiquidation = z.infer<typeof CoinLiquidationSchema>;
type Signed = z.infer<typeof signed>;
export type LiquidationSale = { wallet: string; amount: bigint; close: boolean };

export type CoinLiquidationChain = {
  /** Raw token amount the wallet holds of the mint, and its token-account count. */
  holdings(wallet: string, mint: string): Promise<{ amount: bigint; accounts: number }>;
  /** One transaction paid by `payer` in which each wallet sells its amount at
   * market (when > 0) and closes its accounts when `close`. */
  prepareSale(mint: string, payer: string, sales: LiquidationSale[]): Promise<Signed>;
  /** The wallet's whole balance, less the fee, to `to`; null if nothing would be left. */
  prepareSweep(wallet: string, to: string): Promise<Signed | null>;
  /** True once the finalized block height has passed `height`. */
  expired(height: number): Promise<boolean>;
  simulate(transaction: string): Promise<string | null>;
  send(transaction: string): Promise<void>;
  status(signature: string): Promise<"confirmed" | "failed" | "pending" | "unknown">;
};

const SOLD = new Set(["exited", "settling", "settled", "skipped", "review"]);
const MAX_ATTEMPTS = 6;

export const runLabel = (batchIndex: number) =>
  batchIndex >= TRANCHE_ROW_OFFSET ? `tranche ${batchIndex - TRANCHE_ROW_OFFSET + 1}` : `column ${batchIndex + 1}`;

export async function tickLiquidations(repo: LaunchseedsRepo, chain: CoinLiquidationChain): Promise<string[]> {
  const messages: string[] = [];
  for (const row of repo.userBatches.activeLiquidations()) {
    const label = `Liquidate ${row.tokenId}`;
    try { messages.push(`${label}: ${await advance(repo, chain, row)}`); }
    catch (error) { messages.push(`${label}: ${error instanceof Error ? error.message : "unavailable"}`); }
  }
  return messages;
}

async function advance(repo: LaunchseedsRepo, chain: CoinLiquidationChain, row: { id: number; tokenId: number; revision: number; stateJson: string }) {
  const state = CoinLiquidationSchema.parse(JSON.parse(row.stateJson));
  const save = (patch: Partial<CoinLiquidation>) => {
    const next = CoinLiquidationSchema.parse({ ...state, ...patch });
    if (!repo.userBatches.saveLiquidation(row.id, row.revision, JSON.stringify(next), next.status !== "done" && next.status !== "review", Date.now()))
      throw Error("Liquidation changed meanwhile");
  };
  const columns = new Map(repo.userBatches.byToken(row.tokenId).map((r) => [r.batchIndex, UserBatchStateSchema.parse(JSON.parse(r.stateJson)).status]));
  const deployer = state.wallets.find((w) => w.role === "deployer") ?? null;
  // A sent transaction resolves first: landed, failed, or provably expired.
  if ((state.status === "selling" || state.status === "sweeping") && state.tx) {
    const status = await chain.status(state.tx.signature);
    const sweeping = state.status === "sweeping";
    if (status === "confirmed") { save({ status: sweeping ? "done" : "pending", tx: null, error: null }); return sweeping ? "deployer swept; done" : "sale landed; re-checking holdings"; }
    if (status === "failed" || (status === "unknown" && (await chain.expired(state.tx.lastValidBlockHeight)))) {
      save({ status: "pending", tx: null, error: `Previous ${sweeping ? "sweep" : "sale"} ${status === "failed" ? "failed on chain" : "expired"}` });
      return "retrying";
    }
    if (status === "unknown") await chain.send(state.tx.transaction);
    return `waiting for the ${sweeping ? "sweep" : "sale"}`;
  }
  if (state.status !== "pending") return state.status;
  const waiting = [...columns.entries()].filter(([, s]) => !SOLD.has(s));
  if (waiting.length) return `waiting for ${waiting.map(([i]) => runLabel(i)).join(", ")} to sell`;
  if (state.attempts >= MAX_ATTEMPTS) { save({ status: "review", error: "The sale did not land after several attempts" }); return "needs review"; }
  const sales: LiquidationSale[] = [];
  for (const w of state.wallets) {
    const { amount, accounts } = await chain.holdings(w.wallet, state.mint);
    const column = w.batchIndex === null ? null : columns.get(w.batchIndex) ?? null;
    const close = accounts > 0 && (column === null || column === "settled");
    if (amount > 0n || close) sales.push({ wallet: w.wallet, amount, close });
  }
  if (!sales.length) {
    const sweep = deployer ? await chain.prepareSweep(deployer.wallet, state.destination) : null;
    if (!sweep) { save({ status: "done", error: null }); return "done: nothing left to sell or sweep"; }
    const problem = await chain.simulate(sweep.transaction);
    if (problem) return `sweep: ${problem.slice(0, 120)}`;
    save({ status: "sweeping", tx: sweep, error: null });
    await chain.send(sweep.transaction);
    return "deployer sweep sent";
  }
  // The deployer pays (it is swept afterwards); without one, the first seller.
  const payer = deployer?.wallet ?? sales[0]!.wallet;
  const tx = await chain.prepareSale(state.mint, payer, sales);
  const problem = await chain.simulate(tx.transaction);
  if (problem) return `sale: ${problem.slice(0, 120)}`;
  save({ status: "selling", tx, attempts: state.attempts + 1, error: null });
  await chain.send(tx.transaction);
  return `sale sent: ${sales.length} wallets in one transaction`;
}
