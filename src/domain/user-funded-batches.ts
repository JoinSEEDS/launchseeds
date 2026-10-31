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
  z.object({ kind: z.literal("time"), at: z.number().int().positive().safe() }).strict(),
  z.object({ kind: z.literal("profit"), profitBps: z.number().int().min(1).max(100_000) }).strict(),
]);
export const UserBatchSchema = z.object({
  /** Lamports each slot buys; slot 0 is the column's signing pool wallet. */
  slots: z.array(z.number().int().min(Number(MIN_BATCH_WALLET_BUY)).max(Number(MAX_LAUNCH_BUY)))
    .min(1).max(MAX_SLOTS_PER_COLUMN),
  exit: BatchExitSchema,
}).strict();
export const UserBatchesSchema = z.object({
  columns: z.array(UserBatchSchema).min(1).max(MAX_COLUMNS),
  proceedsWallet: wallet,
}).strict().refine((v) => batchTotal(v) <= MAX_LAUNCH_BUY, `The launch buy is at most ${Number(MAX_LAUNCH_BUY) / 1e9} SOL.`);
export type UserBatch = z.infer<typeof UserBatchSchema>;
export type UserBatches = z.infer<typeof UserBatchesSchema>;

export const batchTotal = (v: { columns: Array<{ slots: number[] }> }) =>
  v.columns.reduce((sum, column) => sum + column.slots.reduce((s, slot) => s + BigInt(slot), 0n), 0n);
export const batchWalletCount = (v: { columns: Array<{ slots: number[] }> }) =>
  v.columns.reduce((sum, column) => sum + column.slots.length, 0);

/** Exact per-column, per-slot budgets (lamports), validated against the schedule. */
export function allocateUserBatches(input: unknown, scheduledAt: number) {
  const batches = UserBatchesSchema.parse(input);
  return batches.columns.map((column, batchIndex) => {
    if (column.exit.kind === "time" && column.exit.at < scheduledAt) throw new Error("A column cannot sell before the scheduled launch.");
    const budgets = column.slots.map(BigInt);
    return { ...column, batchIndex, amount: budgets.reduce((s, b) => s + b, 0n), budgets };
  });
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
