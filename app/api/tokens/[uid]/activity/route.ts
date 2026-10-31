import { ApiError, apiJson } from "../../../../../lib/api-security";
import { publicRouteError } from "../../../../../src/server/route-errors";
import { getStore } from "../../../../../src/server/runtime";
import { coinTrades } from "../../../../../src/server/coin-activity";
import { raffleLeaderboard } from "../../../../../src/server/draws";

/** A live coin's recent trades and its gravity ranking (top 50). */
export async function GET(_request: Request, { params }: { params: Promise<{ uid: string }> }): Promise<Response> {
  try {
    const store = getStore();
    const uid = (await params).uid;
    const token = store.repo.tokens.getByMint(uid) ?? store.repo.tokens.getByHandle(uid);
    if (!token?.mint || token.status !== "live") throw new ApiError("Coin not found.", 404);
    const board = raffleLeaderboard(store, token.id);
    const trades = await coinTrades(token.mint).catch(() => []);
    return apiJson({
      trades,
      gravity: { total: board.totalGravity, holders: board.holders.slice(0, 50).map((h) => ({ wallet: h.wallet, balance: h.balance, gravity: h.gravity, share: h.probability })) },
    }, 200, { "cache-control": "no-store" });
  } catch (error) {
    return publicRouteError(error);
  }
}
