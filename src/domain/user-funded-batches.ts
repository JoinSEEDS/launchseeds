import { z } from "zod";

/** A user-funded launch is up to four columns, one per buy transaction in the
 * Jito bundle after the coin's creation (Jito bundles hold five). A column's
 * transaction is signed and paid by one LaunchSeeds pool wallet (ace, art, ...),
 * which is also its first slot; the launcher may add slots, each a wallet
 * freshly generated for this launch, and choose every slot's buy. The launcher
 * pays all of it. Each column sells once, atomically, on its own rule; every
 * column's proceeds go to the launch's one proceeds wallet. */
export const MAX_COLUMNS = 4;
export const MAX_SLOTS_PER_COLUMN = 4;
export const MIN_BATCH_WALLET_BUY = 30_000_000n;
export const MAX_LAUNCH_BUY = 5_000_000_000n;

const wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const BatchExitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("immediate") }).strict(),
  /** Sells this many seconds after its buy is final (0: at once). */
  /** With `holdFloorSeconds`, for that long after its time it only sells while the
   * market cap stays at or above where the launch bundle left it; then at market. */
  z.object({ kind: z.literal("after"), seconds: z.number().int().min(0).max(86_400), holdFloorSeconds: z.number().int().min(0).max(3_600).optional() }).strict(),
  z.object({ kind: z.literal("time"), at: z.number().int().positive().safe() }).strict(),
  z.object({ kind: z.literal("profit"), profitBps: z.number().int().min(1).max(100_000) }).strict(),
  /** Sells everything together, as soon as that leaves the USD market cap at or above `usd`. */
  z.object({ kind: z.literal("floor"), usd: z.number().positive().max(1e12) }).strict(),
]);
/** A tranche may also sell wallet by wallet, each sale leaving the market cap
 * at or above `usd`; a wallet whose sale would not waits until it would. */
export const TrancheExitSchema = z.discriminatedUnion("kind", [
  ...BatchExitSchema.options,
  z.object({ kind: z.literal("ladder"), usd: z.number().positive().max(1e12) }).strict(),
]);
export const UserBatchSchema = z.object({
  /** Lamports each slot buys; slot 0 is the column's signing pool wallet. */
  slots: z.array(z.number().int().min(Number(MIN_BATCH_WALLET_BUY)).max(Number(MAX_LAUNCH_BUY)))
    .min(1).max(MAX_SLOTS_PER_COLUMN),
  exit: BatchExitSchema,
}).strict();
/** A tranche buys after the launch, outside the bundle: one plain transaction,
 * paid by the coin's deposit wallet (which holds the tranche's SOL until then),
 * that funds its wallets and buys with each. It fires a number of seconds after
 * the launch, or once the market cap crosses a USD level (skipped, its SOL left
 * in the deposit wallet, if that never happens within `withinSeconds`). Then it
 * sells and pays out like a column. */
export const MAX_TRANCHES = 6;
export const MAX_TRANCHE_WALLETS = 6;
/** Tranche rows sit after the four column rows (batchIndex 4, 5, ...). */
export const TRANCHE_ROW_OFFSET = MAX_COLUMNS;
/** Deposit-wallet fee budget per tranche transaction (its actual fee is far lower). */
export const TRANCHE_FEE_LAMPORTS = 100_000n;
/** Keeps the deposit wallet rent-exempt after the last tranche buys. */
export const TRANCHE_RENT_BUFFER = 1_000_000n;
export const TrancheTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delay"), seconds: z.number().int().min(1).max(7 * 86_400) }).strict(),
  z.object({
    kind: z.literal("mcap"),
    usd: z.number().positive().max(1e12),
    /** "above": once the market cap reaches the level; "below": once it falls to it. */
    direction: z.enum(["above", "below"]).default("above"),
    withinSeconds: z.number().int().min(60).max(7 * 86_400).default(86_400),
  }).strict(),
]);
export const TrancheSchema = z.object({
  /** Lamports each of the tranche's fresh wallets buys. */
  slots: z.array(z.number().int().min(Number(MIN_BATCH_WALLET_BUY)).max(Number(MAX_LAUNCH_BUY)))
    .min(1).max(MAX_TRANCHE_WALLETS),
  trigger: TrancheTriggerSchema,
  exit: TrancheExitSchema,
  slippageBps: z.number().int().min(50).max(5_000).default(500),
}).strict();
export const UserBatchesSchema = z.object({
  columns: z.array(UserBatchSchema).min(1).max(MAX_COLUMNS),
  /** Absent on launches without tranches, so their published plans keep their hash. */
  tranches: z.array(TrancheSchema).min(1).max(MAX_TRANCHES).optional(),
  proceedsWallet: wallet,
}).strict()
  .refine((v) => batchTotal(v) <= MAX_LAUNCH_BUY, `The launch buy is at most ${Number(MAX_LAUNCH_BUY) / 1e9} SOL.`)
  .refine((v) => trancheTotal(v) <= MAX_LAUNCH_BUY, `Tranches buy at most ${Number(MAX_LAUNCH_BUY) / 1e9} SOL in all.`);
export type UserBatch = z.infer<typeof UserBatchSchema>;
export type Tranche = z.infer<typeof TrancheSchema>;
export type TrancheTrigger = z.infer<typeof TrancheTriggerSchema>;
export type UserBatches = z.infer<typeof UserBatchesSchema>;

export const batchTotal = (v: { columns: Array<{ slots: number[] }> }) =>
  v.columns.reduce((sum, column) => sum + column.slots.reduce((s, slot) => s + BigInt(slot), 0n), 0n);
export const batchWalletCount = (v: { columns: Array<{ slots: number[] }> }) =>
  v.columns.reduce((sum, column) => sum + column.slots.length, 0);
export const trancheTotal = (v: { tranches?: Array<{ slots: number[] }> }) =>
  (v.tranches ?? []).reduce((sum, t) => sum + t.slots.reduce((s, slot) => s + BigInt(slot), 0n), 0n);
export const trancheWalletCount = (v: { tranches?: Array<{ slots: number[] }> }) =>
  (v.tranches ?? []).reduce((sum, t) => sum + t.slots.length, 0);
/** SOL the deposit wallet keeps after the launch for its tranches: their buys,
 * each wallet's reserve, each transaction's fee budget, and a rent buffer. */
export function trancheFunding(v: { tranches?: Array<{ slots: number[] }> }, reservePerWallet: bigint) {
  if (!v.tranches?.length) return 0n;
  return trancheTotal(v) + BigInt(trancheWalletCount(v)) * reservePerWallet + BigInt(v.tranches.length) * TRANCHE_FEE_LAMPORTS + TRANCHE_RENT_BUFFER;
}

/** Exact per-column, per-slot budgets (lamports), validated against the schedule. */
export function allocateUserBatches(input: unknown, scheduledAt: number) {
  const batches = UserBatchesSchema.parse(input);
  return batches.columns.map((column, batchIndex) => {
    if (column.exit.kind === "time" && column.exit.at < scheduledAt) throw new Error("A column cannot sell before the scheduled launch.");
    const budgets = column.slots.map(BigInt);
    return { ...column, batchIndex, amount: budgets.reduce((s, b) => s + b, 0n), budgets };
  });
}
export function allocateTranches(input: unknown, scheduledAt: number) {
  const batches = UserBatchesSchema.parse(input);
  return (batches.tranches ?? []).map((tranche, index) => {
    if (tranche.exit.kind === "time" && tranche.exit.at < scheduledAt) throw new Error(`Tranche ${index + 1} cannot sell before the scheduled launch.`);
    return { ...tranche, index, budgets: tranche.slots.map(BigInt) };
  });
}

/** Pump's starting curve; every launch opens here. */
const PUMP_START = { virtualQuote: 30_000_000_000, virtualBase: 1_073_000_000_000_000, supply: 1_000_000_000_000_000 };
const PUMP_BUY_FEE = 0.0125;
/** Pump's fee on a sale, as measured on-chain. The venue's quote cannot supply it:
 * it assumes 2% for a coin without a stored fee, which loosened floors by 0.75%. */
const PUMP_SELL_FEE = 0.0125;
/** Estimated market cap, in SOL, after `buyLamports` of buys from the start of the curve. */
export function startingMcapSol(buyLamports: number) {
  const k = PUMP_START.virtualQuote * PUMP_START.virtualBase;
  const quote = PUMP_START.virtualQuote + buyLamports * (1 - PUMP_BUY_FEE);
  return (quote * quote / k) * PUMP_START.supply / 1e9;
}

/** The SOL minimum that makes a sale enforce a market-cap floor on chain. On a
 * constant-product curve a fixed sale pays less the lower it starts, so the
 * output of the sale that ends exactly on the floor is the least any sale ending
 * at or above it can pay, less Pump's fee. Null when no sale of this size can clear. */
/** A new Pump coin's virtual token reserves before any buy (raw units). */
export const PUMP_INITIAL_VIRTUAL_BASE = 1_073_000_000_000_000n;
/** The market cap (lamports) right after the launch bundle bought `bundleRaw`
 * tokens: the curve's constant product (from live reserves) at the virtual
 * token reserves the bundle left. Fees never enter the curve, so k holds. */
export function postBundleMarketCapLamports(input: { virtualQuote: bigint; virtualBase: bigint; supply: bigint; bundleRaw: bigint }) {
  const base = PUMP_INITIAL_VIRTUAL_BASE - input.bundleRaw;
  if (input.bundleRaw <= 0n || base <= 0n || input.virtualQuote <= 0n || input.virtualBase <= 0n) throw new Error("Invalid bundle for its market cap.");
  const k = Number(input.virtualQuote) * Number(input.virtualBase);
  return (k / Number(base) / Number(base)) * Number(input.supply);
}
export function floorSaleMinimum(input: { virtualQuote: bigint; virtualBase: bigint; supply: bigint; sellRaw: bigint; floorLamports: number }) {
  const quote = Number(input.virtualQuote), base = Number(input.virtualBase), sell = Number(input.sellRaw), k = quote * base;
  if (!(quote > 0 && base > 0 && sell > 0 && input.floorLamports > 0 && input.supply > 0n)) throw new Error("Invalid floor sale.");
  const endBase = Math.sqrt(k / (input.floorLamports / Number(input.supply))), startBase = endBase - sell;
  if (startBase <= 0) return null;
  const minimum = Math.ceil((k / startBase - k / endBase) * (1 - PUMP_SELL_FEE));
  return Number.isFinite(minimum) && minimum < Number.MAX_SAFE_INTEGER ? BigInt(minimum) : null;
}

/** Required on-chain net SOL output, with conservative remaining execution caps.
 * The cost is verified irrecoverable buy spend/fees, not the reserve deposited
 * into buyer wallets. Unspent reserves and reclaimed rent remain user money. */
export function batchMinimumOutput(cost: bigint, profitBps: number, sellFeeCap: bigint, settlementFeeCap: bigint) {
  if (cost <= 0n || sellFeeCap < 0n || settlementFeeCap < 0n || !Number.isSafeInteger(profitBps) || profitBps < 1 || profitBps > 100_000) throw new Error("Invalid batch cost or profit target.");
  return (cost * BigInt(10_000 + profitBps) + 9_999n) / 10_000n + sellFeeCap + settlementFeeCap;
}

export function userBatchFunding(input: {
  totalBuy: bigint; walletCount: number; baseFee: bigint;
  serviceFee: bigint; reservePerWallet: bigint; bundleTip: bigint;
}) {
  if (!Number.isInteger(input.walletCount) || input.walletCount < 1 || input.walletCount > MAX_COLUMNS * MAX_SLOTS_PER_COLUMN || input.totalBuy <= 0n || [input.baseFee,input.serviceFee,input.reservePerWallet,input.bundleTip].some(amount => amount < 0n)) throw new Error("Invalid user-funded launch quote.");
  const buyerReserve = BigInt(input.walletCount) * input.reservePerWallet;
  return { ...input, buyerReserve, required: input.baseFee + input.serviceFee + input.totalBuy + buyerReserve + input.bundleTip };
}
