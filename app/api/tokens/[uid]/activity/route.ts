import { ApiError, apiJson } from "../../../../../lib/api-security";
import { publicRouteError } from "../../../../../src/server/route-errors";
import { getStore } from "../../../../../src/server/runtime";
import { coinTrades } from "../../../../../src/server/coin-activity";

/** A live coin's recent trades. */
export async function GET(_request: Request, { params }: { params: Promise<{ uid: string }> }): Promise<Response> {
  try {
    const store = getStore();
    const uid = (await params).uid;
    const token = store.repo.tokens.getByMint(uid) ?? store.repo.tokens.getByHandle(uid);
    if (!token?.mint || token.status !== "live") throw new ApiError("Coin not found.", 404);
    const trades = await coinTrades(token.mint).catch(() => []);
    return apiJson({
      trades,
    }, 200, { "cache-control": "no-store" });
  } catch (error) {
    return publicRouteError(error);
  }
}
