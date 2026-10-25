import { apiJson, extractPathMint } from "../../../../lib/api-security";
import { getStore } from "../../../../src/server/runtime";
import { publicRouteError } from "../../../../src/server/route-errors";

/** Token details never expose the launch idempotency capability or funding internals. */
export function GET(request: Request): Response {
  try {
    const store = getStore();
    const tokenId = store.liveTokenId(extractPathMint(request, "/api/tokens"));
    return apiJson(store.publicToken(tokenId));
  } catch (error) {
    return publicRouteError(error);
  }
}
