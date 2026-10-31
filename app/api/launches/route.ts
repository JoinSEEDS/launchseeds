import { currentBrand } from "../../../src/server/site-brand";
import { notifyLaunchWorker } from "../../../src/server/launch-wake";
import {
  ApiError,
  apiJson,
  readBoundedJson,
  requireSameOrigin,
} from "../../../lib/api-security";
import { getLaunchService } from "../../../src/server/runtime";
import { getOperationalLaunchReadiness } from "../../../src/server/launch-health";
import { publicRouteError } from "../../../src/server/route-errors";
import type { LaunchInput } from "../../../src/shared/domain";
import { parseLaunchSettings } from "../../../src/domain/launch-settings";
import { IngressRateLimiter } from "../../../lib/trusted-client";

// One bounded in-process fuse for this route. Trusted ingress must enforce
// per-client quotas; untrusted forwarding headers are never used as identities.
const launchLimit = new IngressRateLimiter("launch", 5, 10 * 60_000);

/** Prepare a real funding address for a governed token's initial strategy. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const throttle = launchLimit.check(request);
    if (!throttle.allowed) {
      return apiJson(
        { error: "Too many launch attempts. Retry shortly." },
        429,
        { "Retry-After": String(throttle.retryAfterSeconds) },
      );
    }
    const readiness = await getOperationalLaunchReadiness();
    if (!readiness.enabled) {
      return apiJson(
        {
          error:
            "Token launches are temporarily unavailable. No payment is required.",
        },
        503,
      );
    }
    const payload = await readBoundedJson<
      LaunchInput & {
        firstStrategy?: unknown;
        settings?: unknown;
      }
    >(request, 32_768);
    let settings;
    try {
      settings = parseLaunchSettings(payload.settings);
      if(process.env.LAUNCHSEEDS_USER_BATCHES==="true"&&!settings.userBatches)throw new ApiError("The launch form has changed. Reload to configure fully funded batches.",409);
      if (currentBrand().kind === "launchseeds" && !settings.publishMint) throw new ApiError("Publish the reserved CA with the launch plan.",400);
      if (currentBrand().kind === "launchseeds" && settings.profitPolicy?.mode === "token") throw new ApiError("Choose a profit wallet or buy and burn.",400);
      if (settings.scheduledAt === null)
        throw new ApiError(
          "Choose a scheduled launch time and publish the wallet allocation.",
          400,
        );
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : "Invalid launch settings.",
        400,
      );
    }
    const capability =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    if (!/^[a-f0-9]{64}$/.test(capability)) {
      throw new ApiError("Invalid launch request key.", 400);
    }
    const service = await getLaunchService();
    const status = await service.create(
      {
        ...payload,
      },
      capability,
      undefined,
      settings,
    );
    notifyLaunchWorker();
    return apiJson(status, 201);
  } catch (error) {
    return publicRouteError(error);
  }
}
