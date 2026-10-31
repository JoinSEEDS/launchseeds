import { currentBrand } from "../../../../src/server/site-brand";
import {
  ApiError,
  requireSameOrigin,
  readBoundedJson,
} from "../../../../lib/api-security";
import {
  normalizeStrategy,
  assertStrategyAllowed,
} from "../../../../lib/strategy";
import { persistConfig } from "../../../../lib/governance";
import { parseLaunchSettings } from "../../../../src/domain/launch-settings";
import { getOperationalLaunchReadiness } from "../../../../src/server/launch-health";
import type { LaunchInput } from "../../../../src/shared/domain";
import { apiJson, extractPathHandle } from "../../../../lib/api-security";
import { getLaunchService } from "../../../../src/server/runtime";
import { publicRouteError } from "../../../../src/server/route-errors";

/** Pending launch status is read-only and recoverable by its private handle. */
export async function GET(request: Request): Promise<Response> {
  try {
    const handle = extractPathHandle(request, "/api/launches");
    const service = await getLaunchService();
    // Authorization is only an ephemeral retry capability, never a draft edit
    // key, and is not necessary to see the public funding progress.
    const capability =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    const status = capability
      ? service.status(handle, capability)
      : service.publicStatus(handle);
    return apiJson(status);
  } catch (error) {
    return publicRouteError(error);
  }
}

/** Revise immutable-at-launch settings only while the same funding wallet remains unfunded. */
export async function PATCH(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const handle = extractPathHandle(request, "/api/launches");
    if (!(await getOperationalLaunchReadiness()).enabled)
      throw new ApiError("Launch edits are temporarily unavailable.", 503);
    const payload = await readBoundedJson<Record<string, unknown>>(
      request,
      32_768,
    );
    let settings;
    let firstStrategy = null;
    try {
      settings = parseLaunchSettings(payload.settings);
      if (currentBrand().kind === "launchseeds" && !settings.publishMint) throw new ApiError("Publish the reserved CA with the launch plan.",400);
      if (currentBrand().kind === "launchseeds" && settings.profitPolicy?.mode === "token") throw new ApiError("Choose a profit wallet or buy and burn.",400);
      if (settings.scheduledAt === null) {
        const proposed = await normalizeStrategy(payload.firstStrategy);
        assertStrategyAllowed(proposed, settings.holderRewards);
        firstStrategy = persistConfig(proposed);
      }
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : "Invalid launch choices",
        400,
      );
    }
    const capability =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    if (!/^[a-f0-9]{64}$/.test(capability))
      throw new ApiError("A valid launch session is required to edit.", 401);
    const { firstStrategy: _first, settings: _settings, ...fields } = payload;
    const status = await (
      await getLaunchService()
    ).amend(
      handle,
      { ...fields } as LaunchInput,
      capability,
      settings,
      firstStrategy,
    );
    return apiJson(status);
  } catch (error) {
    return publicRouteError(error);
  }
}
