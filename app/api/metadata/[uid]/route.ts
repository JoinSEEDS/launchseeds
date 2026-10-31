import { apiJson, extractPathMint } from "../../../../lib/api-security";
import { getStore } from "../../../../src/server/runtime";
import { publicRouteError } from "../../../../src/server/route-errors";

/** Public token metadata served using the authoritative launch record. */
export function GET(request: Request): Response {
  try {
    const store = getStore();
    const token = store.token(
      store.liveTokenId(extractPathMint(request, "/api/metadata")),
    );
    return apiJson({
      name: token.name,
      symbol: token.symbol,
      description: token.description,
      image: token.image,
      external_url: token.website,
      extensions: { twitter: token.x, telegram: token.telegram },
    });
  } catch (error) {
    return publicRouteError(error);
  }
}
