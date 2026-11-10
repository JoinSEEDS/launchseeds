/** Launchseeds authoritative persisted types. sqlite-zod-orm adds its own integer `id` column,
 * which is every row's identity; cross-table references are integer `…Id` columns and are
 * never exposed publicly (tokens are addressed by CA). All currency/chain amounts are
 * atomic decimal strings. Time fields are UTC milliseconds unless named `Minute`.
 */
import { z } from "sqlite-zod-orm";

export const Atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const Time = z.number().int().nonnegative();
export const Slot = Time;
export const Id = z.string().min(1);
/** Integer row reference (sqlite-zod-orm `id`). */
export const RowId = z.number().int().positive();
export const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const OptionalAddress = Address.nullable();


export const LaunchStatus = z.enum([
  "preparing",
  "funding",
  "deploying",
  "configuring",
  "live",
  "failed",
  "expired",
  "refunding",
  "refunded",
  "needs_review",
]);

export const schemas = {
  tokens: z.object({
    /** Private launch-status handle: sha256(CA) prefix; legacy launches keep their old id. */
    handle: Id,
    mint: OptionalAddress,
    mintSignerRef: z.string().nullable(),
    name: z.string().min(1).max(32),
    symbol: z.string().min(1).max(13),
    description: z.string(),
    image: z.string(),
    metadataUri: z.string().nullable(),
    website: z.string().default(""),
    x: z.string().default(""),
    telegram: z.string().default(""),
    /** Null while the launch is `preparing` (before wallets and metadata exist). */
    fundingWallet: OptionalAddress,
    fundingWalletName: z.string().nullable(),
    creatorWallet: OptionalAddress,
    rewardWallet: OptionalAddress,
    launcherWallet: OptionalAddress,
    refundWallet: OptionalAddress,
    requiredLamports: Atomic.default("0"),
    devBuyLamports: Atomic.default("0"),
    launchSettingsJson: z.string().default(""),
    quoteExpiresAt: Time.default(0),
    fundingReceivedLamports: Atomic.default("0"),
    status: LaunchStatus,
    deploySignature: z.string().nullable(),
    feeConfigSignature: z.string().nullable(),
    nextAttemptAt: Time.default(0),
    error: z.string().nullable(),
    priceUsd: z.number().finite().nonnegative().default(0),
    marketCapUsd: z.number().finite().nonnegative().default(0),
    createdAt: Time,
    launchedAt: Time.nullable(),
    // Launch request (merged): creator capability hash, idempotent input, preparation lease.
    accessHash: Id,
    requestHash: Id,
    inputJson: z.string(),
    leaseId: z.string().default(""),
    leaseUntil: Time.default(0),
    attempts: Time.default(0),
    intent: z.string().default(""),
  }),
  deposits: z.object({
    tokenId: RowId,
    signature: Id,
    lamports: Atomic,
    confirmedSlot: Slot,
    confirmedAt: Time,
    refundSignature: z.string().nullable(),
  }),
  /** A scheduled launch's published plan: its buyer wallets and the hash
   * that commits to them before payment. */
  scheduledPlans: z.object({
    tokenId: RowId,
    buyersJson: z.string(),
    planHash: z.string(),
    createdAt: Time,
  }),
} as const;

/** Stored rows: schema fields plus the ORM's integer `id`. */
export type Tables = {
  [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]> & { id: number };
};
/** Insert payloads: schema input (defaults optional), no `id`. */
export type NewRows = {
  [K in keyof typeof schemas]: z.input<(typeof schemas)[K]>;
};
export type Token = Tables["tokens"];
export type Deposit = Tables["deposits"];
export type LaunchStatusValue = z.infer<typeof LaunchStatus>;
