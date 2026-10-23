/** Shared worker liveness and bounded RPC proof for launch admission.
 *
 * An environment flag only expresses operator intent. A launch may expose a
 * deposit address only after a healthy worker cycle and a successful finalized
 * RPC probe. This is not a guarantee of future uptime; deposits remain an
 * operational responsibility and are never accepted on configuration alone.
 */
import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { solToLamports } from "../shared/domain";
import {
  assessLaunchReadiness,
  type OperationalReadiness,
} from "../../lib/launch-operational-rules";
import { RequestCache } from "../../lib/request-cache";

export interface WorkerHeartbeat {
  workerId: string;
  active: boolean;
  healthy: boolean;
  heartbeatAt: number;
  cycleStartedAt: number;
  completedAt: number;
  lastError: string;
}

export class WorkerHealthRepository {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS worker_health (
        name TEXT PRIMARY KEY CHECK(name='launch-worker'),
        worker_id TEXT NOT NULL,
        active INTEGER NOT NULL,
        healthy INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        cycle_started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        last_error TEXT NOT NULL
      )`);
  }
  close() {
    this.db.close();
  }
  read(): WorkerHeartbeat | null {
    const row = this.db
      .query(`SELECT * FROM worker_health WHERE name='launch-worker'`)
      .get() as {
      worker_id: string;
      active: number;
      healthy: number;
      heartbeat_at: number;
      cycle_started_at: number;
      completed_at: number;
      last_error: string;
    } | null;
    return (
      row && {
        workerId: row.worker_id,
        active: row.active === 1,
        healthy: row.healthy === 1,
        heartbeatAt: row.heartbeat_at,
        cycleStartedAt: row.cycle_started_at,
        completedAt: row.completed_at,
        lastError: row.last_error,
      }
    );
  }
  /** Starting a new process immediately invalidates the old worker's proof. */
  begin(workerId: string = randomUUID(), now = Date.now()): string {
    this.db
      .query(
        `INSERT INTO worker_health
      (name,worker_id,active,healthy,heartbeat_at,cycle_started_at,completed_at,last_error)
      VALUES('launch-worker',?,1,0,?,0,0,'')
      ON CONFLICT(name) DO UPDATE SET worker_id=excluded.worker_id,
      active=1,healthy=0,heartbeat_at=excluded.heartbeat_at,
      cycle_started_at=0,completed_at=0,last_error=''`,
      )
      .run(workerId, now);
    return workerId;
  }
  startCycle(workerId: string, now = Date.now()): boolean {
    return (
      this.db
        .query(
          `UPDATE worker_health SET cycle_started_at=?,heartbeat_at=?,healthy=0
      WHERE name='launch-worker' AND worker_id=? AND active=1`,
        )
        .run(now, now, workerId).changes === 1
    );
  }
  /** Periodically proves the process is still alive between 60s cycles. */
  touch(workerId: string, now = Date.now()): boolean {
    return (
      this.db
        .query(
          `UPDATE worker_health SET heartbeat_at=?
      WHERE name='launch-worker' AND worker_id=? AND active=1`,
        )
        .run(now, workerId).changes === 1
    );
  }

  finishCycle(
    workerId: string,
    healthy: boolean,
    error = "",
    now = Date.now(),
  ): boolean {
    return (
      this.db
        .query(
          `UPDATE worker_health
      SET heartbeat_at=?,completed_at=?,healthy=?,last_error=?
      WHERE name='launch-worker' AND worker_id=? AND active=1`,
        )
        .run(now, now, healthy ? 1 : 0, error.slice(0, 200), workerId)
        .changes === 1
    );
  }
  stop(workerId: string, now = Date.now()): boolean {
    return (
      this.db
        .query(
          `UPDATE worker_health SET active=0,healthy=0,heartbeat_at=?
      WHERE name='launch-worker' AND worker_id=?`,
        )
        .run(now, workerId).changes === 1
    );
  }
}

let singleton: WorkerHealthRepository | null = null;
export function getWorkerHealth() {
  return (singleton ??= new WorkerHealthRepository(
    process.env.LAUNCHSEEDS_WORKER_HEALTH_DB_PATH ||
      "./data/launchseeds-worker-health.sqlite",
  ));
}

export interface RpcProbe {
  healthy: boolean;
  checkedAt: number;
  slot: number;
}
const rpcCache = new RequestCache<RpcProbe>(5_000, 4);

/** No private RPC credentials or raw transport errors are returned to clients. */
export async function probeFinalizedRpc(
  url: string,
  now = Date.now(),
): Promise<RpcProbe> {
  if (!url || !/^https?:\/\//.test(url))
    return { healthy: false, checkedAt: now, slot: 0 };
  return rpcCache.get(
    url,
    async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getLatestBlockhash",
            params: [{ commitment: "finalized" }],
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok)
          return { healthy: false, checkedAt: Date.now(), slot: 0 };
        const data = (await response.json()) as {
          result?: {
            context?: { slot?: number };
            value?: { blockhash?: string };
          };
          error?: unknown;
        };
        const slot = data.result?.context?.slot ?? 0;
        const blockhash = data.result?.value?.blockhash;
        return {
          healthy:
            !data.error &&
            Number.isSafeInteger(slot) &&
            slot > 0 &&
            typeof blockhash === "string" &&
            blockhash.length > 20,
          checkedAt: Date.now(),
          slot,
        };
      } catch {
        return { healthy: false, checkedAt: Date.now(), slot: 0 };
      }
    },
    now,
  );
}

export async function getOperationalLaunchReadiness(
  now = Date.now(),
): Promise<OperationalReadiness> {
  const rpcUrl = process.env.SOLANA_RPC_URL || "";
  let baseFeeLamports: number | null = null;
  try {
    if (process.env.LAUNCH_BASE_SOL)
      baseFeeLamports = solToLamports(process.env.LAUNCH_BASE_SOL);
  } catch {
    /* Fail closed for an invalid fee configuration. */
  }
  // The read is independent of the launch service so a broken provider
  // bootstrap cannot make the public readiness endpoint throw or lie.
  let worker: WorkerHeartbeat | null = null;
  try {
    worker = getWorkerHealth().read();
  } catch {
    /* fail closed */
  }
  const rpc = await probeFinalizedRpc(rpcUrl, now);
  const assessed = assessLaunchReadiness({
    now,
    flags: {
      launch: process.env.LAUNCHSEEDS_LAUNCH_ENABLED === "true",
      live: process.env.LAUNCHSEEDS_LIVE_OPERATIONS === "true",
      worker: process.env.LAUNCHSEEDS_WORKER_ENABLED === "true",
    },
    config: {
      rpc: Boolean(rpcUrl),
      signedIngress:
        (process.env.LAUNCHSEEDS_EDGE_CLIENT_SECRET?.length ?? 0) >= 32,
      publicBase: Boolean(process.env.PUBLIC_BASE_URL?.startsWith("https://")),
      feeLamports: baseFeeLamports,
    },
    worker,
    rpc,
  });
  // Displaying a fixed quoted fee does not imply that accepting funds is enabled.
  return { ...assessed, baseFeeLamports };
}
