import { apiJson } from "../../../lib/api-security";
import { getStore } from "../../../src/server/runtime";
import { publicRouteError } from "../../../src/server/route-errors";

/** Public list of live tokens from the same store used by the page SSR. */
export function GET(): Response {
  try {
    const tokens = getStore()
      .listLive()
      .map((token) => ({
        name: token.name,
        symbol: token.symbol,
        image: token.image,
        mint: token.mint,
        priceUsd: token.priceUsd,
        collectedMicros: token.collectedMicros,
        spentMicros: token.spentMicros,
      }));
    return apiJson({ tokens });
  } catch (error) {
    return publicRouteError(error);
  }
}
