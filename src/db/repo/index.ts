/** One public persistence surface, internally split by table. The API and bgrun workers
 * call application services, which use these methods; neither calls SQL directly.
 * All methods are synchronous. Never await HTTP/RPC within tx().
 */
import { launchCatalogRepo } from "./launch-catalog";
import { userBatchesRepo } from "./user-batches";
import type { LaunchseedsDatabase } from "../connection";
import { rewardApprovalsRepo } from "./reward-approvals";
import { scheduledPlansRepo } from "./scheduled-plans";
import { operationsRepo } from "./operations";
import { tokenRepo } from "./tokens";
import { depositRepo } from "./deposits";
import { holderRepo } from "./holders";
import { strategyRepo } from "./strategies";
import { voteRepo } from "./votes";
import { treasuryRepo } from "./treasuries";
import { ledgerRepo } from "./ledger";
import { feeClaimRepo } from "./fee-claims";
import { feeRepo } from "./fees";
import { executionRepo } from "./executions";
import { packRepo } from "./packs";
import { cardRepo } from "./cards";
import { tokenBuybackRepo } from "./token-buybacks";
import { freeLaunchRepo } from "./free-launches";
import { agentRepo } from "./agents";
import { drawRepo } from "./draws";
import { stockWinRepo } from "./stock-wins";
import { marketMakerRepo } from "./market-maker";
import { launchBundlesRepo } from "./launch-bundles";
import { bundleRewardsRepo } from "./bundle-rewards";
import { siteVotesRepo } from "./site-votes";
import { readRepo } from "./reads";

export function createRepo(db: LaunchseedsDatabase) {
  const r = {
    userBatches: userBatchesRepo(db),
    launchCatalog: launchCatalogRepo(db),
    rewardApprovals: rewardApprovalsRepo(db),
    scheduledPlans: scheduledPlansRepo(db),
    operations: operationsRepo(db),
    tokens: tokenRepo(db),
    deposits: depositRepo(db),
    holders: holderRepo(db),
    strategies: strategyRepo(db),
    votes: voteRepo(db),
    treasuries: treasuryRepo(db),
    ledger: ledgerRepo(db),
    feeClaims: feeClaimRepo(db),
    fees: feeRepo(db),
    executions: executionRepo(db),
    packs: packRepo(db),
    cards: cardRepo(db),
    tokenBuybacks: tokenBuybackRepo(db),
    freeLaunches: freeLaunchRepo(db),
    agents: agentRepo(db),
    draws: drawRepo(db),
    stockWins: stockWinRepo(db),
    marketMaker: marketMakerRepo(db),
    launchBundles: launchBundlesRepo(db),
    bundleRewards: bundleRewardsRepo(db),
    siteVotes: siteVotesRepo(db),
  };
  return {
    ...r,
    reads: readRepo(db, r),
    /** BEGIN IMMEDIATE (sqlite-zod-orm default), automatic rollback on throw. */
    tx<T>(fn: (tx: typeof r) => T): T {
      if (fn.constructor.name === "AsyncFunction")
        throw new Error("Repository transactions must be synchronous");
      return db.transaction(() => {
        const result = fn(r);
        if (result && typeof (result as { then?: unknown }).then === "function")
          throw new Error("Repository transactions must be synchronous");
        return result;
      });
    },
  };
}
export type Repos = Omit<ReturnType<typeof createRepo>, "tx">;
export type LaunchseedsRepo = ReturnType<typeof createRepo>;
