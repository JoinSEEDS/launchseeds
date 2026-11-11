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
    add(input: { key: string; capability: string; wallet: string; inputJson: string; now: number; scheduledFor?: number }) {
      return db.launchQueue.insert({ key: input.key, capability: input.capability, wallet: input.wallet, inputJson: input.inputJson, createdAt: input.now, scheduledFor: input.scheduledFor ?? null, status: "waiting" });
    },
    /** The latest launch time given to any request still waiting or already started. */
    lastSlot() {
      return db.launchQueue.select().where({ status: { $in: ["waiting", "started"] } } as never).max("scheduledFor") as number | null;
    },
    /** Marks a waiting request started (with its coin) or failed; false if it no longer waited. */
    finish(id: number, patch: { status: "started" | "failed"; tokenId?: number; error?: string | null; startedAt: number }) {
      return db.launchQueue.select().where({ id, status: "waiting" }).updateAll(patch as never) > 0;
    },
    /** An admin lets a waiting request launch; false if it no longer waits or was approved. */
    approve(id: number, wallet: string, now: number) {
      return db.launchQueue.select().where({ id, status: "waiting", approvedAt: { $isNull: true } } as never).updateAll({ approvedAt: now, approvedBy: wallet } as never) > 0;
    },
    /** Started or refused requests since `since`, newest first. */
    recent(since: number) {
      return db.launchQueue.select().where({ status: { $in: ["started", "failed"] }, createdAt: { $gte: since } } as never).orderBy("id", "desc").limit(20).all();
    },
    byId(id: number) {
      return db.launchQueue.select().where({ id }).get() ?? null;
    },
    note(id: number, error: string | null) {
      db.launchQueue.select().where({ id }).updateAll({ error });
    },
  };
}
