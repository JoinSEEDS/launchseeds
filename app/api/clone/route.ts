import {
  ApiError,
  apiJson,
  requireSameOriginRead,
} from "../../../lib/api-security";
import { IngressRateLimiter } from "../../../lib/trusted-client";
import { publicRouteError } from "../../../src/server/route-errors";
import { cloneCoin } from "../../../src/server/clone-coin";
import { createRpcConnection } from "../../../src/server/rpc-pacing";

// Each clone reads the chain and fetches metadata and an image: keep it modest.
const limiter = new IngressRateLimiter("coin-clone", 30, 600_000, 500);

/** Launch-form clone: an existing coin's name, ticker, links and image (data URL).
 * Only our own pages may call it (it fetches on the caller's behalf). */
export async function GET(request: Request): Promise<Response> {
  try {
    requireSameOriginRead(request);
    if (!limiter.check(request).allowed)
      throw new ApiError("Too many clone requests. Try again later.", 429);
    const mint = new URL(request.url).searchParams.get("mint")?.trim() ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))
      throw new ApiError("Enter a token contract address.");
    const rpc = process.env.SOLANA_RPC_URL;
    if (!rpc) throw new ApiError("Cloning is not available.", 503);
    try {
      return apiJson(
        await cloneCoin(createRpcConnection(rpc, "confirmed"), mint),
        200,
        { "cache-control": "no-store" },
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        error instanceof Error && /mint|metadata/i.test(error.message)
          ? error.message
          : "That coin could not be read.",
        404,
      );
    }
  } catch (error) {
    return publicRouteError(error);
  }
}
