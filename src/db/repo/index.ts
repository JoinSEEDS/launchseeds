/** One public persistence surface, internally split by table. The API and bgrun workers
 * call application services, which use these methods; neither calls SQL directly.
 * All methods are synchronous. Never await HTTP/RPC within tx().
 */
import { launchCatalogRepo } from "./launch-catalog";
import { userBatchesRepo } from "./user-batches";
import type { LaunchseedsDatabase } from "../connection";
import { scheduledPlansRepo } from "./scheduled-plans";
import { tokenRepo } from "./tokens";
import { depositRepo } from "./deposits";
import { challengesRepo } from "./challenges";

export function createRepo(db: LaunchseedsDatabase) {
  const r = {
    userBatches: userBatchesRepo(db),
    launchCatalog: launchCatalogRepo(db),
    scheduledPlans: scheduledPlansRepo(db),
    tokens: tokenRepo(db),
    deposits: depositRepo(db),
    challenges: challengesRepo(db),
  };

  return {
    ...r,
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
