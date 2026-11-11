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
  /** One coin's creator fee from one trade: the treasury's creator-vault
   * increase in that transaction (lamports). Each coin's fees fund its challenges. */
  coinFees: z.object({
    tokenId: RowId,
    signature: z.string().min(1),
    lamports: z.string().regex(/^\d+$/),
    at: Time,
  }),
  /** Claims of the treasury's creator vault into the treasury. */
  feeClaims: z.object({
    claimId: z.string().min(1),
    status: z.enum(["pending", "confirmed", "failed"]),
    signature: z.string().nullable().default(null),
    lamports: z.string().regex(/^\d+$/).default("0"),
    error: z.string().nullable().default(null),
    createdAt: Time,
    updatedAt: Time,
  }),
  /** A coin creator's challenge: up to `maxWinners` completions each paid `rewardLamports`. */
  challenges: z.object({
    tokenId: RowId,
    title: z.string().min(1).max(120),
    description: z.string().max(2000).default(""),
    rewardLamports: z.string().regex(/^\d+$/),
    maxWinners: z.number().int().min(1).max(100).default(1),
    status: z.enum(["open", "closed"]),
    createdBy: Address,
    createdAt: Time,
    closedAt: Time.nullable().default(null),
  }),
  /** Someone's completion of a challenge. An approved one is paid from the treasury:
   * the signed transfer is saved before it is sent (`payoutJson`), never rebuilt
   * while it may still land. */
  submissions: z.object({
    challengeId: RowId,
    tokenId: RowId,
    wallet: Address,
    proofUrl: z.string().min(1).max(300),
    status: z.enum(["pending", "rejected", "approved", "paying", "paid", "review"]),
    payoutJson: z.string().nullable().default(null),
    payoutSignature: z.string().nullable().default(null),
    error: z.string().nullable().default(null),
    createdAt: Time,
    decidedAt: Time.nullable().default(null),
    paidAt: Time.nullable().default(null),
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
