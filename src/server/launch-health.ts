/** Shared worker liveness and bounded RPC proof for launch admission.
 *
 * An environment flag only expresses operator intent. A launch may expose a
 * deposit address only after a healthy worker cycle and a successful finalized
 * RPC probe. This is not a guarantee of future uptime; deposits remain an
 * operational responsibility and are never accepted on configuration alone.
 */
import { randomUUID } from "node:crypto";
import { openDatabase, type LaunchseedsDatabase } from "../db/connection";
import { getStore } from "./runtime";
import { solToLamports } from "../shared/domain";
import {
  assessLaunchReadiness,
  type OperationalReadiness,
} from "../../lib/launch-operational-rules";
import { RequestCache } from "../../lib/request-cache";
import { trustedIngressActive } from "../../lib/trusted-client";
import { rpcFetch } from "./rpc-pacing";
import { rpcUrlList } from "./rpc-urls";

export interface WorkerHeartbeat {
  workerId: string;
  active: boolean;
  healthy: boolean;
  heartbeatAt: number;
  cycleStartedAt: number;
  completedAt: number;
  lastError: string;
}

/** Stored in the main LaunchSeeds database (table `workerHealth`). A path opens a
 * private database, which tests use with ":memory:". */
const WORKER = "launch-worker" as const;
export class WorkerHealthRepository {
  private readonly db: LaunchseedsDatabase;
  private readonly owned: boolean;
  constructor(source: string | LaunchseedsDatabase) {
    this.owned = typeof source === "string";
    this.db = typeof source === "string" ? openDatabase(source) : source;
  }
  close() {
    if (this.owned) this.db.close();
  }
  private row() {
    return this.db.workerHealth.select().where({ name: WORKER }).get();
  }
  read(): WorkerHeartbeat | null {
    const row = this.row();
    return (
      row && {
        workerId: row.workerId,
        active: row.active,
        healthy: row.healthy,
        heartbeatAt: row.heartbeatAt,
        cycleStartedAt: row.cycleStartedAt,
        completedAt: row.completedAt,
        lastError: row.lastError,
      }
    );
  }
  /** Starting a new process immediately invalidates the old worker's proof. */
  begin(workerId: string = randomUUID(), now = Date.now()): string {
    this.db.workerHealth.upsert(
      { name: WORKER },
      {
        name: WORKER,
        workerId,
        active: true,
        healthy: false,
        heartbeatAt: now,
        cycleStartedAt: 0,
        completedAt: 0,
        lastError: "",
      },
    );
    return workerId;
  }
  /** Only the currently registered, active worker may write its heartbeat. */
  private own(workerId: string, patch: Partial<WorkerHeartbeat>, activeOnly = true) {
    return (
      this.db.workerHealth
        .select()
        .where({ name: WORKER, workerId, ...(activeOnly ? { active: true } : {}) })
        .updateAll(patch) === 1
    );
  }
  startCycle(workerId: string, now = Date.now()): boolean {
    // A normal cycle does not invalidate the last completed result. Admission
    // still rejects failed cycles, stale proofs, stalled cycles and restarts.
    return this.own(workerId, { cycleStartedAt: now, heartbeatAt: now });
  }
  /** Periodically proves the process is still alive between 60s cycles. */
  touch(workerId: string, now = Date.now()): boolean {
    return this.own(workerId, { heartbeatAt: now });
  }

  finishCycle(
    workerId: string,
    healthy: boolean,
    error = "",
    now = Date.now(),
  ): boolean {
    return this.own(workerId, {
      heartbeatAt: now,
      completedAt: now,
      healthy,
      lastError: error.slice(0, 200),
    });
  }
  stop(workerId: string, now = Date.now()): boolean {
    return this.own(workerId, { active: false, healthy: false, heartbeatAt: now }, false);
  }
}

let singleton: WorkerHealthRepository | null = null;
export function getWorkerHealth() {
  return (singleton ??= new WorkerHealthRepository(getStore().data.database));
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
        const response = await rpcFetch(url, {
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

/** A primary endpoint's cooldown must not disable launches while a configured
 * backup can prove finalized chain access. Each probe is bounded and coalesced. */
export async function probeConfiguredRpc(
  urls: string[], now = Date.now(),
  probe: (url: string, now: number) => Promise<RpcProbe> = probeFinalizedRpc,
): Promise<RpcProbe> {
  try {
    return await Promise.any([...new Set(urls)].map(async url => {
      const result = await probe(url, now);
      if (!result.healthy) throw new Error("RPC probe failed");
      return result;
    }));
  } catch {
    return { healthy: false, checkedAt: Date.now(), slot: 0 };
  }
}

export async function getOperationalLaunchReadiness(
  now = Date.now(),
): Promise<OperationalReadiness> {
  const startedAt = Date.now();
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
  const rpc = await probeConfiguredRpc(rpcUrlList(rpcUrl), now);
  const assessed = assessLaunchReadiness({
    now: now + (Date.now() - startedAt),
    flags: {
      launch: process.env.LAUNCHSEEDS_LAUNCH_ENABLED === "true",
      live: process.env.LAUNCHSEEDS_LIVE_OPERATIONS === "true",
      worker: process.env.LAUNCHSEEDS_WORKER_ENABLED === "true",
    },
    config: {
      rpc: Boolean(rpcUrl),
      signedIngress: trustedIngressActive(),
      feeLamports: baseFeeLamports,
    },
    worker,
    rpc,
  });
  // Displaying a fixed quoted fee does not imply that accepting funds is enabled.
  return { ...assessed, baseFeeLamports };
}
