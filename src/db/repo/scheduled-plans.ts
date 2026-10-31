import type { SqlDb } from "./util";
import { schemas, type NewRows } from "../schema";
export function scheduledPlansRepo(db: SqlDb) {
  return {
    byHash(planHash: string) {
      return db.scheduledPlans.select().where({ planHash }).get() ?? null;
    },
    byToken(tokenId: number) {
      return db.scheduledPlans.select().where({ tokenId }).get() ?? null;
    },
    save(input: NewRows["scheduledPlans"]) {
      const value = schemas.scheduledPlans.parse(input);
      const row = db.scheduledPlans
        .select()
        .where({ tokenId: input.tokenId })
        .get();
      if (row) db.scheduledPlans.update(row.id, value);
      else db.scheduledPlans.insert(value);
    },
  };
}
