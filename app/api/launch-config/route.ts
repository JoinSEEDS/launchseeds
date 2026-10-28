import { apiJson } from "../../../lib/api-security";
import { getOperationalLaunchReadiness } from "../../../src/server/launch-health";
import { getFreeLaunchService } from "../../../src/server/runtime";

/** Configuration and actual operational launch readiness are not synonymous. */
export async function GET(): Promise<Response> {
  const readiness = await getOperationalLaunchReadiness();
  const free = readiness.enabled ? await getFreeLaunchService().catch(() => null) : null;
  const freeAvailable = free ? await free.available().catch(() => false) : false;
  return apiJson(
    {
      launchEnabled: readiness.enabled,
      baseFeeLamports: readiness.baseFeeLamports,
      configReady: readiness.configReady,
      workerReady: readiness.workerReady,
      rpcReady: readiness.rpcReady,
      checkedAt: readiness.checkedAt,
      freeLaunch: { available: freeAvailable, bits: free?.config.bits ?? null },
      imageGeneration: process.env.LAUNCHSEEDS_IMAGE_GENERATION === "true",
      sniperBundles: process.env.LAUNCHSEEDS_LAUNCH_BUNDLES === "true",
      message: readiness.enabled
        ? "Final funding requirements are confirmed during preparation."
        : "Token launches are temporarily unavailable. Do not send funds.",
    },
    200,
    { "cache-control": "no-store" },
  );
}
