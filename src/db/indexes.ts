/** Run after sqlite-zod-orm has created all tables. Explicit indexes are deliberate:
 * the ORM's automatic additive migrations do not replace business uniqueness constraints.
 */
export const INDEXES = [
  "CREATE UNIQUE INDEX IF NOT EXISTS user_batch_runs_token_batch ON userBatchRuns(tokenId,batchIndex)",
  "CREATE UNIQUE INDEX IF NOT EXISTS coin_liquidations_token ON coinLiquidations(tokenId)",
  "CREATE UNIQUE INDEX IF NOT EXISTS user_batch_attempt_signature ON userBatchAttempts(batchRunId,kind,signature)",
  "CREATE INDEX IF NOT EXISTS tokens_catalog_order ON tokens(createdAt DESC,id DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS workerHealth_name ON workerHealth(name)",

  "CREATE UNIQUE INDEX IF NOT EXISTS tokens_handle ON tokens(handle)",
  "CREATE UNIQUE INDEX IF NOT EXISTS tokens_access ON tokens(accessHash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS tokens_mint ON tokens(mint) WHERE mint IS NOT NULL",
  // A launcher's own wallet can deploy more than one coin, one at a time.
  "CREATE INDEX IF NOT EXISTS tokens_funding_wallet ON tokens(fundingWallet)",
  "CREATE INDEX IF NOT EXISTS tokens_live ON tokens(status, createdAt DESC)",
  "CREATE INDEX IF NOT EXISTS tokens_launch_due ON tokens(status, nextAttemptAt)",
  "CREATE UNIQUE INDEX IF NOT EXISTS deposits_signature ON deposits(signature)",
  "CREATE INDEX IF NOT EXISTS deposits_token ON deposits(tokenId)",
  "CREATE UNIQUE INDEX IF NOT EXISTS scheduledPlans_token ON scheduledPlans(tokenId)",
] as const;
