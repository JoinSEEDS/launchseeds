/** Immutable creator choices. Persist the canonical JSON before exposing a funding address. */
import { z } from "zod";
import { UserBatchesSchema, batchTotal } from "./user-funded-batches";

/** The launch buy: what the columns' wallets add up to, in lamports. */
export const BUNDLE_MIN_LAMPORTS = 100_000_000;
export const BUNDLE_MAX_LAMPORTS = 5_000_000_000;

export const LaunchSettingsSchema = z
  .object({
    /** The reserved CA is shown before launch. */
    publishMint: z.boolean().default(true),
    /** The project description is part of the published plan. */
    publishProject: z.boolean().default(true),
    scheduledAt: z.number().int().positive().safe().nullable().default(null),
    /** The launch columns and tranches: who buys what, and how each sells. */
    userBatches: UserBatchesSchema.nullable().default(null),
    bundleLamports: z.number().int().min(BUNDLE_MIN_LAMPORTS).max(BUNDLE_MAX_LAMPORTS).nullable().default(null),
    /** The wallet that receives the coin's creator fees. */
    feesTo: z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Enter a valid Solana address for the fees")
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (v) => v.userBatches === null || (v.scheduledAt !== null && v.bundleLamports !== null && BigInt(v.bundleLamports) === batchTotal(v.userBatches)),
    { message: "Launch columns need a launch time and a launch buy equal to their wallets' buys." },
  )
  .refine((v) => v.scheduledAt === null || (v.userBatches !== null && v.feesTo !== null), {
    message: "A scheduled launch needs its columns and a creator-fee wallet.",
  });

export type LaunchSettings = z.infer<typeof LaunchSettingsSchema>;
export const DEFAULT_LAUNCH_SETTINGS: LaunchSettings = Object.freeze({
  publishMint: true,
  publishProject: true,
  scheduledAt: null,
  userBatches: null,
  bundleLamports: null,
  feesTo: null,
});

export function parseLaunchSettings(value: unknown): LaunchSettings {
  return LaunchSettingsSchema.parse(value);
}

export function storedLaunchSettings(json: string | null | undefined): LaunchSettings {
  if (!json) return DEFAULT_LAUNCH_SETTINGS;
  try {
    return parseLaunchSettings(JSON.parse(json));
  } catch {
    throw new Error("Invalid persisted launch settings. Operator review required.");
  }
}

export function canonicalLaunchSettings(value: unknown): string {
  return JSON.stringify(parseLaunchSettings(value));
}

/** The proceeds wallet every column pays. */
export function proceedsWallet(settings: LaunchSettings): string | null {
  return settings.userBatches?.proceedsWallet ?? null;
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
