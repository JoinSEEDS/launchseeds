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

/** Prepare a scheduled launch and its real funding address. */
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
        settings?: unknown;
        deployerKey?: unknown;
      }
    >(request, 32_768);
    const { deployerKey, ...launchRequest } = payload;
    if (deployerKey !== undefined && typeof deployerKey !== "string") throw new ApiError("Enter a valid private key.", 400);
    let settings;
    try {
      settings = parseLaunchSettings(payload.settings);
      if(process.env.LAUNCHSEEDS_USER_BATCHES==="true"&&!settings.userBatches)throw new ApiError("The launch form has changed. Reload to configure fully funded batches.",409);
      if (!settings.publishMint) throw new ApiError("Publish the reserved CA with the launch plan.",400);
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
      launchRequest,
      capability,
      undefined,
      settings,
      deployerKey || undefined,
    );
    notifyLaunchWorker();
    return apiJson(status, 201);
  } catch (error) {
    return publicRouteError(error);
  }
}
