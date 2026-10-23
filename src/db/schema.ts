/** Launchseeds authoritative persisted types. sqlite-zod-orm adds its own integer `id` column;
 * our cross-table identities are the unique TEXT `uid` fields. All currency/chain amounts
 * are atomic decimal strings. Time fields are UTC milliseconds unless named `Minute`.
 */
import { z } from "sqlite-zod-orm";

export const Atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const SignedAtomic = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
export const Time = z.number().int().nonnegative();
export const Slot = Time;
export const Id = z.string().min(1);
export const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const OptionalAddress = Address.nullable();

export const WeightMode = z.enum(["gravity", "snapshot"]);
export const StrategyConfig = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pack"), ref: Id, mode: WeightMode }),
  z.object({
    type: z.literal("stock"),
    ref: Id,
    amountUsdCents: z.number().int().min(500),
    mode: WeightMode,
  }),
  z.object({
    type: z.literal("burn"),
    amountUsdCents: z.number().int().min(500),
  }),
  z.object({
    type: z.literal("wallet"),
    address: Address,
    amountUsdCents: z.number().int().min(500),
  }),
  z.object({
    type: z.literal("x"),
    handle: Id,
    amountUsdCents: z.number().int().min(500),
  }),
  z.object({
    type: z.literal("github"),
    handle: Id,
    amountUsdCents: z.number().int().min(500),
  }),
]);

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
export const FeeClaimStatus = z.enum([
  "pending",
  "prepared",
  "submitted",
  "credited",
  "allocated",
  "needs_review",
]);
export const ExecutionStatus = z.enum([
  "unfulfilled",
  "preparing",
  "submitted",
  "confirmed",
  "fulfilled",
  "failed",
  "needs_review",
]);
export const BuybackStatus = z.enum([
  "unfulfilled",
  "preparing",
  "swap_submitted",
  "swap_confirmed",
  "burn_submitted",
  "fulfilled",
  "failed",
  "needs_review",
]);
export const Asset = z.enum(["SOL", "USDC", "TOKEN"]);

export const schemas = {
  tokens: z.object({
    uid: Id,
    mint: OptionalAddress,
    mintSignerRef: z.string().nullable(),
    name: z.string().min(1).max(32),
    symbol: z.string().min(1).max(10),
    description: z.string(),
    image: z.string(),
    metadataUri: z.string().nullable(),
    website: z.string().default(""),
    x: z.string().default(""),
    telegram: z.string().default(""),
    fundingWallet: Address,
    fundingWalletName: Id,
    creatorWallet: Address,
    rewardWallet: Address,
    launcherWallet: OptionalAddress,
    devBuyRecipient: OptionalAddress,
    refundWallet: OptionalAddress,
    requiredLamports: Atomic,
    devBuyLamports: Atomic,
    quoteExpiresAt: Time,
    fundingReceivedLamports: Atomic.default("0"),
    status: LaunchStatus,
    deploySignature: z.string().nullable(),
    feeConfigSignature: z.string().nullable(),
    nextAttemptAt: Time.default(0),
    error: z.string().nullable(),
    activeStrategyId: z.string().nullable(),
    leaderStrategyId: z.string().nullable(),
    leaderSince: Time.nullable(),
    tokenDecimals: z.number().int().min(0).max(18).default(6),
    priceUsd: z.number().finite().nonnegative().default(0),
    marketCapUsd: z.number().finite().nonnegative().default(0),
    lastGravityMinute: Time.nullable(),
    holdersSnapshotSlot: Slot.default(0),
    createdAt: Time,
    launchedAt: Time.nullable(),
  }),
  deposits: z.object({
    uid: Id,
    tokenId: Id,
    signature: Id,
    lamports: Atomic,
    confirmedSlot: Slot,
    confirmedAt: Time,
    refundSignature: z.string().nullable(),
  }),
  holders: z.object({
    uid: Id,
    tokenId: Id,
    wallet: Address,
    balanceRaw: Atomic,
    /** 1 Gravity = 1 USD-dollar-minute; store micro-dollar-minutes. */
    gravityMicros: Atomic.default("0"),
    heldSince: Time.nullable(),
    balanceSlot: Slot,
    balanceUpdatedAt: Time,
    excluded: z.boolean().default(false),
  }),
  strategies: z.object({
    uid: Id,
    tokenId: Id,
    type: z.enum(["pack", "stock", "burn", "wallet", "x", "github"]),
    configKey: Id,
    configJson: z.string(),
    enabled: z.boolean().default(true),
    createdAt: Time,
  }),
  votes: z.object({
    uid: Id,
    tokenId: Id,
    wallet: Address,
    strategyId: Id,
    /** Strictly increasing per token/wallet; included in signed vote intent. */
    nonce: z.number().int().positive(),
    signature: Id,
    votedAt: Time,
  }),
  treasuries: z.object({
    uid: Id,
    ownerType: z.enum(["token", "platform"]),
    ownerId: Id, // token.uid or 'token'
    wallet: Address,
    asset: Asset,
    availableAtomic: Atomic.default("0"),
    reservedAtomic: Atomic.default("0"),
    updatedAt: Time,
  }),
  ledger: z.object({
    uid: Id,
    eventId: Id,
    treasuryId: Id,
    type: z.enum([
      "fee_in",
      "reserve",
      "release",
      "spend",
      "swap_in",
      "swap_out",
      "network_fee",
      "adjustment",
    ]),
    availableDelta: SignedAtomic,
    reservedDelta: SignedAtomic,
    refType: z.enum([
      "fee",
      "fee_claim",
      "execution",
      "token_buyback",
      "adjustment",
    ]),
    refId: Id,
    signature: z.string().nullable(),
    createdAt: Time,
  }),
  feeClaims: z.object({
    uid: Id,
    tokenId: Id,
    strategyId: Id,
    strategyConfig: z.string(),
    targetLamports: Atomic,
    estimatedCommunityLamports: Atomic,
    status: FeeClaimStatus,
    signedTransactionRef: z.string().nullable(),
    signature: z.string().nullable(),
    nextAttemptAt: Time.default(0),
    error: z.string().nullable(),
    createdAt: Time,
    updatedAt: Time,
  }),
  fees: z.object({
    uid: Id,
    feeClaimId: Id,
    tokenId: Id,
    treasuryId: Id,
    signature: Id,
    receiptIndex: z.number().int().nonnegative(),
    lamports: Atomic,
    receivedAt: Time,
  }),
  executions: z.object({
    uid: Id,
    tokenId: Id,
    fundingClaimId: Id,
    strategyId: Id,
    strategyConfig: z.string(),
    reservedLamports: Atomic,
    targetUsdCents: z.number().int().nonnegative(),
    recipient: OptionalAddress,
    selectionMode: WeightMode.nullable(),
    snapshotHash: z.string().nullable(),
    randomnessRef: z.string().nullable(),
    status: ExecutionStatus,
    providerRef: z.string().nullable(),
    signedTransactionRef: z.string().nullable(),
    transactionSignature: z.string().nullable(),
    resultJson: z.string().default("{}"),
    nextAttemptAt: Time.default(0),
    error: z.string().nullable(),
    fundedAt: Time,
    fulfilledAt: Time.nullable(),
  }),
  packs: z.object({
    uid: Id, // Collector Crypt machine ID
    provider: z.literal("collector_crypt"),
    name: z.string(),
    image: z.string(),
    priceUsdCents: z.number().int().nonnegative(),
    available: z.boolean(),
    metadataJson: z.string().default("{}"),
    refreshedAt: Time,
  }),
  cards: z.object({
    uid: Id,
    executionId: Id,
    nftMint: Address,
    recipient: Address,
    name: z.string(),
    image: z.string(),
    rarity: z.string().nullable(),
    gradingCompany: z.string().nullable(),
    grade: z.string().nullable(),
    insuredValueUsdCents: z.number().int().nonnegative().nullable(),
    purchaseSignature: z.string(),
    deliverySignature: z.string().nullable(),
    awardedAt: Time,
  }),
  tokenBuybacks: z.object({
    uid: Id,
    treasuryId: Id,
    targetUsdCents: z.number().int().positive().default(50_000),
    reservedLamports: Atomic,
    status: BuybackStatus,
    signedSwapRef: z.string().nullable(),
    swapSignature: z.string().nullable(),
    signedBurnRef: z.string().nullable(),
    burnSignature: z.string().nullable(),
    tokenBoughtAtomic: Atomic.nullable(),
    tokenBurnedAtomic: Atomic.nullable(),
    nextAttemptAt: Time.default(0),
    error: z.string().nullable(),
    fundedAt: Time,
    fulfilledAt: Time.nullable(),
  }),
} as const;

export type Tables = {
  [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]>;
};
export type Token = Tables["tokens"];
export type Deposit = Tables["deposits"];
export type Holder = Tables["holders"];
export type Strategy = Tables["strategies"];
export type Vote = Tables["votes"];
export type Treasury = Tables["treasuries"];
export type LedgerEntry = Tables["ledger"];
export type FeeClaim = Tables["feeClaims"];
export type Fee = Tables["fees"];
export type Execution = Tables["executions"];
export type Pack = Tables["packs"];
export type Card = Tables["cards"];
export type TokenBuyback = Tables["tokenBuybacks"];
export type StrategyConfigValue = z.infer<typeof StrategyConfig>;
export type LaunchStatusValue = z.infer<typeof LaunchStatus>;
export type ExecutionStatusValue = z.infer<typeof ExecutionStatus>;
export type FeeClaimStatusValue = z.infer<typeof FeeClaimStatus>;
export type BuybackStatusValue = z.infer<typeof BuybackStatus>;
