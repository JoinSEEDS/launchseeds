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
};
