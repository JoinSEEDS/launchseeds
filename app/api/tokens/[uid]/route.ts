import { apiJson, extractPathId } from "../../../../lib/api-security";
import { getStore } from "../../../../src/server/runtime";
import { publicRouteError } from "../../../../src/server/route-errors";

/** Token details never expose the launch idempotency capability or funding internals. */
export function GET(request: Request): Response {
  try {
    const uid = extractPathId(request, "/api/tokens");
    const store = getStore();
    const token = store.token(uid);
    if (token.status !== "live") {
      return apiJson({ error: "Token not found." }, 404);
    }
    return apiJson(store.publicToken(uid));
  } catch (error) {
    return publicRouteError(error);
  }
}
