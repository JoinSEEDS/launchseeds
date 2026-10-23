import { Connection } from "@solana/web3.js";
import {
  remainingFunding,
  buildFundingTransaction,
} from "../../../lib/funding-transaction";
import {
  ApiError,
  apiJson,
  readBoundedJson,
  requireSameOrigin,
} from "../../../lib/api-security";
import { getLaunchService } from "../../../src/server/runtime";
import { getOperationalLaunchReadiness } from "../../../src/server/launch-health";
import { publicRouteError } from "../../../src/server/route-errors";
import { IngressRateLimiter } from "../../../lib/trusted-client";

const limiter = new IngressRateLimiter("launch-payment", 15, 60_000);
const walletPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const uidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Generate an unsigned SOL funding transfer, bound to one launch and payer.
 * The server never signs or sends funds. The user's wallet shows the
 * transaction for explicit confirmation. The worker verifies deposits later.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const limit = limiter.check(request);
    if (!limit.allowed)
      throw new ApiError("Too many payment attempts. Try again shortly.", 429);
    const readiness = await getOperationalLaunchReadiness();
    if (!readiness.enabled)
      throw new ApiError("Token launches are not available at this time.", 503);
    const { uid, wallet } = await readBoundedJson<{
      uid?: unknown;
      wallet?: unknown;
    }>(request, 2048);
    if (
      typeof uid !== "string" ||
      !uidPattern.test(uid) ||
      typeof wallet !== "string" ||
      !walletPattern.test(wallet)
    )
      throw new ApiError("Invalid launch or wallet address.");
    const capability =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    if (!/^[a-f0-9]{64}$/.test(capability))
      throw new ApiError("Launch authorization required.", 403);
    const service = await getLaunchService();
    let status;
    try {
      status = service.status(uid, capability);
    } catch {
      throw new ApiError("Launch not found.", 404);
    }
    if (remainingFunding(status) === null)
      throw new ApiError("This launch is not accepting funds.", 409);
    const endpoint = process.env.SOLANA_RPC_URL;
    if (!endpoint)
      throw new ApiError("Launch payment is temporarily unavailable.", 503);
    const connection = new Connection(endpoint, "confirmed");
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    return apiJson(
      buildFundingTransaction({
        launch: status,
        payer: wallet,
        blockhash,
        lastValidBlockHeight,
      }),
    );
  } catch (error) {
    return publicRouteError(error);
  }
}
