import {
  ApiError,
  apiJson,
  readBoundedJson,
  requireSameOrigin,
} from "../../../../../lib/api-security";
import { IngressRateLimiter } from "../../../../../lib/trusted-client";
import { publicRouteError } from "../../../../../src/server/route-errors";
import { getStore } from "../../../../../src/server/runtime";
import { createRpcConnection } from "../../../../../src/server/rpc-pacing";
import { address } from "../../../../../src/shared/domain";
import {
  prepareTrade,
  TradeError,
  TRADE_SLIPPAGE_PERCENTS,
} from "../../../../../src/server/coin-trade";
import { parseSol } from "../../../../../lib/launch-ui";

// Each quote reads the curve and simulates: keep it modest per visitor.
const limiter = new IngressRateLimiter("coin-trade", 60, 600_000, 500);

/** `{ wallet, side: "buy", sol }` or `{ wallet, side: "sell", percent }`, with
 * `slippage` (percent): an unsigned transaction for that wallet to sign. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed)
      throw new ApiError("Too many trade requests. Try again later.", 429);
    const uid = (await params).uid;
    const store = getStore();
    const token =
      store.repo.tokens.getByMint(uid) ?? store.repo.tokens.getByHandle(uid);
    if (!token?.mint || token.status !== "live")
      throw new ApiError("Coin not found.", 404);
    const rpc = process.env.SOLANA_RPC_URL;
    if (!rpc) throw new ApiError("Trading is not available.", 503);
    const body = await readBoundedJson<Record<string, unknown>>(request, 1024);
    const wallet = address.parse(body.wallet);
    const slippagePercent = Number(body.slippage);
    if (
      !(TRADE_SLIPPAGE_PERCENTS as readonly number[]).includes(slippagePercent)
    )
      throw new ApiError("Choose a slippage.", 400);
    const connection = createRpcConnection(rpc, "confirmed");
    try {
      if (body.side === "buy") {
        const lamports =
          typeof body.sol === "string" ? parseSol(body.sol.trim()) : null;
        if (lamports === null)
          throw new ApiError("Enter an amount of SOL to buy.", 400);
        return apiJson(
          await prepareTrade(connection, {
            side: "buy",
            wallet,
            mint: token.mint,
            lamports,
            slippagePercent,
          }),
          200,
          { "cache-control": "no-store" },
        );
      }
      if (body.side === "sell") {
        const percent = Number(body.percent);
        return apiJson(
          await prepareTrade(connection, {
            side: "sell",
            wallet,
            mint: token.mint,
            percent,
            slippagePercent,
          }),
          200,
          { "cache-control": "no-store" },
        );
      }
      throw new ApiError("Choose buy or sell.", 400);
    } catch (error) {
      if (error instanceof TradeError) throw new ApiError(error.message, 422);
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && !(error instanceof ApiError))
      console.error("Trade quote failed", error.message.slice(0, 300));
    return publicRouteError(error);
  }
}
