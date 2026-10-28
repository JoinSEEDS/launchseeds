import { z } from "sqlite-zod-orm";
import { Id, RowId, Time, Address } from "./schema";
export const runtimeSchemas = {
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
