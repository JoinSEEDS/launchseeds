import {
  adminError,
  adminResponse,
  requireAdmin,
} from "../../../../lib/admin/security";
import {
  getOperationalLaunchReadiness,
  getWorkerHealth,
} from "../../../../src/server/launch-health";

export async function GET(request: Request): Promise<Response> {
  try {
    requireAdmin(request);
    const now = Date.now();
    // No raw RPC URL, wallet keys, worker error stack or provider credentials.
    let worker = null;
    try {
      worker = getWorkerHealth().read();
    } catch {
      /* No health DB: unavailable */
    }
    const readiness = await getOperationalLaunchReadiness(now);
    return adminResponse({
      checkedAt: now,
      worker: worker
        ? {
            active: worker.active,
            healthy: worker.healthy,
            heartbeatAt: worker.heartbeatAt,
            completedAt: worker.completedAt,
            ageSeconds: Math.max(
              0,
              Math.floor((now - worker.heartbeatAt) / 1000),
            ),
            stale: now - worker.heartbeatAt > 120_000,
            workerId: worker.workerId,
          }
        : null,
      launch: {
        enabled: readiness.enabled,
        configReady: readiness.configReady,
        workerReady: readiness.workerReady,
        rpcReady: readiness.rpcReady,
      },
    });
  } catch (error) {
    return adminError(error);
  }
}
