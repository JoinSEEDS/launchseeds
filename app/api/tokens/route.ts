import { apiJson } from "../../../lib/api-security";
import { getStore } from "../../../src/server/runtime";
import { publicRouteError } from "../../../src/server/route-errors";

import { catalogRows, readCatalogInput } from "../../../src/server/launch-catalog";

/** Public list of live tokens from the same store used by the page SSR. */
export function GET(request: Request = new Request("http://localhost/api/tokens")): Response {
  try {
    const store=getStore();
    const {rows,...pagination}=catalogRows(store,{...readCatalogInput(new URL(request.url).searchParams),filter:"live"});
    const tokens = rows.map(row=>store.view(row))
      .map((token) => ({
        name: token.name,
        symbol: token.symbol,
        image: token.image,
        mint: token.mint,
        priceUsd: token.priceUsd,
        marketCapUsd: token.marketCapUsd,
      }));
    return apiJson({ tokens, pagination });
  } catch (error) {
    return publicRouteError(error);
  }
}
