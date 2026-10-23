import { apiJson, extractPathId } from "../../../../lib/api-security";
import { getLaunchService } from "../../../../src/server/runtime";
import { publicRouteError } from "../../../../src/server/route-errors";

/** Pending launch status is read-only and recoverable by its public UID. */
export async function GET(request: Request): Promise<Response> {
  try {
    const uid = extractPathId(request, "/api/launches");
    const service = await getLaunchService();
    // Authorization is only an ephemeral retry capability, never a draft edit
    // key, and is not necessary to see the public funding progress.
    const capability =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    const status = capability
      ? service.status(uid, capability)
      : service.publicStatus(uid);
    return apiJson(status);
  } catch (error) {
    return publicRouteError(error);
  }
}
