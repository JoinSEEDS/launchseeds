import { apiJson } from "../../../lib/api-security";
import { getOperationalLaunchReadiness } from "../../../src/server/launch-health";

/** Configuration and actual operational launch readiness are not synonymous. */
export async function GET(): Promise<Response> {
  const readiness = await getOperationalLaunchReadiness();
  return apiJson(
    {
      launchEnabled: readiness.enabled,
      baseFeeLamports: readiness.baseFeeLamports,
      configReady: readiness.configReady,
      workerReady: readiness.workerReady,
      rpcReady: readiness.rpcReady,
      checkedAt: readiness.checkedAt,
      message: readiness.enabled
        ? "Final funding requirements are confirmed during preparation."
        : "Token launches are temporarily unavailable. Do not send funds.",
    },
    200,
    { "cache-control": "no-store" },
  );
}
