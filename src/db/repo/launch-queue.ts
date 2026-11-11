import type { SqlDb } from "./util";

/** Signed free-launch requests waiting for the treasury, in arrival order. */
export function launchQueueRepo(db: SqlDb) {
  return {
    byCapability(capability: string) {
      return db.launchQueue.select().where({ capability }).get() ?? null;
    },
    byKey(key: string) {
      return db.launchQueue.select().where({ key }).get() ?? null;
    },
    waiting() {
      return db.launchQueue.select().where({ status: "waiting" }).orderBy("id", "asc").all();
    },
    add(input: { key: string; capability: string; wallet: string; inputJson: string; now: number }) {
      return db.launchQueue.insert({ key: input.key, capability: input.capability, wallet: input.wallet, inputJson: input.inputJson, createdAt: input.now, status: "waiting" });
    },
    /** Marks a waiting request started (with its coin) or failed; false if it no longer waited. */
    finish(id: number, patch: { status: "started" | "failed"; tokenId?: number; error?: string | null; startedAt: number }) {
      return db.launchQueue.select().where({ id, status: "waiting" }).updateAll(patch as never) > 0;
    },
    note(id: number, error: string | null) {
      db.launchQueue.select().where({ id }).updateAll({ error });
    },
  };
}
