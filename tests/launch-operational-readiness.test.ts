import { describe, expect, test } from "bun:test";
import {
  assessLaunchReadiness,
  MAX_WORKER_HEARTBEAT_AGE_MS,
  type OperationalInput,
} from "../lib/launch-operational-rules";
import { WorkerHealthRepository } from "../src/server/launch-health";

const NOW = 1_800_000_000_000;
function healthy(overrides: Partial<OperationalInput> = {}): OperationalInput {
  return {
    now: NOW,
    flags: { launch: true, live: true, worker: true },
    config: {
      rpc: true,
      publicBase: true,
      signedIngress: true,
      feeLamports: 20_000_000,
    },
    worker: {
      active: true,
      healthy: true,
      heartbeatAt: NOW - 1_000,
      cycleStartedAt: NOW - 8_000,
      completedAt: NOW - 2_000,
    },
    rpc: { healthy: true, checkedAt: NOW - 1_000, slot: 100 },
    ...overrides,
  };
}

describe("operational launch admission", () => {
  test("a fully healthy worker and finalized RPC probe allow preparation", () => {
    const result = assessLaunchReadiness(healthy());
    expect(result.enabled).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.baseFeeLamports).toBe(20_000_000);
  });
  test("enabled flags without a worker heartbeat cannot accept funds", () => {
    const result = assessLaunchReadiness(healthy({ worker: null }));
    expect(result.enabled).toBe(false);
    expect(result.configReady).toBe(true);
    expect(result.blockers).toContain("worker_missing");
  });
  test("a stopped worker invalidates an otherwise healthy configuration", () => {
    const base = healthy();
    expect(
      assessLaunchReadiness(
        healthy({ worker: { ...base.worker!, active: false } }),
      ).blockers,
    ).toContain("worker_stopped");
  });
  test("an unhealthy cycle blocks funding regardless of the last heartbeat", () => {
    const base = healthy();
    const result = assessLaunchReadiness(
      healthy({ worker: { ...base.worker!, healthy: false } }),
    );
    expect(result.blockers).toContain("worker_unhealthy");
  });
  test("worker heartbeat expiry is enforced", () => {
    const base = healthy();
    const stale = assessLaunchReadiness(
      healthy({
        worker: {
          ...base.worker!,
          heartbeatAt: NOW - MAX_WORKER_HEARTBEAT_AGE_MS - 1,
        },
      }),
    );
    expect(stale.blockers).toContain("worker_stale");
  });
  test("missing finalized RPC evidence blocks launches", () => {
    const result = assessLaunchReadiness(healthy({ rpc: null }));
    expect(result.blockers).toContain("rpc_unreachable");
  });
  test("a successfully contacted RPC is not sufficient without a recent slot", () => {
    const result = assessLaunchReadiness(
      healthy({ rpc: { healthy: true, slot: 0, checkedAt: NOW } }),
    );
    expect(result.enabled).toBe(false);
    expect(result.blockers).toContain("rpc_unreachable");
  });
  test("an old RPC probe cannot authorize a launch", () => {
    const result = assessLaunchReadiness(
      healthy({ rpc: { healthy: true, slot: 11, checkedAt: NOW - 30_000 } }),
    );
    expect(result.blockers).toContain("rpc_stale");
  });
  test("missing or malformed launch fee cannot be advertised", () => {
    const invalid = assessLaunchReadiness(
      healthy({
        config: {
          rpc: true,
          publicBase: true,
          signedIngress: true,
          feeLamports: 0,
        },
      }),
    );
    expect(invalid.enabled).toBe(false);
    expect(invalid.baseFeeLamports).toBeNull();
    expect(invalid.blockers).toContain("base_fee_invalid");
  });
  test("a long stalled cycle blocks preparation even with a recent heartbeat", () => {
    const base = healthy();
    const stalled = assessLaunchReadiness(
      healthy({
        worker: {
          ...base.worker!,
          cycleStartedAt: NOW - 200_000,
          completedAt: NOW - 210_000,
        },
      }),
    );
    expect(stalled.blockers).toContain("worker_cycle_stalled");
  });
  test("missing signed trusted ingress blocks launch even with a live worker", () => {
    const result = assessLaunchReadiness(
      healthy({
        config: {
          rpc: true,
          publicBase: true,
          signedIngress: false,
          feeLamports: 20_000_000,
        },
      }),
    );
    expect(result.configReady).toBe(false);
    expect(result.blockers).toContain("trusted_ingress_unavailable");
  });
  test("configuration and operational status remain distinct", () => {
    const result = assessLaunchReadiness(
      healthy({ flags: { launch: false, worker: true, live: true } }),
    );
    expect(result.configReady).toBe(false);
    expect(result.workerReady).toBe(true);
    expect(result.rpcReady).toBe(true);
    expect(result.enabled).toBe(false);
  });
});

describe("durable worker heartbeat", () => {
  test("heartbeats sustain a long active cycle without bypassing stalled-cycle checks", () => {
    const repo = new WorkerHealthRepository(":memory:");
    try {
      const id=repo.begin("long-cycle",NOW-60_000);
      repo.startCycle(id,NOW-59_000);
      repo.finishCycle(id,true,"",NOW-50_000);
      repo.startCycle(id,NOW-40_000);
      expect(assessLaunchReadiness(healthy({worker:repo.read()})).enabled).toBe(false);
      repo.touch(id,NOW);
      expect(assessLaunchReadiness(healthy({worker:repo.read()})).enabled).toBe(true);
      repo.touch(id,NOW+190_000);
      const result=assessLaunchReadiness(healthy({now:NOW+190_000,worker:repo.read(),rpc:{healthy:true,checkedAt:NOW+190_000,slot:100}}));
      expect(result.enabled).toBe(false);
      expect(result.blockers).toContain("worker_cycle_stalled");
    } finally {repo.close();}
  });
  test("only a successful cycle permits worker health", () => {
    const repo = new WorkerHealthRepository(":memory:");
    try {
      const id = repo.begin("one", NOW);
      expect(repo.read()?.healthy).toBe(false);
      expect(repo.startCycle(id, NOW + 1)).toBe(true);
      expect(repo.finishCycle(id, true, "", NOW + 100)).toBe(true);
      expect(repo.read()?.completedAt).toBe(NOW + 100);
      expect(repo.read()?.healthy).toBe(true);
      expect(repo.stop(id, NOW + 200)).toBe(true);
      expect(repo.read()?.healthy).toBe(false);
      expect(repo.read()?.active).toBe(false);
    } finally {
      repo.close();
    }
  });
  test("new process fences out an older process's heartbeat", () => {
    const repo = new WorkerHealthRepository(":memory:");
    try {
      repo.begin("old", NOW);
      repo.begin("new", NOW + 5);
      expect(repo.startCycle("old", NOW + 6)).toBe(false);
      expect(repo.finishCycle("old", true, "", NOW + 7)).toBe(false);
      expect(repo.stop("old", NOW + 8)).toBe(false);
      expect(repo.read()?.workerId).toBe("new");
      expect(repo.read()?.healthy).toBe(false);
    } finally {
      repo.close();
    }
  });
  test("failed cycles remain unhealthy", () => {
    const repo = new WorkerHealthRepository(":memory:");
    try {
      const id = repo.begin("worker", NOW);
      repo.startCycle(id, NOW + 100);
      repo.finishCycle(id, false, "rpc down", NOW + 200);
      expect(repo.read()?.healthy).toBe(false);
      expect(repo.read()?.lastError).toBe("rpc down");
    } finally {
      repo.close();
    }
  });
  test("an ongoing normal cycle preserves the last successful result", () => {
    const repo = new WorkerHealthRepository(":memory:");
    try {
      const id = repo.begin("worker", NOW);
      repo.startCycle(id, NOW + 1);
      expect(repo.read()?.healthy).toBe(false);
      repo.finishCycle(id, true, "", NOW + 100);
      repo.startCycle(id, NOW + 60_000);
      expect(repo.read()?.healthy).toBe(true);
      expect(repo.read()?.completedAt).toBe(NOW + 100);
      repo.finishCycle(id, false, "rpc down", NOW + 60_100);
      repo.startCycle(id, NOW + 120_000);
      expect(repo.read()?.healthy).toBe(false);
    } finally {
      repo.close();
    }
  });
  test("restart requires a fresh successful cycle", () => {
    const repo = new WorkerHealthRepository(":memory:");
    try {
      const id = repo.begin("one", NOW);
      repo.startCycle(id, NOW + 100);
      repo.finishCycle(id, true, "", NOW + 200);
      expect(repo.read()?.healthy).toBe(true);
      repo.begin("two", NOW + 300);
      expect(repo.read()?.healthy).toBe(false);
      expect(repo.read()?.completedAt).toBe(0);
    } finally {
      repo.close();
    }
  });
});
