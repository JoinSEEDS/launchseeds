/** Immutable creator choices. Persist the canonical JSON before exposing a funding address. */
import { z } from "zod";

export const FIRST_STRATEGY_LOCKS = [0, 3_600_000, 86_400_000, 604_800_000] as const;
export const MINIMUM_ACTIVE_TIMES = [180_000, 3_600_000, 21_600_000, 86_400_000] as const;
/** Puzzle solve time on a MacBook, in seconds (slider stops). */
export const SNIPER_SECONDS = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300] as const;
/** Concentrated-liquidity range stops, as market cap in USD. */
export const MARKET_CAP_STOPS = [
  10_000, 20_000, 50_000, 100_000, 200_000, 500_000,
  1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000,
] as const;
export const MAX_LIQUIDITY_SHARE = 50;
export const TOKEN_SHARE_PERCENT = 10;
export const LIQUIDITY_BATCH_USD = 100;

const oneOf = <T extends number>(values: readonly T[]) =>
  z.number().refine((v): v is T => (values as readonly number[]).includes(v), "Unsupported value");

export const LiquiditySettingsSchema = z.object({
  feeShare: z.number().int().min(1).max(MAX_LIQUIDITY_SHARE),
  minMcapUsd: oneOf(MARKET_CAP_STOPS),
  maxMcapUsd: oneOf(MARKET_CAP_STOPS),
}).strict().refine((v) => v.minMcapUsd < v.maxMcapUsd, {
  message: "The range must start below where it ends.", path: ["maxMcapUsd"],
});

export const LaunchSettingsSchema = z.object({
  firstStrategyLockMs: z.union([
    z.literal(0), z.literal(3_600_000), z.literal(86_400_000), z.literal(604_800_000),
  ]),
  minimumActiveMs: z.union([
    z.literal(180_000), z.literal(3_600_000), z.literal(21_600_000), z.literal(86_400_000),
  ]),
  /** null = sniper protection off. */
  sniperSeconds: oneOf(SNIPER_SECONDS).nullable(),
  /** null = no concentrated liquidity. */
  liquidity: LiquiditySettingsSchema.nullable(),
}).strict();

export type LaunchSettings = z.infer<typeof LaunchSettingsSchema>;
export const DEFAULT_LAUNCH_SETTINGS: LaunchSettings = Object.freeze({
  firstStrategyLockMs: 86_400_000,
  minimumActiveMs: 3_600_000,
  sniperSeconds: 30,
  liquidity: Object.freeze({ feeShare: 25, minMcapUsd: 100_000, maxMcapUsd: 1_000_000 }),
});

/** Existing tokens without this feature keep their original three-minute governance rule. */
export const UNSPECIFIED_LAUNCH_SETTINGS: LaunchSettings = Object.freeze({
  firstStrategyLockMs: 0,
  minimumActiveMs: 180_000,
  sniperSeconds: null,
  liquidity: null,
});

export function parseLaunchSettings(value: unknown): LaunchSettings {
  return LaunchSettingsSchema.parse(value);
}

export function storedLaunchSettings(json: string | null | undefined): LaunchSettings {
  if (!json) return UNSPECIFIED_LAUNCH_SETTINGS;
  try { return parseLaunchSettings(JSON.parse(json)); }
  catch { throw new Error("Invalid persisted launch settings. Operator review required."); }
}

export function canonicalLaunchSettings(value: unknown): string {
  return JSON.stringify(parseLaunchSettings(value));
}

/** Percent of trading fees reserved for liquidity (0 when off). */
export function liquidityShare(settings: LaunchSettings): number {
  return settings.liquidity?.feeShare ?? 0;
}

/** One-dollar fee decomposition: $TOKEN first, liquidity next, the remainder to rewards. */
export function feeSplit(liquidityPercent: number, feesCents = 100): {
  tokenCents: number;
  liquidityCents: number;
  rewardsCents: number;
  tokenPercent: number;
  liquidityPercent: number;
  rewardsPercent: number;
} {
  if (!Number.isSafeInteger(liquidityPercent) || liquidityPercent < 0 ||
      liquidityPercent > MAX_LIQUIDITY_SHARE ||
      !Number.isSafeInteger(feesCents) || feesCents < 0)
    throw new Error("Invalid fee split");
  const tokenCents = Math.floor(feesCents * TOKEN_SHARE_PERCENT / 100);
  const liquidityCents = Math.floor(feesCents * liquidityPercent / 100);
  return {
    tokenCents, liquidityCents, rewardsCents: feesCents - tokenCents - liquidityCents,
    tokenPercent: TOKEN_SHARE_PERCENT, liquidityPercent,
    rewardsPercent: 100 - TOKEN_SHARE_PERCENT - liquidityPercent,
  };
}

/** The configured market-cap range, or null when liquidity is off. */
export function liquidityRange(settings: LaunchSettings): { lowerUsd: number; upperUsd: number } | null {
  return settings.liquidity
    ? { lowerUsd: settings.liquidity.minMcapUsd, upperUsd: settings.liquidity.maxMcapUsd }
    : null;
}

/** "$100K", "$1M" — the designer's compact market-cap labels. */
export function compactUsd(value: number): string {
  return value >= 1e6 ? `$${value / 1e6}M` : `$${value / 1e3}K`;
}

export function rangeText(settings: LaunchSettings): string {
  const range = liquidityRange(settings);
  return range ? `${compactUsd(range.lowerUsd)}–${compactUsd(range.upperUsd)}` : "Off";
}

/** "1s", "30s", "1 min", "5 min". */
export function secondsText(seconds: number): string {
  return seconds < 60 || seconds % 60 ? `${seconds}s` : `${seconds / 60} min`;
}

export function sniperDescription(settings: LaunchSettings): string {
  return settings.sniperSeconds === null ? "Off" : `${secondsText(settings.sniperSeconds)} puzzle`;
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
  state: { activeStrategyId: number | null; leaderStrategyId: number | null; leaderSince: number | null },
  policy: GovernanceLockPolicy,
  holdMs = 180_000,
): number | null {
  if (!state.leaderStrategyId || state.leaderSince === null ||
      state.leaderStrategyId === state.activeStrategyId) return null;
  const creatorLockUntil = state.activeStrategyId === policy.initialStrategyId
    ? policy.launchedAt + policy.firstLockMs : 0;
  return Math.max(
    state.leaderSince + holdMs,
    creatorLockUntil,
    policy.activatedAt + policy.minimumActiveMs,
  );
}

/** Lock remaining even when the board has no challenger. */
export function activeLockUntil(state: { activeStrategyId: number | null }, policy: GovernanceLockPolicy) {
  return Math.max(
    state.activeStrategyId === policy.initialStrategyId ? policy.launchedAt + policy.firstLockMs : 0,
    policy.activatedAt + policy.minimumActiveMs,
  );
}
