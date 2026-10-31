/** Immutable creator choices. Persist the canonical JSON before exposing a funding address. */
import { z } from "zod";
import { UserBatchesSchema, batchTotal } from "./user-funded-batches";

export const FIRST_STRATEGY_LOCKS = [
  0, 3_600_000, 86_400_000, 604_800_000,
] as const;
export const MINIMUM_ACTIVE_TIMES = [
  180_000, 3_600_000, 21_600_000, 86_400_000,
] as const;
/** Puzzle solve time on a MacBook, in seconds (slider stops). */
export const SNIPER_SECONDS = [
  1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300,
] as const;
/** Concentrated-liquidity range stops, as market cap in USD. */
export const MARKET_CAP_STOPS = [
  10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000,
  5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000,
] as const;
export const MAX_LIQUIDITY_SHARE = 50;
export const TOKEN_SHARE_PERCENT = 10;
export const LIQUIDITY_BATCH_USD = 100;

const oneOf = <T extends number>(values: readonly T[]) =>
  z
    .number()
    .refine(
      (v): v is T => (values as readonly number[]).includes(v),
      "Unsupported value",
    );

export const LiquiditySettingsSchema = z
  .object({
    feeShare: z.number().int().min(1).max(MAX_LIQUIDITY_SHARE),
    minMcapUsd: oneOf(MARKET_CAP_STOPS),
    maxMcapUsd: oneOf(MARKET_CAP_STOPS),
  })
  .strict()
  .refine((v) => v.minMcapUsd < v.maxMcapUsd, {
    message: "The range must start below where it ends.",
    path: ["maxMcapUsd"],
  });

/** One point of a holder-reward coin's public sell plan: when the market cap
 * first reaches `marketCapUsd`, the market maker sells `percent` of its launch
 * position. Each point sells once. */
export const SellPointSchema = z
  .object({
    marketCapUsd: z.number().int().min(1_000).max(1_000_000_000),
    percent: z.number().int().min(1).max(100),
  })
  .strict();
export const SellPlanSchema = z
  .array(SellPointSchema)
  .max(10)
  .refine(
    (plan) =>
      plan.every(
        (p, i) => i === 0 || p.marketCapUsd > plan[i - 1]!.marketCapUsd,
      ),
    { message: "Sell points must rise in market cap." },
  )
  .refine((plan) => plan.reduce((sum, p) => sum + p.percent, 0) <= 100, {
    message: "A sell plan cannot sell more than 100% of the launch position.",
  });
export type SellPoint = z.infer<typeof SellPointSchema>;
/** 20% of the launch position at each of five market caps. */
export const DEFAULT_SELL_PLAN: readonly SellPoint[] = Object.freeze([
  { marketCapUsd: 100_000, percent: 20 },
  { marketCapUsd: 250_000, percent: 20 },
  { marketCapUsd: 500_000, percent: 20 },
  { marketCapUsd: 1_000_000, percent: 20 },
  { marketCapUsd: 2_500_000, percent: 20 },
]);

/** Built-in sniper protection: LaunchSeeds's capital buys this much in the launch's
 * Jito bundle (three public wallets) and sells it back later. The launcher pays
 * only a fee of 3% of it (at least 0.01 SOL); LaunchSeeds gets the rest back. */
export const BUNDLE_MIN_LAMPORTS = 100_000_000;
export const BUNDLE_MAX_LAMPORTS = 5_000_000_000;
export const BUNDLE_DEFAULT_LAMPORTS = 500_000_000;
export const BUNDLE_FEE_BPS = 300;
/** Slider stops for the bundle size, in SOL. */
export const BUNDLE_STOPS_SOL = [0.1, 0.25, 0.5, 1, 2, 3, 5] as const;
export const BUNDLE_MIN_FEE_LAMPORTS = 10_000_000;
/** When the bundle sells: once every wallet gets back this share of its buy. */
export const BUNDLE_EXIT_PERCENTS = [102, 103, 110, 125, 150, 200] as const;
export const BUNDLE_DEFAULT_EXIT_PERCENT = 102;
/** Optional hold limit: past it the bundle sells at market, target or not. */
export const BUNDLE_HOLD_LIMITS_MS = [
  3_600_000, 21_600_000, 86_400_000, 604_800_000,
] as const;
export function bundleFeeLamports(
  bundleLamports: number | null | undefined,
): number {
  if (!bundleLamports) return 0;
  return Math.max(
    BUNDLE_MIN_FEE_LAMPORTS,
    Math.ceil((bundleLamports * BUNDLE_FEE_BPS) / 10_000),
  );
}

export const WalletSharesSchema = z
  .tuple([
    z.number().int().min(1).max(9998),
    z.number().int().min(1).max(9998),
    z.number().int().min(1).max(9998),
  ])
  .refine(
    (v) => v.reduce((sum, n) => sum + n, 0) === 10_000,
    "Wallet shares must total 100%.",
  );
export const ProfitPolicySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("wallet"),
      wallet: z
        .string()
        .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Enter a valid profit wallet."),
    })
    .strict(),
  z.object({ mode: z.literal("burn") }).strict(),
  z.object({ mode: z.literal("token") }).strict(),
]);
export type ProfitPolicy = z.infer<typeof ProfitPolicySchema>;

export const LaunchSettingsSchema = z
  .object({
    publishMint: z.boolean().default(false),
    publishProject: z.boolean().default(false),
    userBatches: UserBatchesSchema.nullable().default(null),
    boost: z.object({
      durationMs: z.number().int().min(60_000).max(30 * 86_400_000),
      steps: z.number().int().min(1).max(100),
    }).strict().nullable().default(null),
    scheduledAt: z.number().int().positive().safe().nullable().default(null),
    walletSharesBps: WalletSharesSchema.nullable().default(null),
    profitPolicy: ProfitPolicySchema.nullable().default(null),
    firstStrategyLockMs: z.union([
      z.literal(0),
      z.literal(3_600_000),
      z.literal(86_400_000),
      z.literal(604_800_000),
    ]),
    minimumActiveMs: z.union([
      z.literal(180_000),
      z.literal(3_600_000),
      z.literal(21_600_000),
      z.literal(86_400_000),
    ]),
    /** null = sniper protection off. */
    sniperSeconds: oneOf(SNIPER_SECONDS).nullable(),
    /** null = no concentrated liquidity. */
    liquidity: LiquiditySettingsSchema.nullable(),
    /** Pump holder-reward coin: creator fees go to holders through Pump, and the
     * launch buy comes from a public, labelled market-making wallet that holders
     * govern (see market-maker.ts). Stored launches without it are false. */
    holderRewards: z.boolean().default(false),
    /** Holder-reward coins: the market maker's fixed, public sell plan (see SellPointSchema). */
    sellPlan: SellPlanSchema.default([]),
    /** Sniper-protection bundle size in lamports (null: none). */
    bundleLamports: z
      .number()
      .int()
      .min(BUNDLE_MIN_LAMPORTS)
      .max(BUNDLE_MAX_LAMPORTS)
      .nullable()
      .default(null),
    /** Bundle sale target, percent of each wallet's buy. */
    bundleExitPercent: oneOf(BUNDLE_EXIT_PERCENTS).default(
      BUNDLE_DEFAULT_EXIT_PERCENT,
    ),
    /** null: hold until the target (or until LaunchSeeds needs the capital). */
    bundleMaxHoldMs: oneOf(BUNDLE_HOLD_LIMITS_MS).nullable().default(null),
    /** Holder-reward coins: creator fees go to this wallet instead of to holders. */
    feesTo: z
      .string()
      .regex(
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
        "Enter a valid Solana address for the fees",
      )
      .nullable()
      .default(null),
  })
  .strict()
  .refine(value => value.userBatches === null || (value.scheduledAt !== null && value.boost === null && value.walletSharesBps === null &&
    value.bundleLamports !== null && BigInt(value.bundleLamports) === batchTotal(value.userBatches)), {message:"User-funded columns require a schedule, a launch buy equal to their slots, and no BOOST."})
  .refine(v => v.boost === null || (v.scheduledAt !== null && (v.profitPolicy?.mode === "burn" || v.profitPolicy?.mode === "token")), { message: "BOOST applies to scheduled buyback policies only." })
  .refine((v) => !v.feesTo || v.holderRewards || v.scheduledAt !== null, {
    message: "A fee address applies to holder-reward coins only.",
    path: ["feesTo"],
  })
  .refine(
    (v) =>
      v.scheduledAt === null ||
      (((v.holderRewards && v.feesTo === null) || (!v.holderRewards && v.feesTo !== null)) &&
        v.bundleLamports !== null &&
        (v.walletSharesBps !== null || v.userBatches !== null) &&
        v.profitPolicy !== null &&
        v.bundleMaxHoldMs === null &&
        v.sniperSeconds === null &&
        v.liquidity === null &&
        v.sellPlan.length === 0),
    {
      message:
        "Scheduled launches require protection, wallet allocation and a profit destination, without a market-sale deadline.",
    },
  );

export type LaunchSettings = z.infer<typeof LaunchSettingsSchema>;
export const DEFAULT_LAUNCH_SETTINGS: LaunchSettings = Object.freeze({
  publishMint: false,
  publishProject: false,
  userBatches: null,
  boost: null,
  scheduledAt: null,
  walletSharesBps: null,
  profitPolicy: null,
  firstStrategyLockMs: 86_400_000,
  minimumActiveMs: 3_600_000,
  sniperSeconds: 30,
  // Off until concentrated liquidity exists (LIQUIDITY_AVAILABLE).
  liquidity: null,
  holderRewards: false,
  sellPlan: [],
  bundleLamports: null,
  bundleExitPercent: BUNDLE_DEFAULT_EXIT_PERCENT,
  bundleMaxHoldMs: null,
  feesTo: null,
});

/** Existing tokens without this feature keep their original three-minute governance rule. */
export const UNSPECIFIED_LAUNCH_SETTINGS: LaunchSettings = Object.freeze({
  publishMint: false,
  publishProject: false,
  userBatches: null,
  boost: null,
  scheduledAt: null,
  walletSharesBps: null,
  profitPolicy: null,
  firstStrategyLockMs: 0,
  minimumActiveMs: 180_000,
  sniperSeconds: null,
  liquidity: null,
  holderRewards: false,
  sellPlan: [],
  bundleLamports: null,
  bundleExitPercent: BUNDLE_DEFAULT_EXIT_PERCENT,
  bundleMaxHoldMs: null,
  feesTo: null,
});

export function parseLaunchSettings(value: unknown): LaunchSettings {
  return LaunchSettingsSchema.parse(value);
}

export function storedLaunchSettings(
  json: string | null | undefined,
): LaunchSettings {
  if (!json) return UNSPECIFIED_LAUNCH_SETTINGS;
  try {
    return parseLaunchSettings(JSON.parse(json));
  } catch {
    throw new Error(
      "Invalid persisted launch settings. Operator review required.",
    );
  }
}

export function canonicalLaunchSettings(value: unknown): string {
  return JSON.stringify(parseLaunchSettings(value));
}

/** Concentrated liquidity is not built yet. Until it is, no fees are set aside
 * for it, whatever a token's stored settings say: holders get the full remainder. */
export const LIQUIDITY_AVAILABLE = false;

/** Percent of trading fees reserved for liquidity (0 when off or unavailable). */
export function liquidityShare(settings: LaunchSettings): number {
  return LIQUIDITY_AVAILABLE ? (settings.liquidity?.feeShare ?? 0) : 0;
}

/** One-dollar fee decomposition: $TOKEN first, liquidity next, the remainder to rewards. */
export function feeSplit(
  liquidityPercent: number,
  feesCents = 100,
): {
  tokenCents: number;
  liquidityCents: number;
  rewardsCents: number;
  tokenPercent: number;
  liquidityPercent: number;
  rewardsPercent: number;
} {
  if (
    !Number.isSafeInteger(liquidityPercent) ||
    liquidityPercent < 0 ||
    liquidityPercent > MAX_LIQUIDITY_SHARE ||
    !Number.isSafeInteger(feesCents) ||
    feesCents < 0
  )
    throw new Error("Invalid fee split");
  const tokenCents = Math.floor((feesCents * TOKEN_SHARE_PERCENT) / 100);
  const liquidityCents = Math.floor((feesCents * liquidityPercent) / 100);
  return {
    tokenCents,
    liquidityCents,
    rewardsCents: feesCents - tokenCents - liquidityCents,
    tokenPercent: TOKEN_SHARE_PERCENT,
    liquidityPercent,
    rewardsPercent: 100 - TOKEN_SHARE_PERCENT - liquidityPercent,
  };
}

/** The configured market-cap range, or null when liquidity is off. */
export function liquidityRange(
  settings: LaunchSettings,
): { lowerUsd: number; upperUsd: number } | null {
  return settings.liquidity
    ? {
        lowerUsd: settings.liquidity.minMcapUsd,
        upperUsd: settings.liquidity.maxMcapUsd,
      }
    : null;
}

/** "$100K", "$1M" — the designer's compact market-cap labels. */
export function compactUsd(value: number): string {
  return value >= 1e6 ? `$${value / 1e6}M` : `$${value / 1e3}K`;
}

export function rangeText(settings: LaunchSettings): string {
  const range = liquidityRange(settings);
  return range
    ? `${compactUsd(range.lowerUsd)}–${compactUsd(range.upperUsd)}`
    : "Off";
}

/** "1s", "30s", "1 min", "5 min". */
export function secondsText(seconds: number): string {
  return seconds < 60 || seconds % 60 ? `${seconds}s` : `${seconds / 60} min`;
}

export function sniperDescription(settings: LaunchSettings): string {
  return settings.sniperSeconds === null
    ? "Off"
    : `${secondsText(settings.sniperSeconds)} puzzle`;
}

export function durationText(ms: number): string {
  if (ms <= 0) return "None";
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.ceil(ms / 1_000)}s`;
}

/** Running time: "41m", "3h 12m", "2d 9h". */
export function elapsedText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function humanRemaining(ms: number): string {
  if (ms <= 0) return "Can change now";
  if (ms >= 3_600_000) return `Can change in ${Math.ceil(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `Can change in ${Math.ceil(ms / 60_000)}m`;
  return `Can change in ${Math.ceil(ms / 1_000)}s`;
}

export interface GovernanceLockPolicy {
  initialStrategyId: number;
  launchedAt: number;
  activatedAt: number;
  firstLockMs: number;
  minimumActiveMs: number;
}

/** Leadership may persist through the lock; it still needs a full 3m hold. */
export function takeoverEarliestAt(
  state: {
    activeStrategyId: number | null;
    leaderStrategyId: number | null;
    leaderSince: number | null;
  },
  policy: GovernanceLockPolicy,
  holdMs = 180_000,
): number | null {
  if (
    !state.leaderStrategyId ||
    state.leaderSince === null ||
    state.leaderStrategyId === state.activeStrategyId
  )
    return null;
  const creatorLockUntil =
    state.activeStrategyId === policy.initialStrategyId
      ? policy.launchedAt + policy.firstLockMs
      : 0;
  return Math.max(
    state.leaderSince + holdMs,
    creatorLockUntil,
    policy.activatedAt + policy.minimumActiveMs,
  );
}

/** Lock remaining even when the board has no challenger. */
export function activeLockUntil(
  state: { activeStrategyId: number | null },
  policy: GovernanceLockPolicy,
) {
  return Math.max(
    state.activeStrategyId === policy.initialStrategyId
      ? policy.launchedAt + policy.firstLockMs
      : 0,
    policy.activatedAt + policy.minimumActiveMs,
  );
}
