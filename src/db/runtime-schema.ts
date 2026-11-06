import { z } from "sqlite-zod-orm";
import { Id, RowId, Time, Address } from "./schema";
export const runtimeSchemas = {
  userBatchRuns: z.object({
    tokenId: RowId,
    /** 0–3: the launch bundle's columns; 4–9: post-launch tranches. */
    batchIndex: z.number().int().min(0).max(9),
    active: z.boolean().default(true),
    stateJson: z.string(),
    revision: z.number().int().nonnegative().default(0),
    createdAt: Time,
    updatedAt: Time,
  }),
  /** Admin "liquidate everything": sells every launch wallet's remaining
   * tokens of a coin (src/server/coin-liquidation.ts). */
  coinLiquidations: z.object({
    tokenId: RowId,
    active: z.boolean().default(true),
    stateJson: z.string(),
    revision: z.number().int().nonnegative().default(0),
    createdAt: Time,
    updatedAt: Time,
  }),
  userBatchAttempts: z.object({
    batchRunId: RowId,
    kind: z.enum(["sale", "payout"]),
    signature: z.string(),
    signedJson: z.string(),
    preparedAt: Time,
  }),
  publicPageSnapshots: z.object({
    key: Id,
    valueJson: z.string(),
    observedAt: Time,
  }),
  governanceState: z.object({
    tokenId: RowId,
    initialStrategyId: RowId,
    switchedAt: Time,
    snapshotAt: Time.default(0),
  }),
  voteChallenges: z.object({
    /** Random single-use challenge string handed to the signing wallet. */
    challenge: Id,
    tokenId: RowId,
    wallet: Address,
    strategyId: RowId,
    nonce: z.number().int().positive(),
    expiresAt: Time,
    usedAt: Time.nullable(),
  }),
  /** Single-row liveness record for the one launch worker. */
  workerHealth: z.object({
    name: z.literal("launch-worker"),
    workerId: Id,
    active: z.boolean(),
    healthy: z.boolean(),
    heartbeatAt: Time,
    cycleStartedAt: Time,
    completedAt: Time,
    lastError: z.string(),
  }),
  /** Non-executing treasury proposal journal (see src/server/treasury-plans.ts). */
  treasuryPlans: z.object({
    planId: Id,
    tokenId: RowId,
    strategyKey: Id,
    status: z.enum(["observed", "reviewable", "superseded", "expired"]),
    costMicros: z.number().int().positive(),
    recordedMicros: Time,
    balanceMicros: Time.nullable(),
    snapshotAt: Time,
    snapshotSlot: Time.default(0),
    balanceSlot: Time.default(0),
    balanceObservedAt: Time.default(0),
    sourceTimestamp: Time,
    evidenceDigest: Id,
    createdAt: Time,
    updatedAt: Time,
    expiresAt: Time,
  }),
};
