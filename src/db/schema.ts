/** Launchseeds authoritative persisted types. sqlite-zod-orm adds its own integer `id` column,
 * which is every row's identity; cross-table references are integer `…Id` columns and are
 * never exposed publicly (tokens are addressed by CA). All currency/chain amounts are
 * atomic decimal strings. Time fields are UTC milliseconds unless named `Minute`.
 */
import { z } from "sqlite-zod-orm";

export const Atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const SignedAtomic = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
export const Time = z.number().int().nonnegative();
export const Slot = Time;
export const Id = z.string().min(1);
/** Integer row reference (sqlite-zod-orm `id`). */
export const RowId = z.number().int().positive();
export const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const OptionalAddress = Address.nullable();

export const WeightMode = z.enum(["gravity", "snapshot"]);
export const StrategyConfig = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pack"), ref: Id, mode: WeightMode }),
  z.object({
    type: z.literal("stock"),
    ref: Id,
    /** Each win is at least $1 of the stock (owner decision 2026-10-26). */
    amountUsdCents: z.number().int().min(100),
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
  /** Holder-governed market making (holder-reward coins). `amountUsdCents` is
   * the size of one bot order; the bot buys after the price falls `spreadBps`
   * below its last trade and sells after it rises `spreadBps` above it, holds at
   * most `maxPositionPercent` of its value in the coin, and pays
   * `payoutPercent` of realized profit to holders by Gravity. */
  z.object({
    type: z.literal("market"),
    amountUsdCents: z.number().int().min(100).max(1_000_000),
    spreadBps: z.number().int().min(200).max(5_000),
    maxPositionPercent: z.number().int().min(10).max(90),
    payoutPercent: z.number().int().min(0).max(100),
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
    /** Private launch-status handle: sha256(CA) prefix; legacy launches keep their old id. */
    handle: Id,
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
    /** Null while the launch is `preparing` (before wallets and metadata exist). */
    fundingWallet: OptionalAddress,
    fundingWalletName: z.string().nullable(),
    creatorWallet: OptionalAddress,
    rewardWallet: OptionalAddress,
    launcherWallet: OptionalAddress,
    devBuyRecipient: OptionalAddress,
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
    activeStrategyId: RowId.nullable(),
    leaderStrategyId: RowId.nullable(),
    leaderSince: Time.nullable(),
    tokenDecimals: z.number().int().min(0).max(18).default(6),
    priceUsd: z.number().finite().nonnegative().default(0),
    marketCapUsd: z.number().finite().nonnegative().default(0),
    lastGravityMinute: Time.nullable(),
    holdersSnapshotSlot: Slot.default(0),
    holdersSnapshotAt: Time.default(0),
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
  holders: z.object({
    tokenId: RowId,
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
    tokenId: RowId,
    type: z.enum(["pack", "stock", "burn", "wallet", "x", "github", "market"]),
    configKey: Id,
    configJson: z.string(),
    enabled: z.boolean().default(true),
    createdAt: Time,
  }),
  votes: z.object({
    tokenId: RowId,
    wallet: Address,
    strategyId: RowId,
    /** Strictly increasing per token/wallet; included in signed vote intent. */
    nonce: z.number().int().positive(),
    signature: Id,
    votedAt: Time,
  }),
  treasuries: z.object({
    ownerType: z.enum(["token", "platform"]),
    /** Owning token; null for the platform ($TOKEN) treasury. */
    tokenId: RowId.nullable(),
    wallet: Address,
    asset: Asset,
    availableAtomic: Atomic.default("0"),
    reservedAtomic: Atomic.default("0"),
    updatedAt: Time,
  }),
  ledger: z.object({
    eventId: Id,
    treasuryId: RowId,
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
    refId: RowId,
    signature: z.string().nullable(),
    createdAt: Time,
  }),
  feeClaims: z.object({
    tokenId: RowId,
    strategyId: RowId,
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
    feeClaimId: RowId,
    tokenId: RowId,
    treasuryId: RowId,
    signature: Id,
    receiptIndex: z.number().int().nonnegative(),
    lamports: Atomic,
    receivedAt: Time,
  }),
  executions: z.object({
    tokenId: RowId,
    fundingClaimId: RowId,
    strategyId: RowId,
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
    machineId: Id, // Collector Crypt machine ID
    provider: z.literal("collector_crypt"),
    name: z.string(),
    image: z.string(),
    priceUsdCents: z.number().int().nonnegative(),
    available: z.boolean(),
    metadataJson: z.string().default("{}"),
    refreshedAt: Time,
  }),
  cards: z.object({
    executionId: RowId,
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
    treasuryId: RowId,
    sourceTokenId: RowId.nullable().default(null),
    targetMint: OptionalAddress.default(null),
    requestKey: z.string().nullable().default(null),
    authorizationJson: z.string().nullable().default(null),
    spentLamports: Atomic.nullable().default(null),
    targetUsdCents: z.number().int().nonnegative().default(50_000),
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
  /** Launches funded from the free-launch treasury. The signed transfer is stored
   * before it is sent, so a retry can never build a second one. */
  freeLaunches: z.object({
    tokenId: RowId,
    identity: z.string().min(1),
    lamports: Atomic,
    signature: z.string().min(1),
    transaction: z.string().min(1),
    lastValidBlockHeight: z.number().int().nonnegative(),
    createdAt: Time,
  }),
  /** Pack winners. A draw is made from a frozen, hashed holder snapshot and a
   * finalized blockhash observed after the freeze; anyone can recompute it.
   * The pack is bought for this winner later (`executionId`, then a card). */
  drawRevisions: z.object({
    executionId: RowId,
    previousDrawId: RowId,
    snapshotJson: z.string(),
    snapshotHash: z.string().length(64),
    targetSlot: Slot,
    reason: z.string(),
    createdAt: Time,
    completedAt: Time.default(0),
    newDrawId: RowId.nullable().default(null),
  }),
  draws: z.object({
    tokenId: RowId,
    /** 1, 2, 3… per token. */
    number: z.number().int().positive(),
    packCode: Id,
    packName: z.string(),
    packImage: z.string().default(""),
    priceUsdCents: z.number().int().positive(),
    weightMode: WeightMode,
    /** Canonical "wallet:weight" lines, sorted by wallet (what was hashed). */
    snapshotJson: z.string(),
    snapshotHash: z.string().length(64),
    /** `finalized:<slot>:<blockhash>`. */
    randomnessRef: z.string(),
    winner: Address,
    /** Winner's weight / total weight at the draw, 0–1. */
    chance: z.number().min(0).max(1),
    executionId: RowId.nullable().default(null),
    drawnAt: Time,
    /** Preliminary draw retained as evidence when replaced by a purchase draw. */
    supersededAt: Time.default(0),
  }),
  /** Stock rewards (e.g. $1 of GLDx gold per win). Stock is bought in chunks
   * (an execution); each win freezes the eligible snapshot first, is drawn from
   * a finalized blockhash observed afterwards, then sent automatically. The
   * signed transfer is stored before sending so a retry resends the same one. */
  stockWins: z.object({
    tokenId: RowId,
    /** Shared numbering with pack draws: win #1, #2… per token. */
    number: z.number().int().positive(),
    /** The chunk purchase this win's tokens came from. */
    executionId: RowId,
    stockMint: Address,
    symbol: z.string(),
    decimals: z.number().int().min(0).max(18),
    amountRaw: Atomic,
    valueUsdCents: z.number().int().positive(),
    weightMode: WeightMode,
    snapshotJson: z.string(),
    snapshotHash: z.string().length(64),
    randomnessRef: z.string().nullable().default(null),
    winner: OptionalAddress.default(null),
    chance: z.number().min(0).max(1).nullable().default(null),
    status: z.enum(["committed", "drawn", "sending", "sent", "needs_review"]),
    signedTransaction: z.string().nullable().default(null),
    signature: z.string().nullable().default(null),
    lastValidBlockHeight: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .default(null),
    error: z.string().nullable().default(null),
    nextAttemptAt: Time.default(0),
    createdAt: Time,
    drawnAt: Time.nullable().default(null),
    sentAt: Time.nullable().default(null),
  }),
  /** Market-maker trades (holder-reward coins: the launch buy and sell-plan
   * sales), public on the token page. A sale is recorded as pending before it is
   * sent; Solard's intent key makes a retry resume it. Position, cost basis and
   * realized profit are running totals after each confirmed trade (average-cost
   * accounting, lamports). */
  mmTrades: z.object({
    tokenId: RowId,
    side: z.enum(["launch", "buy", "sell"]),
    intentKey: z.string().min(1),
    status: z.enum(["pending", "confirmed", "failed"]),
    /** Buy: SOL to spend. Sell: tokens to sell. */
    requestLamports: Atomic.default("0"),
    requestTokensRaw: Atomic.default("0"),
    /** Confirmed amounts: SOL spent (launch/buy) or received (sell); tokens bought or sold. */
    lamports: Atomic.default("0"),
    tokensRaw: Atomic.default("0"),
    signature: z.string().nullable().default(null),
    positionAfterRaw: Atomic.default("0"),
    costAfterLamports: Atomic.default("0"),
    realizedAfterLamports: z
      .string()
      .regex(/^-?\d+$/)
      .default("0"),
    error: z.string().nullable().default(null),
    createdAt: Time,
    confirmedAt: Time.nullable().default(null),
  }),
  /** Sniper-protection bundles: LaunchSeeds's capital funds three new public
   * wallets that buy a coin in its Jito launch bundle. They sell together once
   * each gets 110% of its buy, or at market when the capital is needed for a
   * new launch; then their accounts are closed and swept back to the capital
   * wallet. Amounts are lamports / raw tokens. */
  scheduledPlans: z.object({
    tokenId: RowId,
    buyersJson: z.string(),
    planHash: z.string(),
    createdAt: Time,
  }),
  launchBundles: z.object({
    tokenId: RowId,
    status: z.enum([
      "buying",
      "holding",
      "exiting",
      "exited",
      "closed",
      "settling",
      "settled",
      "abandoned",
    ]),
    /** What the fund sent to the bundle wallets (buys + reserves): its principal. */
    costLamports: Atomic.default("0"),
    /** Chosen by the owner at liquidation: where this coin's realized profit goes. */
    /** token: the profit bought the coin back for a $TOKEN holder (bundleRewards). */
    settlement: z
      .enum(["owner", "holders", "token", "wallet", "burn"])
      .nullable()
      .default(null),
    profitLamports: z
      .string()
      .regex(/^-?\d+$/)
      .nullable()
      .default(null),
    settledAt: Time.nullable().default(null),
    /** Run by the launch CLI on another wallet store: shown here, never traded here. */
    external: z.boolean().default(false),
    /** Each wallet's sale minimum, basis points of its buy. */
    exitTargetBps: z.number().int().default(10_200),
    /** External bundles: the profit buyback (steps, buys, final burn) as JSON. */
    buybackJson: z.string().nullable().default(null),
    /** [{ name, wallet, budgetLamports }] */
    buyersJson: z.string(),
    /** Confirmed fills per buyer, after the launch lands. */
    fillsJson: z.string().nullable().default(null),
    /** Persisted signed exit before it is sent; its kind and lifetime. */
    exitTransaction: z.string().nullable().default(null),
    exitSignature: z.string().nullable().default(null),
    exitLastValidBlockHeight: z.number().int().nullable().default(null),
    /** profit: reached its target; rotation: capital was needed; deadline: the
     * launcher's hold limit; close: the launcher closed it. */
    exitKind: z
      .enum(["profit", "rotation", "deadline", "close"])
      .nullable()
      .default(null),
    proceedsLamports: Atomic.nullable().default(null),
    sweepTransaction: z.string().nullable().default(null),
    sweepSignature: z.string().nullable().default(null),
    sweepLastValidBlockHeight: z.number().int().nullable().default(null),
    error: z.string().nullable().default(null),
    createdAt: Time,
    launchedAt: Time.nullable().default(null),
    exitedAt: Time.nullable().default(null),
  }),
  /** Original sweep bytes retained when expiry and absence are reconciled. */
  bundleSweepAttempts: z.object({
    bundleId: RowId,
    signature: Id,
    transaction: Id,
    lastValidBlockHeight: Time,
    outcome: z.literal("expired_unobserved"),
    reconciledAt: Time,
  }),
  /** A sold bundle's profit, spent buying the coin back in steps from the
   * capital wallet; everything bought goes to one $TOKEN holder, drawn with a
   * chance proportional to Gravity (snapshot committed before the blockhash). */
  rewardApprovals: z.object({
    rewardId: RowId,
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    wallet: Address,
    signature: Id,
    issuedAt: Time,
    createdAt: Time,
  }),
  bundleRewards: z.object({
    tokenId: RowId,
    status: z.enum([
      "buying",
      "committed",
      "drawn",
      "sending",
      "sent",
      "skipped",
      "needs_review",
    ]),
    profitLamports: Atomic,
    steps: z.number().int().min(1),
    stepMs: Time,
    startedAt: Time,
    /** [{ step, lamports, signature, transaction, lastValidBlockHeight, confirmed, tokensAfterRaw, at }] */
    buysJson: z.string().default("[]"),
    /** What the winner receives (the capital wallet's balance of the coin). */
    tokensRaw: Atomic.nullable().default(null),
    /** Frozen $TOKEN Gravity entries [{ wallet, weight }] and their hash. */
    snapshotJson: z.string().nullable().default(null),
    snapshotHash: z.string().nullable().default(null),
    committedAt: Time.nullable().default(null),
    winner: z.string().nullable().default(null),
    chance: z.number().nullable().default(null),
    randomnessRef: z.string().nullable().default(null),
    transferTransaction: z.string().nullable().default(null),
    transferSignature: z.string().nullable().default(null),
    transferLastValidBlockHeight: z.number().int().nullable().default(null),
    sentAt: Time.nullable().default(null),
    error: z.string().nullable().default(null),
    createdAt: Time,
  }),
  /** Holder votes that steer a token website (e.g. $COIN's steer, -10..10
   * tenths): one current choice per wallet, weighted by its Gravity when counted. */
  siteVotes: z.object({
    site: Id,
    wallet: Id,
    choice: Id,
    message: z.string(),
    signature: Id,
    votedAt: Time,
  }),
  /** A token website's holder chat, the neuron's replies and the #1 holder's
   * thought. Holder text is plain text, at most 140 characters. */
  siteMessages: z.object({
    site: Id,
    kind: z.enum(["chat", "reply", "thought"]),
    /** null for the neuron's replies. */
    wallet: z.string().nullable().default(null),
    text: z.string().max(400),
    at: Time,
  }),
  /** Profit payouts at a bundle's settlement, one row per transaction batch
   * (signed bytes persisted before sending; resent while valid). */
  bundlePayouts: z.object({
    tokenId: RowId,
    batch: z.number().int().min(0),
    /** [{ wallet, lamports }] */
    recipientsJson: z.string(),
    totalLamports: Atomic,
    status: z.enum(["pending", "confirmed", "failed"]),
    transaction: z.string().nullable().default(null),
    signature: z.string().nullable().default(null),
    lastValidBlockHeight: z.number().int().nullable().default(null),
    createdAt: Time,
    confirmedAt: Time.nullable().default(null),
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
export type FreeLaunch = Tables["freeLaunches"];
export type Draw = Tables["draws"];
export type StockWin = Tables["stockWins"];
export type MmTrade = Tables["mmTrades"];
export type LaunchBundle = Tables["launchBundles"];
export type BundlePayout = Tables["bundlePayouts"];
export type BundleReward = Tables["bundleRewards"];
export type SiteVote = Tables["siteVotes"];
export type SiteMessage = Tables["siteMessages"];
export type StrategyConfigValue = z.infer<typeof StrategyConfig>;
export type LaunchStatusValue = z.infer<typeof LaunchStatus>;
export type ExecutionStatusValue = z.infer<typeof ExecutionStatus>;
export type FeeClaimStatusValue = z.infer<typeof FeeClaimStatus>;
export type BuybackStatusValue = z.infer<typeof BuybackStatus>;
