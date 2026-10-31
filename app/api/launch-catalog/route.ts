import { apiJson } from "../../../lib/api-security";
import { getStore } from "../../../src/server/runtime";
import { launchCatalog, readCatalogInput } from "../../../src/server/launch-catalog";
import { publicRouteError } from "../../../src/server/route-errors";
export function GET(request: Request) {
  try { return apiJson(launchCatalog(getStore(),readCatalogInput(new URL(request.url).searchParams))); }
  catch(error) { return publicRouteError(error); }
}
