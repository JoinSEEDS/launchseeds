/** One public persistence surface, internally split by table. The API and bgrun workers
 * call application services, which use these methods; neither calls SQL directly.
 * All methods are synchronous. Never await HTTP/RPC within tx().
 */
import type { LaunchseedsDatabase } from "../connection";
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
import { readRepo } from "./reads";

export function createRepo(db: LaunchseedsDatabase) {
  const r = {
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
  };
  return {
    ...r,
    reads: readRepo(db, r),
    /** BEGIN IMMEDIATE (sqlite-zod-orm default), automatic rollback on throw. */
    tx<T>(fn: (tx: typeof r) => T): T {
      return db.transaction(() => fn(r));
    },
  };
}
export type Repos = Omit<ReturnType<typeof createRepo>, "tx">;
export type LaunchseedsRepo = ReturnType<typeof createRepo>;
