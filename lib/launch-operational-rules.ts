/** Pure, fail-closed launch admission rules. No network or database calls. */
export const MAX_WORKER_HEARTBEAT_AGE_MS = 30_000;
export const MAX_WORKER_COMPLETED_CYCLE_AGE_MS = 150_000;
export const MAX_RPC_PROBE_AGE_MS = 20_000;
export const MAX_CYCLE_DURATION_MS = 180_000;

export type ReadinessBlocker =
  | "launch_disabled"
  | "operations_disabled"
  | "worker_disabled"
  | "configuration_incomplete"
  | "trusted_ingress_unavailable"
  | "base_fee_invalid"
  | "worker_missing"
  | "worker_stopped"
  | "worker_unhealthy"
  | "worker_stale"
  | "worker_cycle_stalled"
  | "rpc_unreachable"
  | "rpc_stale";

export interface OperationalInput {
  now: number;
  flags: { launch: boolean; live: boolean; worker: boolean };
  config: {
    rpc: boolean;
    publicBase: boolean;
    signedIngress: boolean;
    feeLamports: number | null;
  };
  worker: {
    active: boolean;
    healthy: boolean;
    heartbeatAt: number;
    cycleStartedAt: number;
    completedAt: number;
  } | null;
  rpc: { healthy: boolean; checkedAt: number; slot: number } | null;
}

export interface OperationalReadiness {
  enabled: boolean;
  blockers: ReadinessBlocker[];
  configReady: boolean;
  workerReady: boolean;
  rpcReady: boolean;
  baseFeeLamports: number | null;
  checkedAt: number;
}

const recent = (timestamp: number, now: number, maximumAge: number) =>
  Number.isSafeInteger(timestamp) &&
  timestamp > 0 &&
  timestamp <= now + 5_000 &&
  now - timestamp <= maximumAge;

export function assessLaunchReadiness(
  input: OperationalInput,
): OperationalReadiness {
  const blockers: ReadinessBlocker[] = [];
  if (!input.flags.launch) blockers.push("launch_disabled");
  if (!input.flags.live) blockers.push("operations_disabled");
  if (!input.flags.worker) blockers.push("worker_disabled");
  if (!input.config.signedIngress) blockers.push("trusted_ingress_unavailable");
  if (!input.config.rpc || !input.config.publicBase)
    blockers.push("configuration_incomplete");
  const fee = input.config.feeLamports;
  if (fee === null || !Number.isSafeInteger(fee) || fee <= 0)
    blockers.push("base_fee_invalid");

  const worker = input.worker;
  if (!worker) blockers.push("worker_missing");
  else {
    if (!worker.active) blockers.push("worker_stopped");
    if (!worker.healthy) blockers.push("worker_unhealthy");
    if (
      !recent(worker.heartbeatAt, input.now, MAX_WORKER_HEARTBEAT_AGE_MS) ||
      !recent(worker.completedAt, input.now, MAX_WORKER_COMPLETED_CYCLE_AGE_MS)
    )
      blockers.push("worker_stale");
    if (
      worker.cycleStartedAt > worker.completedAt &&
      input.now - worker.cycleStartedAt > MAX_CYCLE_DURATION_MS
    )
      blockers.push("worker_cycle_stalled");
  }

  if (
    !input.rpc?.healthy ||
    !Number.isSafeInteger(input.rpc.slot) ||
    input.rpc.slot <= 0
  )
    blockers.push("rpc_unreachable");
  else if (!recent(input.rpc.checkedAt, input.now, MAX_RPC_PROBE_AGE_MS))
    blockers.push("rpc_stale");

  const configReady = !blockers.some((b) =>
    [
      "launch_disabled",
      "operations_disabled",
      "worker_disabled",
      "configuration_incomplete",
      "base_fee_invalid",
      "trusted_ingress_unavailable",
    ].includes(b),
  );
  const workerReady = !blockers.some((b) => b.startsWith("worker_"));
  const rpcReady = !blockers.some((b) => b.startsWith("rpc_"));
  return {
    enabled: blockers.length === 0,
    blockers,
    configReady,
    workerReady,
    rpcReady,
    baseFeeLamports: configReady && fee !== null ? fee : null,
    checkedAt: input.now,
  };
}
