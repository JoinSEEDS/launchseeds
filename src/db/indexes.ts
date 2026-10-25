/** Run after sqlite-zod-orm has created all tables. Explicit indexes are deliberate:
 * the ORM's automatic additive migrations do not replace business uniqueness constraints.
 */
export const INDEXES = [
  "CREATE UNIQUE INDEX IF NOT EXISTS governanceState_token ON governanceState(tokenId)",
  "CREATE UNIQUE INDEX IF NOT EXISTS voteChallenges_challenge ON voteChallenges(challenge)",
  "CREATE INDEX IF NOT EXISTS voteChallenges_expiry ON voteChallenges(expiresAt)",
  "CREATE UNIQUE INDEX IF NOT EXISTS workerHealth_name ON workerHealth(name)",
  "CREATE UNIQUE INDEX IF NOT EXISTS treasuryPlans_planId ON treasuryPlans(planId)",
  "CREATE UNIQUE INDEX IF NOT EXISTS treasuryPlans_evidence ON treasuryPlans(tokenId, evidenceDigest)",
  "CREATE INDEX IF NOT EXISTS treasuryPlans_token_date ON treasuryPlans(tokenId, createdAt DESC)",
  `CREATE UNIQUE INDEX IF NOT EXISTS treasuryPlans_current ON treasuryPlans(tokenId)
     WHERE status IN ('observed','reviewable')`,

  "CREATE UNIQUE INDEX IF NOT EXISTS tokens_handle ON tokens(handle)",
  "CREATE UNIQUE INDEX IF NOT EXISTS tokens_access ON tokens(accessHash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS tokens_mint ON tokens(mint) WHERE mint IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS tokens_funding ON tokens(fundingWallet)",
  "CREATE INDEX IF NOT EXISTS tokens_live ON tokens(status, createdAt DESC)",
  "CREATE INDEX IF NOT EXISTS tokens_launch_due ON tokens(status, nextAttemptAt)",
  "CREATE UNIQUE INDEX IF NOT EXISTS deposits_signature ON deposits(signature)",
  "CREATE UNIQUE INDEX IF NOT EXISTS free_launches_token ON freeLaunches(tokenId)",
  "CREATE INDEX IF NOT EXISTS free_launches_identity ON freeLaunches(identity, createdAt)",
  "CREATE INDEX IF NOT EXISTS deposits_token ON deposits(tokenId)",
  "CREATE UNIQUE INDEX IF NOT EXISTS holders_identity ON holders(tokenId, wallet)",
  "CREATE INDEX IF NOT EXISTS holders_gravity ON holders(tokenId, length(gravityMicros) DESC, gravityMicros DESC) WHERE excluded = 0",
  "CREATE INDEX IF NOT EXISTS holders_wallet ON holders(wallet)",
  "CREATE UNIQUE INDEX IF NOT EXISTS strategies_config ON strategies(tokenId, configKey)",
  "CREATE UNIQUE INDEX IF NOT EXISTS votes_identity ON votes(tokenId, wallet)",
  "CREATE INDEX IF NOT EXISTS votes_strategy ON votes(tokenId, strategyId)",
  // NULL tokenId (platform) rows are distinct under UNIQUE; keep one platform row per asset.
  "CREATE UNIQUE INDEX IF NOT EXISTS treasuries_owner_asset ON treasuries(ownerType, ifnull(tokenId, 0), asset)",
  "CREATE UNIQUE INDEX IF NOT EXISTS ledger_event ON ledger(eventId)",
  "CREATE INDEX IF NOT EXISTS ledger_treasury ON ledger(treasuryId, createdAt DESC)",
  `CREATE UNIQUE INDEX IF NOT EXISTS feeClaims_one_pending ON feeClaims(tokenId)
     WHERE status IN ('pending','prepared','submitted','credited')`,
  "CREATE INDEX IF NOT EXISTS feeClaims_due ON feeClaims(status, nextAttemptAt)",
  "CREATE UNIQUE INDEX IF NOT EXISTS fees_receipt ON fees(signature, receiptIndex, treasuryId)",
  "CREATE INDEX IF NOT EXISTS fees_claim ON fees(feeClaimId)",
  "CREATE INDEX IF NOT EXISTS executions_token ON executions(tokenId, fundedAt DESC)",
  "CREATE INDEX IF NOT EXISTS executions_claim ON executions(fundingClaimId)",
  "CREATE INDEX IF NOT EXISTS executions_due ON executions(status, nextAttemptAt)",
  `CREATE UNIQUE INDEX IF NOT EXISTS executions_one_active ON executions(tokenId)
     WHERE status IN ('preparing','submitted','confirmed')`,
  "CREATE UNIQUE INDEX IF NOT EXISTS packs_machine ON packs(machineId)",
  "CREATE UNIQUE INDEX IF NOT EXISTS cards_execution ON cards(executionId)",
  "CREATE UNIQUE INDEX IF NOT EXISTS cards_mint ON cards(nftMint)",
  "CREATE INDEX IF NOT EXISTS cards_recipient ON cards(recipient, awardedAt DESC)",
  `CREATE UNIQUE INDEX IF NOT EXISTS tokenBuybacks_one_active ON tokenBuybacks(treasuryId)
     WHERE status IN ('preparing','swap_submitted','swap_confirmed','burn_submitted')`,
  "CREATE INDEX IF NOT EXISTS tokenBuybacks_due ON tokenBuybacks(status, nextAttemptAt)",
] as const;
